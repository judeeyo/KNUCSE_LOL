import { describe, expect, it } from "vitest";
import { buildFeatured, buildRivalries, findRivalry, josa, rivalryHref } from "./rivalry";
import type { Group, Lane, Match } from "./types";

const LANES: Lane[] = ["top", "jungle", "mid", "adc", "support"];
let seq = 0;
/** blue/red 각 5명, 같은 위치 = 같은 라인. champs 로 탑 챔피언 지정 */
function match(blue: string[], red: string[], blueWin: boolean, opts: { day?: number; champs?: [string, string]; source?: Match["source"] } = {}): Match {
  const id = `m${++seq}`;
  const mk = (n: string, i: number, team: "blue" | "red") => ({
    id: `${id}-${team}-${i}`, matchId: id, nickname: n, team, lane: LANES[i], win: team === "blue" ? blueWin : !blueWin,
    champion: i === 0 && opts.champs ? opts.champs[team === "blue" ? 0 : 1] : `챔${i}`,
    kills: team === "blue" ? 5 : 2, deaths: team === "blue" ? 2 : 6, assists: 3, cs: team === "blue" ? 200 : 150, gold: 10000,
    damageDealt: 1, damageTaken: 1, visionScore: 1, wardsPlaced: 0, wardsDestroyed: 0, objectiveDamage: 0, ccScore: 0,
    healingDone: 0, shieldingDone: 0, killParticipation: 0, mvpScore: 5, isMvp: false, isAce: false,
  });
  return {
    id, groupId: "main", createdAt: new Date(Date.UTC(2026, 10, opts.day ?? seq)).toISOString(), gameDuration: "25:00",
    source: opts.source ?? "history",
    players: [...blue.map((n, i) => mk(n, i, "blue")), ...red.map((n, i) => mk(n, i, "red"))],
  } as unknown as Match;
}
const group = (matches: Match[]) => ({ id: "main", name: "main", inviteCode: "", createdAt: "", members: [], matches }) as Group;
const blueTeam = (top: string) => [top, "j1", "m1", "a1", "s1"];
const redTeam = (top: string) => [top, "j2", "m2", "a2", "s2"];

describe("라이벌 (같은 라인 맞대결)", () => {
  it("같은 라인 상대만 세고, 3판 미만은 목록에서 뺀다", () => {
    const g = group([
      match(blueTeam("A"), redTeam("B"), true),
      match(blueTeam("A"), redTeam("B"), false),
      match(blueTeam("B"), redTeam("A"), true), // 진영이 바뀌어도 같은 쌍
      match(blueTeam("A"), redTeam("C"), true),
    ]);
    const rs = buildRivalries(g, Date.UTC(2026, 11, 1));
    const ab = rs.find((r) => r.key === "A|B")!;
    expect(ab.games).toHaveLength(3);
    expect(ab.a.nickname).toBe("A");
    expect(ab.a.wins).toBe(1);
    expect(ab.b.wins).toBe(2);
    expect(rs.some((r) => r.key === "A|C")).toBe(false); // 1판
    // 같은 팀 다른 라인(j1 vs m2 등)은 라이벌이 아님
    expect(rs.some((r) => r.key.includes("j1") && r.key.includes("m2"))).toBe(false);
  });

  it("연승·복수전·숙명의 라이벌 칭호", () => {
    const ms = [true, false, true, false, true, true, true, false].map((w) => match(blueTeam("A"), redTeam("B"), !w)); // B 기준
    const r = findRivalry(group(ms), "B", "A", Date.UTC(2026, 11, 1))!;
    // 마지막 판 B 패 → B 복수전, 이전 3연승은 끊김
    expect(r.titles.find((t) => t.kind === "revenge")!.text).toContain("B의 복수전");
    expect(r.titles.some((t) => t.kind === "destined")).toBe(false); // B 5승 3패 = 62.5%
    expect(r.streak).toEqual({ side: "a", count: 1 });
  });

  it("상대가 특정 챔피언을 잡으면 전패한 기록을 팁으로", () => {
    const ms = [
      match(blueTeam("A"), redTeam("B"), false, { champs: ["가렌", "사이온"] }),
      match(blueTeam("A"), redTeam("B"), false, { champs: ["다리우스", "사이온"] }),
      match(blueTeam("A"), redTeam("B"), true, { champs: ["가렌", "오른"] }),
    ];
    const r = findRivalry(group(ms), "A", "B")!;
    expect(r.a.tips.some((t) => t.includes("사이온을 잡으면 2전 전패"))).toBe(true);
    expect(r.b.tips.some((t) => t.includes("사이온으로는 2전 전승"))).toBe(true);
  });

  it("특집 묶음: 셋의 쌍별 기록과 순위", () => {
    const ms = [
      match(blueTeam("뽀스탈게요"), redTeam("우효원"), false),
      match(blueTeam("뽀스탈게요"), redTeam("DoYouKnowIMO"), true),
      match(blueTeam("우효원"), redTeam("DoYouKnowIMO"), true),
    ];
    const f = buildFeatured(group(ms), { title: "탑 삼국지", subtitle: "", lane: "top", players: ["뽀스탈게요", "DoYouKnowIMO", "우효원", "없는사람"] });
    expect(f.pairs).toHaveLength(3);
    expect(f.standings.map((s) => s.nickname)).toEqual(["우효원", "뽀스탈게요", "DoYouKnowIMO"]);
  });

  it("주소는 이름 순서와 상관없이 하나", () => {
    expect(rivalryHref("우효원", "뽀스탈게요")).toBe(rivalryHref("뽀스탈게요", "우효원"));
  });

  it("조사", () => {
    expect(josa("우효원", "이", "가")).toBe("우효원이");
    expect(josa("뽀스탈게요", "이", "가")).toBe("뽀스탈게요가");
    expect(josa("사이온", "으로", "로")).toBe("사이온으로");
    expect(josa("럼블", "으로", "로")).toBe("럼블로");
    expect(josa("IMO", "이", "가")).toBe("IMO이(가)");
  });
});
