"use client";

import { Button } from "@/components/ui/button";
import type { BalancerPlayer } from "@/lib/stats";

export type BalancePair = [string, string];

export function BalancePairEditor({ players, pairs, onChange, labels }: {
  players: BalancerPlayer[];
  pairs: BalancePair[];
  onChange: (pairs: BalancePair[]) => void;
  labels: Record<string, string>;
}) {
  const used = new Set(pairs.flat().filter(Boolean));
  const unassigned = players.filter((p) => !used.has(p.nickname));
  const complete = pairs.filter(([a, b]) => a && b).length;

  function change(index: number, side: number, name: string) {
    onChange(pairs.map((pair, i) => i === index
      ? pair.map((value, j) => j === side ? name : value) as BalancePair
      : pair));
  }

  return (
    <section className="space-y-3" aria-label="밸런스 짝 지정">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold text-sm">밸런스 짝 지정 · {complete}/5</h3>
        <Button size="sm" variant="secondary" onClick={() => onChange(Array.from({ length: 5 }, () => ["", ""]))}>
          짝 초기화
        </Button>
      </div>
      <p className="text-xs text-ink-subtle break-keep">
        실력이 비슷한 두 사람을 한 짝으로 묶어 주세요. 각 짝은 서로 다른 팀에 들어갑니다.
        같은 포지션으로 고정되지는 않습니다.
      </p>
      {pairs.map((pair, index) => (
        <div key={index} className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 rounded-lg border border-hairline p-2 sm:p-3">
          {([0, 1] as const).map((side) => (
            <select
              key={side}
              aria-label={`밸런스 짝 ${index + 1} ${side === 0 ? "첫 번째" : "두 번째"} 선수`}
              value={pair[side]}
              onChange={(e) => change(index, side, e.target.value)}
              className={`min-w-0 w-full rounded-lg border border-hairline bg-surface-1 px-2 py-3 text-sm text-ink ${side === 1 ? "col-start-3 row-start-1" : ""}`}
            >
              <option value="">선수 선택</option>
              {players.filter((p) => p.nickname === pair[side] || !used.has(p.nickname)).map((p) => (
                <option key={p.nickname} value={p.nickname}>{labels[p.nickname]} · {p.score.toFixed(1)}점</option>
              ))}
            </select>
          ))}
          <span className="col-start-2 row-start-1 text-xs text-ink-subtle" aria-hidden="true">↔</span>
        </div>
      ))}
      <p className="text-xs text-ink-subtle break-words" aria-live="polite">
        {unassigned.length ? `짝 미지정 ${unassigned.length}명 · ${unassigned.map((p) => labels[p.nickname]).join(", ")}` : "10명 모두 짝을 지정했습니다."}
      </p>
      {unassigned.length === 2 && (
        <Button size="sm" variant="secondary" onClick={() => {
          const remaining = unassigned.map((p) => p.nickname);
          onChange(pairs.map((pair) => pair.map((name) => name || remaining.shift() || "") as BalancePair));
        }}>남은 두 명으로 완성</Button>
      )}
    </section>
  );
}
