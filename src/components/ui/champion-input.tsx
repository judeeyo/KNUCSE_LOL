"use client";

import { useId, useState } from "react";
import { ALL_CHAMPIONS, resolveChampionInput } from "@/lib/champions";
import { cn } from "@/lib/cn";

// 다른 챔피언 이름의 앞부분이 아닌 이름 ("애니"는 "애니비아"의 앞부분이라 제외) — 입력만으로 바로 확정해도 되는 것
const UNAMBIGUOUS = new Set(ALL_CHAMPIONS.filter((c) => !ALL_CHAMPIONS.some((o) => o !== c && o.startsWith(c))));

/**
 * 챔피언 이름 입력 (자동완성). 정확한 이름이 되면 바로, 애매하면 Enter 때 확정한다.
 * 띄어쓰기 없이(`리신`)·영문(`leesin`)도 받는다. `taken` 에 든 챔피언은 거절.
 */
export function ChampionInput({ onSubmit, label, taken, placeholder = "챔피언 이름", className, autoFocus }: {
  onSubmit: (champion: string) => void;
  label: string;
  taken: Set<string>;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
}) {
  const listId = useId();
  const [text, setText] = useState("");
  const [error, setError] = useState("");

  const commit = (raw: string, strict: boolean) => {
    const champ = resolveChampionInput(raw);
    if (!champ) {
      if (strict && raw.trim()) setError("모르는 챔피언이에요");
      return;
    }
    if (!strict && !UNAMBIGUOUS.has(champ)) return;
    if (taken.has(champ)) {
      setError(`${champ}은(는) 이미 밴·픽됐어요`);
      return;
    }
    setText("");
    setError("");
    onSubmit(champ);
  };

  return (
    <div className={cn("min-w-0", className)}>
      <datalist id={listId}>{ALL_CHAMPIONS.map((c) => <option key={c} value={c} />)}</datalist>
      <input
        list={listId}
        value={text}
        placeholder={placeholder}
        aria-label={label}
        aria-invalid={!!error}
        autoFocus={autoFocus}
        onChange={(e) => {
          setText(e.target.value);
          setError("");
          // 한글 조합 중에는 확정하지 않는다 (조합이 끝나면 onCompositionEnd 에서)
          if (!(e.nativeEvent as InputEvent).isComposing) commit(e.target.value, false);
        }}
        onCompositionEnd={(e) => commit(e.currentTarget.value, false)}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit(text, true); } }}
        className="w-full min-w-0 rounded-lg border border-hairline bg-surface-1 px-3 py-2 text-sm text-ink placeholder:text-ink-tertiary"
      />
      {error && <p role="alert" className="mt-1 text-xs text-lose">{error}</p>}
    </div>
  );
}
