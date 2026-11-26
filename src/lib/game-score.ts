import type { Lane, Match, PlayerStat } from "./types";

/**
 * 경기 점수 (0~10) 와 MVP·ACE — 2026-11-26 재설계 (score-v2)
 *
 * 왜 바꿨나
 * - 이전 점수는 "맞라인 상대보다 얼마나 나았나" 위주였다. 51분 경기에서 사이온 1/3/11 이
 *   CS·받은 피해·시야로 말파이트를 조금씩 앞서 5.8점, 같은 팀 아펠리오스 16/5/6 (팀 딜 40%)은
 *   상대 원딜도 잘해서 5.7점 → 사이온 MVP. 경기 영향력이 점수에 거의 안 들어갔다.
 * - 진 팀 서포터 ACE 쏠림을 고치려고 넣은 "라인별 z 점수로 MVP 고르기" 때문에
 *   화면 점수 1등과 MVP 가 다른 경기가 생겼다 (8.2점 신짜오 대신 7.4점 카이사가 MVP).
 *
 * 참고한 원칙 (계산식은 비공개라 원칙만 차용)
 * - OP.GG OP Score: 0~10점, KDA·CS·골드 등 경기 기록 기반, 이긴 팀 최고점 MVP / 진 팀 최고점 ACE
 *   https://help.op.gg/hc/en-us/articles/31088715328665-OP-Score-explained
 * - LOL.PS PS 점수: 라인전(~15분)은 따로 측정, 중후반은 승패와 직결된 기여를 크게 반영
 *   https://lol.ps/datastudio/guide
 *
 * 계산
 * 1. 지표는 경기 길이·팀 상황에 덜 흔들리는 "팀 안 비중"과 "분당" 값으로 잰다.
 *    킬관여, 팀 딜 비중, 팀 골드 비중, 팀 데스 비중(낮을수록 좋음), KLA, 분당 CS, 분당 시야,
 *    팀 오브젝트 피해 비중, 팀 회복·보호막 비중
 * 2. 각 지표를 "같은 역할의 평균" (ROLE_BASELINE, 우리 내전 63경기에서 계산) 대비 배율로 바꾸고
 *    log2 로 대칭화 (평균 = 0, 2배 = +1, 절반 = -1, ±2 에서 자름)
 * 3. 역할별 가중치 (ROLE_WEIGHTS) 로 가중 평균. 없는 지표(수기 기록의 딜·시야 등)는 빼고 나머지로 다시 맞춘다.
 * 4. 점수 = 5 + 2.5 × 가중 평균 + (승 +0.5 / 패 -0.5) + 라인전 보정(10·15분 기록이 양쪽에 있을 때 최대 ±0.5)
 * 5. MVP = 이긴 팀 최고점, ACE = 진 팀 최고점. 역할 차이는 2번에서 이미 보정하므로 추가 보정 없음 → 화면 점수 1등이 곧 MVP.
 */

export const SCORE_VERSION = "score-v2";

type MetricKey = "kp" | "kla" | "death" | "gold" | "dmg" | "csm" | "vision" | "obj" | "util";

/** 역할별 평균 (2026-11-26, 집계 63경기 / 상세 35경기). 경기가 많이 쌓이면 scripts 없이 같은 방식으로 다시 계산해 갱신 */
export const ROLE_BASELINE: Record<Lane, Record<MetricKey, number>> = {
  top:     { kp: 0.374, kla: 2.52, death: 0.177, gold: 0.187, dmg: 0.231, csm: 6.85, vision: 0.98, obj: 0.165, util: 0.232 },
  jungle:  { kp: 0.629, kla: 3.61, death: 0.208, gold: 0.214, dmg: 0.191, csm: 6.36, vision: 1.26, obj: 0.433, util: 0.340 },
  mid:     { kp: 0.522, kla: 3.06, death: 0.193, gold: 0.201, dmg: 0.229, csm: 7.28, vision: 0.92, obj: 0.136, util: 0.134 },
  adc:     { kp: 0.580, kla: 3.31, death: 0.210, gold: 0.251, dmg: 0.260, csm: 8.22, vision: 0.84, obj: 0.229, util: 0.144 },
  support: { kp: 0.630, kla: 3.84, death: 0.212, gold: 0.146, dmg: 0.090, csm: 1.04, vision: 2.90, obj: 0.037, util: 0.149 },
};
const NEUTRAL_BASELINE: Record<MetricKey, number> = { kp: 0.55, kla: 3.27, death: 0.2, gold: 0.2, dmg: 0.2, csm: 6, vision: 1.4, obj: 0.2, util: 0.2 };

/** 역할별 가중치 (각 합 1). 영향력(킬관여·딜·골드)과 생존(데스·KLA)을 중심으로, 역할 고유 지표를 조금씩 */
export const ROLE_WEIGHTS: Record<Lane, Partial<Record<MetricKey, number>>> = {
  top:     { kla: 0.15, kp: 0.15, dmg: 0.20, gold: 0.15, death: 0.15, csm: 0.10, obj: 0.10 },
  jungle:  { kla: 0.15, kp: 0.25, dmg: 0.10, gold: 0.10, death: 0.15, obj: 0.20, vision: 0.05 },
  mid:     { kla: 0.15, kp: 0.15, dmg: 0.25, gold: 0.15, death: 0.15, csm: 0.10, vision: 0.05 },
  adc:     { kla: 0.15, kp: 0.15, dmg: 0.25, gold: 0.15, death: 0.15, csm: 0.15 },
  support: { kla: 0.15, kp: 0.25, death: 0.15, vision: 0.25, util: 0.10, gold: 0.05, dmg: 0.05 },
};
const NEUTRAL_WEIGHTS: Partial<Record<MetricKey, number>> = { kla: 0.2, kp: 0.2, dmg: 0.2, gold: 0.15, death: 0.15, csm: 0.1 };

const SCALE = 2.5;

const RESULT_BONUS = 0.5;
const LANE_PHASE_MAX = 0.5;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const log2Ratio = (value: number, base: number) => clamp(Math.log2(Math.max(value, 1e-6) / base), -2, 2);

export function matchMinutes(match: Pick<Match, "gameDuration">): number {
  const [mm, ss] = (match.gameDuration || "").split(":").map(Number);
  return mm > 0 ? mm + (ss || 0) / 60 : 0;
}

export interface ScoreBreakdown {
  metrics: Partial<Record<MetricKey, number>>; // 역할 평균 대비 log2 배율
  perf: number; // 가중 평균 (역할 표준화 전)
  laneAdj: number;
  result: number;
}

/** 한 경기 선수 10명의 점수 계산. missing 은 수기 기록처럼 수집되지 않은 지표 */
export function scorePlayers(players: PlayerStat[], minutes: number, missing?: Match["missing"]): (PlayerStat & { breakdown: ScoreBreakdown })[] {
  const team = (t: PlayerStat["team"]) => players.filter((p) => p.team === t);
  const sums = Object.fromEntries((["blue", "red"] as const).map((t) => {
    const tp = team(t);
    const s = (f: (p: PlayerStat) => number) => tp.reduce((acc, p) => acc + f(p), 0);
    return [t, {
      kills: s((p) => p.kills), deaths: s((p) => p.deaths), gold: s((p) => p.gold),
      dmg: s((p) => p.damageDealt || 0), obj: s((p) => p.objectiveDamage || 0),
      util: s((p) => (p.healingDone || 0) + (p.shieldingDone || 0)),
    }];
  })) as Record<PlayerStat["team"], { kills: number; deaths: number; gold: number; dmg: number; obj: number; util: number }>;

  return players.map((p) => {
    const base = (p.lane && ROLE_BASELINE[p.lane]) || NEUTRAL_BASELINE;
    const weights = (p.lane && ROLE_WEIGHTS[p.lane]) || NEUTRAL_WEIGHTS;
    const t = sums[p.team];
    const values: Partial<Record<MetricKey, number>> = {};
    if (t.kills > 0) values.kp = log2Ratio((p.kills + p.assists) / t.kills, base.kp);
    values.kla = log2Ratio((p.kills + p.assists) / (1 + p.deaths), base.kla);
    // 데스 비중은 낮을수록 좋음: (평균+0.05)/(내 비중+0.05). 팀이 한 번도 안 죽었으면 중립
    if (t.deaths > 0) values.death = clamp(Math.log2((base.death + 0.05) / (p.deaths / t.deaths + 0.05)), -2, 2);
    if (t.gold > 0 && p.gold > 0) values.gold = log2Ratio(p.gold / t.gold, base.gold);
    if (!missing?.damage && !p.noDamage && t.dmg > 0) values.dmg = log2Ratio((p.damageDealt || 0) / t.dmg, base.dmg);
    if (minutes > 0) values.csm = log2Ratio(p.cs / minutes, base.csm);
    if (minutes > 0 && !missing?.vision && !p.noVision && p.visionScore > 0) values.vision = log2Ratio(p.visionScore / minutes, base.vision);
    if (t.obj > 0) values.obj = log2Ratio((p.objectiveDamage || 0) / t.obj, base.obj);
    if (t.util > 0) values.util = log2Ratio(((p.healingDone || 0) + (p.shieldingDone || 0)) / t.util, base.util);

    let sum = 0, wsum = 0;
    for (const [k, w] of Object.entries(weights) as [MetricKey, number][]) {
      const v = values[k];
      if (v === undefined || !Number.isFinite(v)) continue;
      sum += w * v;
      wsum += w;
    }
    const perf = wsum > 0 ? sum / wsum : 0;

    // 라인전: 양쪽 모두 같은 시점(15분, 없으면 10분) 기록이 있을 때 골드·경험치 격차
    let laneAdj = 0;
    const opp = p.lane ? players.find((q) => q.team !== p.team && q.lane === p.lane) : undefined;
    const minute = p.phaseStats?.["15"] && opp?.phaseStats?.["15"] ? "15" : "10";
    const a = p.phaseStats?.[minute], b = opp?.phaseStats?.[minute];
    if (a && b && a.gold + b.gold > 0) {
      const gold = (a.gold - b.gold) / ((a.gold + b.gold) / 2);
      const xp = a.xp + b.xp > 0 ? (a.xp - b.xp) / ((a.xp + b.xp) / 2) : 0;
      laneAdj = clamp(((gold + xp) / 2) * 2.5, -LANE_PHASE_MAX, LANE_PHASE_MAX);
    }

    const result = p.win ? RESULT_BONUS : -RESULT_BONUS;
    const score = clamp(5 + SCALE * perf + result + laneAdj, 0, 10);
    const killParticipation = t.kills > 0 ? ((p.kills + p.assists) / t.kills) * 100 : 0;
    return { ...p, killParticipation, mvpScore: Math.round(score * 10) / 10, breakdown: { metrics: values, laneAdj, result, perf } };
  });
}

/** 점수 다시 계산 + MVP(이긴 팀 최고점)·ACE(진 팀 최고점) */
export function rescoreMatch(match: Match): Match {
  const scored = scorePlayers(match.players, matchMinutes(match), match.missing);
  const best = (win: boolean) => {
    const pool = scored.filter((p) => p.win === win);
    return pool.length ? pool.reduce((x, y) => (y.mvpScore > x.mvpScore || (y.mvpScore === x.mvpScore && y.kills + y.assists > x.kills + x.assists) ? y : x)) : null;
  };
  const mvp = best(true), ace = best(false);
  return {
    ...match,
    players: scored.map((s) => {
      const { breakdown, ...p } = s;
      void breakdown;
      return { ...p, isMvp: s === mvp, isAce: s === ace };
    }),
  };
}
