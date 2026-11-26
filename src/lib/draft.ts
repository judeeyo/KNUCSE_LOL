import { getChampionMeta, type ChampionMeta } from "./champion-meta";
import type { Lane, Match } from "./types";

/**
 * 밴픽 도우미 ("밴픽 에이전트").
 *
 * 팀과 라인이 정해진 뒤, 지금까지의 밴·픽을 보고
 *  1. 밴 추천      — 상대 선수들이 그 라인에서 많이 하고 잘한 챔피언 (그 사람 주력 비중이 클수록 우선)
 *  2. 선수별 후보  — 우리 선수가 그 라인에서 해 본 챔피언 (판수·승률), 경험이 적으면 내전에서 잘 나온 챔피언
 *  3. 추천 조합    — 선수별 후보를 묶어 AD/AP 균형·앞라인·이니시를 함께 본 상위 3개
 *  4. 픽 순서 팁   — 상대도 잘하는 챔피언은 먼저, 후보가 많은 라인은 나중에
 * 를 계산한다. 팀 판정과 마찬가지로 LLM 없이 내전 기록 + 챔피언 기본 성향표(champion-meta)만 쓴다.
 * 표본이 적어 승률은 항상 50% 쪽으로 당겨서 쓴다.
 */

export const DRAFT_WEIGHTS = {
  winEdge: 2, // 챔피언 보정 승률(-0.5~0.5) 가중치
  groupEdge: 0.6, // 내전 전체에서 그 라인 그 챔피언의 보정 승률
  offMeta: -0.4, // 그 라인 챔피언이 아닌데 해 본 적은 있는 경우
  matchup: 1.2, // 맞라인 상대 픽과의 기록 (보정 승률)
  newChampBase: 0.3, // 안 해 본 챔피언의 기본 점수 (해 본 챔피언 1판 ≈ 1점보다 낮게)
  candidates: 5, // 조합 탐색에 쓰는 선수별 후보 수
  options: 3,
};

export interface DraftSlot {
  nickname: string;
  lane: Lane;
}

export interface DraftState {
  ours: DraftSlot[];
  theirs: DraftSlot[];
  ourBans: string[];
  theirBans: string[];
  ourPicks: Record<string, string>; // 닉네임 → 챔피언 (확정)
  theirPicks: Record<string, string>;
}

interface Record2 {
  games: number;
  wins: number;
}

interface ChampRecord extends Record2 {
  byLane: Partial<Record<Lane, Record2>>;
}

export interface DraftIndex {
  players: Map<string, Map<string, ChampRecord>>;
  laneChamps: Map<Lane, Map<string, Record2>>;
  /** `${닉네임}|${상대 챔피언}` — 같은 라인에서 그 챔피언을 상대했을 때 */
  playerVsChamp: Map<string, Record2>;
  /** `${라인}|${챔피언}|${상대 챔피언}` — 내전 전체 맞라인 챔피언 상성 */
  champVsChamp: Map<string, Record2>;
}

const bump = (map: Map<string, Record2>, key: string, win: boolean) => {
  const e = map.get(key) || { games: 0, wins: 0 };
  e.games++;
  if (win) e.wins++;
  map.set(key, e);
};

export function buildDraftIndex(matches: Match[]): DraftIndex {
  const players = new Map<string, Map<string, ChampRecord>>();
  const laneChamps = new Map<Lane, Map<string, Record2>>();
  const playerVsChamp = new Map<string, Record2>();
  const champVsChamp = new Map<string, Record2>();
  for (const m of matches) {
    for (const p of m.players) {
      if (!p.champion) continue;
      const pool = players.get(p.nickname) || new Map<string, ChampRecord>();
      const rec = pool.get(p.champion) || { games: 0, wins: 0, byLane: {} };
      rec.games++;
      if (p.win) rec.wins++;
      if (p.lane) {
        const l = rec.byLane[p.lane] || { games: 0, wins: 0 };
        l.games++;
        if (p.win) l.wins++;
        rec.byLane[p.lane] = l;
        const lc = laneChamps.get(p.lane) || new Map<string, Record2>();
        bump(lc, p.champion, p.win);
        laneChamps.set(p.lane, lc);
        const opp = m.players.find((q) => q.team !== p.team && q.lane === p.lane);
        if (opp?.champion) {
          bump(playerVsChamp, `${p.nickname}|${opp.champion}`, p.win);
          bump(champVsChamp, `${p.lane}|${p.champion}|${opp.champion}`, p.win);
        }
      }
      pool.set(p.champion, rec);
      players.set(p.nickname, pool);
    }
  }
  return { players, laneChamps, playerVsChamp, champVsChamp };
}

/** 판수가 적을수록 50% 쪽으로 당긴 승률 - 0.5 */
const edge = (r: Record2 | undefined, prior = 4) => (r ? (r.wins + prior / 2) / (r.games + prior) - 0.5 : 0);

export const LANE_LABEL: Record<Lane, string> = { top: "탑", jungle: "정글", mid: "미드", adc: "원딜", support: "서폿" };

export interface Candidate {
  champion: string;
  score: number;
  games: number; // 이 선수가 이 챔피언을 한 판수 (모든 라인)
  wins: number;
  laneGames: number; // 이 라인에서 한 판수
  isNew: boolean; // 내전에서 해 본 적 없음 (내전 전체 기록으로 추천)
  locked?: boolean;
  reasons: string[];
}

export interface PlayerPlan {
  nickname: string;
  lane: Lane;
  locked?: string;
  candidates: Candidate[];
}

/** 이 선수가 이 라인에서 고를 만한 챔피언 (점수순). `unavailable` 은 밴·이미 뽑힌 챔피언 */
export function playerCandidates(
  index: DraftIndex,
  slot: DraftSlot,
  unavailable: Set<string>,
  opponentPick?: string,
  limit = 8
): Candidate[] {
  const w = DRAFT_WEIGHTS;
  const out: Candidate[] = [];
  const pool = index.players.get(slot.nickname);
  const laneMap = index.laneChamps.get(slot.lane);

  const matchupAdjust = (champion: string, reasons: string[]) => {
    if (!opponentPick) return 0;
    let adj = 0;
    const pv = index.playerVsChamp.get(`${slot.nickname}|${opponentPick}`);
    if (pv && pv.games >= 2) {
      const e = edge(pv);
      adj += (w.matchup * e) / 2;
      if (Math.abs(e) >= 0.08) reasons.push(`${opponentPick} 상대로 ${pv.games}전 ${pv.wins}승`);
    }
    const cv = index.champVsChamp.get(`${slot.lane}|${champion}|${opponentPick}`);
    if (cv && cv.games >= 2) {
      const e = edge(cv);
      adj += w.matchup * e;
      if (Math.abs(e) >= 0.08) reasons.push(`내전에서 ${champion} vs ${opponentPick} ${cv.games}전 ${cv.wins}승`);
    }
    return adj;
  };

  for (const [champion, rec] of pool || []) {
    if (unavailable.has(champion)) continue;
    const meta = getChampionMeta(champion);
    const laneRec = rec.byLane[slot.lane];
    const laneGames = laneRec?.games || 0;
    const fitsLane = meta ? meta.lanes.includes(slot.lane) : !!laneMap?.has(champion);
    if (!fitsLane && laneGames === 0) continue; // 다른 라인에서만 한 그 라인 챔피언이 아닌 경우 (예: 원딜 징크스를 탑에)
    const experience = laneGames + (fitsLane ? 0.5 * (rec.games - laneGames) : 0);
    const reasons: string[] = [];
    let score = Math.log2(1 + experience) + w.winEdge * edge(rec) + w.groupEdge * edge(laneMap?.get(champion), 6);
    if (!fitsLane) score += w.offMeta;
    reasons.push(laneGames === rec.games
      ? `${rec.games}판 ${rec.wins}승`
      : `${rec.games}판 ${rec.wins}승 (${LANE_LABEL[slot.lane]} ${laneGames}판)`);
    score += matchupAdjust(champion, reasons);
    out.push({ champion, score, games: rec.games, wins: rec.wins, laneGames, isNew: false, reasons });
  }

  // 해 본 챔피언이 적으면 내전에서 이 라인에 자주 나온 챔피언을 대안으로
  if (out.length < limit && laneMap) {
    const own = new Set(out.map((c) => c.champion));
    for (const [champion, rec] of laneMap) {
      if (own.has(champion) || unavailable.has(champion) || (pool?.has(champion))) continue;
      if (rec.games < 2) continue;
      const meta = getChampionMeta(champion);
      if (meta && !meta.lanes.includes(slot.lane)) continue;
      const reasons = [`해 본 적 없음 · 내전 ${LANE_LABEL[slot.lane]} ${rec.games}판 ${rec.wins}승`];
      const score = w.newChampBase + w.groupEdge * edge(rec, 6) + Math.min(0.3, rec.games * 0.03) + matchupAdjust(champion, reasons);
      out.push({ champion, score, games: 0, wins: 0, laneGames: 0, isNew: true, reasons });
    }
  }

  return out.sort((a, b) => b.score - a.score || b.games - a.games || a.champion.localeCompare(b.champion)).slice(0, limit);
}

// ─── 조합 평가 ───

export interface CompNote {
  good: boolean;
  text: string;
}

export interface CompSummary {
  ap: number; // AP 비중 (AP 1, MIX 0.5, 모름 0.5)
  front: number;
  engage: number;
  score: number; // 0 이하 (문제가 있을수록 감점)
  notes: CompNote[];
}

export function evaluateComp(champions: string[]): CompSummary {
  const metas = champions.map((c) => getChampionMeta(c));
  const known = metas.filter((m): m is ChampionMeta => !!m);
  const ap = metas.reduce((s, m) => s + (!m ? 0.5 : m.dmg === "AP" ? 1 : m.dmg === "MIX" ? 0.5 : 0), 0);
  const front = metas.reduce((s, m) => s + (m ? m.front : 1), 0);
  const engage = metas.reduce((s, m) => s + (m ? m.engage : 1), 0);
  const hardEngage = known.some((m) => m.engage === 2);
  const n = champions.length;
  const notes: CompNote[] = [];
  let score = 0;

  if (n >= 4) {
    if (ap < 1) { score -= 1.2; notes.push({ good: false, text: "거의 AD 딜 — 상대가 방어력만 올리면 됨" }); }
    else if (ap > n - 1) { score -= 1.2; notes.push({ good: false, text: "거의 AP 딜 — 상대가 마법 저항력만 올리면 됨" }); }
    else if (ap < 1.5 || ap > n - 1.5) { score -= 0.3; notes.push({ good: false, text: "딜 유형이 한쪽으로 쏠림" }); }
    else notes.push({ good: true, text: "AD/AP 균형 좋음" });

    if (front <= 1) { score -= 1; notes.push({ good: false, text: "앞라인 부족 — 받아칠 탱커·브루저가 없음" }); }
    else if (front === 2) { score -= 0.4; notes.push({ good: false, text: "앞라인이 얇은 편" }); }
    else notes.push({ good: true, text: "앞라인 든든함" });

    if (!hardEngage && engage < 3) { score -= 0.8; notes.push({ good: false, text: "한타를 열 챔피언이 없음" }); }
    else if (hardEngage) notes.push({ good: true, text: "이니시 확실함" });
  }
  return { ap, front, engage, score, notes };
}

/** 상대 조합을 보고 하는 조언 (상대 픽이 4개 이상일 때) */
export function enemyCompTips(enemy: string[]): string[] {
  if (enemy.length < 4) return [];
  const c = evaluateComp(enemy);
  const tips: string[] = [];
  if (c.ap <= 1) tips.push("상대 딜이 거의 AD — 방어력 아이템 효율이 좋음");
  if (c.ap >= enemy.length - 1) tips.push("상대 딜이 거의 AP — 마법 저항력 아이템 효율이 좋음");
  if (c.front <= 1) tips.push("상대 앞라인이 약함 — 포킹·돌진으로 딜러를 바로 노리기 좋음");
  if (c.front >= 6) tips.push("상대가 단단함 — 지속 딜(원딜·관통·퍼뎀) 비중을 높이기");
  if (c.engage >= 6) tips.push("상대 이니시가 강함 — 뭉쳐서 받아치거나 끊기지 않게 시야 확보");
  if (c.engage <= 2) tips.push("상대가 한타를 열기 어려움 — 우리가 먼저 걸면 유리");
  return tips;
}

// ─── 종합 ───

export interface CompPick {
  nickname: string;
  lane: Lane;
  champion: string;
  candidate: Candidate;
}

export interface CompOption {
  picks: CompPick[];
  total: number;
  comp: CompSummary;
}

export interface BanSuggestion {
  champion: string;
  target: string;
  lane: Lane;
  games: number;
  wins: number;
  share: number; // 그 선수의 이 라인 판수 중 이 챔피언 비중
  score: number;
}

export interface DraftAdvice {
  banSuggestions: BanSuggestion[];
  /** 상대가 우리에게서 뺏을 만한 챔피언 (우리 선수 주력) */
  ourExposed: BanSuggestion[];
  ourPlans: PlayerPlan[];
  enemyPlans: PlayerPlan[];
  options: CompOption[];
  pickOrder: string[];
  enemyTips: string[];
}

const LANE_ORDER: Lane[] = ["top", "jungle", "mid", "adc", "support"];
const byLane = (a: DraftSlot, b: DraftSlot) => LANE_ORDER.indexOf(a.lane) - LANE_ORDER.indexOf(b.lane);

function banTargets(index: DraftIndex, slots: DraftSlot[], picks: Record<string, string>, unavailable: Set<string>): BanSuggestion[] {
  const list: BanSuggestion[] = [];
  for (const slot of slots) {
    if (picks[slot.nickname]) continue; // 이미 뽑은 선수는 밴해도 소용없음
    const pool = index.players.get(slot.nickname);
    if (!pool) continue;
    let laneTotal = 0;
    for (const rec of pool.values()) laneTotal += rec.byLane[slot.lane]?.games || 0;
    for (const c of playerCandidates(index, slot, unavailable, undefined, 4)) {
      if (c.isNew || c.games < 2) continue;
      const share = laneTotal > 0 ? c.laneGames / laneTotal : 0;
      list.push({ champion: c.champion, target: slot.nickname, lane: slot.lane, games: c.games, wins: c.wins, share, score: c.score + share * 1.5 });
    }
  }
  const seen = new Set<string>();
  return list
    .sort((a, b) => b.score - a.score)
    .filter((b) => (seen.has(b.champion) ? false : (seen.add(b.champion), true)))
    .slice(0, 5);
}

export function adviseDraft(index: DraftIndex, state: DraftState): DraftAdvice {
  const w = DRAFT_WEIGHTS;
  const ours = [...state.ours].sort(byLane);
  const theirs = [...state.theirs].sort(byLane);
  const bans = new Set([...state.ourBans, ...state.theirBans].filter(Boolean));
  const ourPicked = new Set(Object.values(state.ourPicks).filter(Boolean));
  const theirPicked = new Set(Object.values(state.theirPicks).filter(Boolean));
  const taken = new Set([...bans, ...ourPicked, ...theirPicked]);
  const opponentOf = (slot: DraftSlot, other: DraftSlot[], picks: Record<string, string>) => {
    const o = other.find((s) => s.lane === slot.lane);
    return o ? picks[o.nickname] : undefined;
  };

  const ourPlans: PlayerPlan[] = ours.map((slot) => {
    const locked = state.ourPicks[slot.nickname];
    if (locked) {
      const own = playerCandidates(index, slot, new Set([...taken].filter((c) => c !== locked)), opponentOf(slot, theirs, state.theirPicks), 50)
        .find((c) => c.champion === locked);
      const cand: Candidate = own
        ? { ...own, locked: true }
        : { champion: locked, score: 0, games: 0, wins: 0, laneGames: 0, isNew: true, locked: true, reasons: ["확정 픽"] };
      return { nickname: slot.nickname, lane: slot.lane, locked, candidates: [cand] };
    }
    return { nickname: slot.nickname, lane: slot.lane, candidates: playerCandidates(index, slot, taken, opponentOf(slot, theirs, state.theirPicks)) };
  });

  const enemyPlans: PlayerPlan[] = theirs.map((slot) => {
    const locked = state.theirPicks[slot.nickname];
    if (locked) return { nickname: slot.nickname, lane: slot.lane, locked, candidates: [] };
    return { nickname: slot.nickname, lane: slot.lane, candidates: playerCandidates(index, slot, taken, undefined, 3) };
  });

  // 조합 탐색: 선수별 상위 후보를 묶어 (개인 점수 합 + 조합 점수) 최대
  const lists = ourPlans.map((p) => p.candidates.slice(0, w.candidates));
  const combos: CompOption[] = [];
  if (lists.every((l) => l.length > 0)) {
    const pick: Candidate[] = [];
    const walk = (i: number) => {
      if (i === lists.length) {
        const champs = pick.map((c) => c.champion);
        const comp = evaluateComp(champs);
        const total = pick.reduce((s, c) => s + c.score, 0) + comp.score;
        combos.push({
          total,
          comp,
          picks: pick.map((c, k) => ({ nickname: ourPlans[k].nickname, lane: ourPlans[k].lane, champion: c.champion, candidate: c })),
        });
        return;
      }
      for (const c of lists[i]) {
        if (pick.some((x) => x.champion === c.champion)) continue;
        pick.push(c);
        walk(i + 1);
        pick.pop();
      }
    };
    walk(0);
  }
  combos.sort((a, b) => b.total - a.total);
  // 서로 2자리 이상 다른 조합을 고른다 (서폿만 바뀐 비슷한 안 3개가 나오지 않게). 모자라면 1자리 차이 허용
  const options: CompOption[] = [];
  for (const minDiff of [2, 1]) {
    for (const c of combos) {
      if (options.length >= w.options) break;
      if (options.includes(c)) continue;
      const differs = options.every((o) => o.picks.filter((p, i) => p.champion !== c.picks[i].champion).length >= minDiff);
      if (differs) options.push(c);
    }
  }

  // 밴 추천: 상대 선수 주력. 우리가 쓸 수 있는 1안 챔피언은 밴하지 않는다
  const best = new Set(options[0]?.picks.map((p) => p.champion) || []);
  const banSuggestions = banTargets(index, theirs, state.theirPicks, taken).filter((b) => !best.has(b.champion));
  const ourExposed = banTargets(index, ours, state.ourPicks, taken);

  // 픽 순서 팁
  const pickOrder: string[] = [];
  if (options[0]) {
    const enemyComfort = new Map<string, { nick: string; games: number }>();
    for (const slot of theirs) {
      if (state.theirPicks[slot.nickname]) continue;
      for (const [champ, rec] of index.players.get(slot.nickname) || []) {
        if (rec.games >= 2 && (enemyComfort.get(champ)?.games || 0) < rec.games) enemyComfort.set(champ, { nick: slot.nickname, games: rec.games });
      }
    }
    for (const p of options[0].picks) {
      if (p.candidate.locked) continue;
      const e = enemyComfort.get(p.champion);
      if (e) pickOrder.push(`${p.champion}(${p.nickname}) 먼저 — 상대 ${e.nick}도 ${e.games}판 한 챔피언`);
    }
    for (const plan of ourPlans) {
      if (plan.locked) continue;
      const comfort = plan.candidates.filter((c) => !c.isNew && c.laneGames >= 2);
      if (comfort.length === 1) pickOrder.push(`${plan.nickname}(${LANE_LABEL[plan.lane]})는 남은 주력이 ${comfort[0].champion} 하나 — 밴당하기 전에 일찍`);
    }
    const deep = ourPlans
      .filter((p) => !p.locked && p.candidates.filter((c) => !c.isNew && c.games >= 2).length >= 3)
      .filter((p) => !theirs.some((t) => t.lane === p.lane && state.theirPicks[t.nickname]));
    if (deep.length) {
      const d = deep.sort((a, b) => b.candidates.length - a.candidates.length)[0];
      pickOrder.push(`${d.nickname}(${LANE_LABEL[d.lane]})는 후보가 많으니 상대 ${LANE_LABEL[d.lane]} 픽을 보고 마지막에`);
    }
  }

  const enemyChamps = theirs.map((s) => state.theirPicks[s.nickname]).filter(Boolean);
  return {
    banSuggestions,
    ourExposed,
    ourPlans,
    enemyPlans,
    options,
    pickOrder: pickOrder.slice(0, 4),
    enemyTips: enemyCompTips(enemyChamps),
  };
}

/** 카톡에 붙여넣을 밴픽 요약 */
export function formatDraftMessage(state: DraftState, advice: DraftAdvice, ourLabel: string): string {
  const lines: string[] = [`컴학내전 밴픽 도우미 · ${ourLabel}`];
  const bans = [...state.ourBans, ...state.theirBans].filter(Boolean);
  if (bans.length) lines.push(`밴: ${bans.join(", ")}`);
  else if (advice.banSuggestions.length) lines.push(`밴 추천: ${advice.banSuggestions.map((b) => `${b.champion}(${b.target})`).join(", ")}`);
  const best = advice.options[0];
  if (best) {
    lines.push("", "추천 조합");
    for (const p of best.picks) lines.push(`${LANE_LABEL[p.lane]} · ${p.nickname} → ${p.champion}`);
    const good = best.comp.notes.filter((n) => n.good).map((n) => n.text);
    const bad = best.comp.notes.filter((n) => !n.good).map((n) => n.text);
    if (good.length) lines.push(`👍 ${good.join(", ")}`);
    if (bad.length) lines.push(`⚠️ ${bad.join(", ")}`);
  }
  if (advice.pickOrder.length) lines.push("", ...advice.pickOrder.map((t) => `· ${t}`));
  return lines.join("\n");
}

// ─── 순서대로 진행하는 밴픽 (토너먼트 드래프트) ───

export type DraftSide = "blue" | "red";
export interface DraftStep {
  side: DraftSide;
  kind: "ban" | "pick";
}

/** 랭크·토너먼트 드래프트 순서: 밴 3-3 → 픽 B R R B B R → 밴 2-2 (레드 먼저) → 픽 R B B R */
export const DRAFT_SEQUENCE: DraftStep[] = [
  ..."BRBRBR".split("").map((s) => ({ side: s === "B" ? "blue" : "red", kind: "ban" }) as DraftStep),
  ..."BRRBBR".split("").map((s) => ({ side: s === "B" ? "blue" : "red", kind: "pick" }) as DraftStep),
  ..."RBRB".split("").map((s) => ({ side: s === "B" ? "blue" : "red", kind: "ban" }) as DraftStep),
  ..."RBBR".split("").map((s) => ({ side: s === "B" ? "blue" : "red", kind: "pick" }) as DraftStep),
];

export interface PickSuggestion {
  nickname: string;
  lane: Lane;
  champion: string;
  candidate: Candidate;
  priority: number;
  why: string[];
}

/**
 * 지금 우리 픽 차례에 무엇을 먼저 가져갈지.
 * 추천 조합(상위 안)에 들어 있는 챔피언 중에서
 *  - 상대 선수도 잘하는 챔피언(뺏길 수 있음)
 *  - 남은 주력이 하나뿐인 선수
 *  - 맞라인 상대가 이미 픽해서 카운터를 칠 수 있는 라인
 * 을 앞으로, 후보가 많은데 상대 맞라인이 아직 안 정해진 라인은 뒤로 보낸다.
 */
export function suggestNextPicks(index: DraftIndex, state: DraftState, advice: DraftAdvice, limit = 4): PickSuggestion[] {
  const enemyComfort = new Map<string, { nick: string; games: number }>();
  for (const slot of state.theirs) {
    if (state.theirPicks[slot.nickname]) continue;
    for (const [champ, rec] of index.players.get(slot.nickname) || []) {
      if (rec.games >= 2 && (enemyComfort.get(champ)?.games || 0) < rec.games) enemyComfort.set(champ, { nick: slot.nickname, games: rec.games });
    }
  }
  const comfortCount = new Map(advice.ourPlans.map((p) => [p.nickname, p.candidates.filter((c) => !c.isNew && c.laneGames >= 2).length]));
  const out: PickSuggestion[] = [];
  advice.options.forEach((option, rank) => {
    for (const p of option.picks) {
      if (p.candidate.locked) continue;
      const why: string[] = [];
      // 순서 판단(뺏길 위험·카운터)이 숙련도보다 앞서도록 숙련도 점수는 줄여서 더한다
      let priority = 0.4 * p.candidate.score - rank * 0.3;
      const e = enemyComfort.get(p.champion);
      if (e) { priority += 0.6 + 0.15 * e.games; why.push(`상대 ${e.nick}도 ${e.games}판 한 챔피언 — 뺏기기 전에`); }
      const comfort = comfortCount.get(p.nickname) || 0;
      if (comfort === 1) { priority += 0.8; why.push("남은 주력이 이것 하나"); }
      const opp = state.theirs.find((t) => t.lane === p.lane);
      const oppPick = opp ? state.theirPicks[opp.nickname] : undefined;
      if (oppPick) { priority += 0.5; why.push(`상대 ${LANE_LABEL[p.lane]} ${oppPick} 확인됨`); }
      else if (comfort >= 3) { priority -= 0.8; why.push("후보가 많아 나중에 뽑아도 됨"); }
      if (rank > 0) why.push(`${rank + 1}안 조합`);
      out.push({ nickname: p.nickname, lane: p.lane, champion: p.champion, candidate: p.candidate, priority, why });
    }
  });
  const seen = new Set<string>();
  return out
    .sort((a, b) => b.priority - a.priority)
    .filter((s) => (seen.has(s.champion) ? false : (seen.add(s.champion), true)))
    .slice(0, limit);
}

/** 상대가 뽑은 챔피언이 누구 것인지 추정: 그 라인에서 해 본 선수 → 챔피언 기본 라인 → 남은 첫 자리 */
export function guessPickOwner(index: DraftIndex, champion: string, open: DraftSlot[]): DraftSlot | undefined {
  if (open.length === 0) return undefined;
  let best: { slot: DraftSlot; games: number } | null = null;
  for (const slot of open) {
    const g = index.players.get(slot.nickname)?.get(champion)?.byLane[slot.lane]?.games || 0;
    if (g > 0 && (!best || g > best.games)) best = { slot, games: g };
  }
  if (best) return best.slot;
  const meta = getChampionMeta(champion);
  if (meta) {
    for (const lane of meta.lanes) {
      const s = open.find((o) => o.lane === lane);
      if (s) return s;
    }
  }
  return open[0];
}

/** 밴픽 에이전트 주소: /draft?b=탑&b=정글…&r=… (라인 순서대로 5명씩) */
export function draftHref(blue: DraftSlot[], red: DraftSlot[]): string {
  const q = new URLSearchParams();
  for (const [key, team] of [["b", blue], ["r", red]] as const) {
    for (const s of [...team].sort(byLane)) q.append(key, s.nickname);
  }
  return `/draft?${q.toString()}`;
}

export function parseDraftQuery(search: string): { blue: DraftSlot[]; red: DraftSlot[] } | null {
  const q = new URLSearchParams(search);
  const b = q.getAll("b"), r = q.getAll("r");
  if (b.length !== 5 || r.length !== 5 || new Set([...b, ...r]).size !== 10 || [...b, ...r].some((n) => !n.trim())) return null;
  return {
    blue: b.map((nickname, i) => ({ nickname, lane: LANE_ORDER[i] })),
    red: r.map((nickname, i) => ({ nickname, lane: LANE_ORDER[i] })),
  };
}
