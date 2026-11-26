import type { Match, PlayerStat } from "./types";
import { rescoreMatch, scorePlayers } from "./game-score";

/**
 * 경기 점수(0~10)·MVP·ACE. 계산식은 game-score.ts (score-v2, 2026-11-26).
 * MVP = 이긴 팀 최고점, ACE = 진 팀 최고점 (OP.GG 와 같은 기준). 역할 차이는 점수 안에서
 * "같은 역할 평균 대비"로 보정하므로, 화면에 보이는 점수 1등이 그대로 MVP·ACE 가 된다.
 */
export function calculateMvpScores(players: PlayerStat[], minutes = 0, missing?: Match["missing"]): PlayerStat[] {
  if (players.length === 0) return players;
  const scored = scorePlayers(players, minutes, missing);
  const best = (win: boolean) => {
    const pool = scored.filter((p) => p.win === win);
    return pool.length ? pool.reduce((x, y) => (y.mvpScore > x.mvpScore || (y.mvpScore === x.mvpScore && y.kills + y.assists > x.kills + x.assists) ? y : x)) : null;
  };
  const mvp = best(true), ace = best(false);
  return scored.map((s) => {
    const { breakdown, ...p } = s;
    void breakdown;
    return { ...p, isMvp: s === mvp, isAce: s === ace };
  });
}

/**
 * (이전 이름 유지) 경기 시간까지 넣어 점수·MVP·ACE 를 다시 계산한다.
 * 예전에는 "같은 라인·같은 승패 평균 대비 z 점수"로 MVP 를 따로 골랐지만, 화면 점수 1등과 MVP 가
 * 달라지는 경기가 63경기 중 14경기 생겨 score-v2 에서 없앴다. baselineFrom 은 더 이상 쓰지 않는다.
 */
export function applyRoleRelativeAwards(matches: Match[], baselineFrom?: Match[]): Match[] {
  void baselineFrom;
  return matches.map(rescoreMatch);
}
