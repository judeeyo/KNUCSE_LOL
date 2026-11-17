import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { resolveSupabaseUrl } from "@/lib/supabase";

export class ServerConfigError extends Error {}

let client: SupabaseClient | null = null;

/** 쓰기 권한이 있는 서버 전용 클라이언트 (service_role). 브라우저 번들에 절대 포함되지 않는다. */
export function getServiceClient(): SupabaseClient {
  if (client) return client;
  const url = resolveSupabaseUrl();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new ServerConfigError(
      "서버 환경변수가 설정되지 않았습니다: " +
        [!url && "NEXT_PUBLIC_SUPABASE_URL", !key && "SUPABASE_SERVICE_ROLE_KEY"].filter(Boolean).join(", ")
    );
  }
  client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return client;
}
