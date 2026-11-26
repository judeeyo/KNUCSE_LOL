import "server-only";
import { createClient } from "@supabase/supabase-js";
import { resolveSupabaseUrl } from "@/lib/supabase";
import { GROUP_NAME, rowToMatch, type MatchRow } from "@/lib/match-normalize";
import type { Match } from "@/lib/types";

// 공유 미리보기(카톡 등)용 서버 조회. 공개 읽기 키만 쓰며, 실패하면 null 을 돌려 기본 미리보기로 대체한다.
function client() {
  const url = resolveSupabaseUrl();
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function readMatch(id: string): Promise<Match | null> {
  const sb = client();
  if (!sb) return null;
  try {
    const { data, error } = await sb.from("matches").select("*").eq("id", id).maybeSingle();
    if (error || !data) return null;
    const match = rowToMatch(data as MatchRow);
    // 점수·MVP·ACE 는 rowToMatch 에서 사이트 화면과 같은 식(score-v2)으로 계산된다
    return match;
  } catch {
    return null;
  }
}

/** 통계에 반영되는 경기 전체 (보류·없던 경기 제외) */
export async function readCountedMatches(): Promise<Match[] | null> {
  const sb = client();
  if (!sb) return null;
  try {
    const { data, error } = await sb
      .from("matches")
      .select("*")
      .eq("group_name", GROUP_NAME)
      .is("review_status", null)
      .order("created_at", { ascending: true });
    if (error || !data) return null;
    return (data as MatchRow[]).map(rowToMatch).filter((m) => !m.excludedReason);
  } catch {
    return null;
  }
}

/** 수집기가 "아는 사람들의 내전인지" 확인할 때 쓰는 명단: 선수 닉네임·부캐·경기에 나온 계정 ID */
export async function readRoster(): Promise<{ names: string[]; puuids: string[] } | null> {
  const sb = client();
  if (!sb) return null;
  try {
    const [m, mem] = await Promise.all([
      sb.from("matches").select("players").eq("group_name", GROUP_NAME),
      sb.from("members").select("nickname, aliases"),
    ]);
    if (m.error || mem.error) return null;
    const names = new Set<string>();
    const puuids = new Set<string>();
    for (const row of mem.data || []) {
      names.add(row.nickname);
      for (const a of (row.aliases as string[]) || []) names.add(a);
    }
    for (const row of m.data || []) {
      for (const p of (row.players as Array<{ nickname?: string; puuid?: string }>) || []) {
        if (p.nickname) names.add(p.nickname);
        if (p.puuid) puuids.add(p.puuid);
      }
    }
    return { names: [...names], puuids: [...puuids] };
  } catch {
    return null;
  }
}

/** 공유 문구용 날짜 (한국 날짜) */
export function koreanDate(iso: string): string {
  const d = new Date(Date.parse(iso) + 9 * 3600 * 1000);
  return `${d.getUTCFullYear()}년 ${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일`;
}
