import { describe, it, expect } from "vitest";
import { estimateRatings, predictBlueWin, validRatingMatch } from "./rating-model";
import type { Group, PlayerStat } from "./types";

function fixture(): Group {
  const players = Array.from({ length: 10 }, (_, i) => ({
    nickname: `p${i}`, team: i < 5 ? "blue" : "red", win: i < 5,
    gold: 10000, cs: 100, deaths: 3, damageDealt: 10000, visionScore: 20,
    lane: ["top", "jungle", "mid", "adc", "support"][i % 5],
  } as PlayerStat));
  return { id: "test", name: "test", createdAt: "", inviteCode: "", members: [], matches: [
    { id: "m1", groupId: "test", createdAt: "2026-01-01T00:00:00Z", gameDuration: "30:00", players },
  ] };
}
describe("context rating", () => {
  it("승자는 대칭적으로 상승하며 패자는 하락한다", () => {
    const group = fixture();
    const ratings = estimateRatings(group, { asOf: Date.parse("2026-01-02") });
    expect(ratings.find((r) => r.nickname === "p0")!.score).toBeGreaterThan(5);
    expect(ratings.find((r) => r.nickname === "p5")!.score).toBeLessThan(5);
    expect(ratings.reduce((s, r) => s + r.score, 0)).toBeCloseTo(50, 5);
    expect(predictBlueWin(group.matches[0], ratings)).toBeGreaterThan(0.5);
  });
  it("역사 검증에서 미래 조회 티어와 현재 수기 티어가 유출되지 않는다", () => {
    const g = fixture();
    g.members = [{ id: "p0", nickname: "p0", groupId: "test", joinedAt: "", tier: "챌린저" }];
    g.matches[0].uploadedAt = "2026-02-01T00:00:00Z";
    g.matches[0].players[0].soloTier = "챌린저";
    const r = estimateRatings(g, { asOf: Date.parse("2026-01-02"), allowManual: false });
    expect(r.find((p) => p.nickname === "p0")!.baseline).toBe(5);
  });
  it("현재 솔랭은 과거 솔랭과 자유랭보다 우선한다", () => {
    const g = fixture();
    g.matches[0].players[0].rankObservedAt = "2026-01-01T00:00:00Z";
    g.matches[0].players[0].rankSnapshot = { soloTier: "실버 2", previousSoloTier: "다이아 1", flexTier: "마스터" };
    const r = estimateRatings(g, { asOf: Date.parse("2026-01-02") });
    expect(r.find((p) => p.nickname === "p0")!.baseline).toBe(3.5);
  });
  it("빈 전적·전적 제외·불완전 팀을 처리한다", () => {
    const g = fixture();
    g.matches[0].players.pop();
    expect(validRatingMatch(g.matches[0])).toBe(false);
    expect(estimateRatings(g)).toEqual([]);
  });
  it("미수집 지표를 실제 0으로 평가하지 않는다", () => {
    const g = fixture();
    for (const p of g.matches[0].players) { p.noDamage = true; p.noVision = true; }
    g.matches[0].players[0].damageDealt = 0;
    g.matches[0].players[0].visionScore = 0;
    expect(estimateRatings(g).find((r) => r.nickname === "p0")!.performanceAdjustment).toBe(0);
  });
});
