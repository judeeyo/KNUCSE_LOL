import { NextRequest, NextResponse } from "next/server";
import { checkAdmin } from "@/lib/server/auth";
import { getServiceClient, ServerConfigError } from "@/lib/server/supabase-admin";
import * as ops from "@/lib/server/admin-ops";
import { ingestMatches } from "@/lib/server/ingest";
import { parseImportPayload, parseImportText, type ParseResult } from "@/lib/import-parse";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// 기록 수정 전용 API. 모든 요청에 x-admin-password 헤더(ADMIN_PASSWORD)가 필요하다.
export async function POST(req: NextRequest) {
  const auth = checkAdmin(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "요청 본문이 JSON 이 아닙니다" }, { status: 400 });
  }
  const action = String(body.action || "");

  try {
    if (action === "verify") return NextResponse.json({ ok: true });
    const sb = getServiceClient();
    const str = (k: string) => String(body[k] ?? "");

    switch (action) {
      case "addMatch":
        return NextResponse.json(await ops.addMatch(sb, body as never));
      case "updateMatch":
        await ops.updateMatch(sb, body as never);
        return NextResponse.json({ ok: true });
      case "deleteMatch":
        await ops.deleteMatch(sb, str("matchId"));
        return NextResponse.json({ ok: true });
      case "updateMemberProfile":
        await ops.updateMemberProfile(sb, str("nickname"), (body.updates as never) || {});
        return NextResponse.json({ ok: true });
      case "mergeAliases":
        return NextResponse.json({ renamed: await ops.mergeAliases(sb, str("mainNickname"), str("aliasNickname")) });
      case "renameMember":
        await ops.renameMember(sb, str("oldNickname"), str("newNickname"));
        return NextResponse.json({ ok: true });
      case "deleteMember":
        await ops.deleteMember(sb, str("nickname"));
        return NextResponse.json({ ok: true });
      case "export":
        return NextResponse.json(await ops.exportAll(sb));
      case "import": {
        // files: [{name, text, lastModified}] — 브라우저에서 읽은 파일 내용 그대로
        const merged: ParseResult = { matches: [], members: [], errors: [] };
        const files = Array.isArray(body.files) ? (body.files as Array<Record<string, unknown>>) : [];
        for (const f of files) {
          const lm = Number(f.lastModified);
          const r = parseImportText(
            String(f.text ?? ""),
            String(f.name ?? ""),
            Number.isFinite(lm) && lm > 0 ? new Date(lm).toISOString() : undefined
          );
          merged.matches.push(...r.matches);
          merged.members.push(...r.members);
          merged.errors.push(...r.errors);
        }
        if (body.payload !== undefined) {
          const r = parseImportPayload(body.payload);
          merged.matches.push(...r.matches);
          merged.members.push(...r.members);
          merged.errors.push(...r.errors);
        }
        const report = await ingestMatches(sb, merged.matches, { dryRun: body.dryRun !== false, members: merged.members });
        return NextResponse.json({ ...report, parseErrors: merged.errors });
      }
      case "listPending":
        return NextResponse.json(await ops.listPending(sb));
      case "resolvePending": {
        const decision = str("decision");
        if (decision !== "merge" && decision !== "keep" && decision !== "discard") {
          return NextResponse.json({ error: "decision 값이 올바르지 않습니다" }, { status: 400 });
        }
        await ops.resolvePending(sb, str("id"), decision);
        return NextResponse.json({ ok: true });
      }
      default:
        return NextResponse.json({ error: `알 수 없는 action: ${action}` }, { status: 400 });
    }
  } catch (err) {
    const status = err instanceof ServerConfigError ? 503 : 500;
    console.error(`admin ${action} error:`, err);
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status });
  }
}
