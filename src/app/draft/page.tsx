"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { DraftAgent } from "@/components/draft/draft-agent";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { LoadError } from "@/components/ui/load-error";
import { draftHref, LANE_LABEL, parseDraftQuery, type DraftSlot } from "@/lib/draft";
import { getGroup } from "@/lib/store";
import type { Group, Lane } from "@/lib/types";

const LANES: Lane[] = ["top", "jungle", "mid", "adc", "support"];

export default function DraftPage() {
  const [group, setGroup] = useState<Group | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [teams, setTeams] = useState<{ blue: DraftSlot[]; red: DraftSlot[] } | null>(null);
  const [search, setSearch] = useState<string | null>(null);

  useEffect(() => {
    // 주소의 팀 명단은 마운트 뒤에 읽는다 (정적 페이지라 서버에서는 알 수 없음)
    const s = window.location.search;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSearch(s);
    setTeams(parseDraftQuery(s));
  }, []);

  useEffect(() => {
    let active = true;
    getGroup().then((data) => {
      if (active) setGroup(data);
    }).catch((err: unknown) => {
      if (active) setError(err instanceof Error ? err.message : String(err));
    });
    return () => { active = false; };
  }, [attempt]);

  const start = (blue: DraftSlot[], red: DraftSlot[]) => {
    const href = draftHref(blue, red);
    window.history.replaceState(window.history.state, "", href);
    setSearch(href.slice("/draft".length));
    setTeams({ blue, red });
  };

  return (
    <div className="mx-auto max-w-3xl space-y-5 px-4 py-6 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold">컴학내전 밴픽 에이전트</h1>
        <div className="flex gap-3 text-sm">
          {teams && <button type="button" className="text-ink-subtle hover:text-ink cursor-pointer" onClick={() => { window.history.replaceState(window.history.state, "", "/draft"); setTeams(null); }}>팀 바꾸기</button>}
          <Link href="/teams" className="text-primary-hover">팀 짜기</Link>
        </div>
      </header>
      {error ? (
        <LoadError message={error} onRetry={() => { setError(""); setAttempt((n) => n + 1); }} />
      ) : !group || search === null ? (
        <p role="status" className="text-sm text-ink-subtle">선수와 경기 기록을 불러오는 중…</p>
      ) : teams ? (
        <DraftAgent key={search} blue={teams.blue} red={teams.red} matches={group.matches} storageKey={`naejeon-draft:${search}`} />
      ) : (
        <TeamSetup group={group} onStart={start} />
      )}
    </div>
  );
}

/** 주소에 팀이 없을 때: 10명을 라인별로 직접 고른다 */
function TeamSetup({ group, onStart }: { group: Group; onStart: (blue: DraftSlot[], red: DraftSlot[]) => void }) {
  const names = useMemo(() => {
    const set = new Set<string>(group.members.map((m) => m.nickname));
    for (const m of group.matches) for (const p of m.players) set.add(p.nickname);
    return [...set].sort((a, b) => a.localeCompare(b, "ko"));
  }, [group]);
  const [picked, setPicked] = useState<Record<string, string>>({});
  const key = (side: "blue" | "red", lane: Lane) => `${side}-${lane}`;
  const chosen = Object.values(picked).filter(Boolean);
  const complete = chosen.length === 10 && new Set(chosen).size === 10;

  return (
    <Card className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-ink">팀 입력</h2>
        <p className="text-xs text-ink-subtle break-keep">
          <Link href="/teams" className="text-primary-hover">팀 짜기</Link>에서 편성하면 <b>밴픽 에이전트 열기</b>로 바로 넘어옵니다. 다른 방법으로 팀을 정했다면 여기서 라인별로 고르세요.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {(["blue", "red"] as const).map((side) => (
          <div key={side} className="min-w-0 space-y-1.5">
            <div className={`text-xs font-bold ${side === "blue" ? "text-blue-400" : "text-red-400"}`}>{side === "blue" ? "블루" : "레드"}</div>
            {LANES.map((lane) => (
              <label key={lane} className="flex min-w-0 items-center gap-1.5 text-xs">
                <span className="w-7 shrink-0 text-ink-muted">{LANE_LABEL[lane]}</span>
                <select value={picked[key(side, lane)] || ""} aria-label={`${side === "blue" ? "블루" : "레드"} ${LANE_LABEL[lane]}`}
                  onChange={(e) => setPicked((p) => ({ ...p, [key(side, lane)]: e.target.value }))}
                  className="min-w-0 flex-1 rounded-lg border border-hairline bg-surface-1 px-2 py-1.5 text-sm text-ink">
                  <option value="">선수 선택</option>
                  {names.map((n) => (
                    <option key={n} value={n} disabled={chosen.includes(n) && picked[key(side, lane)] !== n}>{n}</option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        ))}
      </div>
      <Button type="button" className="w-full" disabled={!complete}
        onClick={() => onStart(
          LANES.map((lane) => ({ nickname: picked[key("blue", lane)], lane })),
          LANES.map((lane) => ({ nickname: picked[key("red", lane)], lane })),
        )}>
        밴픽 시작
      </Button>
    </Card>
  );
}
