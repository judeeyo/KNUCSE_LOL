import { NextRequest, NextResponse } from "next/server";
import { checkUploader } from "@/lib/server/auth";
import { getServiceClient, ServerConfigError } from "@/lib/server/supabase-admin";
import { ingestMatches } from "@/lib/server/ingest";
import { parseImportPayload } from "@/lib/import-parse";

export const dynamic = "force-dynamic";

// 수집기 업로드 전용 API. Authorization: Bearer <UPLOAD_SECRET>
// 이 토큰으로는 경기 "추가/같은 gameId 갱신"만 가능하고 수정·삭제·선수 정보 변경은 할 수 없다.
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "요청 본문이 JSON 이 아닙니다" }, { status: 400 });
  }

  const auth = checkUploader(req, body.secret);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  // 토큰 확인만 하는 요청 (수집기 설정 화면의 "연결 확인")
  if (body.ping === true) return NextResponse.json({ ok: true });

  const match = body.match as Record<string, unknown> | undefined;
  if (!match || !Array.isArray(match.players) || match.players.length === 0) {
    return NextResponse.json({ error: "Invalid match data" }, { status: 400 });
  }

  try {
    const source = body.source === "history" ? "history" : "collector";
    const parsed = parseImportPayload(match, source);
    if (parsed.matches.length !== 1) {
      return NextResponse.json({ error: "경기 형식을 읽을 수 없습니다", detail: parsed.errors }, { status: 400 });
    }
    const inc = parsed.matches[0];
    // 수집기 업로드는 항상 "새 자료"로 취급 (같은 gameId 면 갱신)
    inc.restore = false;
    inc.id = undefined;
    if (!inc.createdAt) inc.createdAt = new Date().toISOString();

    const report = await ingestMatches(getServiceClient(), [inc], { dryRun: false });
    const item = report.items[0];
    if (item.status === "invalid") {
      return NextResponse.json({ error: `경기 데이터 불완전: ${item.reason}` }, { status: 400 });
    }
    return NextResponse.json({
      success: true,
      status: item.status,
      matchId: item.matchId ?? item.existingId,
      updated: item.status === "updated",
      duplicate: item.status === "skipped",
      pendingReview: item.status === "candidate",
      players: inc.players.length,
      duration: inc.gameDuration,
    });
  } catch (err) {
    console.error("Upload error:", err);
    const status = err instanceof ServerConfigError ? 503 : 500;
    return NextResponse.json(
      { error: "Upload failed", detail: err instanceof Error ? err.message : String(err) },
      { status }
    );
  }
}
