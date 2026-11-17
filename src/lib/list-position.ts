"use client";

// 목록 화면(메인 탭, 선수 페이지 등)에서 다른 화면으로 갈 때 보던 위치를 기억했다가, 돌아오면 복원한다.
// 화면마다 따로 기억하므로 "리더보드 → 선수 페이지 → 경기 상세"처럼 여러 단계를 들어갔다 나와도 각자 위치로 돌아온다.
const POSITIONS_KEY = "naejeon-list-positions";
const ENTRY_KEY = "naejeon-entry-path";
const MAX_AGE_MS = 60 * 60 * 1000; // 1시간이 지난 기록은 쓰지 않음

type Positions = Record<string, { y: number; at: number }>;

function readPositions(): Positions {
  try {
    const all = JSON.parse(sessionStorage.getItem(POSITIONS_KEY) || "{}") as Positions;
    const now = Date.now();
    return Object.fromEntries(Object.entries(all).filter(([, v]) => now - v.at < MAX_AGE_MS));
  } catch {
    return {};
  }
}

function writePositions(p: Positions) {
  try {
    sessionStorage.setItem(POSITIONS_KEY, JSON.stringify(p));
  } catch {
    // 저장 못 해도 이동은 정상
  }
}

/** 다른 화면으로 이동하기 직전에 호출. key = 지금 화면 이름 (예: "matches", "player:닉네임") */
export function rememberListPosition(key: string) {
  writePositions({ ...readPositions(), [key]: { y: window.scrollY, at: Date.now() } });
}

/** 목록 화면에서: 이 화면으로 돌아온 경우 저장해 둔 스크롤 위치를 꺼낸다 (한 번 쓰면 지움) */
export function takeListScroll(key: string): number | null {
  const all = readPositions();
  const saved = all[key];
  if (!saved) return null;
  delete all[key];
  writePositions(all);
  return saved.y;
}

const currentPath = () => window.location.pathname + window.location.search;

/** 이 탭에서 처음 연 화면을 기록 (레이아웃에서 한 번 호출) */
export function markEntryPath() {
  try {
    if (!sessionStorage.getItem(ENTRY_KEY)) sessionStorage.setItem(ENTRY_KEY, currentPath());
  } catch {
    // 무시
  }
}

/** 사이트 안에서 이동해 들어온 화면인지 (링크로 바로 열었거나 새 탭이면 false) */
function navigatedWithinSite(): boolean {
  if (window.history.length <= 1) return false;
  try {
    const entry = sessionStorage.getItem(ENTRY_KEY);
    return Boolean(entry) && entry !== currentPath();
  } catch {
    return false;
  }
}

/**
 * "돌아가기" 버튼. 사이트 안에서 들어왔으면 브라우저 뒤로가기(이전 화면의 탭·스크롤 유지),
 * 링크로 바로 들어왔으면 메인 화면의 해당 탭으로 이동.
 */
export function backToList(router: { back: () => void; push: (href: string) => void }, fallbackTab = "matches") {
  if (navigatedWithinSite()) router.back();
  else router.push(`/group/main?tab=${fallbackTab}`);
}
