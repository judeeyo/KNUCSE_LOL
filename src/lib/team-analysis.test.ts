import { describe, expect, it } from "vitest";
import { analyzeTeams, buildHistoryIndex, suggestPairs } from "./team-analysis";
import type { BalancerPlayer } from "./stats";
import type { Lane, Match } from "./types";

const LANES: Lane[] = ["top", "jungle", "mid", "adc", "support"];
const mk = (name: string, score: number, lane: Lane, extra: Partial<BalancerPlayer> = {}): BalancerPlayer => ({
  nickname: name, score, gamesPlayed: 20, winRate: 50, avgKda: 3, assignedLane: lane, preferredLanes: [lane], ...extra,
});
const team = (prefix: string, scores: number[]) => scores.map((s, i) => mk(`${prefix}${i}`, s, LANES[i]));

function match(blue: string[], red: string[], blueWin: boolean, id: string): Match {
  return {
    id, groupId: "main", createdAt: "2026-11-01T00:00:00Z", gameDuration: "30:00",
    players: [
      ...blue.map((n, i) => ({ nickname: n, team: "blue", win: blueWin, lane: LANES[i] })),
      ...red.map((n, i) => ({ nickname: n, team: "red", win: !blueWin, lane: LANES[i] })),
    ] as unknown as Match["players"],
  };
}

const empty = buildHistoryIndex([]);

describe("우세/열세 판정", () => {
  it("점수가 같으면 박빙", () => {
    const a = analyzeTeams(team("b", [5, 5, 5, 5, 5]), team("r", [5, 5, 5, 5, 5]), empty);
    expect(a.verdict).toBe("even");
    expect(a.favored).toBeNull();
    expect(a.blueWinProb).toBeCloseTo(0.5);
  });

  it("점수 합이 높은 팀이 우세, 이유에 점수 차이가 나온다", () => {
    const a = analyzeTeams(team("b", [5, 5, 5, 5, 5]), team("r", [6, 5, 5, 5, 5.5]), empty);
    expect(a.favored).toBe("red");
    expect(a.blueWinProb).toBeLessThan(0.5);
    expect(a.reasons[0].text).toContain("레드팀 점수 합이 1.5점 높음");
  });

  it("예상 승률은 25~75% 로 제한", () => {
    const a = analyzeTeams(team("b", [10, 10, 10, 10, 10]), team("r", [1, 1, 1, 1, 1]), empty);
    expect(a.blueWinProb).toBe(0.75);
    expect(a.label).toBe("블루팀 우세");
  });

  it("비선호 라인이 많은 팀은 불리", () => {
    const blue = team("b", [5, 5, 5, 5, 5]);
    blue[0] = { ...blue[0], preferredLanes: ["mid"] };
    blue[1] = { ...blue[1], preferredLanes: ["adc"] };
    const a = analyzeTeams(blue, team("r", [5, 5, 5, 5, 5]), empty);
    expect(a.blueWinProb).toBeLessThan(0.5);
    expect(a.reasons.some((r) => r.favors === "red" && r.text.includes("비선호 라인"))).toBe(true);
  });

  it("함께 자주 이긴 팀원과 맞라인 상대 전적을 반영", () => {
    const blue = team("b", [5, 5, 5, 5, 5]);
    const red = team("r", [5, 5, 5, 5, 5]);
    const names = (t: BalancerPlayer[]) => t.map((p) => p.nickname);
    const history = buildHistoryIndex([1, 2, 3, 4].map((i) => match(names(blue), names(red), true, `m${i}`)));
    const a = analyzeTeams(blue, red, history);
    expect(a.favored).toBe("blue");
    expect(a.reasons).toHaveLength(3);
    expect(a.reasons.every((r) => r.favors === "blue")).toBe(true);
  });

  it("판수가 적은 선수를 따로 알려 준다", () => {
    const blue = team("b", [5, 5, 5, 5, 5]);
    blue[2] = { ...blue[2], gamesPlayed: 2 };
    expect(analyzeTeams(blue, team("r", [5, 5, 5, 5, 5]), empty).lowSample).toEqual(["b2"]);
  });
});

describe("점수순 자동 짝", () => {
  it("점수 순 이웃끼리 묶는다", () => {
    const players = [3, 9, 5, 7, 1, 8, 2, 6, 4, 10].map((s) => mk(`p${s}`, s, "mid"));
    expect(suggestPairs(players)).toEqual([["p10", "p9"], ["p8", "p7"], ["p6", "p5"], ["p4", "p3"], ["p2", "p1"]]);
  });
});
