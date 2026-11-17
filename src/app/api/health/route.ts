import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { resolveSupabaseUrl } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// 배포 점검용. 비밀값·키 일부·선수 정보는 노출하지 않고 "설정 여부"와 건수만 알려준다.
export async function GET() {
  const url = resolveSupabaseUrl();
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const env = {
    NEXT_PUBLIC_SUPABASE_URL: Boolean(url),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: Boolean(anon),
    SUPABASE_SERVICE_ROLE_KEY: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    ADMIN_PASSWORD: (process.env.ADMIN_PASSWORD || "").length >= 8,
    UPLOAD_SECRET: (process.env.UPLOAD_SECRET || "").length >= 8,
  };
  if (!url || !anon) {
    return NextResponse.json({ ok: false, env, db: "환경변수 미설정" }, { status: 503 });
  }
  // 어느 Supabase 주소로 붙는지 (프로젝트 주소는 공개값이라 표시해도 된다. 키는 표시하지 않음)
  let supabaseHost = "";
  try {
    supabaseHost = new URL(url).host;
  } catch {
    supabaseHost = "(주소 형식 오류)";
  }
  try {
    const sb = createClient(url, anon, { auth: { persistSession: false } });
    // HEAD 요청은 오류 본문이 없어 실패가 0건으로 보일 수 있으므로 GET 으로 센다
    const base = () => sb.from("matches").select("id", { count: "exact" }).limit(1);
    const [live, legacy, pending] = await Promise.all([
      base().is("review_status", null),
      base().eq("source", "legacy-import"),
      base().eq("review_status", "duplicate_candidate"),
    ]);
    const failed = [live, legacy, pending].find((r) => r.error || r.count === null);
    if (failed) throw new Error(failed.error?.message || `경기 수를 읽지 못했습니다 (HTTP ${failed.status})`);

    // anon key 로 쓰기가 막혀 있는지 실제로 확인한다. players 가 없는(=NOT NULL 위반) 행을 넣어 보므로
    // 어떤 경우에도 데이터는 생기지 않는다. 권한/RLS 오류(42501)면 정상, 다른 오류면 쓰기가 열려 있는 것.
    const probe = await sb.from("matches").insert({ id: "__healthcheck__" });
    const anonWriteBlocked = probe.error?.code === "42501";

    const ok = Object.values(env).every(Boolean) && anonWriteBlocked;
    return NextResponse.json({
      ok,
      env,
      supabaseHost,
      db: "연결됨",
      matches: live.count ?? 0,
      legacy28: legacy.count ?? 0,
      pendingReview: pending.count ?? 0,
      anonWriteBlocked,
      ...(anonWriteBlocked
        ? {}
        : { anonWriteProbe: probe.error ? `${probe.error.code ?? ""} ${probe.error.message}`.trim() : "오류 없음" }),
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, env, supabaseHost, db: "조회 실패", error: err instanceof Error ? err.message : String(err) },
      { status: 503 }
    );
  }
}
