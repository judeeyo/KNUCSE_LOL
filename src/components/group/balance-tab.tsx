"use client";

import { useState, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Shuffle, Check, Users, Zap, RefreshCw, AlertTriangle, X, Link2, Unlink } from "lucide-react";
import type { PlayerStats } from "@/lib/stats";
import type { Group, Lane } from "@/lib/types";
import {
  getBalancerPlayers,
  balanceOptions,
  derivePreferredLanes,
  recentRosters,
  type BalancerPlayer,
  type BalanceResult,
} from "@/lib/stats";

const LANE_EMOJI: Record<string, string> = {
  top: "🛡️", jungle: "🌿", mid: "🔥", adc: "🏹", support: "💚",
};
const LANE_LABEL: Record<string, string> = {
  top: "탑", jungle: "정글", mid: "미드", adc: "원딜", support: "서포터",
};

const TIER_COLORS: Record<string, string> = {
  "아이언": "text-stone-400",
  "브론즈": "text-orange-400",
  "실버": "text-gray-300",
  "골드": "text-yellow-400",
  "플래티넘": "text-teal-300",
  "에메랄드": "text-emerald-400",
  "다이아": "text-blue-400",
  "마스터": "text-purple-400",
  "그랜드마스터": "text-rose-400",
  "챌린저": "text-amber-300",
};

function getTierColor(tier?: string): string {
  if (!tier) return "text-ink-subtle";
  const base = tier.split(" ")[0];
  return TIER_COLORS[base] || "text-ink-subtle";
}

/** 점수 근거 (마우스를 올리면 표시) */
function scoreTitle(p: BalancerPlayer): string {
  const parts = p.parts;
  if (!parts) return "";
  const tier = parts.tierKnown ? `티어 ${parts.tierScore}` : `티어 미입력 → 평균 ${parts.tierScore}`;
  return `${tier} × ${Math.round((1 - parts.perfWeight) * 100)}% + 내전 성적 ${parts.perfScore} × ${Math.round(parts.perfWeight * 100)}%`;
}

type Pair = { a: string; b: string; kind: "together" | "apart" };

export function BalanceTab({ playerStats, group }: { playerStats: PlayerStats[]; group: Group }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [options, setOptions] = useState<BalanceResult[]>([]);
  const [optionIdx, setOptionIdx] = useState(0);
  const [ran, setRan] = useState(false);
  const [avoidRecent, setAvoidRecent] = useState(true);
  const [pairs, setPairs] = useState<Pair[]>([]);
  const [pairA, setPairA] = useState("");
  const [pairB, setPairB] = useState("");
  const [pairKind, setPairKind] = useState<Pair["kind"]>("together");
  const result = options[optionIdx] ?? null;

  const clearResult = () => {
    setOptions([]);
    setOptionIdx(0);
    setRan(false);
  };

  // Build tier overrides from member data
  const tierOverrides = useMemo(() => {
    const map: Record<string, string> = {};
    for (const m of group.members) {
      if (m.tier) map[m.nickname] = m.tier;
    }
    return map;
  }, [group]);

  // 선호 포지션: 선수 정보 탭에 설정된 값이 있으면 그걸 쓰고,
  // 없으면 전적(라인별 판수)에서 자동 도출해 모든 선수에게 한번에 적용
  const lanePrefs = useMemo(() => {
    const map: Record<string, Lane[]> = {};
    const memberByNick = new Map(group.members.map((m) => [m.nickname, m]));
    for (const p of playerStats) {
      const stored = memberByNick.get(p.nickname)?.preferredLanes;
      if (stored && stored.length > 0) {
        map[p.nickname] = stored;
      } else {
        const derived = derivePreferredLanes(p.laneStats);
        if (derived.length > 0) map[p.nickname] = derived;
      }
    }
    return map;
  }, [group, playerStats]);

  const allPlayers = useMemo(
    () => getBalancerPlayers(playerStats, tierOverrides, lanePrefs),
    [playerStats, tierOverrides, lanePrefs]
  );

  const selectedPlayers = allPlayers.filter((p) => selected.has(p.nickname));
  const missingTier = selectedPlayers.filter((p) => !p.parts?.tierKnown);
  const activePairs = pairs.filter((p) => selected.has(p.a) && selected.has(p.b));

  const togglePlayer = (nickname: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(nickname)) next.delete(nickname);
      else if (next.size < 10) next.add(nickname);
      return next;
    });
    clearResult();
  };

  const handleBalance = () => {
    const constraints = {
      together: activePairs.filter((p) => p.kind === "together").map((p) => [p.a, p.b] as [string, string]),
      apart: activePairs.filter((p) => p.kind === "apart").map((p) => [p.a, p.b] as [string, string]),
      avoidRosters: avoidRecent ? recentRosters(group.matches, 3) : [],
    };
    setOptions(balanceOptions(selectedPlayers, 5, constraints));
    setOptionIdx(0);
    setRan(true);
  };

  const selectAll = () => {
    if (selected.size === Math.min(allPlayers.length, 10)) {
      setSelected(new Set());
    } else {
      setSelected(new Set(allPlayers.slice(0, 10).map((p) => p.nickname)));
    }
    clearResult();
  };

  const addPair = () => {
    if (!pairA || !pairB || pairA === pairB) return;
    setPairs((prev) => [
      // 같은 두 사람의 기존 조건은 새 조건으로 바꾼다
      ...prev.filter((p) => !((p.a === pairA && p.b === pairB) || (p.a === pairB && p.b === pairA))),
      { a: pairA, b: pairB, kind: pairKind },
    ]);
    setPairA("");
    setPairB("");
    clearResult();
  };

  const selectedNames = selectedPlayers.map((p) => p.nickname);

  return (
    <div className="space-y-6">
      {/* Instructions */}
      <Card className="flex items-start gap-3 py-3 px-4">
        <Users size={18} className="text-primary shrink-0 mt-0.5" />
        <p className="text-sm text-ink-muted break-keep">
          참여할 플레이어를 고르면 솔랭 티어와 내전 전적을 합친 점수로 가능한 편성을 모두 비교해 가장 균형 잡힌 팀을 추천하고,
          10명일 때는 선호 포지션까지 고려해 라인을 배정합니다. 선호 포지션은 설정값이 없으면{" "}
          <span className="text-primary">전적(라인별 판수)</span>에서 자동으로 가져옵니다. 점수에 마우스를 올리면 계산 근거가 보입니다.
        </p>
      </Card>

      {/* Player Selection */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm text-ink-muted">
            참여자 선택 <span className="text-primary font-bold">{selected.size}</span>/10
          </div>
          <button
            onClick={selectAll}
            className="text-xs text-ink-subtle hover:text-primary cursor-pointer transition-fast"
          >
            {selected.size === Math.min(allPlayers.length, 10) ? "전체 해제" : "전체 선택"}
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
          {allPlayers.map((player) => {
            const isSelected = selected.has(player.nickname);
            const memberTier = tierOverrides[player.nickname];

            return (
              <div
                key={player.nickname}
                className={`flex items-center gap-3 p-3 rounded-xl border transition-fast cursor-pointer ${
                  isSelected
                    ? "bg-primary/5 border-primary/30"
                    : "bg-surface-1 border-hairline hover:border-hairline-strong"
                }`}
                onClick={() => togglePlayer(player.nickname)}
              >
                <div
                  className={`w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-fast ${
                    isSelected ? "bg-primary border-primary" : "border-hairline"
                  }`}
                >
                  {isSelected && <Check size={12} className="text-white" />}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-x-2">
                    <span className="font-medium text-ink text-sm break-all">{player.nickname}</span>
                    {memberTier && (
                      <span className={`text-xs font-bold ${getTierColor(memberTier)}`}>
                        {memberTier}
                      </span>
                    )}
                  </div>
                  {player.gamesPlayed > 0 && (
                    <span className="text-xs text-ink-subtle break-keep">
                      {player.gamesPlayed}판 · {player.winRate.toFixed(0)}% · KDA {player.avgKda.toFixed(2)}
                    </span>
                  )}
                </div>

                <span className="text-xs text-ink-subtle font-mono w-10 text-right shrink-0" title={scoreTitle(player)}>
                  {player.score.toFixed(1)}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Options */}
      <Card className="space-y-3">
        <div className="text-sm font-semibold text-ink">편성 옵션</div>
        <label className="flex items-start gap-2 text-sm text-ink-muted cursor-pointer break-keep">
          <input
            type="checkbox"
            checked={avoidRecent}
            onChange={(e) => {
              setAvoidRecent(e.target.checked);
              clearResult();
            }}
            className="mt-1 accent-[var(--primary)]"
          />
          <span>최근 3경기와 똑같은 팀 구성은 피하기 (같은 멤버로 연달아 할 때 매번 같은 팀이 나오지 않게)</span>
        </label>

        <div className="space-y-2">
          <div className="text-xs text-ink-subtle">두 사람 고정</div>
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
            <select
              value={pairA}
              onChange={(e) => setPairA(e.target.value)}
              aria-label="첫 번째 선수"
              className="min-w-0 w-full sm:w-40 bg-surface-1 border border-hairline rounded-lg px-2 py-1.5 text-sm text-ink"
            >
              <option value="">선수 선택</option>
              {selectedNames.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
            <select
              value={pairB}
              onChange={(e) => setPairB(e.target.value)}
              aria-label="두 번째 선수"
              className="min-w-0 w-full sm:w-40 bg-surface-1 border border-hairline rounded-lg px-2 py-1.5 text-sm text-ink"
            >
              <option value="">선수 선택</option>
              {selectedNames.filter((n) => n !== pairA).map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
            <div className="flex rounded-lg border border-hairline overflow-hidden text-xs justify-self-start">
              {(["together", "apart"] as const).map((k) => (
                <button
                  key={k}
                  onClick={() => setPairKind(k)}
                  className={`px-3 py-1.5 cursor-pointer whitespace-nowrap ${pairKind === k ? "bg-primary/15 text-primary" : "text-ink-subtle hover:text-ink"}`}
                >
                  {k === "together" ? "같은 팀" : "다른 팀"}
                </button>
              ))}
            </div>
            <Button size="sm" variant="secondary" className="justify-self-end sm:justify-self-auto" onClick={addPair} disabled={!pairA || !pairB || pairA === pairB}>
              추가
            </Button>
          </div>
          {selectedNames.length < 2 && <p className="text-xs text-ink-tertiary">참여자를 먼저 선택하세요.</p>}
          {pairs.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {pairs.map((p) => {
                const active = selected.has(p.a) && selected.has(p.b);
                return (
                  <span
                    key={`${p.a}|${p.b}`}
                    className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs max-w-full ${
                      active ? "border-primary/30 bg-primary/10 text-ink" : "border-hairline text-ink-tertiary line-through"
                    }`}
                    title={active ? undefined : "둘 중 한 명이 참여자가 아니라 적용되지 않음"}
                  >
                    {p.kind === "together" ? <Link2 size={12} className="shrink-0" /> : <Unlink size={12} className="shrink-0" />}
                    <span className="truncate">{p.a} · {p.b} {p.kind === "together" ? "같은 팀" : "다른 팀"}</span>
                    <button
                      aria-label="조건 삭제"
                      onClick={() => {
                        setPairs((prev) => prev.filter((x) => x !== p));
                        clearResult();
                      }}
                      className="text-ink-tertiary hover:text-ink cursor-pointer shrink-0"
                    >
                      <X size={12} />
                    </button>
                  </span>
                );
              })}
            </div>
          )}
        </div>
      </Card>

      {missingTier.length > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-mvp/30 bg-mvp/5 px-3 py-2.5 text-xs text-ink-muted break-keep">
          <AlertTriangle size={14} className="text-mvp shrink-0 mt-0.5" />
          <span>
            선택한 {selected.size}명 중 {missingTier.length}명은 솔랭 티어가 없어 평균 티어로 계산합니다
            ({missingTier.slice(0, 5).map((p) => p.nickname).join(", ")}{missingTier.length > 5 ? " 외" : ""}).
            내전 기록이 적을 때는 티어가 가장 확실한 실력 정보이니 <span className="text-primary">선수 정보</span> 탭에서 입력해 주세요.
          </span>
        </div>
      )}

      {/* Balance Button */}
      <div className="flex justify-center">
        <Button
          size="lg"
          onClick={handleBalance}
          disabled={selected.size < 2 || selected.size % 2 !== 0}
        >
          <Shuffle size={18} />
          팀 밸런스 ({selected.size}명)
        </Button>
      </div>

      {selected.size > 0 && selected.size % 2 !== 0 && (
        <p className="text-xs text-center text-ink-subtle">짝수 인원만 밸런스를 맞출 수 있습니다</p>
      )}

      {ran && options.length === 0 && (
        <p className="text-sm text-center text-lose break-keep">
          조건을 모두 만족하는 편성이 없습니다. 고정 조건이나 &quot;최근 경기와 같은 팀 피하기&quot;를 줄여 보세요.
        </p>
      )}

      {/* Result */}
      {result && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-2">
            <span className="flex items-center gap-1.5 text-sm font-medium text-ink">
              <Zap size={16} className="text-primary shrink-0" />
              {options.length > 1 ? `추천 ${optionIdx + 1}/${options.length}` : "팀 편성 완료"}
            </span>
            <span className="text-xs text-ink-subtle whitespace-nowrap">
              점수 차이 <span className="text-primary font-bold">{result.diff.toFixed(2)}</span>
            </span>
            {result.team1.some((p) => p.assignedLane) && (
              <span className="text-xs text-ink-subtle whitespace-nowrap" title="모두 1순위 포지션이면 100%">
                포지션 만족도 <span className="text-primary font-bold">{result.laneFit}%</span>
              </span>
            )}
            {options.length > 1 && (
              <Button size="sm" variant="secondary" onClick={() => setOptionIdx((i) => (i + 1) % options.length)}>
                <RefreshCw size={13} />
                다른 조합
              </Button>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <TeamCard team={result.team1} label="블루팀" color="blue" tiers={tierOverrides} />
            <TeamCard team={result.team2} label="레드팀" color="red" tiers={tierOverrides} />
          </div>
        </div>
      )}
    </div>
  );
}

function TeamCard({
  team,
  label,
  color,
  tiers,
}: {
  team: BalancerPlayer[];
  label: string;
  color: "blue" | "red";
  tiers: Record<string, string>;
}) {
  const total = team.reduce((s, p) => s + p.score, 0);
  const borderColor = color === "blue" ? "border-blue-500/30" : "border-red-500/30";
  const labelBg = color === "blue" ? "bg-blue-500/10 text-blue-400" : "bg-red-500/10 text-red-400";

  return (
    <Card className={`border-l-4 ${borderColor} min-w-0`}>
      <div className="flex items-center justify-between mb-3">
        <span className={`text-sm font-bold px-2 py-0.5 rounded ${labelBg}`}>{label}</span>
        <span className="text-xs text-ink-subtle font-mono">총 {total.toFixed(1)}점</span>
      </div>
      <div className="space-y-2">
        {team.map((p) => (
          <div key={p.nickname} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 text-sm">
            <div className="flex items-center gap-2 min-w-0">
              {p.assignedLane && (
                <span
                  className="text-xs w-14 shrink-0 text-ink-muted"
                  title={p.preferredLanes?.length ? `선호: ${p.preferredLanes.map((l) => LANE_LABEL[l]).join(" > ")}` : "선호 포지션 미설정"}
                >
                  {LANE_EMOJI[p.assignedLane]} {LANE_LABEL[p.assignedLane]}
                </span>
              )}
              <span className="font-medium text-ink break-all">{p.nickname}</span>
              {tiers[p.nickname] && (
                <span className={`text-xs font-bold ${getTierColor(tiers[p.nickname])}`}>
                  {tiers[p.nickname]}
                </span>
              )}
            </div>
            <div className="flex items-center gap-3 text-xs text-ink-subtle ml-auto whitespace-nowrap">
              {p.gamesPlayed > 0 && (
                <>
                  <span>{p.winRate.toFixed(0)}%</span>
                  <span>KDA {p.avgKda.toFixed(2)}</span>
                </>
              )}
              <span className="font-mono" title={scoreTitle(p)}>{p.score.toFixed(1)}</span>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
