"use client";

import { useState } from "react";
import { Sparkles, X, RotateCcw } from "lucide-react";
import type { BalancerPlayer } from "@/lib/stats";
import { suggestPairs } from "@/lib/team-analysis";

export type BalancePair = [string, string];

const EMPTY: BalancePair[] = Array.from({ length: 5 }, () => ["", ""]);

/**
 * 밸런스 짝 지정. 선수 칩을 두 번 눌러(첫 번째 → 두 번째) 짝을 만든다.
 * 드롭다운 10개 대신 한 화면에서 남은 선수·만든 짝이 다 보이게 했다.
 * "점수순 자동 짝"은 이미 만든 짝은 두고 남은 선수만 점수 순 이웃끼리 묶는다.
 */
export function BalancePairEditor({ players, pairs, onChange, labels }: {
  players: BalancerPlayer[];
  pairs: BalancePair[];
  onChange: (pairs: BalancePair[]) => void;
  labels: Record<string, string>;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  const done = pairs.filter(([a, b]) => a && b);
  const used = new Set(done.flat());
  const scoreOf = new Map(players.map((p) => [p.nickname, p.score]));
  const unassigned = players
    .filter((p) => !used.has(p.nickname))
    .sort((a, b) => b.score - a.score || a.nickname.localeCompare(b.nickname));

  const commit = (next: BalancePair[]) => onChange([...next, ...EMPTY].slice(0, 5));

  function pick(name: string) {
    if (picked === null) return setPicked(name);
    if (picked === name) return setPicked(null);
    commit([...done, [picked, name]]);
    setPicked(null);
  }

  const pickedLabel = picked ? labels[picked] ?? picked : null;

  return (
    <section className="space-y-3" aria-label="밸런스 짝 지정">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">
          밸런스 짝 <span className="text-primary">{done.length}</span>/5
        </h3>
        <div className="flex gap-1.5">
          <button type="button" disabled={unassigned.length === 0} onClick={() => { commit([...done, ...suggestPairs(unassigned)]); setPicked(null); }}
            className="inline-flex items-center gap-1 rounded-md border border-primary/40 bg-primary/10 px-2.5 py-1.5 text-xs text-primary-hover hover:bg-primary/20 cursor-pointer disabled:opacity-40 disabled:cursor-default">
            <Sparkles size={13} /> {done.length ? "남은 선수 자동 짝" : "점수순 자동 짝"}
          </button>
          {done.length > 0 && (
            <button type="button" onClick={() => { commit([]); setPicked(null); }}
              className="inline-flex items-center gap-1 rounded-md border border-hairline px-2.5 py-1.5 text-xs text-ink-subtle hover:text-ink cursor-pointer">
              <RotateCcw size={12} /> 초기화
            </button>
          )}
        </div>
      </div>

      {unassigned.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-ink-subtle break-keep" aria-live="polite">
            {pickedLabel
              ? <><span className="text-primary-hover font-medium">{pickedLabel}</span> 의 짝을 누르세요 (다시 누르면 취소)</>
              : "실력이 비슷한 두 사람을 차례로 누르면 한 짝이 됩니다. 각 짝은 서로 다른 팀으로 갑니다."}
          </p>
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-5">
            {unassigned.map((p) => {
              const on = picked === p.nickname;
              return (
                <button key={p.nickname} type="button" aria-pressed={on} onClick={() => pick(p.nickname)}
                  className={`flex min-w-0 items-center justify-between gap-1 rounded-md border px-2 py-1.5 text-left text-xs transition-fast cursor-pointer ${
                    on ? "border-primary bg-primary/20 text-ink ring-1 ring-primary" : "border-hairline bg-surface-2 text-ink-muted hover:border-hairline-strong hover:text-ink"
                  }`}>
                  <span className="truncate">{p.nickname}</span>
                  <span className="shrink-0 font-mono text-ink-subtle">{p.score.toFixed(1)}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {done.length > 0 && (
        <ol className="grid gap-1.5 sm:grid-cols-2">
          {done.map(([a, b], i) => {
            const gap = Math.abs((scoreOf.get(a) ?? 0) - (scoreOf.get(b) ?? 0));
            return (
              <li key={`${a}|${b}`} className="flex min-w-0 items-center gap-2 rounded-md border border-hairline bg-surface-2 px-2 py-1.5 text-xs">
                <span className="w-4 shrink-0 text-ink-tertiary">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate text-ink">{a} <span className="text-ink-tertiary">⇄</span> {b}</span>
                <span className={`shrink-0 font-mono ${gap > 1 ? "text-mvp" : "text-ink-subtle"}`} title="두 사람 점수 차이 (1점 넘으면 노란색)">±{gap.toFixed(1)}</span>
                <button type="button" aria-label={`${a}, ${b} 짝 풀기`} onClick={() => commit(done.filter((_, j) => j !== i))}
                  className="shrink-0 rounded p-0.5 text-ink-tertiary hover:bg-surface-3 hover:text-ink cursor-pointer">
                  <X size={13} />
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
