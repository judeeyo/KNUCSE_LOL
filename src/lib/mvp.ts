import type { PlayerStat, Lane } from "./types";

/**
 * 매치 내 기여도 점수 (0~10)
 *
 * 리서치 반영 (op.gg OP Score, DEEPLOL AI-Score, PandaSkill 논문):
 * - 게임 참가자 10명 전체 대비 평가 (팀 대비 X — 진 팀 혼자 잘한 선수 과대평가 방지)
 * - 포지션별 가중치: 서포터는 CS로, 정글은 라인 CS로 평가하지 않음.
 *   op.gg·PandaSkill 모두 역할(role)별로 다른 기준을 적용
 * - KDA 대신 KLA = (킬+어시스트)/(1+데스) — 0데스 특별처리 없이 수치 안정적 (PandaSkill)
 * - 라인전 보정: 같은 포지션 상대와의 골드 차이를 소폭 반영 (딥롤 GD@15 개념의 종료시점 근사)
 * - 각 지표는 "게임 평균 대비 배율"(1.0=평균, 2.5 캡) → 5.0이 평균, 10.0이 상한
 * - MVP = 이긴 팀 최고점, ACE = 진 팀 최고점 (op.gg 기준과 동일)
 */

type Weights = {
  dmg: number; tank: number; obj: number; vision: number; cs: number;
  cc: number; util: number; kla: number; kp: number;
};

// 포지션별 가중치 (각 합계 1.0)
const ROLE_WEIGHTS: Record<Lane, Weights> = {
  top:     { dmg: 0.20, tank: 0.20, obj: 0.10, vision: 0.05, cs: 0.15, cc: 0,    util: 0,    kla: 0.20, kp: 0.10 },
  jungle:  { dmg: 0.10, tank: 0.10, obj: 0.20, vision: 0.10, cs: 0.05, cc: 0,    util: 0,    kla: 0.20, kp: 0.25 },
  mid:     { dmg: 0.30, tank: 0.10, obj: 0.05, vision: 0.05, cs: 0.15, cc: 0,    util: 0,    kla: 0.20, kp: 0.15 },
  adc:     { dmg: 0.30, tank: 0.05, obj: 0.10, vision: 0.05, cs: 0.20, cc: 0,    util: 0,    kla: 0.20, kp: 0.10 },
  support: { dmg: 0,    tank: 0.10, obj: 0.05, vision: 0.25, cs: 0,    cc: 0.10, util: 0.10, kla: 0.15, kp: 0.25 },
};

// 라인 정보가 없을 때의 역할 중립 가중치
const DEFAULT_WEIGHTS: Weights = {
  dmg: 0.25, tank: 0.10, obj: 0.10, vision: 0.10, cs: 0.10, cc: 0, util: 0, kla: 0.20, kp: 0.15,
};

export function calculateMvpScores(players: PlayerStat[]): PlayerStat[] {
  if (players.length === 0) return players;

  const count = players.length;
  const utilOf = (p: PlayerStat) => (p.healingDone || 0) + (p.shieldingDone || 0);

  // 게임 전체(10명) 합계
  const total = {
    damage: players.reduce((s, p) => s + (p.damageDealt || 0), 0),
    damageTaken: players.reduce((s, p) => s + (p.damageTaken || 0), 0),
    objectiveDamage: players.reduce((s, p) => s + (p.objectiveDamage || 0), 0),
    vision: players.reduce((s, p) => s + (p.visionScore || 0), 0),
    cs: players.reduce((s, p) => s + (p.cs || 0), 0),
    cc: players.reduce((s, p) => s + (p.ccScore || 0), 0),
    util: players.reduce((s, p) => s + utilOf(p), 0),
  };

  const teamKills = {
    blue: players.filter((p) => p.team === "blue").reduce((s, p) => s + p.kills, 0),
    red: players.filter((p) => p.team === "red").reduce((s, p) => s + p.kills, 0),
  };

  const klaOf = (p: PlayerStat) => (p.kills + p.assists) / (1 + p.deaths);
  const kpOf = (p: PlayerStat) => {
    const tk = teamKills[p.team];
    return tk > 0 ? (p.kills + p.assists) / tk : 0;
  };

  const avgKla = players.reduce((s, p) => s + klaOf(p), 0) / count || 1;
  const avgKp = players.reduce((s, p) => s + kpOf(p), 0) / count || 1;

  // 게임 평균 대비 배율 (1.0 = 평균, 2.5 캡 — 한 지표 몰빵 방지, 합계 0이면 중립)
  const CAP = 2.5;
  const shareRatio = (value: number, totalSum: number) =>
    totalSum > 0 ? Math.min((value / totalSum) * count, CAP) : 1;

  // 같은 포지션 상대 (라인전 맞대결 비교용)
  const laneOpponentOf = (p: PlayerStat) =>
    p.lane ? players.find((q) => q.team !== p.team && q.lane === p.lane) : undefined;

  // 역할 고유 지표는 같은 포지션 상대와 1:1 비교 (1.0 = 동률, 최대 2.0).
  // 게임 전체 대비로 재면 서포터 시야·유틸처럼 역할 편중 지표가 매판 자동 상한을 쳐서
  // 변별력이 사라짐 — PandaSkill의 역할별 모델 분리와 같은 취지. 상대가 없으면 전체 대비 폴백.
  const pairRatio = (mine: number, opp: number | undefined, fallbackTotal: number) => {
    if (opp === undefined) return shareRatio(mine, fallbackTotal);
    const sum = mine + opp;
    return sum > 0 ? (mine / sum) * 2 : 1;
  };

  const rawScored = players.map((p) => {
    const w = (p.lane && ROLE_WEIGHTS[p.lane]) || DEFAULT_WEIGHTS;
    const opp = laneOpponentOf(p);

    const composite =
      pairRatio(p.damageDealt || 0, opp && (opp.damageDealt || 0), total.damage) * w.dmg +
      pairRatio(p.damageTaken || 0, opp && (opp.damageTaken || 0), total.damageTaken) * w.tank +
      pairRatio(p.objectiveDamage || 0, opp && (opp.objectiveDamage || 0), total.objectiveDamage) * w.obj +
      pairRatio(p.visionScore || 0, opp && (opp.visionScore || 0), total.vision) * w.vision +
      pairRatio(p.cs || 0, opp && (opp.cs || 0), total.cs) * w.cs +
      pairRatio(p.ccScore || 0, opp && (opp.ccScore || 0), total.cc) * w.cc +
      pairRatio(utilOf(p), opp && utilOf(opp), total.util) * w.util +
      Math.min(klaOf(p) / avgKla, CAP) * w.kla +
      Math.min(kpOf(p) / avgKp, CAP) * w.kp;

    // 라인전 보정: 같은 포지션 상대와의 골드 격차 (최대 ±0.15 → 점수 ±0.75)
    const laneAdj = opp && opp.gold > 0
      ? Math.max(-0.15, Math.min(0.15, (p.gold - opp.gold) / opp.gold))
      : 0;

    return { p, composite: composite + laneAdj };
  });

  // 게임 평균이 정확히 5.0이 되도록 정규화 (역할별 가중치로 인한 전체 인플레 제거)
  const meanComposite =
    rawScored.reduce((s, r) => s + r.composite, 0) / count || 1;

  const scored = rawScored.map(({ p, composite }) => {
    const score = Math.min(Math.max((composite / meanComposite) * 5, 0), 10);
    return {
      ...p,
      mvpScore: Math.round(score * 10) / 10,
      killParticipation: kpOf(p) * 100,
    };
  });

  // MVP = 이긴 팀 최고점, ACE = 진 팀 최고점 (op.gg 기준과 동일)
  const winners = scored.filter((p) => p.win);
  const losers = scored.filter((p) => !p.win);

  const mvp = winners.length > 0
    ? winners.reduce((a, b) => (a.mvpScore > b.mvpScore ? a : b))
    : null;
  const ace = losers.length > 0
    ? losers.reduce((a, b) => (a.mvpScore > b.mvpScore ? a : b))
    : null;

  return scored.map((p) => ({
    ...p,
    isMvp: mvp ? p.nickname === mvp.nickname && p.team === mvp.team : false,
    isAce: ace ? p.nickname === ace.nickname && p.team === ace.team : false,
  }));
}
