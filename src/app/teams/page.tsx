"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { BalanceTab } from "@/components/group/balance-tab";
import { LoadError } from "@/components/ui/load-error";
import { buildPlayerStats } from "@/lib/stats";
import { getGroup } from "@/lib/store";
import type { Group } from "@/lib/types";

export default function TeamsPage() {
  const [group, setGroup] = useState<Group | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const players = useMemo(() => group ? buildPlayerStats(group) : [], [group]);

  useEffect(() => {
    let active = true;
    getGroup().then((data) => {
      if (active) setGroup(data);
    }).catch((err: unknown) => {
      if (active) setError(err instanceof Error ? err.message : String(err));
    });
    return () => { active = false; };
  }, [attempt]);

  return (
    <main className="mx-auto max-w-4xl space-y-5 px-4 py-6 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold">컴학내전 팀 짜기</h1>
        <Link href="/group/main" className="text-sm text-primary-hover">전체 기록 보기</Link>
      </header>
      {group ? <BalanceTab group={group} playerStats={players} initialMode="paired" /> : error ? (
        <LoadError message={error} onRetry={() => { setError(""); setAttempt((n) => n + 1); }} />
      ) : <p role="status" className="text-sm text-ink-subtle">선수와 경기 기록을 불러오는 중…</p>}
    </main>
  );
}
