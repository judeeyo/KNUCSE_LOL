import { getSupabase } from "./supabase";
import { adminFetch } from "./admin-client";
import { GROUP_NAME, rowToMatch, type MatchRow } from "./match-normalize";
import type { Group, Match, PlayerStat, Member, Lane } from "./types";

/** DB 조회 실패. "기록이 0건"과 구분하기 위해 빈 배열 대신 예외로 알린다. */
export class DataLoadError extends Error {
  constructor(what: string, detail: string) {
    super(`${what} 조회 실패: ${detail}`);
    this.name = "DataLoadError";
  }
}

// ─── 읽기 (anon key, 누구나) ───

export async function getAllMatches(): Promise<Match[]> {
  const { data, error } = await getSupabase()
    .from("matches")
    .select("*")
    .eq("group_name", GROUP_NAME)
    .is("review_status", null) // 중복 후보로 보류된 경기는 통계에서 제외
    .order("created_at", { ascending: true });

  if (error) throw new DataLoadError("경기", error.message);
  if (!data) throw new DataLoadError("경기", "응답이 비어 있습니다");
  return (data as MatchRow[]).map(rowToMatch);
}

export async function getMatch(matchId: string): Promise<Match | null> {
  const { data, error } = await getSupabase()
    .from("matches")
    .select("*")
    .eq("id", matchId)
    .maybeSingle();

  if (error) throw new DataLoadError("경기", error.message);
  return data ? rowToMatch(data as MatchRow) : null;
}

export async function getAllMembers(): Promise<Member[]> {
  const { data, error } = await getSupabase()
    .from("members")
    .select("*")
    .order("created_at", { ascending: true });

  if (error) throw new DataLoadError("선수", error.message);
  if (!data) throw new DataLoadError("선수", "응답이 비어 있습니다");

  return data.map((row) => ({
    id: row.nickname,
    nickname: row.nickname,
    groupId: GROUP_NAME,
    joinedAt: row.created_at,
    tier: row.tier || undefined,
    preferredLanes: (row.preferred_lanes as Lane[]) || undefined,
    realName: row.real_name || undefined,
    aliases: (row.aliases as string[]) || undefined,
  }));
}

export async function getGroup(): Promise<Group> {
  const [matches, members] = await Promise.all([getAllMatches(), getAllMembers()]);
  return { id: GROUP_NAME, name: GROUP_NAME, inviteCode: "", createdAt: "", members, matches };
}

// ─── 쓰기 (관리자 비밀번호 필요 — 서버 /api/admin 경유) ───

export async function addMatch(
  players: PlayerStat[],
  gameDuration: string,
  opts: { playedAt?: string; timeUnknown?: boolean } = {}
): Promise<{ id: string }> {
  return adminFetch<{ id: string }>("addMatch", { players, gameDuration, ...opts });
}

export async function updateMatch(matchId: string, players: PlayerStat[], gameDuration?: string) {
  await adminFetch("updateMatch", { matchId, players, gameDuration });
}

export async function deleteMatch(matchId: string) {
  await adminFetch("deleteMatch", { matchId });
}

export async function updateMemberProfile(
  nickname: string,
  updates: { tier?: string; preferredLanes?: Lane[]; realName?: string; aliases?: string[] }
) {
  await adminFetch("updateMemberProfile", { nickname, updates });
}

export async function mergeAliases(mainNickname: string, aliasNickname: string): Promise<number> {
  const res = await adminFetch<{ renamed: number }>("mergeAliases", { mainNickname, aliasNickname });
  return res.renamed;
}

export async function renameMember(oldNickname: string, newNickname: string) {
  await adminFetch("renameMember", { oldNickname, newNickname });
}

export async function deleteMember(nickname: string) {
  await adminFetch("deleteMember", { nickname });
}
