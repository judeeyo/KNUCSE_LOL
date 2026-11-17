"use client";

import { cn } from "@/lib/cn";
import { forwardRef } from "react";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", children, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-fast cursor-pointer whitespace-nowrap",
          "disabled:opacity-40 disabled:cursor-not-allowed",
          {
            primary: "bg-primary text-white hover:bg-primary-hover active:brightness-90",
            secondary: "bg-surface-1 border border-hairline text-ink hover:bg-surface-2 hover:border-hairline-strong",
            ghost: "bg-transparent text-ink-subtle hover:text-ink hover:bg-surface-1",
            danger: "bg-lose/10 text-lose border border-lose/20 hover:bg-lose/20",
          }[variant],
          {
            sm: "px-3 py-1.5 text-xs",
            md: "px-4 py-2 text-sm",
            lg: "px-5 py-2.5 text-sm",
          }[size],
          className
        )}
        {...props}
      >
        {children}
      </button>
    );
  }
);

Button.displayName = "Button";
