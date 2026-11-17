"use client";

import { useState, useMemo } from "react";
import { StatTable, stickyHead } from "@/components/ui/stat-table";
import { Modal } from "@/components/ui/modal";
import { SearchInput } from "@/components/ui/search-input";
import { ChampionIcon } from "@/components/ui/champion-icon";
import { buildChampionStats, type ChampionStats } from "@/lib/stats";
import type { Group, Lane } from "@/lib/types";

type LaneFilter = "all" | Lane;

const LANE_TABS: { key: LaneFilter; label: string }[] = [
  { key: "all", label: "전체" },
  { key: "top", label: "🛡️ 탑" },
  { key: "jungle", label: "🌿 정글" },
  { key: "mid", label: "🔥 미드" },
  { key: "adc", label: "🏹 원딜" },
  { key: "support", label: "💚 서폿" },
];

// ─── PS(lol.ps) 방식 티어 산정 (승률·픽률 동일 가중 커스텀) ───
// PS점수 = 50 + 2.5×z(보정승률) + 2.5×z(픽률) + 0.5×z(밴률)
//   - z는 현재 라인 풀(2판 이상 챔피언) 내 표준화 값
//   - 승률은 판수 보정(스무딩): (승 + 2.5) / (판수 + 5)
// 티어 컷(PS점수 분포 기준): OP ≥ +1.75σ, 1티어 ≥ +1.25σ, 2티어 ≥ +0.5σ,
//   3티어 ≥ 평균, 4티어 ≥ -1.25σ, 5티어 < -1.25σ

interface PsEntry {
  score: number;
  tier: string; // "1" ~ "5"
  isOp: boolean;
}

const TIER_STYLE: Record<string, string> = {
  "1": "text-red-400",
  "2": "text-orange-400",
  "3": "text-yellow-400",
  "4": "text-blue-400",
  "5": "text-ink-subtle",
};

function zScorer(values: number[]): (v: number) => number {
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const sd = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length);
  return (v) => (sd > 0 ? (v - mean) / sd : 0);
}

function computePsTiers(champs: ChampionStats[]): Map<string, PsEntry> {
  const pool = champs.filter((c) => c.totalGames >= 2);
  const result = new Map<string, PsEntry>();
  if (pool.length === 0) return result;

  const smoothedWr = (c: ChampionStats) => ((c.wins + 2.5) / (c.totalGames + 5)) * 100;
  const zWr = zScorer(pool.map(smoothedWr));
  const zPick = zScorer(pool.map((c) => c.totalGames)); // 풀 내 상대 픽률 (z라 스케일 무관)
  const zBan = zScorer(pool.map((c) => c.banCount));

  const scores = pool.map(
    (c) => 50 + 2.5 * zWr(smoothedWr(c)) + 2.5 * zPick(c.totalGames) + 0.5 * zBan(c.banCount)
  );
  const zTier = zScorer(scores);

  pool.forEach((c, i) => {
    const z = zTier(scores[i]);
    const tier = z >= 1.25 ? "1" : z >= 0.5 ? "2" : z >= 0 ? "3" : z >= -1.25 ? "4" : "5";
    result.set(c.champion, { score: scores[i], tier, isOp: z >= 1.75 });
  });
  return result;
}

export function ChampionStatsTab({ group }: { group: Group }) {
  const [search, setSearch] = useState("");
  const [lane, setLane] = useState<LaneFilter>("all");
  const [selected, setSelected] = useState<ChampionStats | null>(null);

  const championStats = useMemo(
    () => buildChampionStats(group, lane === "all" ? undefined : lane),
    [group, lane]
  );

  // 1판만 플레이된 챔피언은 표본 부족으로 테이블에서 제외 (밴 전용 챔피언은 유지)
  const visible = useMemo(
    () => championStats.filter((c) => c.totalGames !== 1),
    [championStats]
  );

  const psTiers = useMemo(() => computePsTiers(visible), [visible]);

  const filtered = useMemo(() => {
    if (!search) return visible;
    return visible.filter((c) => c.champion.toLowerCase().includes(search.toLowerCase()));
  }, [visible, search]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      // 픽 기록 있는 챔피언 먼저 → PS점수 순, 밴 전용은 밴 수 순
      const pickDiff = (a.totalGames > 0 ? 0 : 1) - (b.totalGames > 0 ? 0 : 1);
      if (pickDiff !== 0) return pickDiff;
      if (a.totalGames === 0) return b.banCount - a.banCount;
      return (psTiers.get(b.champion)?.score ?? 0) - (psTiers.get(a.champion)?.score ?? 0);
    });
  }, [filtered, psTiers]);

  return (
    <div className="space-y-4">
      {/* Lane Tabs */}
      <div className="flex items-center gap-1 overflow-x-auto">
        {LANE_TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setLane(t.key)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium cursor-pointer whitespace-nowrap transition-fast ${
              lane === t.key
                ? "bg-primary/15 text-primary"
                : "text-ink-subtle hover:text-ink hover:bg-surface-1"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Controls */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <SearchInput
          className="flex-1 max-w-xs"
          placeholder="챔피언 검색..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <StatTable>
            <thead className={stickyHead}>
              <tr className="text-ink-subtle text-xs border-b border-hairline">
                <th className="text-center py-2.5 px-3 w-12">티어</th>
                <th className="text-left py-2.5 px-3">챔피언</th>
                <th className="text-center py-2.5 px-2" title="PS 방식: 50 + 2.5×z(보정승률) + 2.5×z(픽률) + 0.5×z(밴률)">PS점수</th>
                <th className="text-center py-2.5 px-2">판수</th>
                <th className="text-center py-2.5 px-2">승률</th>
                <th className="text-center py-2.5 px-2">KDA</th>
                <th className="text-center py-2.5 px-2">K/D/A</th>
                <th className="text-center py-2.5 px-2">CS</th>
                <th className="text-center py-2.5 px-2">밴</th>
                <th className="text-left py-2.5 px-2">플레이어</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((champ) => {
                const ps = psTiers.get(champ.champion);
                const banOnly = champ.totalGames === 0;
                return (
                  <tr
                    key={champ.champion}
                    className="border-b border-hairline/50 hover:bg-surface-1 transition-fast cursor-pointer"
                    onClick={() => setSelected(champ)}
                  >
                    <td className="text-center py-2.5 px-3">
                      {banOnly || !ps ? (
                        <span className="text-xs text-ink-tertiary">-</span>
                      ) : ps.isOp ? (
                        <span className="text-sm font-bold text-violet-400">OP</span>
                      ) : (
                        <span className={`text-sm font-bold ${TIER_STYLE[ps.tier]}`}>{ps.tier}</span>
                      )}
                    </td>
                    <td className="py-2.5 px-3">
                      <div className="flex items-center gap-2">
                        <ChampionIcon name={champ.champion} size={28} />
                        <span className="font-medium text-ink">{champ.champion}</span>
                      </div>
                    </td>
                    <td className="text-center py-2.5 px-2">
                      {banOnly || !ps ? (
                        <span className="text-ink-tertiary">-</span>
                      ) : (
                        <span className="font-bold text-primary">{ps.score.toFixed(1)}</span>
                      )}
                    </td>
                    <td className="text-center py-2.5 px-2 text-ink-muted">
                      {banOnly ? "-" : champ.totalGames}
                    </td>
                    <td className="text-center py-2.5 px-2">
                      {banOnly ? (
                        <span className="text-ink-tertiary">-</span>
                      ) : (
                        <span className={`font-semibold ${champ.winRate >= 55 ? "text-win" : champ.winRate < 45 ? "text-lose" : "text-ink"}`}>
                          {champ.winRate.toFixed(0)}%
                        </span>
                      )}
                    </td>
                    <td className="text-center py-2.5 px-2">
                      {banOnly ? (
                        <span className="text-ink-tertiary">-</span>
                      ) : (
                        <span className={champ.avgKda >= 3.5 ? "text-win" : champ.avgKda < 2 ? "text-lose" : "text-ink"}>
                          {champ.avgKda.toFixed(2)}
                        </span>
                      )}
                    </td>
                    <td className="text-center py-2.5 px-2 text-ink-muted text-xs font-mono">
                      {banOnly ? "-" : `${champ.avgKills.toFixed(1)}/${champ.avgDeaths.toFixed(1)}/${champ.avgAssists.toFixed(1)}`}
                    </td>
                    <td className="text-center py-2.5 px-2 text-ink-muted">
                      {banOnly ? "-" : Math.round(champ.avgCs)}
                    </td>
                    <td className="text-center py-2.5 px-2">
                      {champ.banCount > 0 ? (
                        <span className="text-xs">
                          <span className="text-lose font-semibold">{champ.banCount}회</span>
                          <span className="text-ink-tertiary ml-1">({champ.banRate.toFixed(0)}%)</span>
                        </span>
                      ) : (
                        <span className="text-ink-tertiary text-xs">-</span>
                      )}
                    </td>
                    <td className="py-2.5 px-2">
                      <div className="flex items-center gap-1">
                        {champ.players.slice(0, 3).map((p) => (
                          <span key={p.nickname} className="text-xs text-ink-subtle px-1.5 py-0.5 rounded bg-surface-2">
                            {p.nickname}
                          </span>
                        ))}
                        {champ.players.length > 3 && (
                          <span className="text-[10px] text-ink-tertiary">+{champ.players.length - 3}</span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
      </StatTable>

      {filtered.length === 0 && (
        <div className="text-center py-12 text-ink-subtle">
          {search
            ? "검색 결과가 없습니다"
            : lane !== "all"
              ? "해당 라인에 기록된 챔피언이 없습니다"
              : "아직 기록된 챔피언이 없습니다"}
        </div>
      )}

      {/* Tier Criteria */}
      <div className="border border-hairline rounded-lg overflow-hidden">
        <div className="bg-canvas px-4 py-2.5 border-b border-hairline">
          <span className="text-xs font-semibold text-ink-muted">티어 산정 기준 (PS 방식)</span>
        </div>
        <div className="px-4 py-3 space-y-2.5 text-xs text-ink-subtle">
          <p className="text-ink-muted">
            PS점수 = <span className="text-ink font-mono">50 + 2.5×z(보정승률) + 2.5×z(픽률) + 0.5×z(밴률)</span>
            <span className="text-ink-tertiary"> — 현재 라인 풀 내 표준점수(z) 기준, 승률은 판수 보정</span>
          </p>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
            <div className="flex items-center gap-1.5">
              <span className="text-violet-400 font-bold text-sm">OP</span>
              <span>+1.75σ 이상</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-red-400 font-bold text-sm">1</span>
              <span>+1.25σ 이상</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-orange-400 font-bold text-sm">2</span>
              <span>+0.5σ 이상</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-yellow-400 font-bold text-sm">3</span>
              <span>평균 이상</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-blue-400 font-bold text-sm">4</span>
              <span>-1.25σ 이상</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-ink-subtle font-bold text-sm">5</span>
              <span>-1.25σ 미만</span>
            </div>
          </div>
          <p className="text-ink-tertiary">
            lol.ps의 챔피언 티어 산정 방식(승률·픽률·밴률의 라인 내 표준점수 가중합)을 기반으로,
            승률과 픽률(선호도)을 동일 가중치로 반영합니다.
            1판만 플레이된 챔피언은 표본 부족으로 테이블에서 제외되며, 밴만 당한 챔피언은 하단에 표시됩니다.
          </p>
        </div>
      </div>

      {/* Champion Detail Modal */}
      <Modal
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected?.champion}
        className="max-w-md"
      >
        {selected && <ChampionDetail champ={selected} ps={psTiers.get(selected.champion)} />}
      </Modal>
    </div>
  );
}

function ChampionDetail({ champ, ps }: { champ: ChampionStats; ps?: PsEntry }) {
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <ChampionIcon name={champ.champion} size={48} className="rounded-lg" />
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="text-lg font-semibold text-ink">{champ.champion}</span>
            {ps && (
              ps.isOp ? (
                <span className="text-sm font-bold text-violet-400">OP</span>
              ) : (
                <span className={`text-sm font-bold ${TIER_STYLE[ps.tier]}`}>{ps.tier}티어</span>
              )
            )}
            {ps && <span className="text-xs text-ink-subtle">PS점수 {ps.score.toFixed(1)}</span>}
          </div>
          <div className="text-sm text-ink-subtle">
            {champ.totalGames > 0
              ? `${champ.totalGames}판 · ${champ.wins}승 ${champ.totalGames - champ.wins}패`
              : "픽 기록 없음"}
            {champ.banCount > 0 && (
              <span className="text-lose"> · 밴 {champ.banCount}회 ({champ.banRate.toFixed(0)}%)</span>
            )}
          </div>
        </div>
      </div>

      {/* Stats */}
      {champ.totalGames > 0 && (
      <div className="grid grid-cols-4 gap-2">
        <StatBox label="승률" value={`${champ.winRate.toFixed(0)}%`} color={champ.winRate >= 50 ? "text-win" : "text-lose"} />
        <StatBox label="KDA" value={champ.avgKda.toFixed(2)} color={champ.avgKda >= 3 ? "text-win" : undefined} />
        <StatBox label="CS" value={`${Math.round(champ.avgCs)}`} />
        <StatBox label="골드" value={`${Math.round(champ.avgGold).toLocaleString()}`} />
      </div>
      )}

      {champ.totalGames > 0 && (
      <div className="grid grid-cols-3 gap-2">
        <StatBox label="평균 킬" value={champ.avgKills.toFixed(1)} />
        <StatBox label="평균 데스" value={champ.avgDeaths.toFixed(1)} color="text-lose/80" />
        <StatBox label="평균 어시" value={champ.avgAssists.toFixed(1)} />
      </div>
      )}

      {/* Players */}
      {champ.players.length > 0 && (
        <div>
          <div className="text-xs text-ink-subtle mb-2">플레이어별 전적</div>
          <div className="space-y-1">
            {champ.players.map((p) => (
              <div key={p.nickname} className="flex items-center justify-between text-sm py-1.5 px-3 rounded-md bg-surface-2/50">
                <span className="text-ink font-medium">{p.nickname}</span>
                <div className="flex items-center gap-3 text-xs">
                  <span className="text-ink-subtle">{p.games}판</span>
                  <span className={`font-semibold ${p.winRate >= 50 ? "text-win" : "text-lose"}`}>
                    {p.winRate.toFixed(0)}%
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StatBox({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="bg-surface-2/50 rounded-md p-2.5 text-center">
      <div className="text-[10px] text-ink-tertiary">{label}</div>
      <div className={`text-sm font-semibold mt-0.5 ${color || "text-ink"}`}>{value}</div>
    </div>
  );
}
