"use client";

// 기록 수정 요청은 전부 /api/admin 으로 보낸다. 관리자 비밀번호는 이 탭의 sessionStorage 에만 둔다.
const KEY = "naejeon-admin-password";

export class AdminCancelledError extends Error {
  constructor() {
    super("관리자 인증이 취소되었습니다");
  }
}

export function getAdminPassword(): string | null {
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}
export function setAdminPassword(pw: string | null) {
  try {
    if (pw) sessionStorage.setItem(KEY, pw);
    else sessionStorage.removeItem(KEY);
  } catch {
    // sessionStorage 를 쓸 수 없으면 매번 물어본다
  }
  window.dispatchEvent(new Event("naejeon-admin-change"));
}
export function isAdmin(): boolean {
  return Boolean(getAdminPassword());
}

// 로그인 모달(AdminLoginHost)과의 연결 고리
type Prompt = (message?: string) => Promise<string | null>;
let prompter: Prompt | null = null;
export function registerAdminPrompt(p: Prompt | null) {
  prompter = p;
}

async function call(password: string, action: string, payload: object) {
  const res = await fetch("/api/admin", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-admin-password": password },
    body: JSON.stringify({ action, ...payload }),
  });
  let data: Record<string, unknown> = {};
  try {
    data = await res.json();
  } catch {
    // 본문 없음
  }
  return { res, data };
}

/** 비밀번호가 맞는지 서버에 확인 */
export async function verifyAdminPassword(password: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const { res, data } = await call(password, "verify", {});
    if (res.ok) return { ok: true };
    return { ok: false, error: res.status === 401 ? "비밀번호가 올바르지 않습니다" : String(data.error || `서버 오류 (${res.status})`) };
  } catch {
    return { ok: false, error: "서버에 연결할 수 없습니다" };
  }
}

/** 관리자 권한이 필요한 작업 호출. 로그인돼 있지 않으면 비밀번호 입력 창을 띄운다. */
export async function adminFetch<T = Record<string, unknown>>(action: string, payload: object = {}): Promise<T> {
  let password = getAdminPassword();
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!password) {
      if (!prompter) throw new Error("관리자 로그인 창을 열 수 없습니다");
      password = await prompter(attempt > 0 ? "저장된 비밀번호가 더 이상 맞지 않습니다. 다시 입력해 주세요." : undefined);
      if (!password) throw new AdminCancelledError();
    }
    const { res, data } = await call(password, action, payload);
    if (res.status === 401) {
      setAdminPassword(null);
      password = null;
      continue;
    }
    if (!res.ok) throw new Error(String(data.error || `요청 실패 (${res.status})`));
    return data as T;
  }
  throw new AdminCancelledError();
}
