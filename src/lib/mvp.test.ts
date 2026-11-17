import { describe, it, expect } from "vitest";
import { applyRoleRelativeAwards } from "./mvp";
import type { Lane, Match, PlayerStat } from "./types";

let seq = 0;
const LANES: Lane[] = ["top", "jungle", "mid", "adc", "support"];
/** 진 팀 서포터 점수가 늘 높게 나오는 경기 (실제 데이터에서 관찰된 치우침) */
function game(loserScores: number[], winnerScores = [6, 6.5, 6.2, 6.1, 6]): Match {
  const mk = (team: "blue" | "red", win: boolean, scores: number[]): PlayerStat[] =>
    scores.map((s, i) => ({
      id: `p${seq++}`, matchId: "", nickname: `${team}-${LANES[i]}`, champion: "아리", lane: LANES[i], team, win,
      kills: 1, deaths: 1, assists: 1, cs: 100, gold: 1000, damageDealt: 1000, damageTaken: 1000, visionScore: 10,
      wardsPlaced: 0, wardsDestroyed: 0, objectiveDamage: 0, ccScore: 0, healingDone: 0, shieldingDone: 0,
      killParticipation: 0, mvpScore: s, isMvp: false, isAce: false,
    }));
  return { id: `m${seq++}`, groupId: "g", createdAt: "2026-01-01T00:00:00Z", gameDuration: "30:00", players: [...mk("blue", true, winnerScores), ...mk("red", false, loserScores)] };
}

describe("MVP·ACE 를 라인 평균 대비로", () => {
  // 평소: 진 팀 서폿 4.5 전후, 다른 라인 3.5 전후
  const history = Array.from({ length: 12 }, (_, i) => game([3.4 + (i % 3) * 0.1, 3.6, 3.5, 3.5, 4.4 + (i % 3) * 0.1]));
  it("서포터가 평소보다 못했으면, 점수 숫자가 가장 높아도 ACE 가 아니다", () => {
    const target = game([4.0, 3.2, 3.3, 3.4, 4.2]); // 서폿 4.2 (평소 4.5보다 낮음), 탑 4.0 (평소 3.5보다 높음)
    const [out] = applyRoleRelativeAwards([target], [...history, target]);
    const ace = out.players.find((p) => p.isAce)!;
    expect(ace.lane).toBe("top");
    expect(out.players.find((p) => p.lane === "support" && !p.win)!.mvpScore).toBe(4.2); // 점수 숫자는 그대로
  });
  it("팀마다 MVP·ACE 는 정확히 한 명씩", () => {
    const out = applyRoleRelativeAwards(history);
    for (const m of out) {
      expect(m.players.filter((p) => p.isMvp && p.win)).toHaveLength(1);
      expect(m.players.filter((p) => p.isAce && !p.win)).toHaveLength(1);
      expect(m.players.filter((p) => p.isMvp || p.isAce)).toHaveLength(2);
    }
  });
  it("비교할 경기가 적으면 점수 순서 그대로", () => {
    const one = game([3.0, 3.1, 3.9, 3.2, 3.3]);
    const [out] = applyRoleRelativeAwards([one], [one]);
    expect(out.players.find((p) => p.isAce)!.lane).toBe("mid");
  });
});
