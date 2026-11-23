"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ChevronLeft, Trophy } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ChampionIcon } from "@/components/ui/champion-icon";
import { LoadError } from "@/components/ui/load-error";
import { LabBadge, MomentumDots, SplashBg, TitleChip } from "@/components/group/rivalry-tab";
import { getGroup } from "@/lib/store";
import { formatLastPlayed } from "@/lib/stats";
import { LANE_LABEL, playerHref, resolveNickname } from "@/lib/profile";
import { findRivalry, rivalryHref, type RivalGame, type Rivalry, type SideSummary } from "@/lib/rivalry";
import { backToList, rememberListPosition, takeListScroll } from "@/lib/list-position";
import type { Group } from "@/lib/types";

const CACHE_KEY = "naejeon-group-cache-v1"; // 메인 화면과 같은 캐시

export default function RivalryPage() {
  const params = useParams();
  const router = useRouter();
  const rawA = decodeURIComponent(String(params.a ?? ""));
  const rawB = decodeURIComponent(String(params.b ?? ""));
  const [group, setGroup] = useState<Group | null>(null);
  const [error, setError] = useState<string | null>(null);
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

  const names = useMemo(() => (group ? [resolveNickname(group, rawA), resolveNickname(group, rawB)] : [rawA, rawB]), [group, rawA, rawB]);
  const r = useMemo(() => (group ? findRivalry(group, names[0], names[1], now) : null), [group, names, now]);
  const positionKey = `rivalry:${r?.key ?? ""}`;

  // 부캐 이름이나 순서가 다른 주소로 들어왔으면 정식 주소로
  useEffect(() => {
    if (!group) return;
    const canonical = rivalryHref(names[0], names[1]);
    if (canonical !== window.location.pathname) window.history.replaceState(window.history.state, "", canonical);
  }, [group, names]);

  useEffect(() => {
    if (!r || restored) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRestored(true);
    const y = takeListScroll(positionKey);
    if (y !== null) requestAnimationFrame(() => window.scrollTo(0, y));
  }, [r, restored, positionKey]);

  if (error && !group) return <LoadError message={error} onRetry={load} />;
  if (!group) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  const back = (
    <button onClick={() => backToList(router, "rivalry")} className="flex items-center gap-1 text-sm text-ink-subtle transition-fast hover:text-ink cursor-pointer">
      <ChevronLeft size={16} /> 돌아가기
    </button>
  );

  if (!r) {
    return (
      <div className="mx-auto max-w-4xl space-y-4 px-4 py-6 sm:px-6 lg:px-8">
        {back}
        <Card className="py-12 text-center text-ink-subtle break-keep">
          {names[0]} · {names[1]} 두 사람이 같은 라인에서 맞붙은 기록이 없습니다.
        </Card>
      </div>
    );
  }

  const n = r.games.length;
  const aPct = Math.round((r.a.wins / n) * 100);
  const last = formatLastPlayed(r.lastPlayedAt, now);
  const onOpen = () => rememberListPosition(positionKey);

  return (
    <div className="mx-auto max-w-5xl min-w-0 space-y-4 px-4 py-6 sm:px-6 lg:px-8">
      <div className="flex items-center justify-between">{back}<LabBadge /></div>
      {error && <LoadError compact message={error} onRetry={load} />}

      {/* 머리말: 두 사람 + 주 챔피언 일러스트 */}
      <Card className="relative overflow-hidden p-0">
        <SplashBg champion={r.a.mainChampion} side="left" />
        <SplashBg champion={r.b.mainChampion} side="right" />
        <div className="relative space-y-3 px-4 py-5 sm:px-6">
          <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
            <SideHead s={r.a} color="blue" />
            <div className="text-center">
              <div className="flex items-baseline gap-1.5 text-3xl font-black tabular-nums sm:text-4xl">
                <span className="text-blue-300">{r.a.wins}</span><span className="text-sm text-ink-tertiary">VS</span><span className="text-red-300">{r.b.wins}</span>
              </div>
              <div className="text-[11px] text-ink-subtle">{LANE_LABEL[r.mainLane]} 맞대결 {n}판</div>
            </div>
            <SideHead s={r.b} color="red" align="right" />
          </div>
          <div className="flex flex-wrap justify-center gap-1.5">
            {r.titles.map((t) => <TitleChip key={t.kind} t={t} />)}
            <span className="rounded border border-hairline bg-surface-2/80 px-1.5 py-0.5 text-[11px] text-ink-subtle">신뢰도 {r.confidence}</span>
          </div>
          <div className="flex h-1.5 overflow-hidden rounded-full bg-surface-3" role="img" aria-label={`${r.a.nickname} ${aPct}%, ${r.b.nickname} ${100 - aPct}%`}>
            <div className="bg-blue-500/80" style={{ width: `${aPct}%` }} />
            <div className="bg-red-500/80" style={{ width: `${100 - aPct}%` }} />
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-3">
        <div className="min-w-0 space-y-4 lg:col-span-2">
          {/* 최근 흐름 */}
          <Card className="space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold text-ink">최근 흐름</h2>
              <span className="text-[11px] text-ink-tertiary">최근 {Math.min(10, n)}판 · 오른쪽이 최신</span>
            </div>
            <MomentumDots r={r} size="md" />
            <div className="grid grid-cols-3 gap-2 text-xs">
              <Stat label="연승" value={r.streak ? `${r.streak.count}연승` : "-"} sub={r.streak ? (r.streak.side === "a" ? r.a.nickname : r.b.nickname) : ""} color={r.streak?.side === "a" ? "text-blue-300" : "text-red-300"} />
              <Stat label={`최근 ${Math.min(5, n)}판`} value={recentScore(r, 5)} />
              <Stat label="마지막 맞대결" value={last.date} sub={last.ago} />
            </div>
          </Card>

          {/* 맞대결 평균 */}
          <Card className="p-0 overflow-hidden">
            <div className="flex items-baseline justify-between border-b border-hairline px-4 py-2.5">
              <h2 className="text-sm font-semibold text-ink">맞대결 평균</h2>
              <span className="text-[11px] text-ink-tertiary">서로 마주쳤을 때만</span>
            </div>
            <table className="w-full text-xs tabular-nums">
              <tbody className="divide-y divide-hairline/50">
                <CompareRow label="KDA" a={`${r.a.avg.kills}/${r.a.avg.deaths}/${r.a.avg.assists}`} b={`${r.b.avg.kills}/${r.b.avg.deaths}/${r.b.avg.assists}`} />
                <CompareRow label="데스 (평소)" a={`${r.a.avg.deaths} (${r.a.usualDeaths.toFixed(1)})`} b={`${r.b.avg.deaths} (${r.b.usualDeaths.toFixed(1)})`}
                  better={r.a.avg.deaths - r.a.usualDeaths < r.b.avg.deaths - r.b.usualDeaths ? "a" : "b"} />
                <CompareRow label="분당 CS" a={fmt(r.a.avg.csPerMin)} b={fmt(r.b.avg.csPerMin)} better={cmp(r.a.avg.csPerMin, r.b.avg.csPerMin)} />
                <CompareRow label="분당 골드" a={fmt(r.a.avg.goldPerMin, 0)} b={fmt(r.b.avg.goldPerMin, 0)} better={cmp(r.a.avg.goldPerMin, r.b.avg.goldPerMin)} />
              </tbody>
            </table>
            {r.lanes.length > 1 && (
              <div className="border-t border-hairline px-4 py-2 text-[11px] text-ink-tertiary">
                라인별: {r.lanes.map((l) => `${LANE_LABEL[l.lane]} ${l.aWins}:${l.games - l.aWins}`).join(" · ")}
              </div>
            )}
          </Card>

          {/* 기억할 경기 + 전체 맞대결 */}
          <Card className="p-0 overflow-hidden">
            <div className="flex items-baseline justify-between border-b border-hairline px-4 py-2.5">
              <h2 className="text-sm font-semibold text-ink">맞대결 기록</h2>
              <span className="text-[11px] text-ink-tertiary">{n}판 · 최신부터</span>
            </div>
            <ul className="divide-y divide-hairline/50">
              {[...r.games].reverse().map((g) => (
                <GameRow key={g.match.id} g={g} r={r} now={now} tag={r.memorable.find((m) => m.game === g)?.reason} onOpen={onOpen} />
              ))}
            </ul>
          </Card>
        </div>

        <div className="min-w-0 space-y-4">
          {/* 라인 팁 */}
          <Card className="space-y-3">
            <h2 className="text-sm font-semibold text-ink">라인전 참고</h2>
            {n < 3 ? (
              <p className="text-xs text-ink-subtle">아직 탐색전입니다. 3판은 붙어 봐야 보입니다.</p>
            ) : (
              <>
                <Tips s={r.a} color="blue" />
                <Tips s={r.b} color="red" />
              </>
            )}
            <p className="text-[11px] text-ink-tertiary break-keep">
              실제 맞대결 기록에서 기준을 넘는 것만 뽑은 문장입니다. 경기 종료 기록 기준이라 라인전(10·15분) 지표는 새 수집기 기록이 쌓이면 추가됩니다.
            </p>
          </Card>

          {/* 맞대결 챔피언 */}
          <Card className="space-y-2">
            <h2 className="text-sm font-semibold text-ink">맞대결 챔피언</h2>
            <div className="grid grid-cols-2 gap-3">
              <ChampList s={r.a} color="text-blue-300" />
              <ChampList s={r.b} color="text-red-300" />
            </div>
          </Card>

          <p className="text-[11px] text-ink-tertiary break-keep">
            맞대결 = 같은 라인에서 서로 상대 팀으로 만난 경기. 승패는 팀 결과입니다.
            {r.detailedGames < n && ` 수기 기록 ${n - r.detailedGames}판은 퍼스트 블러드 등 상세 지표가 없습니다.`}
          </p>
        </div>
      </div>
    </div>
  );
}

const fmt = (v: number | null, digits = 1) => (v === null ? "-" : v.toFixed(digits));
const cmp = (a: number | null, b: number | null): "a" | "b" | undefined => (a === null || b === null || a === b ? undefined : a > b ? "a" : "b");

function recentScore(r: Rivalry, k: number) {
  const recent = r.games.slice(-k);
  const a = recent.filter((g) => g.aWin).length;
  return `${a} : ${recent.length - a}`;
}

function SideHead({ s, color, align = "left" }: { s: SideSummary; color: "blue" | "red"; align?: "left" | "right" }) {
  return (
    <Link href={playerHref(s.nickname)} className={`min-w-0 ${align === "right" ? "text-right" : ""}`}>
      <div className={`flex items-center gap-2 ${align === "right" ? "flex-row-reverse" : ""}`}>
        {s.mainChampion && <ChampionIcon name={s.mainChampion} size={40} className="rounded-lg ring-1 ring-hairline-strong" />}
        <div className="min-w-0">
          <div className={`truncate text-sm font-bold sm:text-base ${color === "blue" ? "text-blue-200" : "text-red-200"}`}>{s.nickname}</div>
          <div className="truncate text-[11px] text-ink-subtle">{s.mainChampion ? `주로 ${s.mainChampion}` : "고정 픽 없음"}</div>
        </div>
      </div>
    </Link>
  );
}

function Stat({ label, value, sub, color = "text-ink" }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="min-w-0 rounded-md bg-surface-2 px-2 py-1.5">
      <div className={`truncate text-sm font-bold tabular-nums ${color}`}>{value}</div>
      <div className="truncate text-[10px] text-ink-tertiary">{label}{sub ? ` · ${sub}` : ""}</div>
    </div>
  );
}

function CompareRow({ label, a, b, better }: { label: string; a: string; b: string; better?: "a" | "b" }) {
  return (
    <tr>
      <td className={`w-[38%] px-4 py-2 text-left ${better === "a" ? "font-semibold text-blue-300" : "text-ink-muted"}`}>{a}</td>
      <td className="px-1 py-2 text-center text-[11px] text-ink-tertiary">{label}</td>
      <td className={`w-[38%] px-4 py-2 text-right ${better === "b" ? "font-semibold text-red-300" : "text-ink-muted"}`}>{b}</td>
    </tr>
  );
}

function Tips({ s, color }: { s: SideSummary; color: "blue" | "red" }) {
  return (
    <div className="space-y-1">
      <div className={`text-xs font-semibold ${color === "blue" ? "text-blue-300" : "text-red-300"}`}>{s.nickname} 입장</div>
      {s.tips.length ? (
        <ul className="space-y-1">
          {s.tips.map((t) => (
            <li key={t} className="flex items-start gap-1.5 text-xs text-ink-muted break-keep">
              <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${color === "blue" ? "bg-blue-400" : "bg-red-400"}`} aria-hidden="true" />{t}
            </li>
          ))}
        </ul>
      ) : <p className="text-xs text-ink-tertiary">눈에 띄는 차이 없음</p>}
    </div>
  );
}

function ChampList({ s, color }: { s: SideSummary; color: string }) {
  return (
    <div className="min-w-0 space-y-1.5">
      <div className={`truncate text-[11px] ${color}`}>{s.nickname}</div>
      {s.champs.slice(0, 4).map((c) => (
        <div key={c.champion} className="flex items-center gap-1.5 text-xs">
          <ChampionIcon name={c.champion} size={22} className="rounded" />
          <span className="min-w-0 flex-1 truncate text-ink">{c.champion}</span>
          <span className={`shrink-0 tabular-nums ${c.wins / c.games >= 0.6 ? "text-win" : c.wins / c.games <= 0.4 ? "text-lose" : "text-ink-subtle"}`}>{c.wins}-{c.games - c.wins}</span>
        </div>
      ))}
    </div>
  );
}

function GameRow({ g, r, now, tag, onOpen }: { g: RivalGame; r: Rivalry; now: number; tag?: string; onOpen: () => void }) {
  const when = formatLastPlayed(g.match.createdAt, now);
  const winner = g.aWin ? r.a.nickname : r.b.nickname;
  return (
    <li>
      <Link href={`/group/main/match/${g.match.id}`} onClick={onOpen}
        className={`flex items-center gap-2 border-l-4 px-3 py-2 transition-fast hover:bg-surface-2/60 sm:px-4 ${g.aWin ? "border-l-blue-500/70" : "border-l-red-500/70"}`}>
        <ChampionIcon name={g.a.champion} size={30} className="rounded-md" />
        <div className="min-w-0 flex-1 text-xs">
          <div className="flex flex-wrap items-center gap-x-1.5">
            <span className="tabular-nums text-ink">{g.a.kills}/{g.a.deaths}/{g.a.assists}</span>
            <span className="text-ink-tertiary">vs</span>
            <span className="tabular-nums text-ink">{g.b.kills}/{g.b.deaths}/{g.b.assists}</span>
            {(g.a.isMvp || g.b.isMvp) && <Badge variant="mvp"><Trophy size={9} className="mr-0.5" />MVP {g.a.isMvp ? r.a.nickname : r.b.nickname}</Badge>}
            {tag && <span className="rounded bg-mvp/10 px-1 text-[10px] text-mvp">{tag}</span>}
          </div>
          <div className="truncate text-[11px] text-ink-tertiary">
            <span className={g.aWin ? "text-blue-300" : "text-red-300"}>{winner} 승</span> · {LANE_LABEL[g.lane]} · {when.date}{g.match.gameDuration ? ` · ${g.match.gameDuration}` : ""}
          </div>
        </div>
        <ChampionIcon name={g.b.champion} size={30} className="rounded-md" />
      </Link>
    </li>
  );
}
