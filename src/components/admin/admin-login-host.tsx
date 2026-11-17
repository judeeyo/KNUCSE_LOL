"use client";

import { useEffect, useRef, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { registerAdminPrompt, setAdminPassword, verifyAdminPassword } from "@/lib/admin-client";

/**
 * 관리자 비밀번호 입력 창. 레이아웃에 한 번만 올려 두면
 * 기록을 수정하려는 순간(adminFetch) 자동으로 뜬다.
 */
export function AdminLoginHost() {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<string | undefined>();
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);
  const resolver = useRef<((pw: string | null) => void) | null>(null);

  useEffect(() => {
    registerAdminPrompt(
      (msg) =>
        new Promise<string | null>((resolve) => {
          resolver.current?.(null);
          resolver.current = resolve;
          setMessage(msg);
          setValue("");
          setError("");
          setOpen(true);
        })
    );
    return () => registerAdminPrompt(null);
  }, []);

  const finish = (pw: string | null) => {
    setOpen(false);
    resolver.current?.(pw);
    resolver.current = null;
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!value || checking) return;
    setChecking(true);
    const res = await verifyAdminPassword(value);
    setChecking(false);
    if (!res.ok) {
      setError(res.error || "확인 실패");
      return;
    }
    setAdminPassword(value);
    finish(value);
  };

  return (
    <Modal open={open} onClose={() => finish(null)} title="관리자 확인" className="max-w-sm">
      <form onSubmit={submit} className="space-y-3">
        <p className="text-sm text-ink-muted break-keep">
          {message || "기록을 추가·수정·삭제하려면 관리자 비밀번호가 필요합니다. 통계 조회는 비밀번호 없이 누구나 할 수 있습니다."}
        </p>
        <Input
          type="password"
          autoComplete="current-password"
          placeholder="관리자 비밀번호"
          aria-label="관리자 비밀번호"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setError("");
          }}
        />
        {error && <p className="text-xs text-lose break-keep" role="alert">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={() => finish(null)}>취소</Button>
          <Button type="submit" size="sm" disabled={!value || checking}>{checking ? "확인 중..." : "확인"}</Button>
        </div>
      </form>
    </Modal>
  );
}
