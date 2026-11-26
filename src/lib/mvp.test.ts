import { describe, it, expect } from "vitest";
import { applyRoleRelativeAwards, calculateMvpScores } from "./mvp";
import type { Lane, Match, PlayerStat } from "./types";

const LANES: Lane[] = ["top", "jungle", "mid", "adc", "support"];
type Line = [string, number, number, number, number, number, number, number]; // 챔피언, K, D, A, CS, 골드, 딜, 시야
function team(t: "blue" | "red", win: boolean, lines: Line[]): PlayerStat[] {
  return lines.map(([champion, kills, deaths, assists, cs, gold, damageDealt, visionScore], i) => ({
    id: `${t}${i}`, matchId: "m", nickname: `${t}-${LANES[i]}`, champion, lane: LANES[i], team: t, win,
    kills, deaths, assists, cs, gold, damageDealt, damageTaken: 20000, visionScore,
    wardsPlaced: 0, wardsDestroyed: 0, objectiveDamage: 5000, ccScore: 0, healingDone: 0, shieldingDone: 0,
    killParticipation: 0, mvpScore: 0, isMvp: false, isAce: false,
  }));
}
// 실제 11/25 51분 경기 기록 (닉네임만 역할 이름으로)
const BLUE_WIN: Line[] = [
  ["사이온", 1, 3, 11, 328, 15000, 21478, 60],
  ["자르반 4세", 4, 3, 21, 329, 16500, 22117, 92],
  ["아리", 7, 7, 7, 404, 20000, 41008, 85],
  ["아펠리오스", 16, 5, 6, 405, 25000, 69255, 43],
  ["세라핀", 1, 9, 21, 41, 11000, 17092, 175],
];
const RED_LOSE: Line[] = [
  ["말파이트", 1, 6, 10, 255, 14000, 24059, 56],
  ["킨드레드", 8, 12, 15, 353, 19000, 57144, 70],
  ["갈리오", 3, 5, 13, 339, 17000, 19154, 52],
  ["유나라", 13, 4, 7, 403, 23000, 70799, 34],
  ["룰루", 2, 2, 20, 51, 10000, 15097, 180],
];
const game = (duration = "51:01", scale = 1): Match => ({
  id: "m", groupId: "g", createdAt: "2026-11-25T13:17:00Z", gameDuration: duration,
  players: [...team("blue", true, BLUE_WIN), ...team("red", false, RED_LOSE)].map((p) => ({
    ...p, cs: p.cs * scale, gold: p.gold * scale, damageDealt: p.damageDealt * scale, visionScore: p.visionScore * scale,
  })),
});

describe("경기 점수 score-v2", () => {
  it("1/3/11 탱커보다 16킬·팀 딜 40% 원딜이 MVP (사이온 MVP 문제)", () => {
    const [m] = applyRoleRelativeAwards([game()]);
    const mvp = m.players.find((p) => p.isMvp)!;
    expect(mvp.champion).toBe("아펠리오스");
    const sion = m.players.find((p) => p.champion === "사이온")!;
    expect(sion.mvpScore).toBeLessThan(mvp.mvpScore);
  });

  it("MVP·ACE 는 각 팀 점수 1등 (화면 점수와 항상 일치), 한 명씩", () => {
    const [m] = applyRoleRelativeAwards([game()]);
    for (const win of [true, false]) {
      const pool = m.players.filter((p) => p.win === win);
      const top = Math.max(...pool.map((p) => p.mvpScore));
      const awarded = pool.filter((p) => (win ? p.isMvp : p.isAce));
      expect(awarded).toHaveLength(1);
      expect(awarded[0].mvpScore).toBe(top);
    }
  });

  it("경기 길이에 덜 흔들림: 시간과 누적 기록이 같은 비율로 늘면 점수가 같다", () => {
    const a = applyRoleRelativeAwards([game("30:00", 1)])[0];
    const b = applyRoleRelativeAwards([game("60:00", 2)])[0];
    a.players.forEach((p, i) => expect(b.players[i].mvpScore).toBeCloseTo(p.mvpScore, 1));
  });

  it("딜·시야가 없는 수기 기록도 남은 지표로 점수를 낸다", () => {
    const players = game().players.map((p) => ({ ...p, damageDealt: 0, visionScore: 0 }));
    const scored = calculateMvpScores(players, 51, { damage: true, vision: true, damageTaken: false });
    expect(scored.every((p) => p.mvpScore >= 0 && p.mvpScore <= 10)).toBe(true);
    expect(scored.filter((p) => p.isMvp)).toHaveLength(1);
  });

  it("같은 기록이면 이긴 쪽 점수가 높다 (승 +0.5 / 패 -0.5)", () => {
    const mirror: Match = { ...game(), players: [...team("blue", true, BLUE_WIN), ...team("red", false, BLUE_WIN)] };
    const [m] = applyRoleRelativeAwards([mirror]);
    for (let i = 0; i < 5; i++) expect(m.players[i].mvpScore - m.players[i + 5].mvpScore).toBeCloseTo(1, 1);
  });
});
