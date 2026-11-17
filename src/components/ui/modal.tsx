"use client";

import { cn } from "@/lib/cn";
import { X } from "lucide-react";
import { useEffect, useRef } from "react";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  className?: string;
}

export function Modal({ open, onClose, title, children, className }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  // onClose가 인라인 함수여도 effect(초기 포커스/트랩)가 매 렌더 재실행되지 않도록 ref로 고정
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;

    document.body.style.overflow = "hidden";
    const prevFocused = document.activeElement as HTMLElement | null;

    const focusable = () =>
      panelRef.current
        ? Array.from(
            panelRef.current.querySelectorAll<HTMLElement>(
              'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])'
            )
          ).filter((el) => el.offsetParent !== null)
        : [];

    // 초기 포커스를 모달 안으로 이동
    (focusable()[0] ?? panelRef.current)?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key === "Tab") {
        const items = focusable();
        if (items.length === 0) {
          e.preventDefault();
          return;
        }
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = "";
      prevFocused?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={cn(
          "relative w-full max-w-lg rounded-xl bg-surface-1 border border-hairline flex flex-col max-h-[calc(100vh-2rem)] focus:outline-none",
          className
        )}
      >
        {title && (
          <div className="flex items-center justify-between gap-4 px-5 pt-5 pb-4 shrink-0">
            <h2 className="text-base font-semibold text-ink">{title}</h2>
            <button
              onClick={onClose}
              aria-label="닫기"
              className="p-1 rounded-md text-ink-tertiary hover:text-ink hover:bg-surface-2 transition-fast cursor-pointer shrink-0"
            >
              <X size={16} />
            </button>
          </div>
        )}
        <div className={cn("overflow-y-auto px-5 pb-5", title ? "pt-0" : "pt-5")}>
          {children}
        </div>
      </div>
    </div>
  );
}
