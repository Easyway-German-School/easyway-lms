"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import CommunityLauncher from "@/components/CommunityLauncher";
import BrandLogo from "@/components/BrandLogo";
import NotificationCenter from "@/components/NotificationCenter";
import PaymentLockScreen from "@/components/PaymentLockScreen";
import { isTuitionGatedRoute } from "@/lib/access";
import { useStudentAccess } from "@/lib/useStudentAccess";
import {
  AssignmentIcon,
  AttendanceIcon,
  BellIcon,
  BookOpenIcon,
  BroadcastIcon,
  CalendarIcon,
  CertificateIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CommunityIcon,
  CrossIcon,
  DashboardIcon,
  ExamCentreIcon,
  LockIcon,
  MenuIcon,
  PaymentIcon,
  ProfileIcon,
  ResultsIcon,
} from "@/components/icons";

type NavItem = {
  label: string;
  href: string;
  icon: ReactNode;
};

// These were box-drawing characters — ▤ ◷ ◉ ◈ — sitting next to three real
// SVGs, which is why the sidebar looked half-finished.
//
// There is no Settings entry. Everything it held is either on Profile or is a
// school decision a student cannot make, and the theme switch — the one thing
// in there anybody used — lives in the corner of every page.
const navItems: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: <DashboardIcon /> },
  { label: "Classes", href: "/calendar", icon: <CalendarIcon /> },
  { label: "Live class", href: "/live", icon: <BroadcastIcon /> },
  { label: "Assignment", href: "/assignment", icon: <AssignmentIcon /> },
  { label: "Materials", href: "/materials", icon: <BookOpenIcon /> },
  { label: "Community", href: "/community", icon: <CommunityIcon /> },
  { label: "Results", href: "/results", icon: <ResultsIcon /> },
  { label: "Exam centre", href: "/exam-centre", icon: <ExamCentreIcon /> },
  { label: "Attendance", href: "/attendance", icon: <AttendanceIcon /> },
  { label: "Certificates", href: "/certificates", icon: <CertificateIcon /> },
  { label: "Notifications", href: "/notifications", icon: <BellIcon /> },
  { label: "Payments", href: "/payments", icon: <PaymentIcon /> },
  { label: "Profile", href: "/profile", icon: <ProfileIcon /> },
];

export default function StudentShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  // Below lg the sidebar is a drawer, not a column. It used to be a fixed 288px
  // pane with the content pushed 288px right, which on a phone left the portal
  // showing a sliver of itself off the side of the screen.
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { access, hasAccess } = useStudentAccess();

  // Navigating is the end of the drawer's job.
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  // The welcome tour spotlights real sidebar buttons, which on a phone live
  // inside the drawer. It asks; the shell decides — the drawer's state stays
  // owned here rather than being reached into from outside.
  useEffect(() => {
    const onTourDrawer = (event: Event) => {
      const wanted = (event as CustomEvent<{ open?: boolean }>).detail?.open;
      // Only on the small layout. On a desktop the sidebar is already a
      // permanent column and opening a drawer over it would be nonsense.
      if (window.innerWidth >= 1024) return;
      setDrawerOpen(Boolean(wanted));
    };

    window.addEventListener("easyway:tour-drawer", onTourDrawer);
    return () => window.removeEventListener("easyway:tour-drawer", onTourDrawer);
  }, []);

  // A drawer over the page must not let the page behind it scroll.
  useEffect(() => {
    if (!drawerOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [drawerOpen]);

  // One gate for the whole portal. Every student page renders through this
  // shell, so locking here covers pages that do not exist yet — and there is no
  // per-page payment fetch to forget to add.
  const routeLocked = !hasAccess && isTuitionGatedRoute(pathname);
  const lockedAreaLabel =
    navItems.find((item) => pathname === item.href || pathname.startsWith(item.href + "/"))?.label ??
    "This page";

  return (
    // Was a hardcoded blue gradient, which is why the portal stayed daylight-
    // blue whatever theme was chosen. The themed canvas is the page's job now.
    <div className="app-canvas flex min-h-screen text-[var(--foreground)]">
      {/* Scrim, phones only. Tapping anywhere off the drawer closes it. */}
      {drawerOpen && (
        <button
          aria-label="Close menu"
          onClick={() => setDrawerOpen(false)}
          className="fixed inset-0 z-40 cursor-default bg-slate-950/40 backdrop-blur-sm lg:hidden"
        />
      )}

      <aside
        data-tour="sidebar"
        className={`fixed left-0 top-0 z-50 flex h-screen flex-col border-r border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow)] backdrop-blur-xl transition-transform duration-300 lg:z-40 lg:translate-x-0 lg:transition-all ${
          drawerOpen ? "translate-x-0" : "-translate-x-full"
        } w-[17rem] ${collapsed ? "lg:w-20" : "lg:w-72"}`}
      >
        <div className="border-b border-[var(--border)] p-4">
          <div className="flex items-center justify-between gap-3">
            {/* The wordmark already carries the school name, so it is not
                repeated beside it — only which portal you are in. */}
            {collapsed ? (
              <BrandLogo variant="mark" className="h-10 w-10 lg:block hidden" />
            ) : null}
            <div className={`min-w-0 ${collapsed ? "lg:hidden" : ""}`}>
              <BrandLogo variant="wordmark" className="h-9" />
              <h1 className="mt-1.5 text-[11px] font-semibold uppercase tracking-[0.28em] text-[var(--muted)]">
                Student portal
              </h1>
            </div>

            <button
              onClick={() => setCollapsed(!collapsed)}
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              className="hidden rounded-xl p-2 text-[var(--muted)] transition hover:bg-[var(--surface-alt)] hover:text-[var(--accent)] lg:block"
            >
              {collapsed ? <ChevronRightIcon /> : <ChevronLeftIcon />}
            </button>
            <button
              onClick={() => setDrawerOpen(false)}
              aria-label="Close menu"
              className="rounded-xl p-2 text-[var(--muted)] transition hover:bg-[var(--surface-alt)] hover:text-[var(--accent)] lg:hidden"
            >
              <CrossIcon className="h-5 w-5" />
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
                  // The welcome tour spotlights real sidebar entries by href
                  // rather than rendering a picture of them, so it cannot drift
                  // out of date with the nav it is describing.
                  data-tour={`nav:${item.href}`}
                  onClick={() => router.push(item.href)}
                  title={collapsed ? (locked ? `${item.label} — locked until tuition is paid` : item.label) : ""}
                  className={`group flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left text-sm transition-all duration-200 ${
                    active
                      ? "bg-[var(--accent-soft)] text-[var(--accent)] shadow-[0_8px_24px_rgba(10,124,255,0.12)]"
                      : locked
                      ? "text-[var(--muted)] opacity-70 hover:bg-[var(--surface-alt)] hover:opacity-100"
                      : "text-[var(--foreground-soft)] hover:bg-[var(--surface-alt)] hover:text-[var(--foreground)]"
                  }`}
                >
                  <span className={`flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface-alt)] text-base shadow-sm transition ${active ? "border-[var(--accent)]/30 bg-[var(--accent-soft)] text-[var(--accent)]" : "group-hover:border-[var(--border-strong)]"}`}>{item.icon}</span>
                  {!collapsed && <span className="flex-1 font-medium">{item.label}</span>}
                  {!collapsed && locked && <LockIcon className="h-3.5 w-3.5 shrink-0 text-[var(--accent)]/70" strokeWidth={2.2} />}
                </button>
              );
            })}
          </div>
        </nav>

        <div className={`border-t border-[var(--border)] p-4 ${collapsed ? "text-center" : ""}`}>
          <p className="text-xs text-[var(--muted)]">{collapsed ? "v1" : "AI-ready student workspace"}</p>
        </div>
      </aside>

      <main className={`flex-1 transition-all duration-300 ${collapsed ? "lg:ml-20" : "lg:ml-72"}`}>
        {/* The only chrome on a phone: the way back to the menu, and the bell.
            On desktop it keeps the bell reachable from every page, which it
            was not before — the component existed but nothing rendered it. */}
        <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-[var(--border)] bg-[var(--surface-soft)] px-3 py-2 backdrop-blur-xl sm:px-5">
          <button
            onClick={() => setDrawerOpen(true)}
            aria-label="Open menu"
            className="grid h-10 w-10 place-items-center rounded-xl text-[var(--foreground-soft)] transition hover:bg-[var(--surface-alt)] lg:hidden"
          >
            <MenuIcon className="h-5 w-5" />
          </button>

          <div className="min-w-0 flex-1 lg:hidden">
            <BrandLogo variant="wordmark" className="h-7" />
          </div>

          <p className="hidden min-w-0 flex-1 truncate text-sm font-semibold text-[var(--foreground-soft)] lg:block">
            {lockedAreaLabel === "This page" ? "Student portal" : lockedAreaLabel}
          </p>

          <NotificationCenter />
        </header>

        {routeLocked ? <PaymentLockScreen areaLabel={lockedAreaLabel} access={access} /> : children}
      </main>

      {/* Lives in the shell, not on one page, so the community (and its unread
          badge) is one tap away from anywhere in the portal. The community is
          itself a paid feature, so it goes away entirely while locked. */}
      {pathname !== "/community" && hasAccess && <CommunityLauncher />}
    </div>
  );
}
