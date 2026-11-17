"use client";

import { useEffect } from "react";
import { markEntryPath } from "@/lib/list-position";

/** 이 탭에서 처음 연 화면을 기억해, "돌아가기"가 뒤로가기를 써도 되는지 판단하게 한다 */
export function EntryTracker() {
  useEffect(() => {
    markEntryPath();
  }, []);
  return null;
}
