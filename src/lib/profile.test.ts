import { describe, it, expect } from "vitest";
import { buildPlayerProfile, bestAndWorst, resolveNickname, playerHref } from "./profile";
import type { Group, Match, PlayerStat } from "./types";

let seq = 0;
const p = (nickname: string, team: "blue" | "red", win: boolean, lane: PlayerStat["lane"], damage = 1000): PlayerStat => ({
  id: `p${seq++}`, matchId: "", nickname, champion: "아리", team, win, lane,
  kills: 1, deaths: 1, assists: 1, cs: 100, gold: 1000, damageDealt: damage, damageTaken: 0, visionScore: 0,
  wardsPlaced: 0, wardsDestroyed: 0, objectiveDamage: 0, ccScore: 0, healingDone: 0, shieldingDone: 0,
  killParticipation: 0, mvpScore: 5, isMvp: false, isAce: false,
});
const m = (date: string, players: PlayerStat[]): Match => ({ id: `m${seq++}`, groupId: "g", createdAt: date, gameDuration: "30:00", players });
const g = (matches: Match[]): Group => ({
  id: "g", name: "g", inviteCode: "", createdAt: "", matches,
  members: [{ id: "a", nickname: "a", groupId: "g", joinedAt: "", aliases: ["옛a"] }],
});

const group = g([
  m("2026-01-01T00:00:00Z", [p("a", "blue", true, "mid", 3000), p("b", "blue", true, "top", 1000), p("c", "red", false, "mid"), p("d", "red", false, "top")]),
  m("2026-01-02T00:00:00Z", [p("a", "red", false, "mid"), p("c", "red", false, "top"), p("b", "blue", true, "mid"), p("d", "blue", true, "top")]),
  m("2026-01-03T00:00:00Z", [p("a", "blue", true, "mid"), p("b", "blue", true, "top"), p("c", "red", false, "mid"), p("d", "red", false, "top")]),
]);

describe("선수 프로필", () => {
  const prof = buildPlayerProfile(group, "a")!;
  it("최근 경기부터, 누적 승률 추이는 오래된 경기부터", () => {
    expect(prof.games.map((x) => x.match.createdAt.slice(0, 10))).toEqual(["2026-01-03", "2026-01-02", "2026-01-01"]);
    expect(prof.trend.map((t) => Math.round(t.winRate))).toEqual([100, 50, 67]);
  });
  it("팀원·상대·맞라인 전적", () => {
    expect(prof.teammates.find((r) => r.nickname === "b")).toMatchObject({ games: 2, wins: 2 });
    expect(prof.teammates.find((r) => r.nickname === "c")).toMatchObject({ games: 1, wins: 0 });
    expect(prof.opponents.find((r) => r.nickname === "d")).toMatchObject({ games: 3, wins: 2 });
    expect(prof.laneOpponents.find((r) => r.nickname === "c")).toMatchObject({ games: 2, wins: 2 });
    expect(prof.laneOpponents.find((r) => r.nickname === "b")).toMatchObject({ games: 1, wins: 0 });
  });
  it("팀 내 딜 비중", () => {
    expect(prof.games[2].damageShare).toBe(75);
  });
  it("기록 없는 선수는 null, 부캐 이름은 본캐로", () => {
    expect(buildPlayerProfile(group, "zzz")).toBeNull();
    expect(resolveNickname(group, "옛a")).toBe("a");
    expect(resolveNickname(group, "b")).toBe("b");
  });
  it("잘 맞는 / 안 맞는 상대 (최소 판수 이상만)", () => {
    const { best, worst } = bestAndWorst(prof.opponents, 2, 1);
    expect(best[0].nickname).toBe("c"); // c 를 상대로 2전 2승 (100%)
    expect(worst.every((r) => r.games >= 2)).toBe(true);
  });
  it("주소는 한글·공백 닉네임도 안전하게", () => {
    expect(playerHref("얘들아 그거 맞냐")).toBe("/group/main/player/%EC%96%98%EB%93%A4%EC%95%84%20%EA%B7%B8%EA%B1%B0%20%EB%A7%9E%EB%83%90");
  });
});
