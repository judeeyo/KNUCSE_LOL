import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let _supabase: SupabaseClient | null = null;

/** 읽기 전용 클라이언트 (anon key). RLS 로 SELECT 만 허용되므로 브라우저에 노출돼도 기록을 바꿀 수 없다. */
export function getSupabase(): SupabaseClient {
  if (_supabase) return _supabase;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error("Supabase 환경변수(NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY)가 설정되지 않았습니다.");
  }

  _supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return _supabase;
}
