"use client";

import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { activityOf, buildLaneRankings, formatLastPlayed, INACTIVE_DAYS, LANE_RANK_MIN_GAMES } from "@/lib/stats";
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
  // 기준 시각은 탭을 열 때 한 번만 잡는다 (렌더마다 바뀌지 않게)
  const [now] = useState(() => Date.now());
  const rankings = useMemo(() => {
    // 최근 참가 보정: 한 달이 지나면 점수를 조금씩 낮추고, 3개월 이상 미참여는 각 라인 맨 아래로
    return buildLaneRankings(group).map(({ lane, entries }) => ({
      lane,
      entries: entries
        .map((e) => {
          const act = activityOf(e.lastPlayedAt, now);
          return { ...e, act, rankScore: e.score * act.factor, last: formatLastPlayed(e.lastPlayedAt, now) };
        })
        .sort((a, b) => Number(a.act.inactive) - Number(b.act.inactive) || b.rankScore - a.rankScore),
    }));
  }, [group, now]);

  return (
    <div className="space-y-3">
      <p className="text-xs text-ink-tertiary">
        각 라인에서 <span className="text-ink-subtle">{LANE_RANK_MIN_GAMES}판 이상</span> 플레이한 선수를,{" "}
        <span className="text-ink-subtle">그 라인에서의 성적</span>만 반영한 점수(라인 내 백분위 가중합)순으로 정렬합니다. 라인은 로비 순서 기준으로 배정됩니다.
        마지막 참가 후 한 달이 지나면 점수를 조금씩 낮추고, {INACTIVE_DAYS}일 이상 미참여는 ⚠️로 맨 아래에 둡니다.
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
                    <div key={e.nickname} className={`flex items-center gap-2.5 px-4 py-2 ${e.act.inactive ? "opacity-60" : ""}`}>
                      <span className={`w-5 text-center text-xs font-bold shrink-0 ${e.act.inactive ? "text-mvp" : rankColor(rank)}`}>
                        {e.act.inactive ? <span title={`${INACTIVE_DAYS}일 이상 내전 미참여`}>⚠️</span> : rank + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="text-sm font-medium text-ink truncate">{e.nickname}</span>
                          {e.act.inactive && (
                            <span className="shrink-0 text-[10px] font-semibold text-mvp border border-mvp/40 bg-mvp/10 rounded px-1 py-px">
                              3개월+ 미참여
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-ink-tertiary">
                          <span className={e.act.inactive ? "text-mvp" : undefined}>마지막 {e.last.date}</span> ·{" "}
                          {e.games}판 ·{" "}
                          <span className={e.winRate >= 55 ? "text-win" : e.winRate < 45 ? "text-lose" : "text-ink-subtle"}>
                            {e.winRate.toFixed(0)}%
                          </span>{" "}
                          · KDA {e.avgKda.toFixed(2)}
                        </div>
                      </div>
                      <span
                        className="text-sm font-bold text-primary tabular-nums shrink-0"
                        title={e.act.factor < 1 ? `원점수 ${e.score.toFixed(1)} × ${e.act.factor.toFixed(2)} (마지막 참가 ${e.last.ago})` : "종합 점수"}
                      >
                        {e.rankScore.toFixed(1)}
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
