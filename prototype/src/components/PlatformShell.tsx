'use client';

import { type ReactNode } from 'react';
import Link from 'next/link';
import SignOutButton from '@/components/SignOutButton';
import ThemeToggle from '@/components/ThemeToggle';
import EduPrimeLogo from '@/components/platform/EduPrimeLogo';

/**
 * The chrome around the operator console.
 *
 * `/admin/platform` used to render inside `AdminShell`, so the console that
 * manages every school on the platform wore one school's sidebar and logo.
 * That was backwards. This shell is its counterpart — and it now carries a
 * real brand, just not any *school's*: EduPrime, the platform itself. A school
 * operator and a school admin are different jobs (see `src/lib/platform.ts`),
 * and this screen belongs to the first one.
 */
export default function PlatformShell({ children }: { children: ReactNode }) {
  return (
    <div className="eduprime app-canvas min-h-screen">
      <header className="sticky top-0 z-30 border-b border-[var(--border)] bg-[color-mix(in_srgb,var(--surface)_92%,transparent)] backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3.5">
          <div className="flex items-center gap-3">
            <Link href="/platform" className="transition hover:opacity-80">
              <EduPrimeLogo markSize={26} />
            </Link>
            <span className="hidden h-4 w-px bg-[var(--border-strong)] sm:block" />
            <div className="hidden leading-tight sm:block">
              <p className="text-sm font-bold">Operator console</p>
              <p className="text-[11px] text-[var(--muted)]">Cross-tenant · operator access only</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <ThemeToggle variant="compact" />
            <SignOutButton callbackUrl="/auth/admin" tone="slate" portalLabel="the operator console" />
          </div>
        </div>
      </header>

      <div className="eduprime-spectrum-rule" />

      <main className="mx-auto min-w-0 max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
