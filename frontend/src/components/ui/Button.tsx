"use client";

import type { ButtonHTMLAttributes } from "react";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost";
  size?: "md" | "lg";
  loading?: boolean;
};

const VARIANTS = {
  primary: "bg-accent text-white hover:bg-[#0c586a] disabled:bg-muted",
  secondary: "bg-surface text-ink border border-line hover:bg-sunk disabled:text-muted",
  ghost: "text-ink-soft hover:bg-sunk disabled:text-muted",
} as const;

const SIZES = { md: "px-4 py-2 text-sm", lg: "px-6 py-3 text-base" } as const;

export function Button({ variant = "primary", size = "md", loading, children, className = "", ...rest }: Props) {
  return (
    <button
      {...rest}
      disabled={rest.disabled || loading}
      className={`inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition-colors
        focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent
        disabled:cursor-not-allowed ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
    >
      {loading && (
        <span className="flex gap-1" aria-hidden>
          <span className="dot h-1.5 w-1.5 rounded-full bg-current" />
          <span className="dot h-1.5 w-1.5 rounded-full bg-current" />
          <span className="dot h-1.5 w-1.5 rounded-full bg-current" />
        </span>
      )}
      {children}
    </button>
  );
}
