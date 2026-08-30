'use client';

import { type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import SignOutButton from '@/components/SignOutButton';
import EduPrimeLogo from '@/components/platform/EduPrimeLogo';

/**
 * The chrome around EduPrime — the platform, as distinct from any one school.
 *
 * The platform console and the platform billing view used to render inside
 * `AdminShell`, so the screens that belong to the business selling the software
 * wore one customer's sidebar and logo. They now wear EduPrime's own brand.
 * A school admin and a platform operator are different jobs (see
 * `src/lib/platform.ts`); these screens belong to the platform.
 *
 * No theme switcher here on purpose: EduPrime carries its own light/dark via
 * the `.eduprime` scope (eduprime.css), and the school-facing Tag/Nacht/
 * Dämmerung control has no meaning on an operator console.
 */

const NAV = [
  { href: '/platform', label: 'Console' },
  { href: '/platform/billing', label: 'Billing' },
];

export default function PlatformShell({
  children,
  label = 'Platform',
}: {
  children: ReactNode;
  /** What this particular screen is — shown next to the logo. */
  label?: string;
}) {
  const pathname = usePathname();

  return (
    <div className="eduprime app-canvas min-h-screen">
      <header className="sticky top-0 z-30 border-b border-[var(--border)] bg-[color-mix(in_srgb,var(--surface)_92%,transparent)] backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3 sm:px-6">
          <Link href="/platform" className="flex items-center gap-2.5 transition hover:opacity-80">
            <EduPrimeLogo markSize={24} />
          </Link>
          <span className="hidden h-4 w-px bg-[var(--border-strong)] sm:block" />
          <span className="hidden text-sm font-semibold text-[var(--muted)] sm:block">{label}</span>

          <nav className="ml-auto flex items-center gap-1">
            {NAV.map((item) => {
              const active =
                item.href === '/platform'
                  ? pathname === '/platform'
                  : pathname?.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition ${
                    active
                      ? 'bg-[var(--accent-soft)] text-[var(--primary)]'
                      : 'text-[var(--foreground-soft)] hover:text-[var(--foreground)]'
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
            <span className="ml-2 hidden w-[136px] shrink-0 border-l border-[var(--border)] pl-2 sm:block">
              <SignOutButton callbackUrl="/auth/admin" tone="slate" portalLabel="EduPrime" />
            </span>
          </nav>
        </div>
      </header>

      <div className="eduprime-spectrum-rule" />

      <main className="mx-auto min-w-0 max-w-6xl px-4 py-8 sm:px-6">{children}</main>
    </div>
  );
}
