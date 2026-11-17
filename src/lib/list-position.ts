"use client";

// 목록(메인 화면 탭)에서 상세로 갈 때 보던 위치를 기억했다가, 뒤로 돌아오면 그 탭·스크롤로 복원한다.
const KEY = "naejeon-list-position";
const MAX_AGE_MS = 60 * 60 * 1000; // 1시간이 지난 기록은 쓰지 않음

interface Saved {
  tab: string;
  y: number;
  at: number;
}

/** 상세 화면으로 이동하기 직전에 호출 */
export function rememberListPosition(tab: string) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ tab, y: window.scrollY, at: Date.now() } satisfies Saved));
  } catch {
    // 저장 못 해도 이동은 정상
  }
}

function read(): Saved | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as Saved;
    return Date.now() - saved.at < MAX_AGE_MS ? saved : null;
  } catch {
    return null;
  }
}

/** 목록에서 들어온 상세 화면인지 (그렇다면 "돌아가기"를 브라우저 뒤로가기로 처리) */
export function cameFromList(): boolean {
  return read() !== null;
}

/** 목록 화면에서: 같은 탭으로 돌아온 경우 저장해 둔 스크롤 위치를 꺼낸다 (한 번 쓰면 지움) */
export function takeListScroll(tab: string): number | null {
  const saved = read();
  if (!saved || saved.tab !== tab) return null;
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // 무시
  }
  return saved.y;
}

/**
 * 상세 화면의 "돌아가기". 목록에서 들어왔으면 뒤로가기(탭·스크롤 유지),
 * 링크로 바로 들어왔으면 매치 기록 탭으로 이동.
 */
export function backToList(router: { back: () => void; push: (href: string) => void }, fallbackTab = "matches") {
  if (cameFromList() && window.history.length > 1) router.back();
  else router.push(`/group/main?tab=${fallbackTab}`);
}
