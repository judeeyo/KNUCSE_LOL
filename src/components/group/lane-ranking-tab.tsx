"use client";

import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { buildLaneRankings, LANE_RANK_MIN_GAMES } from "@/lib/stats";
import type { Group, Lane } from "@/lib/types";

const LANE_META: Record<Lane, { label: string; emoji: string }> = {
  top: { label: "탑", emoji: "🛡️" },
  jungle: { label: "정글", emoji: "🌿" },
  mid: { label: "미드", emoji: "🔥" },
  adc: { label: "원딜", emoji: "🏹" },
  support: { label: "서포터", emoji: "💚" },
};

function rankColor(rank: number): string {
  return rank === 0 ? "rank-1" : rank === 1 ? "rank-2" : rank === 2 ? "rank-3" : "text-ink-tertiary";
}

export function LaneRankingTab({ group }: { group: Group }) {
  const rankings = useMemo(() => buildLaneRankings(group), [group]);

  return (
    <div className="space-y-3">
      <p className="text-xs text-ink-tertiary">
        각 라인에서 <span className="text-ink-subtle">{LANE_RANK_MIN_GAMES}판 이상</span> 플레이한 선수를,{" "}
        <span className="text-ink-subtle">그 라인에서의 성적</span>만 반영한 점수(라인 내 백분위 가중합)순으로 정렬합니다. 라인은 로비 순서 기준으로 배정됩니다.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {rankings.map(({ lane, entries }) => {
          const meta = LANE_META[lane];
          return (
            <Card key={lane} className="p-0 overflow-hidden">
              {/* Lane header */}
              <div className="flex items-center gap-2 px-4 py-2.5 border-b border-hairline bg-surface-1">
                <span className="text-lg leading-none">{meta.emoji}</span>
                <span className="text-sm font-semibold text-ink">{meta.label}</span>
                <span className="text-xs text-ink-tertiary ml-auto">{entries.length}명</span>
              </div>

              {/* Ranking rows */}
              {entries.length === 0 ? (
                <div className="px-4 py-6 text-center text-xs text-ink-tertiary">기록 없음</div>
              ) : (
                <div className="divide-y divide-hairline/50">
                  {entries.map((e, rank) => (
                    <div key={e.nickname} className="flex items-center gap-2.5 px-4 py-2">
                      <span className={`w-5 text-center text-xs font-bold shrink-0 ${rankColor(rank)}`}>
                        {rank + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-ink truncate">{e.nickname}</div>
                        <div className="text-[11px] text-ink-tertiary">
                          {e.games}판 ·{" "}
                          <span className={e.winRate >= 55 ? "text-win" : e.winRate < 45 ? "text-lose" : "text-ink-subtle"}>
                            {e.winRate.toFixed(0)}%
                          </span>{" "}
                          · KDA {e.avgKda.toFixed(2)}
                        </div>
                      </div>
                      <span className="text-sm font-bold text-primary tabular-nums shrink-0" title="종합 점수">
                        {e.score.toFixed(1)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
