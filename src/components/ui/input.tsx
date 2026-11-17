"use client";

import { cn } from "@/lib/cn";
import { forwardRef } from "react";

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, id, ...props }, ref) => {
    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label htmlFor={id} className="text-sm text-ink-muted">
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={id}
          className={cn(
            "w-full rounded-lg bg-surface-1 border border-hairline px-3 py-2 text-sm text-ink",
            "placeholder:text-ink-tertiary",
            "focus:outline-none focus:ring-2 focus:ring-primary-hover/50",
            "transition-fast",
            className
          )}
          {...props}
        />
      </div>
    );
  }
);

Input.displayName = "Input";
