import { describe, expect, it } from "vitest";
import { balancePairedTeams, type BalancerPlayer } from "./stats";

const players: BalancerPlayer[] = Array.from({ length: 10 }, (_, i) => ({
  nickname: `선수${i}`, score: [9, 8, 7, 6, 5, 4, 3, 2, 1, 0.5][i],
  gamesPlayed: 20, winRate: 50, avgKda: 3,
}));
const pairs: Array<[string, string]> = Array.from({ length: 5 }, (_, i) => [players[i * 2].nickname, players[i * 2 + 1].nickname]);

describe("밸런스 짝 편성", () => {
  it("5쌍을 상대 팀으로 나누고 거울상 중복 없는 16개를 반환한다", () => {
    const results = balancePairedTeams(players, pairs);
    expect(results).toHaveLength(16);
    const keys = results.map((r) => r.team1.map((p) => p.nickname).sort().join(","));
    expect(new Set(keys).size).toBe(16);
    for (const result of results) {
      expect(result.team1).toHaveLength(5);
      expect(result.team2).toHaveLength(5);
      for (const [a, b] of pairs) {
        const team = new Set(result.team1.map((p) => p.nickname));
        expect(team.has(a)).not.toBe(team.has(b));
      }
      expect(new Set(result.team1.map((p) => p.assignedLane)).size).toBe(5);
    }
  });
  it("모든 좌우 조합 중 최소 점수 차이를 먼저 추천한다", () => {
    const differences = Array.from({ length: 32 }, (_, mask) => {
      const score = pairs.reduce((sum, [a, b], i) => {
        const first = players.find((p) => p.nickname === a)!.score;
        const second = players.find((p) => p.nickname === b)!.score;
        return sum + ((mask & (1 << i)) ? first - second : second - first);
      }, 0);
      return Math.abs(score);
    });
    const results = balancePairedTeams(players, pairs);
    expect(results[0].diff).toBe(Math.min(...differences));
    expect(results.map((r) => r.diff)).toEqual(results.map((r) => r.diff).sort((a, b) => a - b));
    for (let i = 1; i < results.length; i++) {
      if (results[i].diff === results[i - 1].diff) expect(results[i].laneFit).toBeLessThanOrEqual(results[i - 1].laneFit);
    }
  });
  it("미완성, 중복, 참가자 외 선수, 10명 미만은 편성하지 않는다", () => {
    expect(balancePairedTeams(players, pairs.slice(0, 4))).toEqual([]);
    expect(balancePairedTeams(players, [...pairs.slice(0, 4), pairs[0]])).toEqual([]);
    expect(balancePairedTeams(players, [...pairs.slice(0, 4), ["외부", players[9].nickname]])).toEqual([]);
    expect(balancePairedTeams(players.slice(0, 8), pairs)).toEqual([]);
  });
  it("최근 팀 제외 옵션을 적용하고 가능한 결과가 없으면 빈 배열을 반환한다", () => {
    const results = balancePairedTeams(players, pairs);
    const avoid = results.map((r) => r.team1.map((p) => p.nickname));
    expect(balancePairedTeams(players, pairs, avoid)).toEqual([]);
  });
});
