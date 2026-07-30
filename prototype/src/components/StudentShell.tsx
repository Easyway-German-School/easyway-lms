"use client";

import { usePathname, useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import CommunityLauncher from "@/components/CommunityLauncher";
import BrandLogo from "@/components/BrandLogo";
import PaymentLockScreen from "@/components/PaymentLockScreen";
import { isTuitionGatedRoute } from "@/lib/access";
import { useStudentAccess } from "@/lib/useStudentAccess";

type NavItem = {
  label: string;
  href: string;
  icon: ReactNode;
};

function CertificateIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3l7 3v5c0 4.2-2.6 7.8-7 10-4.4-2.2-7-5.8-7-10V6l7-3z" />
      <path d="M9.6 12.4l1.6 1.6 3.2-3.2" />
    </svg>
  );
}

function BellIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M15 17H5a2 2 0 0 1-2-2v-1l2-2V10a5 5 0 1 1 10 0v2l2 2v1a2 2 0 0 1-2 2Z" />
      <path d="M10 19a2 2 0 0 0 3.8 0" />
    </svg>
  );
}

function DollarIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="3" />
      <path d="M12 7v10" />
      <path d="M14.5 9.2c0-1.2-.9-2.2-2.2-2.2h-.4c-1.3 0-2.3 1.1-2.3 2.4 0 1.4 1 2 2.4 2.3 1.5.3 2.6.9 2.6 2.4 0 1.4-1.2 2.4-2.6 2.4h-.4c-1.3 0-2.4-.9-2.5-2.2" />
    </svg>
  );
}

const navItems: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: "▤" },
  { label: "Classes", href: "/calendar", icon: "◷" },
  { label: "Assignment", href: "/assignment", icon: "✎" },
  { label: "Materials", href: "/materials", icon: "▦" },
  { label: "Community", href: "/community", icon: "◍" },
  { label: "Results", href: "/results", icon: "◈" },
  { label: "Exam centre", href: "/exam-centre", icon: "◆" },
  { label: "Attendance", href: "/attendance", icon: "◫" },
  { label: "Certificates", href: "/certificates", icon: <CertificateIcon className="h-4 w-4" /> },
  { label: "Notifications", href: "/notifications", icon: <BellIcon className="h-4 w-4" /> },
  { label: "Payments", href: "/payments", icon: <DollarIcon className="h-4 w-4" /> },
  { label: "Profile", href: "/profile", icon: "◎" },
  { label: "Settings", href: "/settings", icon: "⚙" },
];

function LockGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4.5" y="11" width="15" height="10" rx="2.5" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

export default function StudentShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const { access, hasAccess } = useStudentAccess();

  // One gate for the whole portal. Every student page renders through this
  // shell, so locking here covers pages that do not exist yet — and there is no
  // per-page payment fetch to forget to add.
  const routeLocked = !hasAccess && isTuitionGatedRoute(pathname);
  const lockedAreaLabel =
    navItems.find((item) => pathname === item.href || pathname.startsWith(item.href + "/"))?.label ??
    "This page";

  return (
    <div className="flex min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(10,124,255,0.10),_transparent_30%),linear-gradient(135deg,_#f7faff_0%,_#eef3ff_100%)] text-[var(--foreground)]">
      <aside className={`fixed left-0 top-0 z-40 flex h-screen flex-col border-r border-white/60 bg-white/80 shadow-[0_24px_70px_rgba(15,23,42,0.08)] backdrop-blur-xl transition-all duration-300 ${collapsed ? "w-20" : "w-72"}`}>
        <div className="border-b border-slate-200/70 p-4">
          <div className="flex items-center justify-between gap-3">
            {/* The wordmark already carries the school name, so it is not
                repeated beside it — only which portal you are in. */}
            {collapsed ? (
              <BrandLogo variant="mark" className="h-10 w-10" />
            ) : (
              <div className="min-w-0">
                <BrandLogo variant="wordmark" className="h-9" />
                <h1 className="mt-1.5 text-[11px] font-semibold uppercase tracking-[0.28em] text-[var(--muted)]">
                  Student portal
                </h1>
              </div>
            )}
            <button onClick={() => setCollapsed(!collapsed)} className="rounded-xl p-2 text-slate-500 transition hover:bg-slate-100 hover:text-[var(--accent)]">
              {collapsed ? "→" : "←"}
            </button>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto p-3">
          <div className="space-y-1">
            {navItems.map((item) => {
              const active = pathname === item.href || pathname.startsWith(item.href + "/");
              // Locked items stay clickable on purpose: tapping Classes and
              // meeting the padlock explains the paywall far better than a
              // dead, greyed-out button does.
              const locked = !hasAccess && isTuitionGatedRoute(item.href);
              return (
                <button
                  key={item.href}
                  onClick={() => router.push(item.href)}
                  title={collapsed ? (locked ? `${item.label} — locked until tuition is paid` : item.label) : ""}
                  className={`group flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left text-sm transition-all duration-200 ${
                    active
                      ? "bg-[var(--accent-soft)] text-[var(--accent)] shadow-[0_8px_24px_rgba(10,124,255,0.12)]"
                      : locked
                      ? "text-slate-400 hover:bg-slate-100/70 hover:text-slate-600"
                      : "text-slate-700 hover:bg-slate-100 hover:text-slate-900"
                  }`}
                >
                  <span className={`flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white/80 text-base shadow-sm transition ${active ? "border-[var(--accent)]/30 bg-[var(--accent-soft)] text-[var(--accent)]" : "group-hover:border-slate-300"}`}>{item.icon}</span>
                  {!collapsed && <span className="flex-1 font-medium">{item.label}</span>}
                  {!collapsed && locked && <LockGlyph className="h-3.5 w-3.5 shrink-0 text-[var(--accent)]/70" />}
                </button>
              );
            })}
          </div>
        </nav>

        <div className={`border-t border-slate-200/70 p-4 ${collapsed ? "text-center" : ""}`}>
          <p className="text-xs text-slate-500">{collapsed ? "v1" : "AI-ready student workspace"}</p>
        </div>
      </aside>

      <main className={`flex-1 transition-all duration-300 ${collapsed ? "ml-20" : "ml-72"}`}>
        {routeLocked ? <PaymentLockScreen areaLabel={lockedAreaLabel} access={access} /> : children}
      </main>

      {/* Lives in the shell, not on one page, so the community (and its unread
          badge) is one tap away from anywhere in the portal. The community is
          itself a paid feature, so it goes away entirely while locked. */}
      {pathname !== "/community" && hasAccess && <CommunityLauncher />}
    </div>
  );
}
