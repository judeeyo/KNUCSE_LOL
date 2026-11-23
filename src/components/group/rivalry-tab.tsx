"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { FlaskConical, Swords, Crown } from "lucide-react";
import { Card } from "@/components/ui/card";
import { ChampionIcon } from "@/components/ui/champion-icon";
import { getChampionSplashUrl } from "@/lib/champions";
import { rememberListPosition } from "@/lib/list-position";
import { LANE_LABEL } from "@/lib/profile";
import {
  buildFeatured, buildRivalries, FEATURED_GROUPS, rivalryHref, MOMENTUM_GAMES, type Rivalry, type RivalryTitle,
} from "@/lib/rivalry";
import type { Group, Lane } from "@/lib/types";

const LANES: (Lane | "all")[] = ["all", "top", "jungle", "mid", "adc", "support"];

/** 실험실 딱지 (탭·페이지 공용) */
export function LabBadge({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-0.5 rounded border border-ace/40 bg-ace/10 px-1 py-px text-[10px] font-semibold leading-none text-ace ${className}`}>
      <FlaskConical size={10} aria-hidden="true" />실험실
    </span>
  );
}

/** 챔피언 일러스트를 어둡게 깐 배경 (불러오지 못하면 배경색만) */
export function SplashBg({ champion, side }: { champion: string | null; side: "left" | "right" }) {
  const url = champion ? getChampionSplashUrl(champion) : null;
  if (!url) return null;
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-y-0 w-1/2 bg-cover bg-center opacity-35"
      style={{
        [side]: 0,
        backgroundImage: `url("${url}")`,
        maskImage: `linear-gradient(to ${side === "left" ? "right" : "left"}, black 20%, transparent 95%)`,
        WebkitMaskImage: `linear-gradient(to ${side === "left" ? "right" : "left"}, black 20%, transparent 95%)`,
      }}
    />
  );
}

/** 최근 맞대결을 점으로 (a 이기면 파랑, b 이기면 빨강, 오른쪽이 최신) */
export function MomentumDots({ r, count = MOMENTUM_GAMES, size = "sm" }: { r: Rivalry; count?: number; size?: "sm" | "md" }) {
  const recent = r.games.slice(-count);
  const dot = size === "md" ? "h-5 w-5 text-[10px]" : "h-3.5 w-3.5 text-[8px]";
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`최근 ${recent.length}번: ${recent.map((g) => (g.aWin ? r.a.nickname : r.b.nickname)).join(", ")} 승`}>
      {recent.map((g, i) => (
        <span key={g.match.id}
          className={`inline-flex items-center justify-center rounded-sm font-bold ${dot} ${g.aWin ? "bg-blue-500/70 text-blue-50" : "bg-red-500/70 text-red-50"} ${i === recent.length - 1 ? "ring-1 ring-ink/60" : ""}`}>
          {size === "md" ? (g.aWin ? r.a.nickname : r.b.nickname).charAt(0) : ""}
        </span>
      ))}
    </span>
  );
}

export function TitleChip({ t }: { t: RivalryTitle }) {
  const style = t.kind === "destined" ? "border-mvp/40 bg-mvp/10 text-mvp"
    : t.kind === "nemesis" ? "border-lose/40 bg-lose/10 text-lose"
    : t.kind === "streak" ? "border-primary/40 bg-primary/10 text-primary-hover"
    : "border-hairline bg-surface-2 text-ink-subtle";
  const icon = t.kind === "destined" ? "🔥 " : t.kind === "nemesis" ? "👑 " : t.kind === "streak" ? "⚡ " : "⚔ ";
  return <span className={`inline-flex max-w-full items-center rounded border px-1.5 py-0.5 text-[11px] ${style}`}><span className="truncate">{icon}{t.text}</span></span>;
}

export function RivalryTab({ group }: { group: Group }) {
  const [now] = useState(() => Date.now());
  const [lane, setLane] = useState<Lane | "all">("all");
  const rivalries = useMemo(() => buildRivalries(group, now), [group, now]);
  const featured = useMemo(() => FEATURED_GROUPS.map((f) => buildFeatured(group, f, now)).filter((f) => f.pairs.length > 0), [group, now]);
  const shown = rivalries.filter((r) => lane === "all" || r.mainLane === lane);
  const open = () => rememberListPosition("rivalry");

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-2 rounded-lg border border-ace/30 bg-ace/5 px-3 py-2 text-xs text-ink-muted break-keep">
        <FlaskConical size={14} className="mt-0.5 shrink-0 text-ace" />
        <span>
          <b className="text-ace">실험실</b> · 같은 라인에서 맞붙은 기록만 모았습니다. 승패는 그 판 팀 결과라 한 사람 실력만의 결과는 아닙니다.
          칭호·팁은 기록이 기준을 넘을 때만 붙습니다.
        </span>
      </div>

      {featured.map((f) => (
        <Card key={f.title} className="space-y-3 p-0 overflow-hidden">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-4 pt-4">
            <h2 className="flex items-center gap-1.5 text-base font-bold text-ink">
              <Swords size={16} className="text-mvp" /> {f.title}
              <span className="text-xs font-normal text-ink-subtle">· {LANE_LABEL[f.lane]}</span>
            </h2>
            <span className="text-[11px] text-ink-tertiary">{f.subtitle}</span>
          </div>

          {/* 세 사람 순위 (일러스트 카드) */}
          <div className="grid grid-cols-3 gap-1.5 px-4">
            {f.standings.map((s, i) => {
              const url = s.mainChampion ? getChampionSplashUrl(s.mainChampion) : null;
              return (
                <Link key={s.nickname} href={`/group/main/player/${encodeURIComponent(s.nickname)}`} onClick={open}
                  className="relative min-w-0 overflow-hidden rounded-lg border border-hairline bg-surface-2 px-2 pb-2 pt-12 hover:border-hairline-strong transition-fast">
                  {url && <div aria-hidden="true" className="absolute inset-0 bg-cover bg-top opacity-50" style={{ backgroundImage: `url("${url}")` }} />}
                  <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-surface-1 via-surface-1/70 to-transparent" />
                  <div className="relative">
                    <div className="flex items-center gap-1 text-[11px] text-ink-subtle">
                      {i === 0 && <Crown size={11} className="text-mvp" />}{i + 1}위{s.mainChampion && <span className="truncate">· {s.mainChampion}</span>}
                    </div>
                    <div className="truncate text-sm font-bold text-ink">{s.nickname}</div>
                    <div className="text-[11px] text-ink-subtle tabular-nums">
                      {s.wins}승 {s.games - s.wins}패 <span className={s.winRate >= 55 ? "text-win" : s.winRate <= 45 ? "text-lose" : ""}>{s.winRate.toFixed(0)}%</span>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>

          {/* 쌍별 */}
          <ul className="divide-y divide-hairline/60 border-t border-hairline">
            {f.pairs.map((r) => <RivalryRow key={r.key} r={r} onOpen={open} />)}
          </ul>
        </Card>
      ))}

      <Card className="p-0 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline px-4 py-2.5">
          <h2 className="text-sm font-semibold text-ink">맞라인 라이벌 <span className="font-normal text-ink-tertiary">{shown.length}쌍</span></h2>
          <div className="flex flex-wrap gap-1" role="group" aria-label="라인 필터">
            {LANES.map((l) => (
              <button key={l} type="button" aria-pressed={lane === l} onClick={() => setLane(l)}
                className={`rounded px-2 py-0.5 text-[11px] cursor-pointer transition-fast ${lane === l ? "bg-primary/15 text-primary" : "text-ink-subtle hover:text-ink"}`}>
                {l === "all" ? "전체" : LANE_LABEL[l]}
              </button>
            ))}
          </div>
        </div>
        {shown.length ? (
          <ul className="divide-y divide-hairline/60">{shown.map((r) => <RivalryRow key={r.key} r={r} onOpen={open} />)}</ul>
        ) : (
          <p className="px-4 py-6 text-center text-xs text-ink-subtle">같은 라인에서 3번 이상 만난 쌍이 아직 없습니다.</p>
        )}
        <p className="border-t border-hairline px-4 py-2 text-[11px] text-ink-tertiary break-keep">
          같은 라인에서 3번 이상 만난 쌍 · 최근에 자주, 팽팽하게 붙을수록 위 · 신뢰도: 3~4판 참고, 5~9판 보통, 10판 이상 신뢰
        </p>
      </Card>
    </div>
  );
}

function RivalryRow({ r, onOpen }: { r: Rivalry; onOpen: () => void }) {
  const n = r.games.length;
  const aPct = (r.a.wins / n) * 100;
  const headline = r.titles.find((t) => t.kind !== "revenge");
  return (
    <li>
      <Link href={rivalryHref(r.a.nickname, r.b.nickname)} onClick={onOpen} className="block px-3 py-2.5 hover:bg-surface-2/60 transition-fast sm:px-4">
        <div className="flex items-center gap-2">
          {r.a.mainChampion && <ChampionIcon name={r.a.mainChampion} size={28} className="rounded-md" />}
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="truncate font-medium text-blue-300">{r.a.nickname}</span>
              <span className="shrink-0 font-bold tabular-nums text-ink">
                <span className="text-blue-300">{r.a.wins}</span><span className="mx-1 text-ink-tertiary">:</span><span className="text-red-300">{r.b.wins}</span>
              </span>
              <span className="truncate text-right font-medium text-red-300">{r.b.nickname}</span>
            </div>
            <div className="mt-1 flex h-1 overflow-hidden rounded-full bg-surface-3">
              <div className="bg-blue-500/70" style={{ width: `${aPct}%` }} />
              <div className="bg-red-500/70" style={{ width: `${100 - aPct}%` }} />
            </div>
          </div>
          {r.b.mainChampion && <ChampionIcon name={r.b.mainChampion} size={28} className="rounded-md" />}
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 pl-9 pr-9 text-[11px] text-ink-tertiary">
          <span>{LANE_LABEL[r.mainLane]} · {n}판 · {r.confidence}</span>
          <MomentumDots r={r} count={5} />
          {headline && <TitleChip t={headline} />}
        </div>
      </Link>
    </li>
  );
}
