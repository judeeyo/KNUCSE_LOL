// 여러 형태의 경기 자료를 하나의 형식(IncomingMatch)으로 읽어 들인다. (순수 함수 — 서버·테스트 공용)
//
// 지원 형식
//  1. 수집기 경기 파일      match_backup_*.json / backups/*.json   {gameId, gameCreation, gameDuration, players:[...]}
//  2. 수집기 과거 전적 추출  history_export_*.json                  {format:"naejeon-history-export", matches:[...]}
//  3. 이 사이트의 백업      naejeon-backup-*.json                  {format:"naejeon-backup", matches:[행...], members:[행...]}
//  4. DB 내보내기           Supabase Table Editor 의 CSV / SQL 결과 JSON (matches 테이블 행 배열)
//  5. naejeon.lol 수기 기록  [{team1_data, team2_data, played_at, duration}]
//  6. 업로드 요청 본문       {match:{...}}
import type { MatchSource } from "./types";

export interface IncomingPlayer {
  nickname: string;
  champion: string;
  lane?: string;
  team: "blue" | "red";
  win: boolean;
  kills: number;
  deaths: number;
  assists: number;
  cs: number;
  gold: number;
  // 상세 지표: 자료에 없으면 null (미수집)
  damageDealt: number | null;
  damageTaken: number | null;
  visionScore: number | null;
  wardsPlaced: number | null;
  wardsDestroyed: number | null;
  objectiveDamage: number | null;
  ccScore: number | null;
  healingDone: number | null;
  shieldingDone: number | null;
  turretDamage?: number | null;
  firstBlood?: boolean;
  largestMultiKill?: number | null;
  level?: number;
  /** Riot 계정 고유 ID — 닉네임이 바뀌어도 같은 사람으로 잇는 데 쓴다 */
  puuid?: string;
  tagLine?: string;
  /** 업로드 시점의 솔랭 티어 (예: "다이아 2"). 기록만 하고 팀 밸런스에는 자동으로 쓰지 않음 */
  soloTier?: string;
  items?: number[];
  spell1Id?: number;
  spell2Id?: number;
  perkKeystone?: number;
  perkPrimaryStyle?: number;
  perkSubStyle?: number;
}

export interface IncomingMatch {
  /** 백업·DB 내보내기에서 온 행이면 원래 id 를 유지 (재실행해도 중복되지 않도록) */
  id?: string;
  /** true 면 "행 복원": 이미 있는 경기는 덮어쓰지 않고 건너뜀 */
  restore: boolean;
  gameId: string | null;
  createdAt: string | null;
  timeUnknown: boolean;
  gameDuration: string;
  gameMode: string;
  bans: { blue: string[]; red: string[] } | null;
  objectives?: { blue: TeamObjectivesIn; red: TeamObjectivesIn } | null;
  source: MatchSource;
  reviewStatus: "duplicate_candidate" | null;
  duplicateOf: string | null;
  excludedReason?: string | null;
  players: IncomingPlayer[];
}

export interface TeamObjectivesIn {
  towers: number;
  inhibitors: number;
  dragons: number;
  barons: number;
  heralds: number;
}

/** 팀 오브젝트 — 수집기는 match.objectives, DB 행·백업은 bans.objectives 에 들어 있다 */
function parseObjectives(v: unknown): IncomingMatch["objectives"] {
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return null;
    }
  }
  if (!isObj(v) || !isObj(v.blue) || !isObj(v.red)) return null;
  const side = (o: Obj): TeamObjectivesIn => ({
    towers: num(o.towers), inhibitors: num(o.inhibitors), dragons: num(o.dragons), barons: num(o.barons), heralds: num(o.heralds),
  });
  return { blue: side(v.blue), red: side(v.red) };
}

export interface IncomingMember {
  nickname: string;
  real_name?: string | null;
  tier?: string | null;
  preferred_lanes?: unknown;
  aliases?: unknown;
  created_at?: string;
}

export interface ParseResult {
  matches: IncomingMatch[];
  members: IncomingMember[];
  errors: string[];
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const numOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const LANES = new Set(["top", "jungle", "mid", "adc", "support"]);
const SOURCES = new Set(["collector", "history", "manual", "legacy-import", "backup-import"]);

function toIso(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  // epoch ms (수집기 gameCreation)
  if (typeof v === "number" || /^\d{11,}$/.test(String(v))) {
    const ms = Number(v);
    return ms > 946684800000 ? new Date(ms).toISOString() : null; // 2000-01-01 이후만 신뢰
  }
  const t = Date.parse(String(v));
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

function parsePlayer(p: Obj, index: number, total: number): IncomingPlayer {
  const team: "blue" | "red" =
    p.team === "red" ? "red" : p.team === "blue" ? "blue" : index < total / 2 ? "blue" : "red";
  const out: IncomingPlayer = {
    nickname: String(p.nickname ?? p.name ?? "").trim() || `Player${index + 1}`,
    champion: String(p.champion ?? "").trim(),
    team,
    win: p.win === true || p.win === "true" || p.win === 1,
    kills: num(p.kills),
    deaths: num(p.deaths),
    assists: num(p.assists),
    cs: num(p.cs),
    gold: num(p.gold),
    damageDealt: numOrNull(p.damageDealt),
    damageTaken: numOrNull(p.damageTaken),
    visionScore: numOrNull(p.visionScore),
    wardsPlaced: numOrNull(p.wardsPlaced),
    wardsDestroyed: numOrNull(p.wardsDestroyed),
    objectiveDamage: numOrNull(p.objectiveDamage),
    ccScore: numOrNull(p.ccScore),
    healingDone: numOrNull(p.healingDone),
    shieldingDone: numOrNull(p.shieldingDone),
  };
  if (typeof p.lane === "string" && LANES.has(p.lane)) out.lane = p.lane;
  if (p.turretDamage !== undefined) out.turretDamage = numOrNull(p.turretDamage);
  if (p.firstBlood !== undefined) out.firstBlood = Boolean(p.firstBlood);
  if (p.largestMultiKill !== undefined) out.largestMultiKill = numOrNull(p.largestMultiKill);
  if (p.level !== undefined) out.level = num(p.level);
  for (const k of ["puuid", "tagLine", "soloTier"] as const) {
    if (typeof p[k] === "string" && (p[k] as string).trim()) out[k] = (p[k] as string).trim().slice(0, 100);
  }
  if (Array.isArray(p.items)) {
    const items = p.items.slice(0, 7).map((x) => Math.max(0, Math.trunc(Number(x) || 0)));
    if (items.some((x) => x > 0)) out.items = items;
  }
  for (const k of ["spell1Id", "spell2Id", "perkKeystone", "perkPrimaryStyle", "perkSubStyle"] as const) {
    const n = Number(p[k]);
    if (Number.isFinite(n) && n > 0) out[k] = Math.trunc(n);
  }
  return out;
}

function parseBans(b: unknown): IncomingMatch["bans"] {
  if (typeof b === "string") {
    try {
      b = JSON.parse(b);
    } catch {
      return null;
    }
  }
  if (!isObj(b)) return null;
  const arr = (v: unknown) => (Array.isArray(v) ? v.map(String).filter(Boolean) : []);
  const bans = { blue: arr(b.blue), red: arr(b.red) };
  return bans.blue.length || bans.red.length ? bans : null;
}

/** naejeon.lol 수기 기록 한 건 */
function parseLegacy(m: Obj): IncomingMatch {
  const t1 = m.team1_data as Obj;
  const t2 = m.team2_data as Obj;
  const team1Win = t1.result === "승리";
  const mk = (p: Obj, i: number, team: "blue" | "red", win: boolean) =>
    parsePlayer({ ...p, nickname: p.name, team, win }, i, 10);
  const players = [
    ...((t1.players as Obj[]) || []).map((p, i) => mk(p, i, "blue", team1Win)),
    ...((t2.players as Obj[]) || []).map((p, i) => mk(p, i, "red", !team1Win)),
  ];
  const day = String(m.played_at ?? m.created_at ?? "").slice(0, 10);
  return {
    id: m.id ? String(m.id) : undefined,
    restore: true,
    gameId: null,
    createdAt: /^\d{4}-\d{2}-\d{2}$/.test(day) ? new Date(`${day}T12:00:00+09:00`).toISOString() : toIso(m.created_at),
    timeUnknown: true,
    gameDuration: String(m.duration ?? ""),
    gameMode: String(m.game_mode ?? "rift"),
    bans: null,
    source: "legacy-import",
    reviewStatus: null,
    duplicateOf: null,
    players,
  };
}

/** matches 테이블 행 (백업 / DB 내보내기) */
function parseRow(r: Obj, errors: string[]): IncomingMatch | null {
  let players = r.players;
  if (typeof players === "string") {
    try {
      players = JSON.parse(players);
    } catch {
      errors.push(`players 열을 JSON 으로 읽을 수 없습니다 (id=${String(r.id)})`);
      return null;
    }
  }
  if (!Array.isArray(players)) return null;
  const source = SOURCES.has(String(r.source)) ? (String(r.source) as MatchSource) : "backup-import";
  return {
    id: r.id ? String(r.id) : undefined,
    restore: true,
    gameId: r.game_id != null && r.game_id !== "" ? String(r.game_id) : null,
    createdAt: toIso(r.created_at),
    timeUnknown: r.time_unknown === true || r.time_unknown === "true" || r.time_unknown === "t",
    gameDuration: String(r.game_duration ?? ""),
    gameMode: String(r.game_mode ?? "rift"),
    bans: parseBans(r.bans),
    objectives: parseObjectives(isObj(r.bans) ? (r.bans as Obj).objectives : typeof r.bans === "string" ? (() => { try { return JSON.parse(r.bans as string).objectives; } catch { return null; } })() : null),
    source,
    reviewStatus: r.review_status === "duplicate_candidate" ? "duplicate_candidate" : null,
    duplicateOf: r.duplicate_of ? String(r.duplicate_of) : null,
    excludedReason: r.excluded_reason ? String(r.excluded_reason) : null,
    players: (players as Obj[]).map((p, i, a) => parsePlayer(p, i, a.length)),
  };
}

/** 수집기 형식 한 건 */
function parseCollector(m: Obj, source: MatchSource): IncomingMatch | null {
  if (!Array.isArray(m.players)) return null;
  return {
    restore: false,
    gameId: m.gameId != null && m.gameId !== "" ? String(m.gameId) : null,
    createdAt: toIso(m.gameCreation ?? m.createdAt),
    timeUnknown: false,
    gameDuration: String(m.gameDuration ?? ""),
    gameMode: String(m.gameMode ?? "rift"),
    bans: parseBans(m.bans),
    objectives: parseObjectives(m.objectives),
    source,
    reviewStatus: null,
    duplicateOf: null,
    players: (m.players as Obj[]).map((p, i, a) => parsePlayer(p, i, a.length)),
  };
}

function parseOne(item: unknown, out: ParseResult, defaultSource: MatchSource) {
  if (!isObj(item)) {
    out.errors.push("경기 항목이 객체가 아닙니다");
    return;
  }
  let m: IncomingMatch | null = null;
  if (isObj(item.team1_data) && isObj(item.team2_data)) m = parseLegacy(item);
  else if ("game_duration" in item || "group_name" in item || "created_at" in item) m = parseRow(item, out.errors);
  else if (Array.isArray(item.players)) m = parseCollector(item, defaultSource);
  if (!m) {
    out.errors.push("알 수 없는 경기 형식입니다 (players 가 없음)");
    return;
  }
  out.matches.push(m);
}

/** JSON 으로 읽은 임의의 자료 → 경기·멤버 목록 */
export function parseImportPayload(payload: unknown, defaultSource: MatchSource = "backup-import"): ParseResult {
  const out: ParseResult = { matches: [], members: [], errors: [] };
  const walk = (v: unknown, src: MatchSource) => {
    if (Array.isArray(v)) {
      for (const item of v) parseOne(item, out, src);
    } else if (isObj(v)) {
      if (Array.isArray(v.matches)) {
        const src2: MatchSource = v.format === "naejeon-history-export" ? "history" : src;
        walk(v.matches, src2);
        if (Array.isArray(v.members)) {
          for (const mem of v.members) {
            if (isObj(mem) && typeof mem.nickname === "string" && mem.nickname) {
              out.members.push(mem as unknown as IncomingMember);
            }
          }
        }
      } else if (isObj(v.match)) {
        parseOne(v.match, out, src);
      } else {
        parseOne(v, out, src);
      }
    } else {
      out.errors.push("JSON 최상위가 객체나 배열이 아닙니다");
    }
  };
  walk(payload, defaultSource);
  return out;
}

/** 파일 내용(문자열) → 자료. JSON 이 아니면 CSV(Supabase Table Editor 내보내기)로 시도 */
export function parseImportText(text: string, fileName = "", fallbackCreatedAt?: string): ParseResult {
  const res = parseImportTextInner(text, fileName);
  // 경기 시각이 없는 자료(예전 match_backup 파일)는 파일 수정 시각을 경기 시각으로 추정
  if (fallbackCreatedAt) {
    for (const m of res.matches) if (!m.createdAt) m.createdAt = fallbackCreatedAt;
  }
  return res;
}

function parseImportTextInner(text: string, fileName: string): ParseResult {
  const trimmed = text.replace(/^﻿/, "").trim();
  if (!trimmed) return { matches: [], members: [], errors: [`${fileName || "파일"}: 내용이 비어 있습니다`] };
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      // 수집기가 남긴 낱개 파일은 collector, 묶음 형식은 각자 지정된 source 를 따른다
      return parseImportPayload(JSON.parse(trimmed), "collector");
    } catch (e) {
      return { matches: [], members: [], errors: [`${fileName || "파일"}: JSON 파싱 실패 (${e instanceof Error ? e.message : e})`] };
    }
  }
  const rows = parseCsv(trimmed);
  if (rows.length < 2) return { matches: [], members: [], errors: [`${fileName || "파일"}: JSON 도 CSV 도 아닙니다`] };
  const header = rows[0].map((h) => h.trim());
  const objs = rows.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] === "" ? null : r[i]])));
  if (header.includes("players")) return parseImportPayload(objs);
  if (header.includes("nickname")) {
    const members = objs
      .filter((o) => o.nickname)
      .map((o) => {
        const j = (v: unknown) => {
          try {
            return typeof v === "string" ? JSON.parse(v) : v;
          } catch {
            return [];
          }
        };
        return { ...o, preferred_lanes: j(o.preferred_lanes), aliases: j(o.aliases) } as unknown as IncomingMember;
      });
    return { matches: [], members, errors: [] };
  }
  return { matches: [], members: [], errors: [`${fileName || "파일"}: CSV 에 players 또는 nickname 열이 없습니다`] };
}

/** RFC 4180 CSV (따옴표·줄바꿈 포함 필드 지원) */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f !== ""));
}

/**
 * 수집기(실시간·과거 전적)에서 온 경기가 "내전"인지: 5대5 로 10명이 참가한 경기만 인정한다.
 * 혼자 한 사용자 설정 게임(봇전·1대1 등)이 섞여 들어오는 것을 막는다.
 * 수동 등록·수기 기록·백업 복원은 사람이 고른 자료이므로 이 기준을 적용하지 않는다.
 */
export function naejeonViolation(m: IncomingMatch): string | null {
  if (m.source !== "collector" && m.source !== "history") return null;
  const blue = m.players.filter((p) => p.team === "blue").length;
  const red = m.players.length - blue;
  if (m.players.length !== 10 || blue !== 5 || red !== 5) {
    return `내전이 아님 (${m.players.length}명, ${blue}대${red})`;
  }
  return null;
}

/** 가져오기 전 최소 검증. 문제가 있으면 사유 문자열, 없으면 null */
export function validateIncoming(m: IncomingMatch): string | null {
  if (m.players.length < 2) return "참가자가 2명 미만";
  if (m.players.length > 10) return `참가자가 ${m.players.length}명 (10명 초과)`;
  const blue = m.players.filter((p) => p.team === "blue");
  const red = m.players.filter((p) => p.team === "red");
  if (blue.length === 0 || red.length === 0) return "한쪽 팀이 비어 있음";
  const blueWins = blue.filter((p) => p.win).length;
  const redWins = red.filter((p) => p.win).length;
  if ((blueWins > 0 && redWins > 0) || (blueWins === 0 && redWins === 0)) return "승패를 판단할 수 없음";
  return null;
}
