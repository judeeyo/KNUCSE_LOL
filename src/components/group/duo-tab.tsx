"use client";

import { useMemo } from "react";
import { StatTable, stickyHead } from "@/components/ui/stat-table";
import { buildTeamSideStats, capDuosPerPlayer, type DuoRecord } from "@/lib/stats";
import type { Group } from "@/lib/types";

const TOP_N = 7;
const CAP = 2; // 한 사람이 한 분류에 최대 2개까지만 등장

// 같은 팀 듀오 테이블 (베스트/워스트 공용)
function SameTeamDuoTable({ duos }: { duos: DuoRecord[] }) {
  return (
    <StatTable>
          <thead className={stickyHead}>
            <tr className="text-ink-subtle text-xs border-b border-hairline">
              <th className="text-left py-2.5 px-3">듀오</th>
              <th className="text-center py-2.5 px-2">함께한 경기</th>
              <th className="text-center py-2.5 px-2">승률</th>
              <th className="text-center py-2.5 px-2">전적</th>
            </tr>
          </thead>
          <tbody>
            {duos.length === 0 ? (
              <tr>
                <td colSpan={4} className="text-center py-6 text-ink-tertiary text-xs">
                  조건을 만족하는 듀오가 아직 없습니다
                </td>
              </tr>
            ) : (
              duos.map((d, i) => (
                <tr key={i} className="border-b border-hairline/30 hover:bg-surface-1 transition-fast">
                  <td className="py-2.5 px-3">
                    <span className="font-medium text-ink">{d.player1}</span>
                    <span className="text-ink-tertiary mx-1.5">&</span>
                    <span className="font-medium text-ink">{d.player2}</span>
                  </td>
                  <td className="text-center py-2.5 px-2 text-ink-muted">{d.sameTeamGames}</td>
                  <td className="text-center py-2.5 px-2">
                    <span className={`font-semibold ${d.sameTeamWinRate >= 60 ? "text-win" : d.sameTeamWinRate < 40 ? "text-lose" : "text-ink"}`}>
                      {d.sameTeamWinRate.toFixed(0)}%
                    </span>
                  </td>
                  <td className="text-center py-2.5 px-2 text-ink-muted text-xs">
                    {d.sameTeamWins}W {d.sameTeamGames - d.sameTeamWins}L
                  </td>
                </tr>
              ))
            )}
          </tbody>
    </StatTable>
  );
}

export function DuoTab({ group }: { group: Group }) {
  const duos = useMemo(() => buildTeamSideStats(group).duos, [group]);

  const bestDuos = capDuosPerPlayer(
    duos
      .filter((d) => d.sameTeamGames >= 5)
      .sort((a, b) => b.sameTeamWinRate - a.sameTeamWinRate || b.sameTeamGames - a.sameTeamGames),
    CAP
  ).slice(0, TOP_N);

  const worstDuos = capDuosPerPlayer(
    duos
      .filter((d) => d.sameTeamGames >= 5)
      .sort((a, b) => a.sameTeamWinRate - b.sameTeamWinRate || b.sameTeamGames - a.sameTeamGames),
    CAP
  ).slice(0, TOP_N);

  const rivals = capDuosPerPlayer(
    duos.filter((d) => d.oppositeGames >= 2).sort((a, b) => b.oppositeGames - a.oppositeGames),
    CAP
  ).slice(0, TOP_N);

  return (
    <div className="space-y-5">
      {/* Best duos */}
      <div>
        <div className="text-xs text-ink-subtle mb-2 font-medium">🤝 베스트 듀오 (같은 팀 승률 · 5판 이상 · 상위 7 · 인당 최대 2개)</div>
        <SameTeamDuoTable duos={bestDuos} />
      </div>

      {/* Worst duos */}
      <div>
        <div className="text-xs text-ink-subtle mb-2 font-medium">💔 워스트 듀오 (같은 팀 승률 최저 · 5판 이상 · 상위 7 · 인당 최대 2개)</div>
        <SameTeamDuoTable duos={worstDuos} />
      </div>

      {/* Rivals */}
      <div>
        <div className="text-xs text-ink-subtle mb-2 font-medium">⚔️ 라이벌 (적팀으로 만난 횟수 · 상위 7 · 인당 최대 2개)</div>
        <StatTable>
              <thead className={stickyHead}>
                <tr className="text-ink-subtle text-xs border-b border-hairline">
                  <th className="text-left py-2.5 px-3">매치업</th>
                  <th className="text-center py-2.5 px-2">맞대결</th>
                  <th className="text-center py-2.5 px-2">상대 전적</th>
                </tr>
              </thead>
              <tbody>
                {rivals.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="text-center py-6 text-ink-tertiary text-xs">
                      맞대결 기록이 아직 없습니다
                    </td>
                  </tr>
                ) : (
                  rivals.map((d, i) => (
                    <tr key={i} className="border-b border-hairline/30 hover:bg-surface-1 transition-fast">
                      <td className="py-2.5 px-3">
                        <span className="font-medium text-ink">{d.player1}</span>
                        <span className="text-ink-tertiary mx-1.5">vs</span>
                        <span className="font-medium text-ink">{d.player2}</span>
                      </td>
                      <td className="text-center py-2.5 px-2 text-ink-muted">{d.oppositeGames}회</td>
                      <td className="text-center py-2.5 px-2 text-xs">
                        <span className="text-ink">{d.player1}</span>
                        <span className="text-ink-muted mx-1">
                          {d.player1Wins}:{d.oppositeGames - d.player1Wins}
                        </span>
                        <span className="text-ink">{d.player2}</span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
        </StatTable>
      </div>
    </div>
  );
}
