import "server-only";
import { createHash, timingSafeEqual } from "crypto";
import type { NextRequest } from "next/server";

function safeEqual(a: string, b: string): boolean {
  // 길이가 달라도 일정 시간에 비교되도록 해시 후 비교
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

export type AuthResult = { ok: true } | { ok: false; status: 401 | 503; error: string };

function check(provided: string | null, expected: string | undefined, envName: string): AuthResult {
  // 비밀값이 설정되지 않았으면 "누구나 통과"가 아니라 "아무도 못 씀"
  if (!expected || expected.length < 8) {
    return { ok: false, status: 503, error: `서버에 ${envName} 환경변수가 설정되지 않았습니다 (8자 이상)` };
  }
  if (!provided || !safeEqual(provided, expected)) {
    return { ok: false, status: 401, error: "인증 실패" };
  }
  return { ok: true };
}

/** 기록 수정(웹 관리 기능) 권한: ADMIN_PASSWORD */
export function checkAdmin(req: NextRequest): AuthResult {
  return check(req.headers.get("x-admin-password"), process.env.ADMIN_PASSWORD, "ADMIN_PASSWORD");
}

/** 수집기 업로드 권한: UPLOAD_SECRET (기록 추가만 가능, 수정·삭제 불가) */
export function checkUploader(req: NextRequest, bodySecret?: unknown): AuthResult {
  const header = req.headers.get("authorization");
  const bearer = header?.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : null;
  const provided = bearer || (typeof bodySecret === "string" ? bodySecret : null);
  return check(provided, process.env.UPLOAD_SECRET, "UPLOAD_SECRET");
}
