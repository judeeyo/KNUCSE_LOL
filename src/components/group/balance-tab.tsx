"use client";

import { useState, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Shuffle, Check, Users, Zap } from "lucide-react";
import type { PlayerStats } from "@/lib/stats";
import type { Group, Lane } from "@/lib/types";
import { getBalancerPlayers, balanceTeams, derivePreferredLanes, type BalancerPlayer } from "@/lib/stats";

const LANE_EMOJI: Record<string, string> = {
  top: "🛡️", jungle: "🌿", mid: "🔥", adc: "🏹", support: "💚",
};
const LANE_LABEL: Record<string, string> = {
  top: "탑", jungle: "정글", mid: "미드", adc: "원딜", support: "서포터",
};

const TIER_COLORS: Record<string, string> = {
  "실버": "text-gray-300",
  "골드": "text-yellow-400",
  "플래티넘": "text-teal-300",
  "에메랄드": "text-emerald-400",
  "다이아": "text-blue-400",
  "마스터": "text-purple-400",
};

function getTierColor(tier?: string): string {
  if (!tier) return "text-ink-subtle";
  const base = tier.split(" ")[0];
  return TIER_COLORS[base] || "text-ink-subtle";
}

export function BalanceTab({ playerStats, group }: { playerStats: PlayerStats[]; group: Group }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<{ team1: BalancerPlayer[]; team2: BalancerPlayer[]; diff: number } | null>(null);

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

  const togglePlayer = (nickname: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(nickname)) next.delete(nickname);
      else if (next.size < 10) next.add(nickname);
      return next;
    });
    setResult(null);
  };

  const handleBalance = () => {
    const selectedPlayers = allPlayers.filter((p) => selected.has(p.nickname));
    const balanced = balanceTeams(selectedPlayers);
    setResult(balanced);
  };

  const selectAll = () => {
    if (selected.size === Math.min(allPlayers.length, 10)) {
      setSelected(new Set());
    } else {
      setSelected(new Set(allPlayers.slice(0, 10).map((p) => p.nickname)));
    }
    setResult(null);
  };

  return (
    <div className="space-y-6">
      {/* Instructions */}
      <Card className="flex items-center gap-3 py-3 px-4">
        <Users size={18} className="text-primary shrink-0" />
        <p className="text-sm text-ink-muted">
          참여할 플레이어를 선택하면 솔랭 티어 + 내전 전적(승률·판수 비중↑)을 종합해서 팀을 추천하고,
          10명일 때는 선호 포지션 우선순위까지 고려해 라인을 배정합니다.
          선호 포지션은 설정값이 없으면 <span className="text-primary">전적(라인별 판수)</span>에서 자동 반영되며, <span className="text-primary">선수 정보</span> 탭에서 직접 설정하거나 프로필에 저장할 수 있습니다.
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
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-ink text-sm">{player.nickname}</span>
                    {memberTier && (
                      <span className={`text-xs font-bold ${getTierColor(memberTier)}`}>
                        {memberTier}
                      </span>
                    )}
                  </div>
                  {player.gamesPlayed > 0 && (
                    <span className="text-xs text-ink-subtle">
                      {player.gamesPlayed}판 · {player.winRate.toFixed(0)}% · KDA {player.avgKda.toFixed(2)}
                    </span>
                  )}
                </div>

                <span className="text-xs text-ink-subtle font-mono w-10 text-right">
                  {player.score.toFixed(1)}
                </span>
              </div>
            );
          })}
        </div>
      </div>

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

      {/* Result */}
      {result && (
        <div className="space-y-4">
          <div className="flex items-center justify-center gap-2">
            <Zap size={16} className="text-primary" />
            <span className="text-sm font-medium text-ink">
              팀 편성 완료 — 점수 차이: <span className="text-primary font-bold">{result.diff.toFixed(2)}</span>
            </span>
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
    <Card className={`border-l-4 ${borderColor}`}>
      <div className="flex items-center justify-between mb-3">
        <span className={`text-sm font-bold px-2 py-0.5 rounded ${labelBg}`}>{label}</span>
        <span className="text-xs text-ink-subtle font-mono">총 {total.toFixed(1)}점</span>
      </div>
      <div className="space-y-2">
        {team.map((p) => (
          <div key={p.nickname} className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-2">
              {p.assignedLane && (
                <span
                  className="text-xs w-14 shrink-0 text-ink-muted"
                  title={p.preferredLanes?.length ? `선호: ${p.preferredLanes.map((l) => LANE_LABEL[l]).join(" > ")}` : "선호 포지션 미설정"}
                >
                  {LANE_EMOJI[p.assignedLane]} {LANE_LABEL[p.assignedLane]}
                </span>
              )}
              <span className="font-medium text-ink">{p.nickname}</span>
              {tiers[p.nickname] && (
                <span className={`text-xs font-bold ${getTierColor(tiers[p.nickname])}`}>
                  {tiers[p.nickname]}
                </span>
              )}
            </div>
            <div className="flex items-center gap-3 text-xs text-ink-subtle">
              {p.gamesPlayed > 0 && (
                <>
                  <span>{p.winRate.toFixed(0)}%</span>
                  <span>KDA {p.avgKda.toFixed(2)}</span>
                </>
              )}
              <span className="font-mono">{p.score.toFixed(1)}</span>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
