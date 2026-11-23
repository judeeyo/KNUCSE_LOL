import { NextResponse } from "next/server";
import { readCountedMatches } from "@/lib/server/public-read";
import { RATING_VERSION, validRatingMatch } from "@/lib/rating-model";

export const dynamic = "force-dynamic";

// 후속 개선 작업을 위한 집계 상태. 선수 이름·계정 식별자·원본 경기 데이터는 포함하지 않는다.
export async function GET() {
  const matches = await readCountedMatches();
  if (!matches) return NextResponse.json({ ok: false, error: "경기 조회 실패" }, { status: 503 });
  const valid = matches.filter(validRatingMatch);
  const complete = valid.filter((m) => m.players.every((p) => p.phaseStats?.["10"]));
  return NextResponse.json({
    ok: true, version: RATING_VERSION, matches: valid.length,
    timeline10Matches: complete.length,
    timeline15Matches: valid.filter((m) => m.players.every((p) => p.phaseStats?.["15"])).length,
    timelineDays: new Set(complete.map((m) => new Date(Date.parse(m.createdAt) + 9 * 3600000).toISOString().slice(0, 10))).size,
    datedRankPlayers: new Set(valid.flatMap((m) => m.players.filter((p) => p.rankObservedAt).map((p) => p.nickname))).size,
    checkedAt: new Date().toISOString(),
  }, { headers: { "Cache-Control": "no-store" } });
}
