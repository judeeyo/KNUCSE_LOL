"use client";

import { cn } from "@/lib/cn";

interface BadgeProps {
  variant: "mvp" | "ace" | "win" | "lose" | "default";
  children: React.ReactNode;
  className?: string;
}

export function Badge({ variant, children, className }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold leading-none",
        {
          mvp: "badge-mvp",
          ace: "badge-ace",
          win: "bg-win/12 text-win",
          lose: "bg-lose/12 text-lose",
          default: "bg-surface-2 text-ink-subtle",
        }[variant],
        className
      )}
    >
      {children}
    </span>
  );
}
