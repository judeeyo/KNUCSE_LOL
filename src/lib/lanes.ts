import type { Lane, PlayerStat } from "./types";

const LANE_ORDER: Lane[] = ["top", "jungle", "mid", "adc", "support"];

/** 팀 내 순서(로비 순서) 기반 라인 배정: 탑→정글→미드→원딜→서폿.
 * 라이엇 매치 데이터의 포지션 추정은 커스텀 게임에서 부정확하므로
 * (서포터 판별 불가 등) 로비 순서를 신뢰한다.
 * 이미 5개 라인이 정확히 한 번씩 지정된 팀(수동 등록·수동 교정)은 그대로 둔다. */
export function assignLanesByOrder(players: PlayerStat[]): PlayerStat[] {
  const result = players.map((p) => ({ ...p }));
  for (const team of ["blue", "red"] as const) {
    const teamPlayers = result.filter((p) => p.team === team);
    if (teamPlayers.length !== 5) continue;
    const lanes = new Set(teamPlayers.map((p) => p.lane));
    if (LANE_ORDER.every((l) => lanes.has(l))) continue;
    teamPlayers.forEach((p, i) => {
      p.lane = LANE_ORDER[i];
    });
  }
  return result;
}
