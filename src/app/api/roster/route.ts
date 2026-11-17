import { NextResponse } from "next/server";
import { readRoster } from "@/lib/server/public-read";

export const dynamic = "force-dynamic";

// 수집기용 멤버 명단 (닉네임·부캐·계정 ID). 사이트에 이미 공개된 정보만 돌려준다.
export async function GET() {
  const roster = await readRoster();
  if (!roster) return NextResponse.json({ error: "명단을 읽지 못했습니다" }, { status: 503 });
  return NextResponse.json(roster, { headers: { "Cache-Control": "public, s-maxage=300" } });
}
