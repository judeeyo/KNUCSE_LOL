import type { Match, MatchSource, MissingStats, PlayerStat } from "./types";
import { calculateMvpScores } from "./mvp";
import { matchMinutes } from "./game-score";
import { normalizeChampionName } from "./champions";
import { normalizeNickname } from "./nicknames";
import { assignLanesByOrder } from "./lanes";

export const GROUP_NAME = "컴학내전";

/** matches 테이블의 한 행 (DB 컬럼 이름 그대로) */
export interface MatchRow {
  id: string;
  group_name?: string;
  created_at: string;
  game_duration?: string | null;
  game_mode?: string | null;
  game_id?: string | null;
  bans?: { blue?: string[]; red?: string[]; objectives?: Match["objectives"] } | null;
  players: unknown;
  source?: string | null;
  time_unknown?: boolean | null;
  review_status?: string | null;
  duplicate_of?: string | null;
  uploaded_at?: string | null;
  excluded_reason?: string | null;
}

const NUMERIC_FIELDS = [
  "kills", "deaths", "assists", "cs", "gold",
  "damageDealt", "damageTaken", "visionScore", "wardsPlaced", "wardsDestroyed",
  "objectiveDamage", "ccScore", "healingDone", "shieldingDone",
] as const;

/**
 * 경기 단위 "미수집" 판정: 참가자 전원의 값이 비어 있거나(null) 0이면 그 지표는 수집되지 않은 것.
 * (실제 경기에서 10명 전원의 딜량·시야점수가 0일 수는 없다.)
 */
export function detectMissing(players: Array<Record<string, unknown>>): MissingStats {
  const allEmpty = (field: string) =>
    players.length > 0 && players.every((p) => !(Number(p[field]) > 0));
  return {
    damage: allEmpty("damageDealt"),
    damageTaken: allEmpty("damageTaken"),
    vision: allEmpty("visionScore"),
  };
}

/** DB에 저장된 참가자 배열 → 화면/통계용 PlayerStat (null→0, 미수집 플래그, 이름 정규화, MVP 재계산) */
export function normalizePlayers(raw: unknown, gameDuration?: string | null): { players: PlayerStat[]; missing: MissingStats } {
  const list = (Array.isArray(raw) ? raw : []) as Array<Record<string, unknown>>;
  const missing = detectMissing(list);
  const cleaned = list.map((p, i) => {
    const out: Record<string, unknown> = { ...p };
    for (const f of NUMERIC_FIELDS) out[f] = Number(p[f]) || 0;
    out.id = String(p.id ?? `p-${i}`);
    out.nickname = normalizeNickname(String(p.nickname ?? ""));
    out.champion = normalizeChampionName(String(p.champion ?? ""));
    out.team = p.team === "red" ? "red" : "blue";
    out.win = Boolean(p.win);
    out.noDamage = missing.damage;
    out.noDamageTaken = missing.damageTaken;
    out.noVision = missing.vision;
    return out as unknown as PlayerStat;
  });
  // MVP 점수는 산정식이 바뀌어도 과거 경기에 동일하게 적용되도록 읽을 때마다 재계산
  return { players: calculateMvpScores(assignLanesByOrder(cleaned), matchMinutes({ gameDuration: gameDuration || "" }), missing), missing };
}

export function normalizeBans(bans: MatchRow["bans"]): Match["bans"] | undefined {
  if (!bans || !((bans.blue || []).length || (bans.red || []).length)) return undefined;
  return {
    blue: (bans.blue || []).map(normalizeChampionName),
    red: (bans.red || []).map(normalizeChampionName),
  };
}

export function rowToMatch(row: MatchRow): Match {
  const { players, missing } = normalizePlayers(row.players, row.game_duration);
  return {
    id: row.id,
    groupId: GROUP_NAME,
    createdAt: row.created_at,
    gameDuration: row.game_duration || "",
    players,
    bans: normalizeBans(row.bans),
    objectives: row.bans?.objectives?.blue && row.bans.objectives.red ? row.bans.objectives : undefined,
    source: (row.source as MatchSource) || undefined,
    gameId: row.game_id || undefined,
    timeUnknown: Boolean(row.time_unknown),
    missing,
    excludedReason: row.excluded_reason?.trim() || undefined,
    uploadedAt: row.uploaded_at || undefined,
  };
}

// ─── 중복 판정용 지문 ───

/** 한국 날짜(YYYY-MM-DD) */
export function kstDate(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  return new Date(t + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

type FpPlayer = { team?: unknown; champion?: unknown; kills?: unknown; deaths?: unknown; assists?: unknown };

/**
 * 경기 지문: 팀별 (챔피언, K/D/A) 목록. 블루/레드가 뒤바뀌어 기록돼도 같게 나오도록 팀 순서는 무시.
 * 10명의 챔피언과 KDA가 전부 같은 서로 다른 경기는 사실상 없으므로 gameId 없는 기록의 동일성 판정에 쓴다.
 */
export function matchFingerprint(players: FpPlayer[]): string {
  const side = (team: string) =>
    players
      .filter((p) => (p.team === "red" ? "red" : "blue") === team)
      .map((p) => `${normalizeChampionName(String(p.champion ?? ""))}:${Number(p.kills) || 0}/${Number(p.deaths) || 0}/${Number(p.assists) || 0}`)
      .sort()
      .join(",");
  return [side("blue"), side("red")].sort().join(" | ");
}

/** 두 경기에서 겹치는 챔피언 수 (0~10) */
export function championOverlap(a: FpPlayer[], b: FpPlayer[]): number {
  const count = new Map<string, number>();
  for (const p of a) {
    const c = normalizeChampionName(String(p.champion ?? ""));
    if (c) count.set(c, (count.get(c) || 0) + 1);
  }
  let n = 0;
  for (const p of b) {
    const c = normalizeChampionName(String(p.champion ?? ""));
    const left = count.get(c) || 0;
    if (c && left > 0) {
      n++;
      count.set(c, left - 1);
    }
  }
  return n;
}

export function dayDistance(isoA: string, isoB: string): number {
  const a = Date.parse(kstDate(isoA));
  const b = Date.parse(kstDate(isoB));
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Infinity;
  return Math.abs(a - b) / 86400000;
}
