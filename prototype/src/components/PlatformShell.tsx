'use client';

import { type ReactNode } from 'react';
import SignOutButton from '@/components/SignOutButton';
import ThemeToggle from '@/components/ThemeToggle';
import { ShieldIcon } from '@/components/icons';

/**
 * The chrome around the operator console — deliberately carrying none of any
 * one school's identity.
 *
 * `/admin/platform` used to render inside `AdminShell`, which meant the
 * console that manages every school on the platform, EasyWay included, wore
 * EasyWay's own sidebar and logo. That is backwards: this screen is reached
 * by a platform operator, a role distinct from any school's admin (see
 * `src/lib/platform.ts`), and its route lives outside `/admin/**` for the
 * same reason. This shell is its neutral counterpart — a plain mark, not a
 * brand, and no per-school navigation at all.
 */
export default function PlatformShell({ children }: { children: ReactNode }) {
  return (
    <div className="app-canvas min-h-screen">
      <header className="sticky top-0 z-30 border-b border-[var(--border)] bg-[var(--surface)]/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3.5">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--foreground)] text-[var(--surface)]">
              <ShieldIcon className="h-4 w-4" />
            </span>
            <div className="leading-tight">
              <p className="text-sm font-bold">Platform Console</p>
              <p className="text-[11px] text-[var(--muted)]">Operator access only</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <ThemeToggle variant="compact" />
            <SignOutButton callbackUrl="/auth/admin" tone="slate" portalLabel="the platform console" />
          </div>
        </div>
      </header>

      <main className="mx-auto min-w-0 max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
