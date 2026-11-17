"use client";

import { cn } from "@/lib/cn";
import { Card } from "@/components/ui/card";

// sticky 헤더에 쓰는 공통 클래스 (표 헤더 배경을 surface-1로 통일)
export const stickyHead = "sticky top-0 z-10 bg-surface-1";

/**
 * 통계 테이블 공통 셸: Card 프레임 + 가로/세로 스크롤 + (기본) 최대 높이.
 * thead에 `stickyHead`를 붙이면 스크롤 시 헤더가 상단에 고정된다.
 */
export function StatTable({
  children,
  maxHeight = "70vh",
  className,
}: {
  children: React.ReactNode;
  maxHeight?: string | false;
  className?: string;
}) {
  return (
    <Card className={cn("overflow-hidden p-0", className)}>
      <div className="overflow-auto" style={maxHeight ? { maxHeight } : undefined}>
        <table className="w-full text-sm">{children}</table>
      </div>
    </Card>
  );
}
