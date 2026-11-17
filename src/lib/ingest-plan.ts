// 들어온 경기를 DB의 기존 경기와 비교해 "어떻게 처리할지" 결정한다. (순수 함수)
import { championOverlap, dayDistance, matchFingerprint } from "./match-normalize";
import { normalizeChampionName } from "./champions";
import type { IncomingMatch } from "./import-parse";

export interface ExistingMatch {
  id: string;
  game_id: string | null;
  created_at: string;
  review_status: string | null;
  players: Array<Record<string, unknown>>;
}

export type IngestDecision =
  | { action: "insert" }
  /** 같은 id / gameId / 내용의 경기가 이미 있음 → 건너뜀 */
  | { action: "skip"; reason: "same-id" | "same-game-id" | "same-content"; existingId: string }
  /** 같은 gameId 의 경기를 최신 수집 데이터로 갱신 */
  | { action: "update"; existingId: string }
  /** gameId 없는 기존 기록(수기 등)과 10명의 챔피언·KDA 가 모두 같음 → 같은 경기가 확실하므로 자동으로 합친다 */
  | { action: "merge"; existingId: string }
  /** 중복으로 의심되지만 확정할 수 없음 → 보류 상태로 저장, 관리 화면에서 검토 */
  | { action: "candidate"; existingId: string; reason: "same-content-no-game-id" | "similar" };

/** 날짜가 ±1일 이내이고 챔피언이 8개 이상 겹치면 같은 경기일 가능성이 있다고 본다 */
const SIMILAR_MIN_OVERLAP = 8;

export function decideIngest(existing: ExistingMatch[], inc: IncomingMatch): IngestDecision {
  if (inc.id) {
    const same = existing.find((e) => e.id === inc.id);
    if (same) return { action: "skip", reason: "same-id", existingId: same.id };
  }
  if (inc.gameId) {
    const same = existing.find((e) => e.game_id === inc.gameId);
    if (same) {
      return inc.restore
        ? { action: "skip", reason: "same-game-id", existingId: same.id }
        : { action: "update", existingId: same.id };
    }
  }
  // 백업에서 보류 상태로 복원되는 행은 그대로 넣는다
  if (inc.reviewStatus) return { action: "insert" };

  // 둘 다 gameId 가 있는데 다르면 서로 다른 경기가 확실하므로 비교 대상에서 뺀다
  const live = existing.filter((e) => !e.review_status && !(inc.gameId && e.game_id && e.game_id !== inc.gameId));
  const fp = matchFingerprint(inc.players);
  const exact = live.find((e) => matchFingerprint(e.players) === fp);
  if (exact) {
    // gameId 가 없는 자료끼리, 또는 gameId 없는 자료가 이미 있는 경기와 내용이 같으면 그냥 중복
    if (!inc.gameId) return { action: "skip", reason: "same-content", existingId: exact.id };
    // 새 자료에는 gameId 가 있고 기존 기록(수기)에는 없음. 10명의 챔피언·K/D/A 가 전부 같은 서로 다른 경기는
    // 사실상 없으므로 자동으로 합친다 (기존 id·닉네임 유지, 상세 지표·gameId·정확한 시각 채움)
    return { action: "merge", existingId: exact.id };
  }

  if (inc.createdAt) {
    const similar = live.find(
      (e) =>
        // 둘 다 gameId 가 있으면 서로 다른 경기가 확실하므로 비교하지 않는다
        !(e.game_id && inc.gameId) &&
        dayDistance(e.created_at, inc.createdAt as string) <= 1 &&
        championOverlap(e.players, inc.players) >= SIMILAR_MIN_OVERLAP
    );
    if (similar) return { action: "candidate", existingId: similar.id, reason: "similar" };
  }
  return { action: "insert" };
}

type NamedPlayer = { nickname?: unknown; team?: unknown; champion?: unknown; kills?: unknown; deaths?: unknown; assists?: unknown };

const playerKey = (p: NamedPlayer) =>
  `${normalizeChampionName(String(p.champion ?? ""))}:${Number(p.kills) || 0}/${Number(p.deaths) || 0}/${Number(p.assists) || 0}`;

/**
 * 같은 경기의 두 기록을 합칠 때 닉네임은 기존 기록 것을 유지한다.
 * 참가자는 (챔피언, K/D/A) 로 짝을 짓는다 — 한 경기 안에서 이 조합은 사람마다 다르다.
 * 반환: 닉네임을 바꾼 새 참가자 목록 + 바뀐 이름 쌍(새 이름 → 기존 이름)
 */
export function keepExistingNicknames<T extends NamedPlayer>(
  existingPlayers: NamedPlayer[],
  incomingPlayers: T[]
): { players: T[]; renames: Array<{ from: string; to: string }> } {
  const pool = new Map<string, string[]>();
  for (const p of existingPlayers) {
    const k = playerKey(p);
    pool.set(k, [...(pool.get(k) || []), String(p.nickname ?? "")]);
  }
  const renames: Array<{ from: string; to: string }> = [];
  const players = incomingPlayers.map((p) => {
    const names = pool.get(playerKey(p));
    const old = names?.shift();
    const now = String(p.nickname ?? "");
    if (!old || old === now) return p;
    renames.push({ from: now, to: old });
    return { ...p, nickname: old };
  });
  return { players, renames };
}
