"use client";

import { cn } from "@/lib/cn";
import { Search } from "lucide-react";
import { forwardRef } from "react";

// className은 래퍼(div)에 적용되고, 내부 input은 항상 w-full.
type SearchInputProps = React.InputHTMLAttributes<HTMLInputElement>;

export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(
  ({ className, ...props }, ref) => (
    <div className={cn("relative", className)}>
      <Search
        size={15}
        className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-tertiary pointer-events-none"
      />
      <input
        ref={ref}
        className={cn(
          "w-full rounded-lg bg-surface-1 border border-hairline pl-9 pr-3 py-2 text-sm text-ink",
          "placeholder:text-ink-tertiary focus:outline-none focus:ring-2 focus:ring-primary-hover/50 transition-fast"
        )}
        {...props}
      />
    </div>
  )
);

SearchInput.displayName = "SearchInput";
