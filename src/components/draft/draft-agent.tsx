"use client";

import { useEffect, useMemo, useState } from "react";
import { Ban, Check, Eye, Lightbulb, RotateCcw, Undo2, Swords } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChampionIcon } from "@/components/ui/champion-icon";
import { ChampionInput } from "@/components/ui/champion-input";
import {
  adviseDraft, buildDraftIndex, DRAFT_SEQUENCE, enemyCompTips, evaluateComp, formatDraftMessage, guessPickOwner,
  LANE_LABEL, suggestNextPicks, type DraftSide, type DraftSlot, type DraftState,
} from "@/lib/draft";
import type { Match } from "@/lib/types";

/** 한 단계의 입력. champion 이 null 이면 밴 안 함 */
interface Action {
  champion: string | null;
  nickname?: string; // 픽일 때 그 챔피언을 하는 선수
}

const SIDE_LABEL: Record<DraftSide, string> = { blue: "블루", red: "레드" };
const SIDE_TEXT: Record<DraftSide, string> = { blue: "text-blue-400", red: "text-red-400" };
const SIDE_BORDER: Record<DraftSide, string> = { blue: "border-blue-500/40", red: "border-red-500/40" };
const other = (s: DraftSide): DraftSide => (s === "blue" ? "red" : "blue");

/**
 * 밴픽 에이전트: 드래프트 순서(밴 3-3 → 픽 → 밴 2-2 → 픽)대로 한 칸씩 진행한다.
 * 우리 차례면 추천을 보여 주고, 상대 차례면 상대가 고른 챔피언을 입력받는다. 입력할 때마다 추천을 다시 계산한다.
 */
export function DraftAgent({ blue, red, matches, storageKey }: { blue: DraftSlot[]; red: DraftSlot[]; matches: Match[]; storageKey: string }) {
  const [ourSide, setOurSide] = useState<DraftSide>("blue");
  const [actions, setActions] = useState<Action[]>([]);
  const [restored, setRestored] = useState(false);
  const [pickFor, setPickFor] = useState(""); // 직접 입력할 때 누구 픽인지 (우리: 선수, 상대: "" = 자동)
  const [copied, setCopied] = useState<"idle" | "copied" | "manual">("idle");
  const index = useMemo(() => buildDraftIndex(matches), [matches]);

  // 새로고침해도 진행 상황이 남도록 (같은 팀 주소별로 이 브라우저에만 저장)
  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey) || "null") as { ourSide: DraftSide; actions: Action[] } | null;
      if (saved && Array.isArray(saved.actions)) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setActions(saved.actions.slice(0, DRAFT_SEQUENCE.length));
        setOurSide(saved.ourSide === "red" ? "red" : "blue");
      }
    } catch {
      // 저장소를 못 쓰면 처음부터
    }
    setRestored(true);
  }, [storageKey]);
  useEffect(() => {
    if (!restored) return;
    try {
      sessionStorage.setItem(storageKey, JSON.stringify({ ourSide, actions }));
    } catch {
      // 무시
    }
  }, [restored, storageKey, ourSide, actions]);

  const teams: Record<DraftSide, DraftSlot[]> = { blue, red };
  const bans: Record<DraftSide, (string | null)[]> = { blue: [], red: [] };
  const picks: Record<string, string> = {};
  actions.forEach((a, i) => {
    const step = DRAFT_SEQUENCE[i];
    if (step.kind === "ban") bans[step.side].push(a.champion);
    else if (a.champion && a.nickname) picks[a.nickname] = a.champion;
  });
  const theirSide = other(ourSide);
  const pickMap = (side: DraftSide) => Object.fromEntries(teams[side].filter((s) => picks[s.nickname]).map((s) => [s.nickname, picks[s.nickname]]));
  const state: DraftState = {
    ours: teams[ourSide],
    theirs: teams[theirSide],
    ourBans: bans[ourSide].filter((c): c is string => !!c),
    theirBans: bans[theirSide].filter((c): c is string => !!c),
    ourPicks: pickMap(ourSide),
    theirPicks: pickMap(theirSide),
  };
  const stateKey = JSON.stringify(state);
  /* eslint-disable react-hooks/exhaustive-deps */
  const advice = useMemo(() => adviseDraft(index, state), [index, stateKey]);
  const nextPicks = useMemo(() => suggestNextPicks(index, state, advice), [index, stateKey, advice]);
  /* eslint-enable react-hooks/exhaustive-deps */
  const taken = new Set(actions.map((a) => a.champion).filter((c): c is string => !!c));

  const stepIdx = actions.length;
  const step = DRAFT_SEQUENCE[stepIdx];
  const done = !step;
  const ours = step?.side === ourSide;
  const openSlots = (side: DraftSide) => teams[side].filter((s) => !picks[s.nickname]);

  const push = (a: Action) => {
    setActions((prev) => [...prev, a]);
    setPickFor("");
    setCopied("idle");
  };
  const undo = () => { setActions((prev) => prev.slice(0, -1)); setPickFor(""); setCopied("idle"); };
  const reset = () => { setActions([]); setPickFor(""); setCopied("idle"); };

  const submitPick = (side: DraftSide, champion: string, nickname?: string) => {
    const open = openSlots(side);
    const owner = nickname && open.some((s) => s.nickname === nickname)
      ? nickname
      : side === ourSide
        ? (nextPicks.find((s) => s.champion === champion)?.nickname || guessPickOwner(index, champion, open)?.nickname)
        : guessPickOwner(index, champion, open)?.nickname;
    push({ champion, nickname: owner });
  };

  async function copy() {
    const text = formatDraftMessage(state, advice, ourSide === "blue" ? "🔵 블루팀" : "🔴 레드팀");
    try {
      await navigator.clipboard.writeText(text);
      setCopied("copied");
    } catch {
      setCopied("manual");
    }
  }

  const banNo = step?.kind === "ban" ? DRAFT_SEQUENCE.slice(0, stepIdx + 1).filter((s) => s.kind === "ban" && s.side === step.side).length : 0;
  const pickNo = step?.kind === "pick" ? DRAFT_SEQUENCE.slice(0, stepIdx + 1).filter((s) => s.kind === "pick" && s.side === step.side).length : 0;
  const best = advice.options[0];
  const ourAllPicked = state.ours.every((s) => picks[s.nickname]);

  return (
    <div className="space-y-4">
      {/* 우리 팀 선택 · 되돌리기 */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex rounded-lg border border-hairline overflow-hidden text-sm" role="group" aria-label="우리 팀 선택">
          {(["blue", "red"] as const).map((s) => (
            <button key={s} type="button" aria-pressed={ourSide === s} onClick={() => setOurSide(s)}
              className={`px-3 py-1.5 cursor-pointer whitespace-nowrap ${ourSide === s ? (s === "blue" ? "bg-blue-500/15 text-blue-400" : "bg-red-500/15 text-red-400") : "text-ink-subtle hover:text-ink"}`}>
              우리 = {SIDE_LABEL[s]}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <Button type="button" size="sm" variant="secondary" onClick={undo} disabled={actions.length === 0}><Undo2 size={14} /> 되돌리기</Button>
          <Button type="button" size="sm" variant="ghost" onClick={reset} disabled={actions.length === 0}><RotateCcw size={14} /> 처음부터</Button>
        </div>
      </div>

      {/* 진행 상황판 */}
      <div className="grid grid-cols-2 gap-3">
        {(["blue", "red"] as const).map((side) => (
          <Card key={side} className={`min-w-0 space-y-2 border-t-4 ${SIDE_BORDER[side]} p-3`}>
            <div className={`text-xs font-bold ${SIDE_TEXT[side]}`}>{SIDE_LABEL[side]}{side === ourSide ? " (우리)" : " (상대)"}</div>
            <div className="flex gap-1" aria-label={`${SIDE_LABEL[side]} 밴`}>
              {Array.from({ length: 5 }, (_, i) => {
                const c = bans[side][i];
                const current = step?.kind === "ban" && step.side === side && bans[side].length === i;
                return (
                  <span key={i} title={c || (c === null ? "밴 안 함" : "")}
                    className={`flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded border text-[10px] text-ink-tertiary ${current ? "border-primary ring-1 ring-primary" : "border-hairline"} ${c ? "grayscale" : ""}`}>
                    {c ? <ChampionIcon name={c} size={26} /> : c === null ? "—" : ""}
                  </span>
                );
              })}
            </div>
            <ul className="space-y-1">
              {teams[side].map((s) => {
                const c = picks[s.nickname];
                return (
                  <li key={s.nickname} className="flex min-w-0 items-center gap-1.5 text-xs">
                    <span className="w-7 shrink-0 text-ink-tertiary">{LANE_LABEL[s.lane]}</span>
                    {c ? <ChampionIcon name={c} size={22} /> : <span className="h-[22px] w-[22px] shrink-0 rounded border border-dashed border-hairline" />}
                    <span className="min-w-0 truncate">
                      <span className="text-ink">{c || ""}</span>
                      <span className={`${c ? "ml-1 text-ink-subtle" : "text-ink-muted"}`}>{s.nickname}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </Card>
        ))}
      </div>

      {/* 지금 차례 */}
      {!done && step && (
        <Card className={`space-y-3 border-l-4 ${SIDE_BORDER[step.side]}`} aria-live="polite">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="flex items-center gap-1.5 text-base font-bold text-ink">
              {step.kind === "ban" ? <Ban size={16} className={SIDE_TEXT[step.side]} /> : <Swords size={16} className={SIDE_TEXT[step.side]} />}
              <span className={SIDE_TEXT[step.side]}>{ours ? "우리" : "상대"}</span>
              {step.kind === "ban" ? ` 밴 ${banNo}번째` : ` 픽 ${pickNo}번째`}
            </h2>
            <span className="text-xs text-ink-subtle">{stepIdx + 1} / {DRAFT_SEQUENCE.length}</span>
          </div>

          {/* 우리 밴 */}
          {ours && step.kind === "ban" && (
            <>
              <p className="text-xs text-ink-muted break-keep">상대 선수가 그 라인에서 많이 하고 이긴 챔피언이에요. 눌러서 밴하세요.</p>
              <SuggestionList items={advice.banSuggestions.map((b) => ({
                champion: b.champion,
                title: b.champion,
                sub: `${b.target} ${LANE_LABEL[b.lane]} · ${b.games}판 ${b.wins}승${b.share >= 0.4 ? ` · 주력 ${Math.round(b.share * 100)}%` : ""}`,
              }))} onPick={(c) => push({ champion: c })} empty="밴할 만한 상대 주력이 없어요. 원하는 챔피언을 직접 입력하세요." />
              <div className="flex gap-2">
                <ChampionInput className="flex-1" label="밴할 챔피언 직접 입력" taken={taken} onSubmit={(c) => push({ champion: c })} placeholder="다른 챔피언 밴" />
                <Button type="button" variant="ghost" onClick={() => push({ champion: null })}>밴 안 함</Button>
              </div>
            </>
          )}

          {/* 상대 밴 */}
          {!ours && step.kind === "ban" && (
            <>
              <ChampionInput autoFocus label="상대가 밴한 챔피언" taken={taken} onSubmit={(c) => push({ champion: c })} placeholder="상대가 밴한 챔피언 입력" />
              {advice.ourExposed.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs text-ink-muted">상대가 밴할 것 같은 우리 주력 (눌러서 바로 입력)</p>
                  <SuggestionList compact items={advice.ourExposed.map((b) => ({ champion: b.champion, title: b.champion, sub: `${b.target} · ${b.games}판` }))}
                    onPick={(c) => push({ champion: c })} />
                </div>
              )}
              <Button type="button" size="sm" variant="ghost" onClick={() => push({ champion: null })}>상대가 밴 안 함</Button>
            </>
          )}

          {/* 우리 픽 */}
          {ours && step.kind === "pick" && (
            <>
              <p className="text-xs text-ink-muted break-keep">지금 가져갈 챔피언이에요. 위일수록 먼저 뽑는 게 좋아요.</p>
              <SuggestionList items={nextPicks.map((s) => ({
                champion: s.champion,
                key: `${s.nickname}|${s.champion}`,
                title: `${s.champion} · ${s.nickname} (${LANE_LABEL[s.lane]})`,
                sub: [...s.candidate.reasons, ...s.why].join(" · "),
                badge: s.candidate.isNew ? "새 챔피언" : undefined,
                onClick: () => push({ champion: s.champion, nickname: s.nickname }),
              }))} onPick={() => {}} empty="추천할 후보가 없어요. 직접 입력하세요." />
              <div className="flex flex-wrap gap-2">
                <select value={pickFor} onChange={(e) => setPickFor(e.target.value)} aria-label="누구 픽인지"
                  className="rounded-lg border border-hairline bg-surface-1 px-2 py-2 text-sm text-ink">
                  <option value="">선수 자동</option>
                  {openSlots(ourSide).map((s) => <option key={s.nickname} value={s.nickname}>{LANE_LABEL[s.lane]} {s.nickname}</option>)}
                </select>
                <ChampionInput className="flex-1 min-w-[10rem]" label="우리 픽 직접 입력" taken={taken} onSubmit={(c) => submitPick(ourSide, c, pickFor)} placeholder="다른 챔피언" />
              </div>
            </>
          )}

          {/* 상대 픽 */}
          {!ours && step.kind === "pick" && (
            <>
              <div className="flex flex-wrap gap-2">
                <select value={pickFor} onChange={(e) => setPickFor(e.target.value)} aria-label="상대 누구 픽인지"
                  className="rounded-lg border border-hairline bg-surface-1 px-2 py-2 text-sm text-ink">
                  <option value="">선수 자동 추정</option>
                  {openSlots(theirSide).map((s) => <option key={s.nickname} value={s.nickname}>{LANE_LABEL[s.lane]} {s.nickname}</option>)}
                </select>
                <ChampionInput autoFocus className="flex-1 min-w-[10rem]" label="상대가 픽한 챔피언" taken={taken} onSubmit={(c) => submitPick(theirSide, c, pickFor)} placeholder="상대가 픽한 챔피언 입력" />
              </div>
              <EnemyGuess plans={advice.enemyPlans} onPick={(c, n) => push({ champion: c, nickname: n })} />
            </>
          )}
        </Card>
      )}

      {/* 지금 기준 추천 조합 (픽이 남아 있을 때) */}
      {!ourAllPicked && best && (
        <Card className="space-y-2">
          <div className="flex items-center gap-1.5 text-sm font-semibold text-ink"><Lightbulb size={15} className="text-primary" /> 지금 기준 추천 조합</div>
          <ul className="space-y-1">
            {best.picks.map((p) => (
              <li key={p.nickname} className="flex min-w-0 items-center gap-2 text-sm">
                <span className="w-8 shrink-0 text-xs text-ink-muted">{LANE_LABEL[p.lane]}</span>
                <ChampionIcon name={p.champion} size={24} />
                <span className="min-w-0 truncate">
                  <span className="font-medium text-ink">{p.champion}</span>
                  <span className="ml-1.5 text-xs text-ink-subtle">{p.nickname}</span>
                  {p.candidate.locked && <Check size={12} className="ml-1 inline text-primary" aria-label="확정" />}
                </span>
                <span className="ml-auto hidden shrink-0 text-[11px] text-ink-tertiary sm:inline">{p.candidate.reasons[0]}</span>
              </li>
            ))}
          </ul>
          <CompNotes notes={best.comp.notes} />
        </Card>
      )}

      {/* 끝났을 때 / 우리 픽이 다 끝났을 때 */}
      {ourAllPicked && (
        <Card className="space-y-3">
          <div className="text-sm font-semibold text-ink">{done ? "밴픽 끝" : "우리 픽 완료"} — 조합 점검</div>
          <CompNotes notes={evaluateComp(state.ours.map((s) => picks[s.nickname])).notes} />
          {enemyCompTips(Object.values(state.theirPicks)).length > 0 && (
            <ul className="space-y-0.5 text-xs text-ink-muted">
              {enemyCompTips(Object.values(state.theirPicks)).map((t) => <li key={t} className="break-keep">· {t}</li>)}
            </ul>
          )}
        </Card>
      )}

      <div className="space-y-2">
        <Button type="button" variant="secondary" className="w-full" onClick={copy}>카톡용 밴픽 복사</Button>
        <p role="status" className="text-sm text-ink-muted">
          {copied === "copied" && "복사했어요. 카톡 채팅창에 붙여넣으세요."}
          {copied === "manual" && "아래 내용을 길게 눌러 복사하세요."}
        </p>
        {copied === "manual" && <textarea aria-label="카톡용 밴픽" readOnly rows={8} value={formatDraftMessage(state, advice, ourSide === "blue" ? "🔵 블루팀" : "🔴 레드팀")}
          onFocus={(e) => e.currentTarget.select()} className="w-full rounded-lg border border-hairline bg-surface-1 p-3 text-sm" />}
      </div>

      <p className="text-[11px] text-ink-tertiary break-keep">
        선수별 판수·승률(적으면 50% 쪽으로 보정), 내전 맞라인 상성, 챔피언 성향(AD/AP·앞라인·이니시)으로 계산한 참고용 추천입니다.
        LLM 을 쓰지 않고 내전 기록만으로 계산합니다.
      </p>
    </div>
  );
}

interface SuggestionItem {
  champion: string;
  key?: string;
  title: string;
  sub: string;
  badge?: string;
  onClick?: () => void;
}

function SuggestionList({ items, onPick, empty, compact = false }: { items: SuggestionItem[]; onPick: (champion: string) => void; empty?: string; compact?: boolean }) {
  if (items.length === 0) return empty ? <p className="text-xs text-ink-subtle">{empty}</p> : null;
  return (
    <ul className={compact ? "flex flex-wrap gap-1.5" : "space-y-1.5"}>
      {items.map((it, i) => (
        <li key={it.key || it.champion} className={compact ? "" : "min-w-0"}>
          <button type="button" onClick={it.onClick || (() => onPick(it.champion))}
            className={`flex w-full min-w-0 items-center gap-2 rounded-lg border bg-surface-1 px-2 py-1.5 text-left cursor-pointer hover:border-hairline-strong ${!compact && i === 0 ? "border-primary/50" : "border-hairline"}`}>
            <ChampionIcon name={it.champion} size={compact ? 20 : 32} />
            <span className="min-w-0 flex-1">
              <span className={`block truncate text-ink ${compact ? "text-xs" : "text-sm font-medium"}`}>
                {it.title}
                {it.badge && <span className="ml-1.5 text-[11px] font-normal text-mvp">{it.badge}</span>}
              </span>
              <span className="block text-[11px] text-ink-subtle break-keep">{it.sub}</span>
            </span>
            {!compact && i === 0 && <span className="shrink-0 text-[11px] text-primary-hover">추천</span>}
          </button>
        </li>
      ))}
    </ul>
  );
}

function CompNotes({ notes }: { notes: { good: boolean; text: string }[] }) {
  if (notes.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {notes.map((n) => (
        <span key={n.text} className={`rounded-full border px-2 py-0.5 text-[11px] break-keep ${n.good ? "border-win/30 text-win" : "border-lose/30 text-lose"}`}>
          {n.good ? "👍" : "⚠️"} {n.text}
        </span>
      ))}
    </div>
  );
}

function EnemyGuess({ plans, onPick }: { plans: ReturnType<typeof adviseDraft>["enemyPlans"]; onPick: (champion: string, nickname: string) => void }) {
  const open = plans.filter((p) => !p.locked && p.candidates.length);
  if (open.length === 0) return null;
  return (
    <div className="space-y-1.5">
      <p className="flex items-center gap-1.5 text-xs text-ink-muted"><Eye size={13} /> 상대가 꺼낼 만한 픽 (눌러서 바로 입력)</p>
      <ul className="space-y-1">
        {open.map((p) => (
          <li key={p.nickname} className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs">
            <span className="w-24 shrink-0 truncate text-ink-subtle">{LANE_LABEL[p.lane]} {p.nickname}</span>
            {p.candidates.map((c) => (
              <button key={c.champion} type="button" onClick={() => onPick(c.champion, p.nickname)}
                className="inline-flex items-center gap-1 rounded-md border border-hairline bg-surface-1 px-1.5 py-0.5 text-ink-muted hover:border-hairline-strong cursor-pointer">
                <ChampionIcon name={c.champion} size={16} />
                {c.champion}
                <span className="text-ink-tertiary">{c.isNew ? "" : `${c.games}판`}</span>
              </button>
            ))}
          </li>
        ))}
      </ul>
    </div>
  );
}
