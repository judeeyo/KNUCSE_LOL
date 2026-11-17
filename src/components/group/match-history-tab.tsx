"use client";

import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronRight, Trash2, Gamepad2, Clock, Trophy, Download } from "lucide-react";
import { ChampionIcon } from "@/components/ui/champion-icon";
import type { Match } from "@/lib/types";

export function MatchHistoryTab({
  matches,
  groupId,
  onDelete,
}: {
  matches: Match[];
  groupId: string;
  onDelete: (matchId: string) => void;
}) {
  const router = useRouter();
  const reversed = [...matches].reverse();

  if (matches.length === 0) {
    return (
      <Card className="text-center py-16">
        <Gamepad2 size={48} className="mx-auto text-ink-tertiary mb-4 opacity-50" />
        <p className="text-ink-muted text-lg mb-2 break-keep">아직 기록된 경기가 없습니다</p>
        <p className="text-sm text-ink-subtle mb-6">수집기를 설치하면 게임 종료 시 자동으로 기록됩니다</p>
        <a href="/api/collector" download>
          <Button>
            <Download size={16} />
            수집기 다운로드
          </Button>
        </a>
      </Card>
    );
  }

  // Group matches by date
  const grouped = new Map<string, Match[]>();
  for (const match of reversed) {
    const dateKey = new Date(match.createdAt).toLocaleDateString("ko-KR", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    const arr = grouped.get(dateKey) || [];
    arr.push(match);
    grouped.set(dateKey, arr);
  }

  return (
    <div className="space-y-6">
      {Array.from(grouped.entries()).map(([date, dateMatches]) => (
        <div key={date}>
          {/* Date Header */}
          <div className="flex items-center gap-3 mb-3">
            <div className="text-sm font-semibold text-ink-muted">{date}</div>
            <div className="flex-1 h-px bg-hairline" />
            <div className="text-xs text-ink-tertiary">{dateMatches.length}경기</div>
          </div>

          <div className="flex items-center gap-3 mb-3 -mt-1">
            <div className="text-xs text-ink-tertiary">
              {dateMatches.some((m) => m.excludedReason) &&
                `통계 반영 ${dateMatches.filter((m) => !m.excludedReason).length}경기 · 제외 ${dateMatches.filter((m) => m.excludedReason).length}경기`}
            </div>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
            {dateMatches.map((match) => (
              <MatchCard
                key={match.id}
                match={match}
                onDelete={onDelete}
                onClick={() => router.push(`/group/${groupId}/match/${match.id}`)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function MatchCard({
  match,
  onDelete,
  onClick,
}: {
  match: Match;
  onDelete: (matchId: string) => void;
  onClick: () => void;
}) {
  const blue = match.players.filter((p) => p.team === "blue");
  const red = match.players.filter((p) => p.team === "red");
  const blueWin = blue.length > 0 && blue[0].win;
  const mvp = match.players.find((p) => p.isMvp);
  const ace = match.players.find((p) => p.isAce);
  const blueKills = blue.reduce((s, p) => s + p.kills, 0);
  const redKills = red.reduce((s, p) => s + p.kills, 0);
  // 수기 기록은 시각이 없으므로(날짜만 신뢰) 시각 대신 출처를 표시
  const time = match.timeUnknown
    ? "시각 미상"
    : new Date(match.createdAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });

  return (
    <div
      onClick={onClick}
      title={match.excludedReason ? `${match.excludedReason} — 기록에 반영되지 않는 경기` : undefined}
      className="group relative rounded-lg border border-hairline bg-surface-1 hover:bg-surface-2 hover:border-hairline-strong cursor-pointer transition-fast overflow-hidden"
    >
      {/* "없던 경기" 표시: 흰색 문구 (카드 내용은 아래에서 흑백 처리) */}
      {match.excludedReason && (
        <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none">
          <span className="px-3 py-1 rounded-md bg-black/55 text-white text-lg sm:text-xl font-extrabold tracking-wide drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)] -rotate-6 max-w-[90%] text-center break-words">
            {match.excludedReason}
          </span>
        </div>
      )}

      <div className={match.excludedReason ? "grayscale-75 opacity-70" : undefined}>
      {/* Win indicator bar */}
      <div className={`absolute top-0 left-0 w-1 h-full ${blueWin ? "bg-blue-500" : "bg-red-500"}`} />

      <div className="pl-4 pr-3 py-4">
        {/* Top row: time, duration, MVP/ACE */}
        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5 mb-3">
          <div className="flex items-center gap-2.5">
            <div className="flex items-center gap-1 text-xs text-ink-subtle whitespace-nowrap">
              <Clock size={12} />
              {time}
            </div>
            {match.gameDuration && (
              <span className="text-xs text-ink-subtle px-2 py-0.5 rounded bg-surface-2">
                {match.gameDuration}
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-1.5 min-w-0">
            {match.source === "legacy-import" && (
              <Badge variant="default" className="whitespace-nowrap">수기 기록</Badge>
            )}
            {mvp && (
              <Badge variant="mvp" className="max-w-full">
                <Trophy size={10} className="mr-0.5 shrink-0" /> <span className="truncate">{mvp.nickname}</span>
              </Badge>
            )}
            {ace && (
              <Badge variant="ace" className="max-w-full">
                <span className="shrink-0 mr-1">ACE</span><span className="truncate">{ace.nickname}</span>
              </Badge>
            )}
          </div>
        </div>

        {/* Score row — 좁은 화면에서는 블루/레드를 위아래로 쌓는다 */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
          {/* Blue side */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2.5 mb-2.5">
              <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-semibold ${
                blueWin ? "bg-win/10 text-win" : "bg-lose/10 text-lose"
              }`}>
                {blueWin ? "승리" : "패배"}
              </div>
              <span className={`text-2xl font-bold tabular-nums ${blueWin ? "text-blue-400" : "text-ink-tertiary"}`}>
                {blueKills}
              </span>
            </div>
            <div className="space-y-1.5">
              {blue.map((p) => (
                <PlayerRow key={p.id} player={p} align="left" isMvp={p.isMvp} isAce={p.isAce} />
              ))}
            </div>
          </div>

          {/* VS divider */}
          <div className="flex sm:flex-col items-center gap-2 sm:gap-1 sm:px-1 shrink-0">
            <div className="h-px flex-1 sm:flex-none sm:w-px sm:h-6 bg-hairline" />
            <span className="text-[10px] font-semibold text-ink-tertiary">VS</span>
            <div className="h-px flex-1 sm:flex-none sm:w-px sm:h-6 bg-hairline" />
          </div>

          {/* Red side */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2.5 flex-row-reverse justify-end sm:flex-row sm:justify-end mb-2.5">
              <span className={`text-2xl font-bold tabular-nums ${!blueWin ? "text-red-400" : "text-ink-tertiary"}`}>
                {redKills}
              </span>
              <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-semibold ${
                !blueWin ? "bg-win/10 text-win" : "bg-lose/10 text-lose"
              }`}>
                {!blueWin ? "승리" : "패배"}
              </div>
            </div>
            <div className="space-y-1.5">
              {red.map((p) => (
                <PlayerRow key={p.id} player={p} align="right" isMvp={p.isMvp} isAce={p.isAce} />
              ))}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-0.5 shrink-0 sm:ml-1">
            <button
              aria-label="경기 삭제"
              onClick={(e) => {
                e.stopPropagation();
                if (confirm("이 경기를 삭제하시겠습니까? (관리자 비밀번호 필요)")) onDelete(match.id);
              }}
              className="p-1.5 rounded text-ink-tertiary hover:text-lose hover:bg-lose/10 sm:opacity-0 sm:group-hover:opacity-100 focus-visible:opacity-100 transition-fast cursor-pointer"
            >
              <Trash2 size={14} />
            </button>
            <ChevronRight size={16} className="text-ink-tertiary/50" />
          </div>
        </div>
      </div>
      </div>
    </div>
  );
}

function PlayerRow({
  player,
  align,
  isMvp,
  isAce,
}: {
  player: { nickname: string; champion: string; kills: number; deaths: number; assists: number; lane?: string };
  align: "left" | "right";
  isMvp: boolean;
  isAce: boolean;
}) {
  const kdaColor = player.deaths === 0
    ? "text-win"
    : (player.kills + player.assists) / player.deaths >= 3
      ? "text-ink"
      : (player.kills + player.assists) / player.deaths < 1.5
        ? "text-lose/80"
        : "text-ink-muted";

  if (align === "right") {
    // 데스크톱에서는 오른쪽 정렬(아이콘이 바깥쪽), 모바일에서는 위아래로 쌓이므로 왼쪽 정렬
    return (
      <div className="flex flex-row-reverse sm:flex-row items-center gap-1.5 justify-end text-[13px] py-0.5 min-w-0">
        <span className={`font-mono text-xs tabular-nums whitespace-nowrap shrink-0 ${kdaColor}`}>
          <span className="text-ink-muted">{player.kills}</span>
          <span className="text-ink-tertiary">/</span>
          <span className="text-lose/70">{player.deaths}</span>
          <span className="text-ink-tertiary">/</span>
          <span className="text-ink-muted">{player.assists}</span>
        </span>
        <span title={player.nickname} className={`font-semibold truncate min-w-0 ${isMvp ? "text-mvp" : isAce ? "text-ace" : "text-ink"}`}>
          {player.nickname}
        </span>
        <ChampionIcon name={player.champion} size={18} />
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5 text-[13px] py-0.5 min-w-0">
      <ChampionIcon name={player.champion} size={18} />
      <span title={player.nickname} className={`font-semibold truncate min-w-0 ${isMvp ? "text-mvp" : isAce ? "text-ace" : "text-ink"}`}>
        {player.nickname}
      </span>
      <span className={`font-mono text-xs tabular-nums whitespace-nowrap shrink-0 ${kdaColor}`}>
        <span className="text-ink-muted">{player.kills}</span>
        <span className="text-ink-tertiary">/</span>
        <span className="text-lose/70">{player.deaths}</span>
        <span className="text-ink-tertiary">/</span>
        <span className="text-ink-muted">{player.assists}</span>
      </span>
    </div>
  );
}
