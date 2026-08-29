'use client';

import { type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import SignOutButton from '@/components/SignOutButton';
import ThemeToggle from '@/components/ThemeToggle';
import EduPrimeLogo from '@/components/platform/EduPrimeLogo';

/**
 * The chrome around EduPrime — the platform, as distinct from any one school.
 *
 * The platform console and the platform billing view used to render inside
 * `AdminShell`, so the screens that belong to the business selling the software
 * wore one customer's sidebar and logo. They now wear EduPrime's own brand.
 * A school admin and a platform operator are different jobs (see
 * `src/lib/platform.ts`); these screens belong to the platform.
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
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-3.5">
          <div className="flex items-center gap-3">
            <Link href="/platform" className="transition hover:opacity-80">
              <EduPrimeLogo markSize={26} />
            </Link>
            <span className="hidden h-4 w-px bg-[var(--border-strong)] sm:block" />
            <span className="hidden text-sm font-semibold text-[var(--muted)] sm:block">{label}</span>
          </div>

          <nav className="flex items-center gap-1">
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
          </nav>

          <div className="flex items-center gap-3">
            <ThemeToggle variant="compact" />
            <SignOutButton callbackUrl="/auth/admin" tone="slate" portalLabel="EduPrime" />
          </div>
        </div>
      </header>

      <div className="eduprime-spectrum-rule" />

      <main className="mx-auto min-w-0 max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
