import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { v4 as uuid } from "uuid";
import { calculateMvpScores } from "@/lib/mvp";
import { GROUP_NAME, type MatchRow } from "@/lib/match-normalize";
import { keepExistingNicknames } from "@/lib/ingest-plan";
import type { Lane, PlayerStat } from "@/lib/types";

/** Supabase 오류를 삼키지 않고 예외로 올린다 (기존 코드는 실패해도 조용히 넘어갔음) */
function must<T>(res: { data: T; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what} 실패: ${res.error.message}`);
  return res.data;
}

async function aliasMapOf(sb: SupabaseClient) {
  const rows = must(await sb.from("members").select("nickname, aliases"), "멤버 조회") || [];
  const aliasMap = new Map<string, string>();
  const names = new Set<string>();
  for (const m of rows) {
    names.add(m.nickname);
    for (const a of (m.aliases as string[]) || []) aliasMap.set(a, m.nickname);
  }
  return { aliasMap, names };
}

/** 수동 입력에서 비워 둔(전원 0) 상세 지표는 0 이 아니라 null(미수집)로 저장 */
function nullifyUncollected(players: PlayerStat[]) {
  const FIELDS = [
    "damageDealt", "damageTaken", "visionScore", "wardsPlaced", "wardsDestroyed",
    "objectiveDamage", "ccScore", "healingDone", "shieldingDone",
  ] as const;
  const empty = FIELDS.filter((f) => players.every((p) => !(Number(p[f]) > 0)));
  return players.map((p) => {
    const out: Record<string, unknown> = { ...p };
    delete out.noDamage;
    delete out.noDamageTaken;
    delete out.noVision;
    for (const f of empty) out[f] = null;
    return out;
  });
}

export async function addMatch(
  sb: SupabaseClient,
  input: { players: PlayerStat[]; gameDuration: string; playedAt?: string; timeUnknown?: boolean }
) {
  if (!Array.isArray(input.players) || input.players.length < 2) throw new Error("참가자가 2명 미만입니다");
  const { aliasMap, names } = await aliasMapOf(sb);
  const id = uuid();
  const normalized = input.players.map((p, i) => ({
    ...p,
    id: `p-${i}`,
    matchId: id,
    nickname: aliasMap.get(p.nickname.trim()) || p.nickname.trim(),
  }));
  const scored = calculateMvpScores(normalized);
  const createdAt = input.playedAt && Number.isFinite(Date.parse(input.playedAt)) ? new Date(input.playedAt).toISOString() : undefined;

  must(
    await sb.from("matches").insert({
      id,
      group_name: GROUP_NAME,
      game_duration: input.gameDuration || "",
      players: nullifyUncollected(scored),
      source: "manual",
      time_unknown: Boolean(input.timeUnknown),
      ...(createdAt ? { created_at: createdAt } : {}),
    }),
    "경기 저장"
  );

  const fresh = [...new Set(scored.map((p) => p.nickname))].filter((n) => n && !names.has(n));
  if (fresh.length > 0) {
    must(
      await sb.from("members").upsert(fresh.map((nickname) => ({ nickname })), { onConflict: "nickname", ignoreDuplicates: true }),
      "멤버 등록"
    );
  }
  return { id };
}

export async function updateMatch(
  sb: SupabaseClient,
  input: { matchId: string; players: PlayerStat[]; gameDuration?: string }
) {
  const scored = calculateMvpScores(input.players);
  const update: Record<string, unknown> = { players: nullifyUncollected(scored) };
  if (input.gameDuration !== undefined) update.game_duration = input.gameDuration;
  must(await sb.from("matches").update(update).eq("id", input.matchId), "경기 수정");
}

export async function deleteMatch(sb: SupabaseClient, matchId: string) {
  must(await sb.from("matches").delete().eq("id", matchId), "경기 삭제");
}

export async function updateMemberProfile(
  sb: SupabaseClient,
  nickname: string,
  updates: { tier?: string; preferredLanes?: Lane[]; realName?: string; aliases?: string[] }
) {
  const data: Record<string, unknown> = {};
  if (updates.tier !== undefined) data.tier = updates.tier || null;
  if (updates.preferredLanes !== undefined) data.preferred_lanes = updates.preferredLanes;
  if (updates.realName !== undefined) data.real_name = updates.realName || null;
  if (updates.aliases !== undefined) data.aliases = updates.aliases;
  if (Object.keys(data).length === 0) return;
  // 경기에는 있지만 members 에 없는 닉네임도 프로필을 저장할 수 있도록 upsert
  must(await sb.from("members").upsert({ nickname, ...data }, { onConflict: "nickname" }), "선수 정보 저장");
}

/** 모든 경기에서 닉네임을 바꾼다. 바뀐 경기 수 반환 */
async function renameInMatches(sb: SupabaseClient, from: string, to: string): Promise<number> {
  const matches = must(await sb.from("matches").select("id, players").eq("group_name", GROUP_NAME), "경기 조회") || [];
  let changed = 0;
  for (const match of matches) {
    const players = match.players as Array<{ nickname: string }>;
    if (!players.some((p) => p.nickname === from)) continue;
    const next = players.map((p) => (p.nickname === from ? { ...p, nickname: to } : p));
    must(await sb.from("matches").update({ players: next }).eq("id", match.id), "경기 닉네임 변경");
    changed++;
  }
  return changed;
}

export async function mergeAliases(sb: SupabaseClient, mainNickname: string, aliasNickname: string): Promise<number> {
  if (!mainNickname || !aliasNickname || mainNickname === aliasNickname) throw new Error("닉네임이 올바르지 않습니다");
  const rows = must(await sb.from("members").select("nickname, aliases").in("nickname", [mainNickname, aliasNickname]), "멤버 조회") || [];
  const main = rows.find((r) => r.nickname === mainNickname);
  const alias = rows.find((r) => r.nickname === aliasNickname);

  // 부캐가 이미 갖고 있던 부캐 목록도 승계
  const aliases = [...(((main?.aliases as string[]) || []))];
  for (const a of [aliasNickname, ...(((alias?.aliases as string[]) || []))]) {
    if (a !== mainNickname && !aliases.includes(a)) aliases.push(a);
  }
  must(await sb.from("members").upsert({ nickname: mainNickname, aliases }, { onConflict: "nickname" }), "부캐 목록 저장");
  const renamed = await renameInMatches(sb, aliasNickname, mainNickname);
  must(await sb.from("members").delete().eq("nickname", aliasNickname), "부캐 멤버 삭제");
  return renamed;
}

export async function renameMember(sb: SupabaseClient, oldNickname: string, newNickname: string) {
  newNickname = newNickname.trim();
  if (!oldNickname || !newNickname || oldNickname === newNickname) throw new Error("닉네임이 올바르지 않습니다");
  await renameInMatches(sb, oldNickname, newNickname);
  const old = must(await sb.from("members").select("*").eq("nickname", oldNickname).maybeSingle(), "멤버 조회");
  must(
    await sb.from("members").upsert(
      {
        nickname: newNickname,
        real_name: old?.real_name ?? null,
        tier: old?.tier ?? null,
        preferred_lanes: old?.preferred_lanes ?? [],
        aliases: old?.aliases ?? [],
      },
      { onConflict: "nickname" }
    ),
    "새 닉네임 저장"
  );
  must(await sb.from("members").delete().eq("nickname", oldNickname), "이전 닉네임 삭제");
}

export async function deleteMember(sb: SupabaseClient, nickname: string) {
  await renameInMatches(sb, nickname, `[삭제] ${nickname}`);
  must(await sb.from("members").delete().eq("nickname", nickname), "멤버 삭제");
}

// ─── 백업 ───

export async function exportAll(sb: SupabaseClient) {
  const matches = must(await sb.from("matches").select("*").order("created_at", { ascending: true }), "경기 내보내기") || [];
  const members = must(await sb.from("members").select("*").order("created_at", { ascending: true }), "멤버 내보내기") || [];
  return {
    format: "naejeon-backup",
    version: 1,
    exportedAt: new Date().toISOString(),
    counts: { matches: matches.length, members: members.length },
    matches,
    members,
  };
}

// ─── 중복 후보 검토 ───

export async function listPending(sb: SupabaseClient) {
  const pending = (must(
    await sb.from("matches").select("*").eq("review_status", "duplicate_candidate").order("created_at", { ascending: true }),
    "보류 경기 조회"
  ) || []) as MatchRow[];
  const ids = [...new Set(pending.map((p) => p.duplicate_of).filter(Boolean))] as string[];
  const targets = ids.length
    ? ((must(await sb.from("matches").select("*").in("id", ids), "원본 경기 조회") || []) as MatchRow[])
    : [];
  return { pending, targets };
}

export async function resolvePending(
  sb: SupabaseClient,
  id: string,
  decision: "merge" | "keep" | "discard"
) {
  const row = must(await sb.from("matches").select("*").eq("id", id).maybeSingle(), "보류 경기 조회") as MatchRow | null;
  if (!row || row.review_status !== "duplicate_candidate") throw new Error("검토 대상 경기를 찾을 수 없습니다");

  if (decision === "keep") {
    must(await sb.from("matches").update({ review_status: null, duplicate_of: null }).eq("id", id), "별개 경기로 등록");
    return;
  }
  if (decision === "discard") {
    must(await sb.from("matches").delete().eq("id", id), "보류 경기 삭제");
    return;
  }
  // merge: 기존 기록(수기 등)의 id 는 유지하고 내용을 새 수집 데이터로 교체
  if (!row.duplicate_of) throw new Error("합칠 대상이 지정돼 있지 않습니다");
  const target = must(await sb.from("matches").select("id, players").eq("id", row.duplicate_of).maybeSingle(), "원본 경기 조회");
  if (!target) throw new Error("합칠 대상 경기가 이미 삭제됐습니다. '별개 경기로 등록'을 선택하세요");
  // 닉네임은 기존 기록 표기를 유지 (챔피언·KDA 가 같은 참가자끼리 짝지음)
  const { players: kept } = keepExistingNicknames(
    (target.players as Array<Record<string, unknown>>) || [],
    row.players as Array<Record<string, unknown>>
  );
  const players = kept.map((p) => ({ ...p, matchId: row.duplicate_of }));
  // game_id 는 유니크이므로 보류 행을 먼저 지운 뒤 대상에 옮긴다
  must(await sb.from("matches").delete().eq("id", id), "보류 경기 삭제");
  const res = await sb
    .from("matches")
    .update({
      players,
      game_id: row.game_id ?? null,
      bans: row.bans ?? null,
      game_duration: row.game_duration,
      game_mode: row.game_mode,
      created_at: row.created_at,
      time_unknown: Boolean(row.time_unknown),
      source: row.source,
    })
    .eq("id", row.duplicate_of);
  if (res.error) {
    // 실패하면 지웠던 보류 행을 되살린다
    await sb.from("matches").insert(row);
    throw new Error(`병합 실패: ${res.error.message}`);
  }
}
