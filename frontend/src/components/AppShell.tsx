"use client";

import Link from "next/link";
import { useSession } from "@/lib/session";
import { Button } from "./ui/Button";

/**
 * Full-bleed shell: a fixed bar and a content area that fills the rest of the
 * viewport, so pages can build their own side-by-side layouts inside it rather
 * than sitting in a narrow centred column.
 */
export function AppShell({ children, wide = true }: { children: React.ReactNode; wide?: boolean }) {
  const { user, signOut } = useSession();

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-line bg-surface px-5">
        <Link href="/study" className="flex items-baseline gap-2.5">
          <span className="font-display text-base font-extrabold tracking-tight text-ink">Study Loop</span>
          <span className="hidden font-display text-[11px] font-semibold uppercase tracking-[0.14em] text-accent sm:inline">
            Physics
          </span>
        </Link>

        {user && (
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-muted sm:inline">{user.email}</span>
            <Button variant="ghost" size="md" onClick={() => void signOut()}>
              Sign out
            </Button>
          </div>
        )}
      </header>

      {/*
        On desktop the page owns its own internal scrolling, so main is a fixed
        flex child. On a phone the whole document scrolls instead -- otherwise
        content below the fold is simply unreachable.
      */}
      <main className={`flex-1 overflow-y-auto lg:min-h-0 ${wide ? "lg:overflow-hidden" : ""}`}>
        {children}
      </main>
    </div>
  );
}
