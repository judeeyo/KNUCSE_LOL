"use client";

import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

/** DB 조회 실패 화면. "기록이 0건"인 빈 상태와 구분해서 보여 주고 다시 시도할 수 있게 한다. */
export function LoadError({
  message,
  onRetry,
  retrying,
  compact,
}: {
  message: string;
  onRetry: () => void;
  retrying?: boolean;
  compact?: boolean;
}) {
  const body = (
    <>
      <div className="flex items-start gap-2.5 min-w-0">
        <AlertTriangle size={compact ? 16 : 20} className="text-lose shrink-0 mt-0.5" />
        <div className="min-w-0">
          <p className={`font-semibold text-ink ${compact ? "text-sm" : "text-base"}`}>
            {compact ? "최신 기록을 불러오지 못했습니다" : "기록을 불러오지 못했습니다"}
          </p>
          <p className="text-xs text-ink-subtle mt-1 break-words">
            {compact
              ? "아래는 이전에 불러온 내용입니다. "
              : "기록이 없는 것이 아니라 데이터베이스 조회에 실패한 상태입니다. "}
            잠시 후 다시 시도해 주세요.
          </p>
          <p className="text-[11px] text-ink-tertiary mt-1 break-all font-mono">{message}</p>
        </div>
      </div>
      <Button size="sm" variant="secondary" onClick={onRetry} disabled={retrying} className="shrink-0">
        <RefreshCw size={13} className={retrying ? "animate-spin" : ""} />
        {retrying ? "다시 시도 중..." : "다시 시도"}
      </Button>
    </>
  );

  if (compact) {
    return (
      <div role="alert" className="mb-4 rounded-lg border border-lose/30 bg-lose/5 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
        {body}
      </div>
    );
  }
  return (
    <div className="flex items-center justify-center min-h-[60vh] px-4">
      <div role="alert" className="w-full max-w-md rounded-xl border border-lose/30 bg-lose/5 p-5 flex flex-col gap-4">
        {body}
      </div>
    </div>
  );
}
