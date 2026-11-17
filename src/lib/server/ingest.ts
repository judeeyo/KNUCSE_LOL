import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { v4 as uuid } from "uuid";
import { calculateMvpScores } from "@/lib/mvp";
import { normalizeChampionName } from "@/lib/champions";
import { normalizeNickname } from "@/lib/nicknames";
import { assignLanesByOrder } from "@/lib/lanes";
import { GROUP_NAME } from "@/lib/match-normalize";
import { decideIngest, keepExistingNicknames, type ExistingMatch, type IngestDecision } from "@/lib/ingest-plan";
import { naejeonViolation, validateIncoming, type IncomingMatch, type IncomingMember } from "@/lib/import-parse";
import type { PlayerStat } from "@/lib/types";

export interface IngestItemResult {
  status: "inserted" | "updated" | "merged" | "skipped" | "candidate" | "invalid";
  matchId?: string;
  existingId?: string;
  reason?: string;
  date?: string | null;
  gameId?: string | null;
  summary?: string;
}

export interface IngestReport {
  dryRun: boolean;
  total: number;
  inserted: number;
  updated: number;
  /** 수기 기록에 자동으로 합친 경기 수 */
  merged: number;
  skipped: number;
  candidates: number;
  invalid: number;
  membersAdded: number;
  /** 자동으로 부캐 등록한 닉네임 (Riot 닉네임 → 기존 표기) */
  aliasesAdded: Array<{ from: string; to: string }>;
  /** 별도 선수로 이미 있어 자동 통합하지 않은 닉네임 — 선수 정보 탭에서 직접 통합 */
  aliasConflicts: Array<{ from: string; to: string }>;
  items: IngestItemResult[];
}

interface Snapshot {
  existing: ExistingMatch[];
  aliasMap: Map<string, string>;
  memberSet: Set<string>;
  memberAliases: Map<string, string[]>;
}

async function loadSnapshot(sb: SupabaseClient): Promise<Snapshot> {
  const [m, mem] = await Promise.all([
    sb.from("matches").select("id, game_id, created_at, review_status, players").eq("group_name", GROUP_NAME),
    sb.from("members").select("nickname, aliases"),
  ]);
  if (m.error) throw new Error(`matches 조회 실패: ${m.error.message}`);
  if (mem.error) throw new Error(`members 조회 실패: ${mem.error.message}`);
  const aliasMap = new Map<string, string>();
  const memberSet = new Set<string>();
  const memberAliases = new Map<string, string[]>();
  for (const row of mem.data || []) {
    memberSet.add(row.nickname);
    memberAliases.set(row.nickname, [...((row.aliases as string[]) || [])]);
    for (const a of (row.aliases as string[]) || []) aliasMap.set(a, row.nickname);
  }
  return { existing: (m.data || []) as ExistingMatch[], aliasMap, memberSet, memberAliases };
}

/** 저장용 참가자 배열 생성 (닉네임·챔피언 정규화, 부캐→본캐, 라인 배정, MVP 점수) */
function buildPlayers(inc: IncomingMatch, matchId: string, aliasMap: Map<string, string>) {
  const base = inc.players.map((p, i) => {
    const nick = normalizeNickname(p.nickname);
    return {
      ...p,
      id: `p-${i}`,
      matchId,
      // 행 복원은 저장돼 있던 닉네임을 그대로 유지, 새 자료는 부캐를 본캐로 치환
      nickname: inc.restore ? nick : aliasMap.get(nick) || nick,
      champion: normalizeChampionName(p.champion),
      killParticipation: 0,
      mvpScore: 0,
      isMvp: false,
      isAce: false,
    };
  });
  // 점수 계산은 null 을 0 으로 보고 수행하되, 저장할 때는 원래의 null(미수집)을 되돌려 둔다
  const forScore = base.map((p) => ({
    ...p,
    damageDealt: p.damageDealt ?? 0,
    damageTaken: p.damageTaken ?? 0,
    visionScore: p.visionScore ?? 0,
    wardsPlaced: p.wardsPlaced ?? 0,
    wardsDestroyed: p.wardsDestroyed ?? 0,
    objectiveDamage: p.objectiveDamage ?? 0,
    ccScore: p.ccScore ?? 0,
    healingDone: p.healingDone ?? 0,
    shieldingDone: p.shieldingDone ?? 0,
  })) as unknown as PlayerStat[];
  const scored = calculateMvpScores(assignLanesByOrder(forScore));
  return scored.map((s, i) => ({
    ...s,
    damageDealt: base[i].damageDealt,
    damageTaken: base[i].damageTaken,
    visionScore: base[i].visionScore,
    wardsPlaced: base[i].wardsPlaced,
    wardsDestroyed: base[i].wardsDestroyed,
    objectiveDamage: base[i].objectiveDamage,
    ccScore: base[i].ccScore,
    healingDone: base[i].healingDone,
    shieldingDone: base[i].shieldingDone,
  }));
}

function summarize(inc: IncomingMatch): string {
  const side = (t: string) =>
    inc.players
      .filter((p) => p.team === t)
      .map((p) => p.nickname)
      .join(", ");
  return `${side("blue")} vs ${side("red")}`;
}

/**
 * 경기 목록을 DB에 반영한다.
 *  - gameId 가 같으면 갱신(수집기) 또는 건너뜀(복원)
 *  - gameId 가 없는 기록과 겹쳐 보이면 보류(duplicate_candidate) 상태로 넣어 관리 화면에서 검토
 *  - dryRun 이면 아무것도 쓰지 않고 결과만 계산
 */
export async function ingestMatches(
  sb: SupabaseClient,
  incoming: IncomingMatch[],
  opts: { dryRun?: boolean; members?: IncomingMember[] } = {}
): Promise<IngestReport> {
  const dryRun = Boolean(opts.dryRun);
  const snap = await loadSnapshot(sb);
  const report: IngestReport = {
    dryRun, total: incoming.length, inserted: 0, updated: 0, merged: 0, skipped: 0, candidates: 0, invalid: 0, membersAdded: 0,
    aliasesAdded: [], aliasConflicts: [], items: [],
  };
  // 이번 가져오기에서 새로 생긴 부캐 (기존 표기 → 추가할 Riot 닉네임들)
  const aliasAdds = new Map<string, Set<string>>();
  const noteRenames = (renames: Array<{ from: string; to: string }>) => {
    for (const r of renames) {
      if (snap.aliasMap.get(r.from) === r.to) continue; // 이미 부캐로 등록됨
      if (snap.memberSet.has(r.from) || snap.aliasMap.has(r.from)) {
        // 같은 닉네임이 이미 따로 집계되고 있음 → 자동으로 합치지 않고 알려 준다
        if (!report.aliasConflicts.some((c) => c.from === r.from && c.to === r.to)) report.aliasConflicts.push(r);
        continue;
      }
      snap.aliasMap.set(r.from, r.to);
      aliasAdds.set(r.to, (aliasAdds.get(r.to) || new Set()).add(r.from));
      report.aliasesAdded.push(r);
    }
  };

  // 멤버(백업 복원): 없는 닉네임만 추가 — 기존 프로필은 덮어쓰지 않는다
  const newMembers = new Map<string, Record<string, unknown>>();
  for (const m of opts.members || []) {
    if (!snap.memberSet.has(m.nickname) && !newMembers.has(m.nickname)) {
      newMembers.set(m.nickname, {
        nickname: m.nickname,
        real_name: m.real_name ?? null,
        tier: m.tier ?? null,
        preferred_lanes: Array.isArray(m.preferred_lanes) ? m.preferred_lanes : [],
        aliases: Array.isArray(m.aliases) ? m.aliases : [],
      });
    }
  }
  // 복원되는 멤버의 부캐 정보도 이번 가져오기에 바로 반영
  for (const m of newMembers.values()) {
    for (const a of (m.aliases as string[]) || []) snap.aliasMap.set(a, m.nickname as string);
  }

  for (const inc of incoming) {
    const base = { date: inc.createdAt, gameId: inc.gameId, summary: summarize(inc) };
    const invalid = validateIncoming(inc) ?? naejeonViolation(inc);
    if (invalid) {
      report.invalid++;
      report.items.push({ status: "invalid", reason: invalid, ...base });
      continue;
    }
    const decision: IngestDecision = decideIngest(snap.existing, inc);

    if (decision.action === "skip") {
      report.skipped++;
      report.items.push({ status: "skipped", existingId: decision.existingId, reason: decision.reason, ...base });
      continue;
    }

    const target = decision.action === "update" || decision.action === "merge" ? decision.existingId : null;
    const matchId = target || inc.id || uuid();
    let players = buildPlayers(inc, matchId, snap.aliasMap);
    if (target) {
      // 이미 있는 경기에 덮어쓸 때는 닉네임을 기존 기록 그대로 유지한다 (수기 표기·관리자가 고친 이름 보존)
      const existingRow = snap.existing.find((x) => x.id === target);
      if (existingRow) {
        const kept = keepExistingNicknames(existingRow.players, players);
        players = kept.players;
        noteRenames(kept.renames);
      }
    }
    const row: Record<string, unknown> = {
      group_name: GROUP_NAME,
      game_duration: inc.gameDuration,
      game_mode: inc.gameMode || "rift",
      players,
      source: inc.source,
      time_unknown: inc.timeUnknown,
      bans: inc.bans
        ? { blue: inc.bans.blue.map(normalizeChampionName), red: inc.bans.red.map(normalizeChampionName) }
        : null,
    };
    if (inc.gameId) row.game_id = inc.gameId;
    if (inc.createdAt) row.created_at = inc.createdAt;

    if (decision.action === "update" || decision.action === "merge") {
      if (!inc.gameDuration) delete row.game_duration;
      if (!dryRun) {
        // 갱신 시 검토 상태(보류 여부)는 건드리지 않는다
        const { error } = await sb.from("matches").update(row).eq("id", matchId);
        if (error) throw new Error(`경기 갱신 실패: ${error.message}`);
      }
      const e = snap.existing.find((x) => x.id === matchId);
      if (e) {
        e.players = players as unknown as ExistingMatch["players"];
        if (inc.gameId) e.game_id = inc.gameId;
      }
      if (decision.action === "merge") {
        report.merged++;
        report.items.push({ status: "merged", matchId, existingId: matchId, reason: "same-content-no-game-id", ...base });
      } else {
        report.updated++;
        report.items.push({ status: "updated", matchId, ...base });
      }
    } else {
      const candidate = decision.action === "candidate";
      row.id = matchId;
      row.review_status = candidate ? "duplicate_candidate" : inc.reviewStatus;
      row.duplicate_of = candidate ? decision.existingId : inc.duplicateOf;
      // 백업 복원 시 "없던 경기" 표시도 그대로 (컬럼이 없는 DB 를 위해 값이 있을 때만 보냄)
      if (inc.excludedReason) row.excluded_reason = inc.excludedReason;
      if (!dryRun) {
        const { error } = await sb.from("matches").insert(row);
        if (error) throw new Error(`경기 저장 실패: ${error.message}`);
      }
      snap.existing.push({
        id: matchId,
        game_id: inc.gameId,
        created_at: inc.createdAt || new Date().toISOString(),
        review_status: (row.review_status as string) || null,
        players: players as unknown as ExistingMatch["players"],
      });
      if (candidate) {
        report.candidates++;
        report.items.push({ status: "candidate", matchId, existingId: decision.existingId, reason: decision.reason, ...base });
      } else {
        report.inserted++;
        report.items.push({ status: "inserted", matchId, ...base });
      }
    }

    for (const p of players) {
      if (!snap.memberSet.has(p.nickname) && !snap.aliasMap.has(p.nickname) && !newMembers.has(p.nickname)) {
        newMembers.set(p.nickname, { nickname: p.nickname });
      }
    }
  }

  // 자동 부캐 등록: 기존 표기(본캐)의 aliases 에 Riot 닉네임 추가
  if (!dryRun) {
    for (const [main, adds] of aliasAdds) {
      const aliases = [...(snap.memberAliases.get(main) || [])];
      for (const a of adds) if (!aliases.includes(a)) aliases.push(a);
      const { error } = await sb.from("members").upsert({ nickname: main, aliases }, { onConflict: "nickname" });
      if (error) throw new Error(`부캐 등록 실패: ${error.message}`);
      snap.memberSet.add(main);
    }
  }
  // 본캐로 바뀐 닉네임은 새 선수로 등록하지 않는다
  for (const r of report.aliasesAdded) newMembers.delete(r.from);

  if (newMembers.size > 0) {
    report.membersAdded = newMembers.size;
    if (!dryRun) {
      // 열 구성이 다른 행을 한 번에 넣으면 빠진 열이 null 로 채워지므로 닉네임만 있는 행과 분리
      const full = [...newMembers.values()].filter((m) => "aliases" in m);
      const bare = [...newMembers.values()].filter((m) => !("aliases" in m));
      for (const batch of [full, bare]) {
        if (batch.length === 0) continue;
        const { error } = await sb.from("members").upsert(batch, { onConflict: "nickname", ignoreDuplicates: true });
        if (error) throw new Error(`멤버 등록 실패: ${error.message}`);
      }
    }
  }
  return report;
}
