import type { Group, Match, PlayerStat } from "./types";
import { parseTierScore } from "./stats";

export const RATING_VERSION = "context-v1";
const DAY = 86_400_000;
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
const sigmoid = (value: number) => 1 / (1 + Math.exp(-clamp(value, -30, 30)));

export interface RatingEstimate {
  nickname: string;
  score: number;
  baseline: number;
  performanceAdjustment: number;
  outcomeAdjustment: number;
  tier?: string;
  tierSource: string;
  games: number;
  // 경기 수와 티어 확인 여부에 따른 안내값. 통계적 신뢰구간을 의미하지 않는다.
  evidence: "낮음" | "보통";
}
export interface RatingConfig {
  scale: number;
  regularization: number;
  halfLifeDays: number;
}
export const DEFAULT_RATING_CONFIG: RatingConfig = { scale: 0.4, regularization: 2, halfLifeDays: 120 };

/** 손실/기여도 평가에 사용할 수 있는 일관된 5대5 경기만 포함한다. */
export function validRatingMatch(match: Match): boolean {
  if (match.excludedReason || match.players.length !== 10 || new Set(match.players.map((p) => p.nickname)).size !== 10) return false;
  const blue = match.players.filter((p) => p.team === "blue");
  const red = match.players.filter((p) => p.team === "red");
  return blue.length === 5 && red.length === 5 && blue.every((p) => p.win === blue[0].win) &&
    red.every((p) => p.win === red[0].win) && blue[0].win !== red[0].win;
}

function performance(me: PlayerStat, opponent: PlayerStat): number | null {
  const values: number[] = [];
  const compare = (own: number, other: number, smoothing: number, direction = 1) => {
    if (Number.isFinite(own) && Number.isFinite(other) && own >= 0 && other >= 0) {
      values.push(direction * Math.tanh(Math.log((own + smoothing) / (other + smoothing))));
    }
  };
  compare(me.gold, opponent.gold, 1000);
  if (me.lane !== "support") compare(me.cs, opponent.cs, 30);
  compare(me.deaths, opponent.deaths, 3, -1);
  if (!me.noDamage && !opponent.noDamage && me.gold > 0 && opponent.gold > 0) {
    compare(me.damageDealt / me.gold, opponent.damageDealt / opponent.gold, 0.5);
  }
  if (!me.noVision && !opponent.noVision) compare(me.visionScore, opponent.visionScore, 10);
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function tierEvidence(group: Group, nickname: string, asOf: number, allowManual: boolean) {
  const manual = allowManual ? group.members.find((m) => m.nickname === nickname)?.tier : undefined;
  if (parseTierScore(manual) !== null) return { tier: manual, source: "선수 정보 솔랭", precision: 2.5 };
  const entries = group.matches.flatMap((m) => m.players.filter((p) => p.nickname === nickname).flatMap((p) => {
    const observedAt = p.rankObservedAt || m.uploadedAt;
    const date = Date.parse(observedAt || "");
    // 경기 날짜를 랭크 조회일로 추정하지 않는다. 조회/업로드 시각이 없으면 사용하지 않는다.
    if (!Number.isFinite(date) || date > asOf) return [];
    const age = Math.max(0, (asOf - date) / DAY);
    if (p.rankSnapshot) {
      const r = p.rankSnapshot;
      const queue = r.soloTier ? "solo" : r.previousSoloTier ? "past" : r.flexTier ? "flex" : "none";
      const tier = r.soloTier || r.previousSoloTier || r.flexTier;
      if (parseTierScore(tier) === null) return [{ tier: undefined, date, precision: 0.5, source: "수집 랭크 없음" }];
      const precision = (queue === "solo" ? 2.5 : queue === "past" ? 0.8 : 0.3) * Math.pow(0.5, age / 180);
      return [{ tier, date, precision, source: queue === "solo" ? "수집 솔랭" : queue === "past" ? "과거 솔랭" : "자유랭 보조" }];
    }
    if (parseTierScore(p.soloTier) === null) return [];
    return [{ tier: p.soloTier, date, precision: 1.8 * Math.pow(0.5, age / 180), source: "수집 솔랭 · 업로드일 기준" }];
  }));
  // 최신 조회 묶음 안에서 솔랭 > 과거 솔랭 > 자유랭을 적용한다. 시즌 초기화 뒤 옛 현재 티어가 부활하지 않게 한다.
  entries.sort((a, b) => b.date - a.date);
  return entries[0] || { tier: undefined, source: "티어 미확인", precision: 0.5 };
}

/** 티어 사전정보 + 상대 포지션 대비 작은 기여도 보정 + 팀 승패의 정규화 로지스틱 추정. */
export function estimateRatings(group: Group, options: {
  asOf?: number; allowManual?: boolean; config?: RatingConfig;
} = {}): RatingEstimate[] {
  const asOf = options.asOf ?? Date.now();
  const config = options.config ?? DEFAULT_RATING_CONFIG;
  const matches = group.matches.filter((m) => validRatingMatch(m) && Date.parse(m.createdAt) < asOf);
  const names = [...new Set([...group.members.map((m) => m.nickname), ...matches.flatMap((m) => m.players.map((p) => p.nickname))])].sort();
  const indices = new Map(names.map((name, i) => [name, i]));
  const counts = names.map(() => 0);
  const contribution = names.map(() => 0);
  const mass = names.map(() => 0);
  const rows = matches.map((match) => {
    const age = Math.max(0, (asOf - Date.parse(match.createdAt)) / DAY);
    const weight = Math.pow(0.5, age / config.halfLifeDays);
    const x = names.map(() => 0);
    for (const p of match.players) {
      const index = indices.get(p.nickname)!;
      x[index] = p.team === "blue" ? 1 : -1;
      counts[index]++;
      const opponents = match.players.filter((q) => q.team !== p.team && q.lane === p.lane);
      const teammates = match.players.filter((q) => q.team === p.team && q.lane === p.lane);
      if (p.lane && opponents.length === 1 && teammates.length === 1) {
        const value = performance(p, opponents[0]);
        if (value !== null) { contribution[index] += value * weight; mass[index] += weight; }
      }
    }
    return { x, weight, y: Number(match.players.find((p) => p.team === "blue")!.win) };
  });
  const evidence = names.map((name) => tierEvidence(group, name, asOf, options.allowManual ?? true));
  const baselines = evidence.map((entry) => parseTierScore(entry.tier) ?? 5);
  // 종료 지표만으로 캐리의 인과관계를 알 수 없어 최대 0.5점으로 제한한다.
  const performanceDeltas = mass.map((weight, i) => weight ? 0.5 * contribution[i] / (weight + 12) : 0);
  const centers = baselines.map((value, i) => value + performanceDeltas[i]);
  const precision = evidence.map((entry) => entry.precision * config.regularization);
  const ratings = [...centers];
  const curvature = rows.reduce((sum, row) => sum + row.weight * 10 * config.scale ** 2 / 4, 0) + Math.max(...precision, 1);
  for (let iteration = 0; iteration < 600; iteration++) {
    const gradient = ratings.map((value, i) => precision[i] * (value - centers[i]));
    for (const row of rows) {
      const diff = ratings.reduce((sum, value, i) => sum + row.x[i] * value, 0);
      const residual = row.weight * config.scale * (sigmoid(config.scale * diff) - row.y);
      for (let i = 0; i < names.length; i++) gradient[i] += residual * row.x[i];
    }
    let change = 0;
    for (let i = 0; i < names.length; i++) {
      const next = clamp(ratings[i] - gradient[i] / curvature, 1, 10);
      change = Math.max(change, Math.abs(next - ratings[i])); ratings[i] = next;
    }
    if (change < 0.000001) break;
  }
  return names.map((nickname, i) => ({
    nickname, score: ratings[i], baseline: baselines[i], performanceAdjustment: performanceDeltas[i],
    outcomeAdjustment: ratings[i] - centers[i], tier: evidence[i].tier, tierSource: evidence[i].source,
    games: counts[i], evidence: counts[i] >= 20 && evidence[i].tier ? "보통" : "낮음",
  }));
}

export function predictBlueWin(match: Match, estimates: RatingEstimate[], scale = DEFAULT_RATING_CONFIG.scale): number {
  const scores = new Map(estimates.map((entry) => [entry.nickname, entry.score]));
  const diff = match.players.reduce((sum, p) => sum + (p.team === "blue" ? 1 : -1) * (scores.get(p.nickname) ?? 5), 0);
  return sigmoid(scale * diff);
}
