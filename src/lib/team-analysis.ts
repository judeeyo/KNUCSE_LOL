import type { BalancerPlayer } from "./stats";
import type { Lane, Match } from "./types";

/**
 * 팀 편성 결과의 우세/열세 판정 ("AI 판정").
 *
 * 챗봇(LLM)을 부르지 않고, 내전 기록만으로 계산한다:
 *  1. 팀 점수 합 차이        — 밸런스 점수(기존 종합 성적 또는 시험 모델)
 *  2. 포지션 편안함           — 배정된 라인이 선호 라인 밖이면 감점
 *  3. 팀원 궁합               — 같은 팀으로 뛴 기록(2판 이상)의 승률, 판수가 적으면 50% 쪽으로 당김
 *  4. 맞라인 상대 전적        — 같은 라인에서 맞붙은 기록(2판 이상)
 * 각 요소를 로짓(승률의 log-odds)으로 더해 블루팀 예상 승률을 낸다.
 * 계수는 표본(현재 약 50경기)이 적어 보수적으로 잡았고, 예상 승률은 25~75% 로 제한한다.
 * 경기가 더 쌓이면 docs/점수모델_작업관리.md 의 시간순 평가 방식으로 계수를 다시 검증할 것.
 */

export const ANALYSIS_WEIGHTS = {
  score: 0.35, // 팀 점수 합 1점 차이당
  offRole: 0.12, // 비선호 라인 배정 1명당
  synergy: 0.6, // 팀원 한 쌍의 (보정 승률 - 0.5) 당
  matchup: 0.4, // 맞라인 한 쌍의 (보정 승률 - 0.5) 당
  minGames: 2, // 궁합·맞라인을 반영할 최소 판수
  lowSampleGames: 5, // 이보다 적게 뛴 선수가 있으면 신뢰도 낮음 표시
  maxProb: 0.75,
};

export type Verdict = "even" | "slight" | "clear";

export interface AnalysisReason {
  favors: "blue" | "red";
  text: string;
  weight: number; // 로짓 기여도 절댓값 (정렬용)
}

export interface TeamAnalysis {
  blueWinProb: number; // 0~1
  favored: "blue" | "red" | null; // 박빙이면 null
  verdict: Verdict;
  label: string; // "블루팀 약간 우세" 등
  reasons: AnalysisReason[]; // 영향 큰 순, 최대 3개
  lowSample: string[]; // 판수가 적은 선수
}

const LANE_LABEL: Record<Lane, string> = { top: "탑", jungle: "정글", mid: "미드", adc: "원딜", support: "서폿" };
const TEAM_LABEL = { blue: "블루", red: "레드" } as const;
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

/** 판수가 적을수록 50% 쪽으로 당긴 승률 - 0.5 */
const shrunkEdge = (wins: number, games: number, prior = 3) => (wins + prior / 2) / (games + prior) - 0.5;

export interface HistoryIndex {
  together: Map<string, { games: number; wins: number }>;
  laneVs: Map<string, { games: number; wins: number }>; // key = "lane|a|b", wins 는 a 기준
}

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** 집계 대상 경기(기록 제외 경기는 이미 빠진 group.matches)에서 궁합·맞라인 기록을 모은다. */
export function buildHistoryIndex(matches: Match[]): HistoryIndex {
  const together = new Map<string, { games: number; wins: number }>();
  const laneVs = new Map<string, { games: number; wins: number }>();
  for (const m of matches) {
    for (const side of ["blue", "red"] as const) {
      const team = m.players.filter((p) => p.team === side);
      for (let i = 0; i < team.length; i++) {
        for (let j = i + 1; j < team.length; j++) {
          const key = pairKey(team[i].nickname, team[j].nickname);
          const e = together.get(key) || { games: 0, wins: 0 };
          e.games++;
          if (team[i].win) e.wins++;
          together.set(key, e);
        }
      }
    }
    const blue = m.players.filter((p) => p.team === "blue");
    for (const b of blue) {
      if (!b.lane) continue;
      const r = m.players.find((p) => p.team === "red" && p.lane === b.lane);
      if (!r) continue;
      for (const [x, y] of [[b, r], [r, b]] as const) {
        const key = `${b.lane}|${x.nickname}|${y.nickname}`;
        const e = laneVs.get(key) || { games: 0, wins: 0 };
        e.games++;
        if (x.win) e.wins++;
        laneVs.set(key, e);
      }
    }
  }
  return { together, laneVs };
}

const isOffRole = (p: BalancerPlayer) =>
  !!p.assignedLane && !!p.preferredLanes?.length && !p.preferredLanes.includes(p.assignedLane);

export function analyzeTeams(blue: BalancerPlayer[], red: BalancerPlayer[], history: HistoryIndex): TeamAnalysis {
  const w = ANALYSIS_WEIGHTS;
  const reasons: AnalysisReason[] = [];
  let logit = 0;
  const add = (value: number, text: (favors: "blue" | "red") => string) => {
    if (Math.abs(value) < 1e-9) return;
    logit += value;
    const favors = value > 0 ? "blue" : "red";
    reasons.push({ favors, text: text(favors), weight: Math.abs(value) });
  };

  // 1. 점수 합
  const sum = (t: BalancerPlayer[]) => t.reduce((s, p) => s + p.score, 0);
  const scoreDiff = sum(blue) - sum(red);
  if (Math.abs(scoreDiff) >= 0.05) {
    add(w.score * scoreDiff, (f) => `${TEAM_LABEL[f]}팀 점수 합이 ${Math.abs(scoreDiff).toFixed(1)}점 높음`);
  }

  // 2. 포지션 편안함
  const off = (t: BalancerPlayer[]) => t.filter(isOffRole);
  const offB = off(blue), offR = off(red);
  if (offB.length !== offR.length) {
    const worse = offB.length > offR.length ? offB : offR;
    add(w.offRole * (offR.length - offB.length), (f) =>
      `${TEAM_LABEL[f === "blue" ? "red" : "blue"]}팀 ${worse.length}명이 비선호 라인 (${worse.map((p) => `${p.nickname} ${LANE_LABEL[p.assignedLane!]}`).join(", ")})`);
  }

  // 3. 팀원 궁합 (팀별로 가장 눈에 띄는 쌍을 이유로)
  for (const [team, sign] of [[blue, 1], [red, -1]] as const) {
    let total = 0;
    let best: { a: string; b: string; games: number; wins: number; edge: number } | null = null;
    for (let i = 0; i < team.length; i++) {
      for (let j = i + 1; j < team.length; j++) {
        const rec = history.together.get(pairKey(team[i].nickname, team[j].nickname));
        if (!rec || rec.games < w.minGames) continue;
        const edge = shrunkEdge(rec.wins, rec.games);
        total += edge;
        if (!best || Math.abs(edge) > Math.abs(best.edge)) best = { a: team[i].nickname, b: team[j].nickname, ...rec, edge };
      }
    }
    if (best && Math.abs(total) >= 0.05) {
      const b = best;
      const name = sign === 1 ? "블루" : "레드";
      add(sign * w.synergy * total, () => total > 0
        ? `${name}팀 궁합 좋음 (${b.a}·${b.b} 같은 팀 ${b.games}전 ${b.wins}승)`
        : `${name}팀 궁합 아쉬움 (${b.a}·${b.b} 같은 팀 ${b.games}전 ${b.wins}승)`);
    }
  }

  // 4. 맞라인 상대 전적
  for (const bp of blue) {
    if (!bp.assignedLane) continue;
    const rp = red.find((p) => p.assignedLane === bp.assignedLane);
    if (!rp) continue;
    const rec = history.laneVs.get(`${bp.assignedLane}|${bp.nickname}|${rp.nickname}`);
    if (!rec || rec.games < w.minGames) continue;
    const edge = shrunkEdge(rec.wins, rec.games);
    if (Math.abs(edge) < 0.05) continue;
    const [winner, loser, wins] = edge > 0 ? [bp.nickname, rp.nickname, rec.wins] : [rp.nickname, bp.nickname, rec.games - rec.wins];
    add(w.matchup * edge, () => `${LANE_LABEL[bp.assignedLane!]} 맞라인 ${winner} 강세 (${loser} 상대 ${rec.games}전 ${wins}승)`);
  }

  const raw = sigmoid(logit);
  const blueWinProb = Math.min(w.maxProb, Math.max(1 - w.maxProb, raw));
  const gap = Math.abs(blueWinProb - 0.5);
  const verdict: Verdict = gap < 0.03 ? "even" : gap < 0.08 ? "slight" : "clear";
  const favored = verdict === "even" ? null : blueWinProb > 0.5 ? "blue" : "red";
  const label = favored === null ? "박빙" : `${TEAM_LABEL[favored]}팀 ${verdict === "slight" ? "약간 우세" : "우세"}`;
  const lowSample = [...blue, ...red].filter((p) => p.gamesPlayed < w.lowSampleGames).map((p) => p.nickname);

  return {
    blueWinProb,
    favored,
    verdict,
    label,
    reasons: reasons.sort((a, b) => b.weight - a.weight).slice(0, 3),
    lowSample,
  };
}

/** 점수 순으로 정렬해 이웃끼리 짝 (1-2등, 3-4등 …). 짝 편성의 "자동 짝 추천" 버튼용. */
export function suggestPairs(players: BalancerPlayer[]): Array<[string, string]> {
  const sorted = [...players].sort((a, b) => b.score - a.score || a.nickname.localeCompare(b.nickname));
  const out: Array<[string, string]> = [];
  for (let i = 0; i + 1 < sorted.length; i += 2) out.push([sorted[i].nickname, sorted[i + 1].nickname]);
  return out;
}
