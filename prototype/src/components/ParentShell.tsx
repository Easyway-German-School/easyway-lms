"use client";

import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import BrandLogo from "@/components/BrandLogo";
import NotificationCenter from "@/components/NotificationCenter";
import ThemeToggle, { useHideFloatingThemeToggle } from "@/components/ThemeToggle";
import SignOutButton from "@/components/SignOutButton";
import HelpLauncher from "@/components/HelpLauncher";
import PortalUpdates from "@/components/PortalUpdates";
import BrandLoader from "@/components/BrandLoader";
import {
  AttendanceIcon,
  CalendarIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CrossIcon,
  DashboardIcon,
  MenuIcon,
} from "@/components/icons";

export type ParentChild = {
  id: string;
  name: string;
  studentCode: string | null;
  level: string;
  classType: string;
  deliveryMode: string;
  branchName: string | null;
};

type ChildContextValue = {
  children: ParentChild[];
  selectedId: string | null;
  select: (id: string) => void;
  loading: boolean;
};

const ParentChildContext = createContext<ChildContextValue | null>(null);

/** The currently-viewed child, and the full list for a switcher. */
export function useParentChildren() {
  const ctx = useContext(ParentChildContext);
  if (!ctx) throw new Error("useParentChildren must be used inside ParentShell");
  return ctx;
}

const STORAGE_KEY_PREFIX = "ew-parent-selected-child-";

const navItems = [
  { label: "Dashboard", href: "/parent/dashboard", icon: <DashboardIcon /> },
  { label: "Timetable", href: "/parent/timetable", icon: <CalendarIcon /> },
  { label: "Attendance", href: "/parent/attendance", icon: <AttendanceIcon /> },
];

/**
 * The parent portal's shell. Deliberately much smaller than StudentShell:
 * no tuition lock (a parent needs to see attendance especially when payment
 * is the problem), no live-class/moment-queue machinery (none of it applies
 * to a read-only monitoring portal), and a flat three-item nav so a
 * non-technical parent never has to guess where something lives.
 */
export default function ParentShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { data: session, status } = useSession();
  useHideFloatingThemeToggle();

  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [kids, setKids] = useState<ParentChild[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loadingKids, setLoadingKids] = useState(true);

  useEffect(() => {
    if (status !== "loading" && session?.user?.role !== "parent") {
      router.replace("/auth/parent/signin");
    }
  }, [status, session, router]);

  useEffect(() => {
    if (status !== "authenticated" || session?.user?.role !== "parent") return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/parent/children");
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        const list: ParentChild[] = data.children || [];
        setKids(list);
        const storageKey = STORAGE_KEY_PREFIX + (session?.user?.id || "");
        const stored = typeof window !== "undefined" ? window.localStorage.getItem(storageKey) : null;
        const initial = list.find((c) => c.id === stored)?.id || list[0]?.id || null;
        setSelectedId(initial);
      } finally {
        if (!cancelled) setLoadingKids(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [status, session]);

  function select(id: string) {
    setSelectedId(id);
    const storageKey = STORAGE_KEY_PREFIX + (session?.user?.id || "");
    if (typeof window !== "undefined") window.localStorage.setItem(storageKey, id);
  }

  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!drawerOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [drawerOpen]);

  if (status === "loading" || (status === "authenticated" && session?.user?.role !== "parent")) {
    return <BrandLoader fullscreen size="lg" title="Loading…" message="Taking you to your parent dashboard." />;
  }

  const activeLabel = navItems.find((item) => pathname === item.href || pathname.startsWith(item.href + "/"))?.label ?? "Parent portal";

  return (
    <ParentChildContext.Provider value={{ children: kids, selectedId, select, loading: loadingKids }}>
      <div className="app-canvas flex min-h-screen text-[var(--foreground)]">
        {drawerOpen && (
          <button
            aria-label="Close menu"
            onClick={() => setDrawerOpen(false)}
            className="fixed inset-0 z-40 cursor-default bg-slate-950/40 backdrop-blur-sm lg:hidden"
          />
        )}

        <aside
          className={`sidebar-glass fixed left-0 top-0 z-50 flex h-dvh flex-col border-r border-[var(--border)] transition-transform duration-300 lg:z-40 lg:translate-x-0 lg:transition-all ${
            drawerOpen ? "translate-x-0" : "-translate-x-full"
          } w-[17rem] ${collapsed ? "lg:w-20" : "lg:w-72"}`}
        >
          <div className="border-b border-[var(--border)] p-4">
            <div className="flex items-center justify-between gap-3">
              {collapsed ? (
                <Link href="/parent/dashboard" aria-label="Go to dashboard" className="hidden lg:block">
                  <BrandLogo variant="mark" className="h-10 w-10" />
                </Link>
              ) : null}
              <div className={`min-w-0 ${collapsed ? "lg:hidden" : ""}`}>
                <Link href="/parent/dashboard" aria-label="Go to dashboard">
                  <BrandLogo variant="wordmark" className="h-9" />
                </Link>
                <h1 className="mt-1.5 text-[11px] font-semibold uppercase tracking-[0.28em] text-[var(--muted)]">
                  Parent portal
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

          {/* Only shown for a family with more than one child — a parent with
              one kid should never suspect there's a switcher they're missing. */}
          {!collapsed && kids.length > 1 ? (
            <div className="border-b border-[var(--border)] p-3">
              <p className="px-2 pb-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">
                Viewing
              </p>
              <div className="space-y-1">
                {kids.map((kid) => (
                  <button
                    key={kid.id}
                    onClick={() => select(kid.id)}
                    className={`flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-medium transition ${
                      kid.id === selectedId
                        ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                        : "text-[var(--foreground-soft)] hover:bg-[var(--surface-alt)]"
                    }`}
                  >
                    {kid.name}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <nav className="flex-1 overflow-y-auto p-3">
            <div className="space-y-1">
              {navItems.map((item) => {
                const active = pathname === item.href || pathname.startsWith(item.href + "/");
                return (
                  <button
                    key={item.href}
                    onClick={() => router.push(item.href)}
                    title={collapsed ? item.label : ""}
                    className={`group flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left text-sm transition-all duration-200 ${
                      active
                        ? "bg-[var(--accent-soft)] text-[var(--accent)] shadow-[0_8px_24px_rgba(10,124,255,0.12)]"
                        : "text-[var(--foreground-soft)] hover:bg-[var(--surface-alt)] hover:text-[var(--foreground)]"
                    }`}
                  >
                    <span
                      className={`flex h-9 w-9 items-center justify-center rounded-xl border text-base shadow-sm transition ${
                        active
                          ? "border-[var(--accent)]/30 bg-[var(--accent-soft)] text-[var(--accent)]"
                          : "border-[var(--border)] bg-[var(--surface-alt)] group-hover:border-[var(--border-strong)]"
                      }`}
                    >
                      {item.icon}
                    </span>
                    {!collapsed && <span className="flex-1 font-medium">{item.label}</span>}
                  </button>
                );
              })}
            </div>
          </nav>

          <div className="border-t border-[var(--border)] p-3">
            <SignOutButton callbackUrl="/auth/parent/signin" collapsed={collapsed} portalLabel="the parent portal" />
            <p className={`mt-2 px-3 text-xs text-[var(--muted)] ${collapsed ? "lg:text-center" : ""}`}>
              {collapsed ? "" : "Family monitoring"}
            </p>
          </div>
        </aside>

        <main
          className={`min-w-0 w-0 flex-1 max-w-[100vw] overflow-x-clip transition-all duration-300 ${
            collapsed ? "lg:ml-20" : "lg:ml-72"
          }`}
        >
          <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-[var(--border)] bg-[var(--surface-soft)] px-3 py-2 backdrop-blur-xl sm:px-5">
            <button
              onClick={() => setDrawerOpen(true)}
              aria-label="Open menu"
              className="grid h-10 w-10 place-items-center rounded-xl text-[var(--foreground-soft)] transition hover:bg-[var(--surface-alt)] lg:hidden"
            >
              <MenuIcon className="h-5 w-5" />
            </button>
            <div className="min-w-0 flex-1 lg:hidden">
              <Link href="/parent/dashboard" aria-label="Go to dashboard">
                <BrandLogo variant="wordmark" className="h-7" />
              </Link>
            </div>
            <p className="hidden min-w-0 flex-1 truncate text-sm font-semibold text-[var(--foreground-soft)] lg:block">
              {activeLabel}
            </p>
            <ThemeToggle variant="compact" />
            <NotificationCenter />
          </header>

          {children}
        </main>

        <HelpLauncher />

        {/* One in-app popup system across every portal — the same bottom-anchored
            card students and staff get, so a parent hears about a payment notice
            or a message from any page. Push handles the phone when it's closed. */}
        <PortalUpdates />
      </div>
    </ParentChildContext.Provider>
  );
}
