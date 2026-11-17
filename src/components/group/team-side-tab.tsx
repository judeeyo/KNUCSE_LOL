"use client";

import { useState, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { buildTeamSideStats, type PlayerTeamSide, type ChampionTeamSide, type TeamSideOverall } from "@/lib/stats";
import { ChampionIcon } from "@/components/ui/champion-icon";
import type { Group } from "@/lib/types";

type SubTab = "overview" | "players" | "champions";

export function TeamSideTab({ group }: { group: Group }) {
  const [sub, setSub] = useState<SubTab>("overview");
  const data = useMemo(() => buildTeamSideStats(group), [group]);

  return (
    <div className="space-y-5">
      {/* Sub tabs */}
      <div className="flex items-center gap-1 bg-surface-1 border border-hairline rounded-lg p-0.5 w-fit">
        {([
          ["overview", "전체"],
          ["players", "선수별"],
          ["champions", "챔피언별"],
        ] as [SubTab, string][]).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setSub(key)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-fast cursor-pointer ${
              sub === key ? "bg-surface-3 text-ink" : "text-ink-subtle hover:text-ink"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {sub === "overview" && <OverviewSection overall={data.overall} totalMatches={group.matches.length} />}
      {sub === "players" && <PlayersSection players={data.players} />}
      {sub === "champions" && <ChampionsSection champions={data.champions} />}
    </div>
  );
}

// ─── Overview ───

function OverviewSection({ overall, totalMatches }: { overall: TeamSideOverall[]; totalMatches: number }) {
  const blue = overall.find((o) => o.team === "blue")!;
  const red = overall.find((o) => o.team === "red")!;

  return (
    <div className="space-y-4">
      {/* Big scoreboard */}
      <div className="grid grid-cols-2 gap-3">
        <TeamOverviewCard side={blue} label="블루팀" color="blue" />
        <TeamOverviewCard side={red} label="레드팀" color="red" />
      </div>

      {/* Win rate bar */}
      <Card className="p-4">
        <div className="text-xs text-ink-subtle mb-3">전체 {totalMatches}경기 진영별 승률</div>
        <div className="flex items-center gap-3">
          <span className="text-sm font-bold text-blue-400 w-14 text-right">{blue.winRate.toFixed(0)}%</span>
          <div className="flex-1 h-5 rounded-sm overflow-hidden flex">
            <div
              className="bg-blue-500/70 h-full transition-all duration-500"
              style={{ width: `${blue.winRate}%` }}
            />
            <div
              className="bg-red-500/70 h-full transition-all duration-500"
              style={{ width: `${red.winRate}%` }}
            />
          </div>
          <span className="text-sm font-bold text-red-400 w-14">{red.winRate.toFixed(0)}%</span>
        </div>
        <div className="flex justify-between mt-1.5">
          <span className="text-[11px] text-ink-tertiary">{blue.wins}승</span>
          <span className="text-[11px] text-ink-tertiary">{red.wins}승</span>
        </div>
      </Card>

      {/* Avg stats comparison */}
      <Card className="p-4">
        <div className="text-xs text-ink-subtle mb-3">경기당 평균</div>
        <div className="space-y-3">
          <CompareBar label="평균 킬" blueVal={blue.avgKills} redVal={red.avgKills} format={(v) => v.toFixed(1)} />
          <CompareBar label="평균 데스" blueVal={blue.avgDeaths} redVal={red.avgDeaths} format={(v) => v.toFixed(1)} invert />
          <CompareBar label="평균 골드" blueVal={blue.avgGold} redVal={red.avgGold} format={(v) => Math.round(v).toLocaleString()} />
        </div>
      </Card>
    </div>
  );
}

function TeamOverviewCard({ side, label, color }: { side: TeamSideOverall; label: string; color: "blue" | "red" }) {
  const textColor = color === "blue" ? "text-blue-400" : "text-red-400";
  const bgColor = color === "blue" ? "bg-blue-500/8" : "bg-red-500/8";
  const borderColor = color === "blue" ? "border-blue-500/20" : "border-red-500/20";

  return (
    <Card className={`text-center border-t-2 ${borderColor} ${bgColor}`}>
      <div className={`text-sm font-semibold ${textColor} mb-2`}>{label}</div>
      <div className={`text-4xl font-bold ${textColor} mb-1`}>{side.wins}</div>
      <div className="text-xs text-ink-subtle">승 / {side.totalGames - side.wins} 패</div>
      <div className={`text-lg font-bold ${textColor} mt-2`}>{side.winRate.toFixed(1)}%</div>
    </Card>
  );
}

function CompareBar({
  label,
  blueVal,
  redVal,
  format,
  invert,
}: {
  label: string;
  blueVal: number;
  redVal: number;
  format: (v: number) => string;
  invert?: boolean;
}) {
  const total = blueVal + redVal || 1;
  const bluePct = (blueVal / total) * 100;
  const blueHigher = invert ? blueVal < redVal : blueVal > redVal;
  const redHigher = invert ? redVal < blueVal : redVal > blueVal;

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className={`text-xs font-medium ${blueHigher ? "text-blue-400" : "text-ink-muted"}`}>{format(blueVal)}</span>
        <span className="text-[11px] text-ink-tertiary">{label}</span>
        <span className={`text-xs font-medium ${redHigher ? "text-red-400" : "text-ink-muted"}`}>{format(redVal)}</span>
      </div>
      <div className="flex h-2 rounded-sm overflow-hidden">
        <div className="bg-blue-500/60 h-full" style={{ width: `${bluePct}%` }} />
        <div className="bg-red-500/60 h-full" style={{ width: `${100 - bluePct}%` }} />
      </div>
    </div>
  );
}

// ─── Players ───

function PlayersSection({ players }: { players: PlayerTeamSide[] }) {
  return (
    <Card className="overflow-hidden p-0">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-ink-subtle text-xs border-b border-hairline bg-canvas">
              <th className="text-left py-2.5 px-3">플레이어</th>
              <th className="text-center py-2.5 px-2" colSpan={3}>
                <span className="text-blue-400">블루팀</span>
              </th>
              <th className="text-center py-2.5 px-2" colSpan={3}>
                <span className="text-red-400">레드팀</span>
              </th>
              <th className="text-center py-2.5 px-2">차이</th>
            </tr>
            <tr className="text-ink-tertiary text-[10px] border-b border-hairline/50">
              <th />
              <th className="py-1 px-2">판수</th>
              <th className="py-1 px-2">승률</th>
              <th className="py-1 px-2">KDA</th>
              <th className="py-1 px-2">판수</th>
              <th className="py-1 px-2">승률</th>
              <th className="py-1 px-2">KDA</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {players.map((p) => (
              <tr key={p.nickname} className="border-b border-hairline/30 hover:bg-surface-1 transition-fast">
                <td className="py-2.5 px-3 font-medium text-ink">{p.nickname}</td>
                <td className="text-center py-2.5 px-2 text-ink-muted">{p.blue.games}</td>
                <td className="text-center py-2.5 px-2">
                  <span className={p.blue.winRate >= 55 ? "text-win font-semibold" : p.blue.winRate < 45 ? "text-lose" : "text-ink"}>
                    {p.blue.games > 0 ? `${p.blue.winRate.toFixed(0)}%` : "-"}
                  </span>
                </td>
                <td className="text-center py-2.5 px-2 text-ink-muted text-xs">
                  {p.blue.games > 0 ? p.blue.avgKda.toFixed(2) : "-"}
                </td>
                <td className="text-center py-2.5 px-2 text-ink-muted">{p.red.games}</td>
                <td className="text-center py-2.5 px-2">
                  <span className={p.red.winRate >= 55 ? "text-win font-semibold" : p.red.winRate < 45 ? "text-lose" : "text-ink"}>
                    {p.red.games > 0 ? `${p.red.winRate.toFixed(0)}%` : "-"}
                  </span>
                </td>
                <td className="text-center py-2.5 px-2 text-ink-muted text-xs">
                  {p.red.games > 0 ? p.red.avgKda.toFixed(2) : "-"}
                </td>
                <td className="text-center py-2.5 px-2">
                  {p.blue.games > 0 && p.red.games > 0 ? (
                    <span className={`text-xs font-semibold ${
                      p.blueWinDiff > 10 ? "text-blue-400" : p.blueWinDiff < -10 ? "text-red-400" : "text-ink-subtle"
                    }`}>
                      {p.blueWinDiff > 0 ? "+" : ""}{p.blueWinDiff.toFixed(0)}%
                    </span>
                  ) : (
                    <span className="text-ink-tertiary text-xs">-</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ─── Champions ───

function ChampionsSection({ champions }: { champions: ChampionTeamSide[] }) {
  const [sort, setSort] = useState<"games" | "blueWr" | "redWr">("games");
  const sorted = useMemo(() => {
    return [...champions].sort((a, b) => {
      if (sort === "blueWr") return b.blue.winRate - a.blue.winRate;
      if (sort === "redWr") return b.red.winRate - a.red.winRate;
      return b.total.games - a.total.games;
    });
  }, [champions, sort]);

  return (
    <Card className="overflow-hidden p-0">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-ink-subtle text-xs border-b border-hairline bg-canvas">
              <th className="text-left py-2.5 px-3">챔피언</th>
              <th className="text-center py-2.5 px-2 cursor-pointer hover:text-ink" onClick={() => setSort("games")}>
                전체 {sort === "games" && "↓"}
              </th>
              <th className="text-center py-2.5 px-2 cursor-pointer hover:text-ink" onClick={() => setSort("blueWr")}>
                <span className="text-blue-400">블루 승률</span> {sort === "blueWr" && "↓"}
              </th>
              <th className="text-center py-2.5 px-2 cursor-pointer hover:text-ink" onClick={() => setSort("redWr")}>
                <span className="text-red-400">레드 승률</span> {sort === "redWr" && "↓"}
              </th>
              <th className="text-center py-2.5 px-2">진영별 비교</th>
            </tr>
          </thead>
          <tbody>
            {sorted.filter((c) => c.total.games >= 2).map((c) => {
              const total = c.blue.games + c.red.games || 1;
              const bluePct = (c.blue.games / total) * 100;
              return (
                <tr key={c.champion} className="border-b border-hairline/30 hover:bg-surface-1 transition-fast">
                  <td className="py-2.5 px-3">
                    <div className="flex items-center gap-2">
                      <ChampionIcon name={c.champion} size={28} />
                      <div>
                        <span className="font-medium text-ink">{c.champion}</span>
                        <span className="text-xs text-ink-tertiary ml-1.5">{c.total.games}판</span>
                      </div>
                    </div>
                  </td>
                  <td className="text-center py-2.5 px-2">
                    <span className={c.total.winRate >= 55 ? "text-win font-semibold" : c.total.winRate < 45 ? "text-lose" : "text-ink"}>
                      {c.total.winRate.toFixed(0)}%
                    </span>
                  </td>
                  <td className="text-center py-2.5 px-2">
                    {c.blue.games > 0 ? (
                      <div>
                        <span className={c.blue.winRate >= 55 ? "text-win font-semibold" : c.blue.winRate < 45 ? "text-lose" : "text-ink"}>
                          {c.blue.winRate.toFixed(0)}%
                        </span>
                        <span className="text-[10px] text-ink-tertiary ml-1">{c.blue.games}판</span>
                      </div>
                    ) : <span className="text-ink-tertiary">-</span>}
                  </td>
                  <td className="text-center py-2.5 px-2">
                    {c.red.games > 0 ? (
                      <div>
                        <span className={c.red.winRate >= 55 ? "text-win font-semibold" : c.red.winRate < 45 ? "text-lose" : "text-ink"}>
                          {c.red.winRate.toFixed(0)}%
                        </span>
                        <span className="text-[10px] text-ink-tertiary ml-1">{c.red.games}판</span>
                      </div>
                    ) : <span className="text-ink-tertiary">-</span>}
                  </td>
                  <td className="py-2.5 px-3">
                    <div className="flex h-2 rounded-sm overflow-hidden w-24 mx-auto">
                      <div className="bg-blue-500/60 h-full" style={{ width: `${bluePct}%` }} />
                      <div className="bg-red-500/60 h-full" style={{ width: `${100 - bluePct}%` }} />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

