"use client";

import { useMemo, useState } from "react";
import { Swords, X, Ban, Lightbulb, ListOrdered, Eye } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChampionIcon } from "@/components/ui/champion-icon";
import { ALL_CHAMPIONS, resolveChampionInput } from "@/lib/champions";
import { adviseDraft, buildDraftIndex, evaluateComp, formatDraftMessage, LANE_LABEL, type DraftState, type CompOption } from "@/lib/draft";
import type { BalancerPlayer } from "@/lib/stats";
import type { Match } from "@/lib/types";

const DATALIST_ID = "draft-champion-list";
const BAN_SLOTS = 5;
const UNAMBIGUOUS = new Set(ALL_CHAMPIONS.filter((c) => !ALL_CHAMPIONS.some((o) => o !== c && o.startsWith(c))));

/**
 * 밴픽 도우미. 팀 편성 결과(라인 배정 포함)를 받아, 밴·픽을 입력할 때마다 추천을 다시 계산한다.
 */
export function DraftAssistant({ team1, team2, matches }: { team1: BalancerPlayer[]; team2: BalancerPlayer[]; matches: Match[] }) {
  const [side, setSide] = useState<"blue" | "red">("blue");
  const [ourBans, setOurBans] = useState<string[]>(Array(BAN_SLOTS).fill(""));
  const [theirBans, setTheirBans] = useState<string[]>(Array(BAN_SLOTS).fill(""));
  const [picks, setPicks] = useState<Record<string, string>>({}); // 양 팀 닉네임 → 챔피언
  const [optionIdx, setOptionIdx] = useState(0);
  const [copied, setCopied] = useState<"idle" | "copied" | "manual">("idle");
  const index = useMemo(() => buildDraftIndex(matches), [matches]);

  const toSlots = (t: BalancerPlayer[]) => t.filter((p) => p.assignedLane).map((p) => ({ nickname: p.nickname, lane: p.assignedLane! }));
  const blue = toSlots(team1);
  const red = toSlots(team2);
  const ours = side === "blue" ? blue : red;
  const theirs = side === "blue" ? red : blue;
  const pickOf = (slots: typeof ours) => Object.fromEntries(slots.filter((s) => picks[s.nickname]).map((s) => [s.nickname, picks[s.nickname]]));

  const state: DraftState = {
    ours, theirs,
    ourBans: ourBans.filter(Boolean),
    theirBans: theirBans.filter(Boolean),
    ourPicks: pickOf(ours),
    theirPicks: pickOf(theirs),
  };
  const stateKey = JSON.stringify(state);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const advice = useMemo(() => adviseDraft(index, state), [index, stateKey]);
  const option = advice.options[Math.min(optionIdx, advice.options.length - 1)];
  const taken = new Set([...ourBans, ...theirBans, ...Object.values(picks)].filter(Boolean));

  if (blue.length !== 5 || red.length !== 5) return null;

  const touch = () => { setOptionIdx(0); setCopied("idle"); };
  const setBan = (which: "ours" | "theirs", i: number, champ: string) => {
    (which === "ours" ? setOurBans : setTheirBans)((prev) => prev.map((c, k) => (k === i ? champ : c)));
    touch();
  };
  const addOurBan = (champ: string) => {
    const i = ourBans.findIndex((c) => !c);
    if (i >= 0) setBan("ours", i, champ);
  };
  const setPick = (nick: string, champ: string) => {
    setPicks((prev) => ({ ...prev, [nick]: champ }));
    touch();
  };
  const applyOption = (o: CompOption) => {
    setPicks((prev) => ({ ...prev, ...Object.fromEntries(o.picks.map((p) => [p.nickname, p.champion])) }));
    touch();
  };
  const reset = () => {
    setOurBans(Array(BAN_SLOTS).fill(""));
    setTheirBans(Array(BAN_SLOTS).fill(""));
    setPicks({});
    touch();
  };

  async function copy() {
    const text = formatDraftMessage(state, advice, side === "blue" ? "🔵 블루팀" : "🔴 레드팀");
    try {
      await navigator.clipboard.writeText(text);
      setCopied("copied");
    } catch {
      setCopied("manual");
    }
  }

  const ourColor = side === "blue" ? "text-blue-400" : "text-red-400";
  const theirColor = side === "blue" ? "text-red-400" : "text-blue-400";
  const allOurPicked = ours.every((s) => picks[s.nickname]);

  return (
    <Card className="space-y-4">
      <datalist id={DATALIST_ID}>{ALL_CHAMPIONS.map((c) => <option key={c} value={c} />)}</datalist>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
            <Swords size={15} className="text-primary shrink-0" /> 밴픽 도우미
          </h3>
          <p className="text-xs text-ink-subtle break-keep">밴·픽을 입력할 때마다 내전 기록으로 추천을 다시 계산합니다.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-hairline overflow-hidden text-xs" role="group" aria-label="우리 팀 선택">
            {(["blue", "red"] as const).map((s) => (
              <button key={s} type="button" aria-pressed={side === s} onClick={() => { setSide(s); touch(); }}
                className={`px-3 py-1.5 cursor-pointer whitespace-nowrap ${side === s ? (s === "blue" ? "bg-blue-500/15 text-blue-400" : "bg-red-500/15 text-red-400") : "text-ink-subtle hover:text-ink"}`}>
                우리 = {s === "blue" ? "블루" : "레드"}
              </button>
            ))}
          </div>
          <button type="button" onClick={reset} className="text-xs text-ink-subtle hover:text-ink cursor-pointer">초기화</button>
        </div>
      </div>

      {/* 밴 */}
      <div className="space-y-2">
        {([["ours", "우리 밴", ourBans, ourColor], ["theirs", "상대 밴", theirBans, theirColor]] as const).map(([which, label, list, color]) => (
          <div key={which} className="grid grid-cols-[3rem_1fr] items-center gap-1.5">
            <span className={`text-xs font-medium ${color}`}>{label}</span>
            <div className="grid grid-cols-5 gap-1">
              {list.map((c, i) => (
                <ChampionSlot key={i} value={c} label={`${label} ${i + 1}`} taken={taken} compact
                  onChange={(v) => setBan(which, i, v)} />
              ))}
            </div>
          </div>
        ))}
      </div>

      {advice.banSuggestions.length > 0 && ourBans.some((c) => !c) && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 text-xs font-medium text-ink-muted"><Ban size={13} /> 밴 추천 (누르면 우리 밴에 추가)</div>
          <div className="flex flex-wrap gap-1.5">
            {advice.banSuggestions.map((b) => (
              <button key={b.champion} type="button" onClick={() => addOurBan(b.champion)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-hairline bg-surface-1 px-2 py-1 text-xs hover:border-hairline-strong cursor-pointer text-left">
                <ChampionIcon name={b.champion} size={20} />
                <span>
                  <span className="font-medium text-ink">{b.champion}</span>
                  <span className="block text-[11px] text-ink-subtle">{b.target} {LANE_LABEL[b.lane]} · {b.games}판 {b.wins}승{b.share >= 0.4 ? ` · 주력 ${Math.round(b.share * 100)}%` : ""}</span>
                </span>
              </button>
            ))}
          </div>
          {advice.ourExposed.length > 0 && (
            <p className="text-[11px] text-ink-tertiary break-keep">
              상대가 노릴 만한 우리 주력: {advice.ourExposed.slice(0, 3).map((b) => `${b.champion}(${b.target})`).join(", ")} — 밴당하면 아래 다른 후보로
            </p>
          )}
        </div>
      )}

      {/* 픽 */}
      <div className="space-y-1.5">
        <div className="grid grid-cols-[2.5rem_1fr_1fr] gap-x-2 text-[11px] text-ink-tertiary">
          <span />
          <span className={ourColor}>우리 픽</span>
          <span className={theirColor}>상대 픽</span>
        </div>
        {ours.map((o) => {
          const t = theirs.find((x) => x.lane === o.lane)!;
          return (
            <div key={o.lane} className="grid grid-cols-[2.5rem_1fr_1fr] items-start gap-x-2">
              <span className="pt-1.5 text-xs text-ink-muted">{LANE_LABEL[o.lane]}</span>
              <div className="min-w-0 space-y-0.5">
                <div className="truncate text-xs text-ink">{o.nickname}</div>
                <ChampionSlot value={picks[o.nickname] || ""} label={`${o.nickname} 픽`} taken={taken} onChange={(v) => setPick(o.nickname, v)} />
              </div>
              <div className="min-w-0 space-y-0.5">
                <div className="truncate text-xs text-ink-subtle">{t.nickname}</div>
                <ChampionSlot value={picks[t.nickname] || ""} label={`${t.nickname} 픽`} taken={taken} onChange={(v) => setPick(t.nickname, v)} />
              </div>
            </div>
          );
        })}
      </div>

      {/* 추천 조합 */}
      {option && !allOurPicked && (
        <div className="space-y-2" aria-live="polite">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-xs font-medium text-ink-muted"><Lightbulb size={13} /> 추천 조합</div>
            {advice.options.length > 1 && (
              <div className="flex gap-1" role="group" aria-label="추천 조합 선택">
                {advice.options.map((_, i) => (
                  <button key={i} type="button" aria-pressed={optionIdx === i} onClick={() => setOptionIdx(i)}
                    className={`rounded-md border px-2 py-0.5 text-xs cursor-pointer ${optionIdx === i ? "border-primary bg-primary/10 text-ink" : "border-hairline text-ink-subtle hover:text-ink"}`}>
                    {i + 1}안
                  </button>
                ))}
              </div>
            )}
          </div>
          <ul className="space-y-1.5">
            {option.picks.map((p) => (
              <li key={p.nickname} className="flex items-center gap-2 rounded-lg border border-hairline bg-surface-1 px-2 py-1.5">
                <span className="w-9 shrink-0 text-xs text-ink-muted">{LANE_LABEL[p.lane]}</span>
                <ChampionIcon name={p.champion} size={28} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-ink">
                    <span className="font-medium">{p.champion}</span>
                    <span className="ml-1.5 text-xs text-ink-subtle">{p.nickname}</span>
                    {p.candidate.locked && <span className="ml-1.5 text-[11px] text-primary-hover">확정</span>}
                    {p.candidate.isNew && <span className="ml-1.5 text-[11px] text-mvp">새 챔피언</span>}
                  </div>
                  <div className="truncate text-[11px] text-ink-subtle">{p.candidate.reasons.join(" · ")}</div>
                </div>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-1.5">
            {option.comp.notes.map((n) => (
              <span key={n.text} className={`rounded-full border px-2 py-0.5 text-[11px] break-keep ${n.good ? "border-win/30 text-win" : "border-lose/30 text-lose"}`}>
                {n.good ? "👍" : "⚠️"} {n.text}
              </span>
            ))}
          </div>
          <Button type="button" size="sm" variant="secondary" onClick={() => applyOption(option)}>이 조합으로 픽 채우기</Button>
        </div>
      )}
      {allOurPicked && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 text-xs font-medium text-ink-muted"><Lightbulb size={13} /> 우리 조합 점검</div>
          <div className="flex flex-wrap gap-1.5">
            {evaluateComp(ours.map((s) => picks[s.nickname])).notes.map((n) => (
              <span key={n.text} className={`rounded-full border px-2 py-0.5 text-[11px] break-keep ${n.good ? "border-win/30 text-win" : "border-lose/30 text-lose"}`}>
                {n.good ? "👍" : "⚠️"} {n.text}
              </span>
            ))}
          </div>
        </div>
      )}
      {!option && !allOurPicked && (
        <p className="text-xs text-ink-subtle">추천할 후보가 없습니다. 밴·픽이 겹쳤거나 내전 기록이 부족합니다.</p>
      )}

      {advice.pickOrder.length > 0 && !allOurPicked && (
        <div className="space-y-1">
          <div className="flex items-center gap-1.5 text-xs font-medium text-ink-muted"><ListOrdered size={13} /> 픽 순서</div>
          <ul className="space-y-0.5 text-xs text-ink-muted">
            {advice.pickOrder.map((t) => <li key={t} className="break-keep">· {t}</li>)}
          </ul>
        </div>
      )}

      {/* 상대 예상 */}
      {advice.enemyPlans.some((p) => !p.locked && p.candidates.length) && (
        <div className="space-y-1">
          <div className="flex items-center gap-1.5 text-xs font-medium text-ink-muted"><Eye size={13} /> 상대가 꺼낼 만한 픽</div>
          <ul className="space-y-0.5 text-xs text-ink-muted">
            {advice.enemyPlans.filter((p) => !p.locked && p.candidates.length).map((p) => (
              <li key={p.nickname} className="break-keep">
                {LANE_LABEL[p.lane]} {p.nickname}: {p.candidates.map((c) => c.isNew ? c.champion : `${c.champion}(${c.games}판)`).join(", ")}
              </li>
            ))}
          </ul>
        </div>
      )}
      {advice.enemyTips.length > 0 && (
        <ul className="space-y-0.5 rounded-lg border border-hairline bg-surface-1 px-3 py-2 text-xs text-ink-muted">
          {advice.enemyTips.map((t) => <li key={t} className="break-keep">· {t}</li>)}
        </ul>
      )}

      {/* 선수별 후보 */}
      <details className="group">
        <summary className="cursor-pointer text-xs text-ink-subtle hover:text-ink">선수별 후보 전체 보기</summary>
        <div className="mt-2 space-y-2">
          {advice.ourPlans.map((plan) => (
            <div key={plan.nickname} className="space-y-1">
              <div className="text-xs text-ink">{LANE_LABEL[plan.lane]} · {plan.nickname}</div>
              {plan.candidates.length === 0 ? <p className="text-[11px] text-ink-tertiary">후보 없음</p> : (
                <div className="flex flex-wrap gap-1.5">
                  {plan.candidates.slice(0, 6).map((c) => (
                    <button key={c.champion} type="button" disabled={!!plan.locked} onClick={() => setPick(plan.nickname, c.champion)}
                      title={c.reasons.join(" · ")}
                      className="inline-flex items-center gap-1 rounded-md border border-hairline bg-surface-1 px-1.5 py-0.5 text-[11px] text-ink-muted hover:border-hairline-strong cursor-pointer disabled:cursor-default">
                      <ChampionIcon name={c.champion} size={16} />
                      {c.champion}
                      <span className="text-ink-tertiary">{c.isNew ? "새" : `${c.games}판`}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </details>

      <div className="space-y-2">
        <Button type="button" variant="secondary" className="w-full" onClick={copy}>카톡용 밴픽 복사</Button>
        <p role="status" className="text-sm text-ink-muted">
          {copied === "copied" && "복사했어요. 카톡 채팅창에 붙여넣으세요."}
          {copied === "manual" && "아래 내용을 길게 눌러 복사하세요."}
        </p>
        {copied === "manual" && <textarea aria-label="카톡용 밴픽" readOnly rows={8} value={formatDraftMessage(state, advice, side === "blue" ? "🔵 블루팀" : "🔴 레드팀")}
          onFocus={(e) => e.currentTarget.select()} className="w-full rounded-lg border border-hairline bg-surface-1 p-3 text-sm" />}
      </div>

      <p className="text-[11px] text-ink-tertiary break-keep">
        선수별 판수·승률(적으면 50% 쪽으로 보정), 내전 맞라인 상성, 챔피언 성향(AD/AP·앞라인·이니시)으로 계산한 참고용 추천입니다.
      </p>
    </Card>
  );
}

/** 챔피언 한 칸: 비어 있으면 자동완성 입력, 정해지면 아이콘 칩(누르면 지움) */
function ChampionSlot({ value, onChange, label, taken, compact = false }: {
  value: string;
  onChange: (champ: string) => void;
  label: string;
  taken: Set<string>;
  compact?: boolean;
}) {
  const [text, setText] = useState("");
  const [error, setError] = useState("");

  if (value) {
    return (
      <button type="button" onClick={() => onChange("")} aria-label={`${label} ${value} 지우기`} title={`${value} · 눌러서 지우기`}
        className="inline-flex w-full min-w-0 items-center gap-1 rounded-md border border-hairline bg-surface-2 px-1.5 py-1 text-xs text-ink hover:border-hairline-strong cursor-pointer">
        <ChampionIcon name={value} size={compact ? 18 : 20} />
        <span className={`truncate ${compact ? "hidden sm:inline" : ""}`}>{value}</span>
        <X size={11} className="ml-auto shrink-0 text-ink-tertiary" />
      </button>
    );
  }

  const commit = (raw: string, strict: boolean) => {
    const champ = resolveChampionInput(raw);
    if (!champ) {
      if (strict && raw.trim()) setError("모르는 챔피언");
      return;
    }
    if (!strict && !UNAMBIGUOUS.has(champ)) return; // "애니"처럼 다른 이름의 앞부분이면 Enter·포커스 이동 때 확정
    if (taken.has(champ)) {
      setError("이미 밴·픽됨");
      return;
    }
    setText("");
    setError("");
    onChange(champ);
  };

  return (
    <span className="inline-flex w-full min-w-0 flex-col">
      <input
        list={DATALIST_ID}
        value={text}
        placeholder={compact ? "밴" : "챔피언"}
        aria-label={label}
        aria-invalid={!!error}
        onChange={(e) => {
          setText(e.target.value);
          setError("");
          // 한글 조합 중에는 확정하지 않는다 (조합이 끝나면 아래 onCompositionEnd 에서)
          if (!(e.nativeEvent as InputEvent).isComposing) commit(e.target.value, false);
        }}
        onCompositionEnd={(e) => commit(e.currentTarget.value, false)}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit(text, true); } }}
        onBlur={() => commit(text, true)}
        className="w-full min-w-0 rounded-md border border-hairline bg-surface-1 px-1.5 py-1 text-xs text-ink placeholder:text-ink-tertiary"
      />
      {error && <span className="text-[10px] text-lose">{error}</span>}
    </span>
  );
}
