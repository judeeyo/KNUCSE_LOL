import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let _supabase: SupabaseClient | null = null;

/**
 * Supabase 주소. 보통은 https://xxxx.supabase.co 그대로 쓴다.
 * 미리보기 모드(로컬 가짜 DB)에서는 "/_db" 같은 상대 경로를 넣는데, 이때 브라우저는 현재 사이트 주소를 통해
 * (next.config 의 rewrite 프록시) 접속하고 서버는 PREVIEW_DB_PROXY 로 직접 접속한다.
 */
export function resolveSupabaseUrl(): string | undefined {
  const url = normalizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
  if (!url || !url.startsWith("/")) return url;
  if (typeof window !== "undefined") return window.location.origin + url;
  return process.env.PREVIEW_DB_PROXY;
}

/**
 * 환경변수에 흔히 잘못 넣는 형태를 프로젝트 주소(https://<ref>.supabase.co)로 바로잡는다.
 *  - 앞뒤 공백·따옴표, 끝의 슬래시
 *  - Data API 화면의 REST 주소: https://<ref>.supabase.co/rest/v1/
 *  - 대시보드 주소: https://supabase.com/dashboard/project/<ref>/...
 *  - 프로젝트 ID 만 넣은 경우: <ref>
 * 그 밖의 주소(셀프 호스팅 등)는 경로만 정리하고 그대로 둔다.
 */
export function normalizeSupabaseUrl(raw: string | undefined): string | undefined {
  if (!raw) return raw;
  let url = raw.trim().replace(/^["']|["']$/g, "").trim();
  if (!url) return undefined;
  if (url.startsWith("/")) return url.replace(/\/+$/, ""); // 미리보기 모드의 상대 경로
  const dashboard = url.match(/supabase\.com\/dashboard\/project\/([a-z0-9]{10,})/i);
  if (dashboard) return `https://${dashboard[1].toLowerCase()}.supabase.co`;
  if (/^[a-z0-9]{15,30}$/i.test(url)) return `https://${url.toLowerCase()}.supabase.co`;
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  try {
    const u = new URL(url);
    // *.supabase.co 는 항상 루트가 프로젝트 주소. 그 외에는 끝의 /rest/v1 등 API 경로만 떼어 낸다
    if (/\.supabase\.(co|in)$/i.test(u.hostname)) return `${u.protocol}//${u.host}`;
    const path = u.pathname.replace(/\/+$/, "").replace(/\/(rest|auth|storage)\/v1$/i, "");
    return `${u.protocol}//${u.host}${path}`;
  } catch {
    return url;
  }
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
