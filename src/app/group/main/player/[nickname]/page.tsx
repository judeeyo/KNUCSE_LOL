"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ChevronLeft, Trophy } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ChampionIcon } from "@/components/ui/champion-icon";
import { LoadError } from "@/components/ui/load-error";
import { WinrateTrend } from "@/components/ui/winrate-trend";
import { PlayerDetail } from "@/components/group/player-stats-tab";
import { getGroup } from "@/lib/store";
import { activityOf, buildPlayerStats, formatLastPlayed, INACTIVE_DAYS } from "@/lib/stats";
import {
  bestAndWorst,
  buildPlayerProfile,
  LANE_LABEL,
  playerHref,
  resolveNickname,
  type ProfileGame,
  type RelationRecord,
} from "@/lib/profile";
import { backToList, rememberListPosition, takeListScroll } from "@/lib/list-position";
import { rivalryHref } from "@/lib/rivalry";
import type { Group } from "@/lib/types";

const CACHE_KEY = "naejeon-group-cache-v1"; // 메인 화면과 같은 캐시 (같은 세션이면 즉시 표시)
const RECENT_PAGE = 20;

export default function PlayerPage() {
  const params = useParams();
  const router = useRouter();
  const rawName = decodeURIComponent(String(params.nickname ?? ""));
  const [group, setGroup] = useState<Group | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCount, setShowCount] = useState(RECENT_PAGE);
  const [now] = useState(() => Date.now());
  const [restored, setRestored] = useState(false);

  const load = useCallback(async () => {
    try {
      const cached = sessionStorage.getItem(CACHE_KEY);
      if (cached) setGroup(JSON.parse(cached) as Group);
    } catch {
      // 캐시 없음
    }
    try {
      const g = await getGroup();
      setGroup(g);
      setError(null);
      try {
        sessionStorage.setItem(CACHE_KEY, JSON.stringify(g));
      } catch {
        // 무시
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const nickname = useMemo(() => (group ? resolveNickname(group, rawName) : rawName), [group, rawName]);
  const profile = useMemo(() => (group ? buildPlayerProfile(group, nickname) : null), [group, nickname]);
  const stats = useMemo(() => (group ? buildPlayerStats(group).find((p) => p.nickname === nickname) : undefined), [group, nickname]);
  const member = group?.members.find((m) => m.nickname === nickname);
  const positionKey = `player:${nickname}`;

  // 부캐 이름으로 들어왔으면 본캐 주소로 바꿔 둔다 (공유·새로고침 시 같은 페이지)
  useEffect(() => {
    if (group && nickname !== rawName) window.history.replaceState(window.history.state, "", playerHref(nickname));
  }, [group, nickname, rawName]);

  // 경기 상세에서 돌아왔으면 보던 위치로
  useEffect(() => {
    if (!profile || restored) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRestored(true);
    const y = takeListScroll(positionKey);
    if (y !== null) requestAnimationFrame(() => window.scrollTo(0, y));
  }, [profile, restored, positionKey]);

  if (error && !group) return <LoadError message={error} onRetry={load} />;
  if (!group) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const back = (
    <button
      onClick={() => backToList(router, "players")}
      className="flex items-center gap-1 text-sm text-ink-subtle hover:text-ink transition-fast cursor-pointer"
    >
      <ChevronLeft size={16} />
      돌아가기
    </button>
  );

  if (!profile || !stats) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-4">
        {back}
        <Card className="text-center py-12 text-ink-subtle break-keep">
          &quot;{rawName}&quot; 선수의 경기 기록이 없습니다.
        </Card>
      </div>
    );
  }

  const act = activityOf(stats.lastPlayedAt, now);
  const last = formatLastPlayed(stats.lastPlayedAt, now);
  const minRel = Math.min(3, Math.max(1, Math.floor(profile.games.length / 5)));
  const mates = bestAndWorst(profile.teammates, minRel);
  const rivals = bestAndWorst(profile.opponents, minRel);

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-4 min-w-0">
      {back}
      {error && <LoadError compact message={error} onRetry={load} />}

      {/* 머리말 */}
      <Card className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-bold text-ink break-all">{nickname}</h1>
            {member?.realName && <span className="text-sm text-ink-subtle">({member.realName})</span>}
            {act.inactive && (
              <span className="text-[11px] font-semibold text-mvp border border-mvp/40 bg-mvp/10 rounded px-1.5 py-0.5">
                ⚠️ 3개월+ 미참여
              </span>
            )}
          </div>
          <div className="text-xs text-ink-tertiary mt-1 break-keep">
            마지막 참가 <span className={act.inactive ? "text-mvp" : "text-ink-subtle"}>{last.date}</span> ({last.ago})
            {(member?.aliases || []).length > 0 && <> · 부캐 {member!.aliases!.join(", ")}</>}
          </div>
        </div>
        <div className="flex items-baseline gap-4 text-sm">
          <div>
            <span className="text-2xl font-bold text-ink tabular-nums">{stats.winRate.toFixed(0)}%</span>
            <span className="text-xs text-ink-subtle ml-1.5 whitespace-nowrap">{stats.wins}승 {stats.losses}패</span>
          </div>
          <div className="text-xs text-ink-subtle whitespace-nowrap">
            종합 점수 <span className="text-primary font-bold text-sm">{stats.totalScore.toFixed(1)}</span>
          </div>
        </div>
      </Card>

      {/* 승률 추이 */}
      <Card>
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
          <h2 className="text-sm font-semibold text-ink">누적 승률 추이</h2>
          <span className="text-[11px] text-ink-tertiary">그래프에 마우스를 올리면(눌러 보면) 경기별 정보</span>
        </div>
        <WinrateTrend points={profile.trend} />
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
        {/* 요약 (기존 선수 상세와 같은 내용) */}
        <Card className="lg:col-span-2 min-w-0 overflow-x-auto">
          <PlayerDetail player={stats} />
        </Card>

        {/* 관계 */}
        <div className="space-y-4 min-w-0">
          <RelationCard
            title="함께하면"
            hint={`같은 팀으로 ${minRel}판 이상`}
            best={mates.best}
            worst={mates.worst}
            bestLabel="잘 이김"
            worstLabel="잘 짐"
            onOpen={() => rememberListPosition(positionKey)}
          />
          <RelationCard
            title="상대로 만나면"
            hint={`상대 팀으로 ${minRel}판 이상 · 내 승률`}
            best={rivals.best}
            worst={rivals.worst}
            bestLabel="강함"
            worstLabel="천적"
            onOpen={() => rememberListPosition(positionKey)}
          />
          {profile.laneOpponents.length > 0 && (
            <Card className="p-0 overflow-hidden">
              <div className="px-4 py-2.5 border-b border-hairline flex flex-wrap items-baseline justify-between gap-x-2">
                <span className="text-sm font-semibold text-ink">맞라인 상대 전적</span>
                <span className="text-[11px] text-ink-tertiary">누르면 라이벌전</span>
              </div>
              <ul className="divide-y divide-hairline/50">
                {profile.laneOpponents.slice(0, 6).map((r) => (
                  <RelationRow key={r.nickname} r={r} href={rivalryHref(nickname, r.nickname)} onOpen={() => rememberListPosition(positionKey)} />
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>

      {/* 최근 경기 */}
      <Card className="p-0 overflow-hidden">
        <div className="px-4 py-2.5 border-b border-hairline flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink">경기 기록</h2>
          <span className="text-xs text-ink-tertiary">{profile.games.length}경기</span>
        </div>
        <ul className="divide-y divide-hairline/50">
          {profile.games.slice(0, showCount).map((g) => (
            <GameRow key={g.match.id} g={g} now={now} onOpen={() => rememberListPosition(positionKey)} />
          ))}
        </ul>
        {profile.games.length > showCount && (
          <button
            onClick={() => setShowCount((c) => c + RECENT_PAGE)}
            className="w-full py-3 text-xs text-ink-subtle hover:text-ink hover:bg-surface-2 transition-fast cursor-pointer border-t border-hairline"
          >
            더 보기 ({profile.games.length - showCount}경기 남음)
          </button>
        )}
      </Card>

      {act.inactive && (
        <p className="text-xs text-ink-tertiary">⚠️ {INACTIVE_DAYS}일 이상 내전에 참가하지 않아 순위에서는 맨 아래에 표시됩니다.</p>
      )}
    </div>
  );
}

function GameRow({ g, now, onOpen }: { g: ProfileGame; now: number; onOpen: () => void }) {
  const { match, me } = g;
  const minutes = (() => {
    const [mm, ss] = (match.gameDuration || "").split(":").map(Number);
    return mm > 0 ? mm + (ss || 0) / 60 : 0;
  })();
  const kda = me.deaths === 0 ? "Perfect" : ((me.kills + me.assists) / me.deaths).toFixed(2);
  const when = formatLastPlayed(match.createdAt, now);
  return (
    <li>
      <Link
        href={`/group/main/match/${match.id}`}
        onClick={onOpen}
        className={`flex items-center gap-3 px-3 sm:px-4 py-2.5 hover:bg-surface-2/60 transition-fast border-l-4 ${me.win ? "border-l-win/70" : "border-l-lose/70"}`}
      >
        <div className="w-14 shrink-0 text-xs">
          <div className={`font-bold ${me.win ? "text-win" : "text-lose"}`}>{me.win ? "승리" : "패배"}</div>
          <div className="text-ink-tertiary">{match.gameDuration || "-"}</div>
        </div>
        <ChampionIcon name={me.champion} size={36} className="rounded-lg" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-1.5 text-sm">
            <span className="text-ink font-medium truncate">{me.champion}</span>
            {me.lane && <span className="text-xs text-ink-tertiary">{LANE_LABEL[me.lane]}</span>}
            {me.isMvp && <Badge variant="mvp"><Trophy size={9} className="mr-0.5" />MVP</Badge>}
            {me.isAce && <Badge variant="ace">ACE</Badge>}
          </div>
          <div className="text-[11px] text-ink-tertiary">{when.date} ({when.ago})</div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-sm font-semibold text-ink tabular-nums whitespace-nowrap">
            {me.kills} / <span className="text-lose">{me.deaths}</span> / {me.assists}
          </div>
          <div className="text-[11px] text-ink-tertiary whitespace-nowrap">{kda} KDA</div>
        </div>
        <div className="hidden sm:block text-right shrink-0 w-24 text-xs text-ink-subtle">
          <div className="tabular-nums">CS {me.cs}{minutes > 0 && <span className="text-ink-tertiary"> ({(me.cs / minutes).toFixed(1)})</span>}</div>
          <div className="tabular-nums">{g.damageShare === null ? <span className="text-ink-tertiary">딜 미수집</span> : `딜 비중 ${g.damageShare.toFixed(0)}%`}</div>
        </div>
        <div className="w-10 text-right shrink-0">
          <div className="text-sm font-bold text-primary tabular-nums">{me.mvpScore.toFixed(1)}</div>
          <div className="text-[10px] text-ink-tertiary">점수</div>
        </div>
      </Link>
    </li>
  );
}

function RelationRow({ r, onOpen, href }: { r: RelationRecord; onOpen: () => void; href?: string }) {
  return (
    <li>
      <Link href={href ?? playerHref(r.nickname)} onClick={onOpen} className="flex items-center justify-between gap-3 px-4 py-2 hover:bg-surface-2/60 transition-fast">
        <span className="text-sm text-ink truncate">{href && <span className="mr-1 text-mvp" aria-hidden="true">⚔</span>}{r.nickname}</span>
        <span className="text-xs whitespace-nowrap shrink-0">
          <span className="text-ink-tertiary">{r.games}판 {r.wins}승 </span>
          <span className={`font-semibold ${r.winRate >= 60 ? "text-win" : r.winRate <= 40 ? "text-lose" : "text-ink-subtle"}`}>{r.winRate.toFixed(0)}%</span>
        </span>
      </Link>
    </li>
  );
}

function RelationCard({
  title, hint, best, worst, bestLabel, worstLabel, onOpen,
}: {
  title: string; hint: string; best: RelationRecord[]; worst: RelationRecord[];
  bestLabel: string; worstLabel: string; onOpen: () => void;
}) {
  if (best.length === 0 && worst.length === 0) return null;
  return (
    <Card className="p-0 overflow-hidden">
      <div className="px-4 py-2.5 border-b border-hairline flex flex-wrap items-baseline justify-between gap-x-2">
        <span className="text-sm font-semibold text-ink">{title}</span>
        <span className="text-[11px] text-ink-tertiary">{hint}</span>
      </div>
      {best.length > 0 && (
        <>
          <div className="px-4 pt-2 text-[11px] text-win">{bestLabel}</div>
          <ul>{best.map((r) => <RelationRow key={r.nickname} r={r} onOpen={onOpen} />)}</ul>
        </>
      )}
      {worst.length > 0 && (
        <>
          <div className="px-4 pt-2 text-[11px] text-lose border-t border-hairline/50">{worstLabel}</div>
          <ul className="pb-1">{worst.map((r) => <RelationRow key={r.nickname} r={r} onOpen={onOpen} />)}</ul>
        </>
      )}
    </Card>
  );
}
