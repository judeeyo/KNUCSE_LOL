import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let _supabase: SupabaseClient | null = null;

/**
 * Supabase 주소. 보통은 https://xxxx.supabase.co 그대로 쓴다.
 * 미리보기 모드(로컬 가짜 DB)에서는 "/_db" 같은 상대 경로를 넣는데, 이때 브라우저는 현재 사이트 주소를 통해
 * (next.config 의 rewrite 프록시) 접속하고 서버는 PREVIEW_DB_PROXY 로 직접 접속한다.
 */
export function resolveSupabaseUrl(): string | undefined {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url || !url.startsWith("/")) return url;
  if (typeof window !== "undefined") return window.location.origin + url;
  return process.env.PREVIEW_DB_PROXY;
}

/** 읽기 전용 클라이언트 (anon key). RLS 로 SELECT 만 허용되므로 브라우저에 노출돼도 기록을 바꿀 수 없다. */
export function getSupabase(): SupabaseClient {
  if (_supabase) return _supabase;

  const url = resolveSupabaseUrl();
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error("Supabase 환경변수(NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY)가 설정되지 않았습니다.");
  }

  _supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return _supabase;
}
