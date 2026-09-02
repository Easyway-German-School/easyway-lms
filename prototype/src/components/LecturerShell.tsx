'use client';

import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { signOut, useSession } from 'next-auth/react';
import { useEffect, useState, type ReactNode } from 'react';
import { homePathForRole } from '@/lib/portal';
import BrandLogo from "@/components/BrandLogo";
import HelpLauncher from "@/components/HelpLauncher";
import PortalUpdates from "@/components/PortalUpdates";
import NotificationCenter from "@/components/NotificationCenter";
import ThemeToggle, { useHideFloatingThemeToggle } from "@/components/ThemeToggle";
import SignOutButton from "@/components/SignOutButton";
import {
  AssignmentIcon,
  AttendanceIcon,
  BookOpenIcon,
  BroadcastIcon,
  BroadcastMessageIcon,
  ChainIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CommunityIcon,
  CrossIcon,
  CustomiseIcon,
  DashboardIcon,
  ExamIcon,
  GradebookIcon,
  LessonBuilderIcon,
  MailIcon,
  MenuIcon,
  PrivateClassIcon,
  QuizIcon,
  SettingsIcon,
  TimetableIcon,
  UsersIcon,
  FilmIcon,
  ShieldIcon,
} from "@/components/icons";
import { featureForLecturerPath, LECTURER_FEATURE_LABELS } from "@/lib/lecturer-features";

type NavItem = {
  label: string;
  href: string;
  icon: ReactNode;
};

// One icon per destination, no repeats. Four entries used to share the same
// pair-of-people glyph and three shared the same sheet-of-paper, which made
// the sidebar useless to scan — you had to read every label.
const navItems: NavItem[] = [
  { label: 'Dashboard', href: '/lecturer/dashboard', icon: <DashboardIcon /> },
  { label: 'Live classroom', href: '/live', icon: <BroadcastIcon /> },
  // Not "customise" any more: a tutor does not choose their class, the office
  // does. This page shows them what they were given and their roster.
  { label: 'My classes', href: '/lecturer/classes', icon: <CustomiseIcon /> },
  { label: 'My students', href: '/lecturer/students', icon: <UsersIcon /> },
  { label: 'Timetable', href: '/lecturer/timetable', icon: <TimetableIcon /> },
  { label: 'Private classes', href: '/lecturer/private-classes', icon: <PrivateClassIcon /> },
  { label: 'Assignments', href: '/lecturer/assignments', icon: <AssignmentIcon /> },
  // Sits with Assignments because that is where its questions come from: a
  // game is a quiz the tutor already wrote, put on the projector instead of
  // set as homework.
  { label: 'Quiz game', href: '/lecturer/live-quiz', icon: <QuizIcon /> },
  // Next to the quiz game because both are "a game my class plays", but it is
  // the opposite format: nobody has to be anywhere, and it runs for a week.
  { label: 'Story chain', href: '/lecturer/stories', icon: <ChainIcon /> },
  { label: 'Materials', href: '/lecturer/materials', icon: <BookOpenIcon /> },
  // Tutors had no way to watch back a class they taught. The students have had
  // the shelf-style library since it was built; this is the same library,
  // scoped to the classes this tutor actually takes.
  { label: 'Recordings', href: '/lecturer/recordings', icon: <FilmIcon /> },
  { label: 'Attendance', href: '/lecturer/attendance', icon: <AttendanceIcon /> },
  { label: 'Exam/Test', href: '/lecturer/grades', icon: <ExamIcon /> },
  // Tutors already had access to every space server-side (isStaffRole in
  // lib/community-spaces), but no way to reach one — the entry simply was not
  // in this sidebar, so the answering-questions-between-classes half of the
  // community never happened.
  { label: 'Community', href: '/community', icon: <CommunityIcon /> },
  // These two pages existed but were reachable from nowhere, so nobody used
  // them. They belong in the sidebar with everything else.
  { label: 'Gradebook', href: '/lecturer/gradebook', icon: <GradebookIcon /> },
  { label: 'Lesson builder', href: '/lecturer/lesson-builder', icon: <LessonBuilderIcon /> },
  { label: 'Messages', href: '/lecturer/messages', icon: <MailIcon /> },
  { label: 'Announcements', href: '/lecturer/announcements', icon: <BroadcastMessageIcon /> },
  { label: 'Settings', href: '/lecturer/settings', icon: <SettingsIcon /> },
];

export default function LecturerShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { data: session, status } = useSession();
  useHideFloatingThemeToggle();
  const [collapsed, setCollapsed] = useState(false);
  const [revoked, setRevoked] = useState(false);
  /**
   * Which optional areas this tutor may reach. Null while unknown, and null
   * means everything shows — a slow or failed lookup must not blank out a
   * tutor's own sidebar mid-lesson, and the routes enforce it regardless.
   */
  const [features, setFeatures] = useState<string[] | null>(null);
  // Below lg the sidebar is a drawer. A tutor marking attendance on their
  // phone had 288px of the 375px screen taken by a sidebar they could not
  // dismiss.
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  /**
   * THE DOOR, same reasoning as AdminShell's: this shell had no session
   * check at all, so a student or parent who followed a stray link or old
   * bookmark into `/lecturer/*` got the full tutor console rendered for
   * them rather than being turned away. Admin is deliberately let through —
   * several lecturer pages (the group timetable editor, community, live
   * classroom) are built to also serve admin — but private classes has its
   * OWN admin page (`/admin/schedule/private/[studentId]`) precisely
   * because admin has no lecturer identity to view this one with, so that
   * one path still gets admin bounced to it below.
   */
  useEffect(() => {
    if (status === 'unauthenticated') {
      router.replace('/auth/lecturer/signin');
      return;
    }
    if (status !== 'authenticated') return;
    const role = (session?.user?.role ?? '').toLowerCase();
    if (role !== 'lecturer' && role !== 'tutor' && role !== 'admin') {
      router.replace(homePathForRole(role));
    }
  }, [router, session?.user?.role, status]);

  useEffect(() => {
    if (pathname !== '/lecturer/private-classes') return;
    if ((session?.user?.role ?? '').toLowerCase() !== 'admin') return;
    const studentId = new URLSearchParams(window.location.search).get('studentId');
    router.replace(studentId ? `/admin/schedule/private/${encodeURIComponent(studentId)}` : '/admin/schedule');
  }, [pathname, router, session?.user?.role]);

  /**
   * A tutor who was marked inactive while signed in loses the portal here.
   *
   * Their session token stays technically valid for up to 30 days, so refusing
   * them at the sign-in form alone would leave somebody who has left the school
   * holding a live roster, register and gradebook until it expired. Checked on
   * every navigation; a failed request is ignored, because a network blip must
   * not throw a tutor out mid-lesson.
   */
  useEffect(() => {
    let cancelled = false;
    fetch("/api/lecturer/status", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        if (data.active === false) setRevoked(true);
        if (Array.isArray(data.features)) setFeatures(data.features);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  useEffect(() => {
    if (revoked) signOut({ callbackUrl: "/auth/lecturer/signin?message=This+tutor+account+is+no+longer+active.+Contact+the+school+office." });
  }, [revoked]);

  if (revoked) {
    return (
      <div className="grid min-h-screen place-items-center bg-[var(--background)] px-6 text-center">
        <div>
          <p className="text-lg font-semibold text-[var(--foreground)]">This tutor account is no longer active.</p>
          <p className="mt-2 text-sm text-[var(--muted)]">Signing you out — contact the school office.</p>
        </div>
      </div>
    );
  }

  if (status === 'loading') {
    return <div className="app-canvas flex min-h-screen items-center justify-center text-[var(--foreground-soft)]">Loading lecturer portal...</div>;
  }

  const sessionRole = (session?.user?.role ?? '').toLowerCase();
  const adminOnPrivateClasses = pathname === '/lecturer/private-classes' && sessionRole === 'admin';
  if (status === 'unauthenticated' || (sessionRole !== 'lecturer' && sessionRole !== 'tutor' && sessionRole !== 'admin') || adminOnPrivateClasses) {
    return <div className="app-canvas flex min-h-screen items-center justify-center text-[var(--foreground-soft)]">Redirecting...</div>;
  }

  /**
   * THE DOOR, not just the signpost — the same reasoning as AdminShell.
   *
   * Hiding a sidebar entry is presentation. It is not access control, and on
   * its own it leaves a tutor who follows an old bookmark or their own browser
   * history staring at a live classroom page that spins forever or a private
   * class list that renders empty. Both read as the portal being broken rather
   * than as a boundary, and the resulting bug report is a fair one.
   */
  const visibleToThisTutor = (item: NavItem) => {
    const feature = featureForLecturerPath(item.href);
    return !feature || features === null || features.includes(feature);
  };

  const blockedFeature = (() => {
    const feature = featureForLecturerPath(pathname);
    if (!feature || features === null || features.includes(feature)) return null;
    return feature;
  })();

  return (
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
          drawerOpen ? 'translate-x-0' : '-translate-x-full'
        } w-[17rem] ${collapsed ? 'lg:w-20' : 'lg:w-72'}`}
      >
        <div className="border-b border-[var(--border)] p-4">
          {/* Collapsed rail (desktop only): the brand mark stacked over a
              full-width expand control, both centred so nothing is crammed
              against the edge of the 80px rail. */}
          {collapsed && (
            <div className="hidden flex-col items-center gap-3 lg:flex">
              <Link href="/lecturer/dashboard" aria-label="Go to dashboard">
                <BrandLogo variant="mark" className="h-9 w-9" />
              </Link>
              <button
                onClick={() => setCollapsed(false)}
                aria-label="Expand sidebar"
                className="flex w-full items-center justify-center rounded-xl p-2 text-[var(--muted)] transition hover:bg-[var(--surface-alt)] hover:text-[var(--accent)]"
              >
                <ChevronRightIcon />
              </button>
            </div>
          )}

          <div className={`flex items-center justify-between gap-3 ${collapsed ? 'lg:hidden' : ''}`}>
            <div className="min-w-0">
              <Link href="/lecturer/dashboard" aria-label="Go to dashboard">
                <BrandLogo variant="wordmark" className="h-9" />
              </Link>
              <h1 className="mt-1.5 text-[11px] font-semibold uppercase tracking-[0.28em] text-[var(--muted)]">
                Lecturer portal
              </h1>
            </div>
            <button
              onClick={() => setCollapsed(!collapsed)}
              aria-label="Collapse sidebar"
              className="hidden rounded-xl p-2 text-[var(--muted)] transition hover:bg-[var(--surface-alt)] hover:text-[var(--accent)] lg:block"
            >
              <ChevronLeftIcon />
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
            {navItems.filter(visibleToThisTutor).map((item) => {
              const active = pathname === item.href || pathname.startsWith(item.href + '/');
              return (
                <button
                  key={item.href}
                  onClick={() => router.push(item.href)}
                  title={collapsed ? item.label : ''}
                  className={`group flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left text-sm transition-all duration-200 ${
                    collapsed ? 'lg:justify-center lg:gap-0 lg:px-0' : ''
                  } ${
                    active
                      ? 'bg-[var(--accent-soft)] text-[var(--accent)] shadow-[0_8px_24px_rgba(10,124,255,0.12)]'
                      : 'text-[var(--foreground-soft)] hover:bg-[var(--surface-alt)] hover:text-[var(--foreground)]'
                  }`}
                >
                  <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface-alt)] text-base shadow-sm transition ${active ? 'border-[var(--accent)]/30 bg-[var(--accent-soft)] text-[var(--accent)]' : 'group-hover:border-[var(--border-strong)]'}`}>{item.icon}</span>
                  {!collapsed && <span className="font-medium">{item.label}</span>}
                </button>
              );
            })}
          </div>
        </nav>

        <div className="border-t border-[var(--border)] p-3">
          <SignOutButton callbackUrl="/auth/lecturer/signin" collapsed={collapsed} tone="slate" portalLabel="the tutor portal" />
          <p className={`mt-2 px-3 text-xs text-[var(--muted)] ${collapsed ? 'lg:text-center' : ''}`}>
            {collapsed ? 'v1' : 'AI-ready lecturer workspace'}
          </p>
        </div>
      </aside>

      {/*
        `min-w-0` and `overflow-x-clip` are load-bearing, not tidying.

        This <main> is a flex child, and a flex child defaults to
        `min-width: auto` — it refuses to shrink below its widest content. One
        wide table, long student email or unbroken URL anywhere on the page
        pushes it past the viewport, and because `body` sets `overflow-x: hidden`
        globally the page does NOT gain a sideways scrollbar to reveal it: the
        content is simply gone off the right edge. That presents as a dozen
        unrelated "this page is cut off" bugs rather than one layout fault.

        StudentShell was fixed this way on 2026-08-02; these two shells were
        missed at the time.
      */}
      <main className={`min-w-0 flex-1 overflow-x-clip transition-all duration-300 ${collapsed ? 'lg:ml-20' : 'lg:ml-72'}`}>
        <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-[var(--border)] bg-[var(--surface-soft)] px-3 py-2 backdrop-blur-xl sm:px-5">
          <button
            onClick={() => setDrawerOpen(true)}
            aria-label="Open menu"
            className="grid h-10 w-10 place-items-center rounded-xl text-[var(--muted)] transition hover:bg-[var(--surface-alt)] lg:hidden"
          >
            <MenuIcon className="h-5 w-5" />
          </button>

          <div className="min-w-0 flex-1 lg:hidden">
            <Link href="/lecturer/dashboard" aria-label="Go to dashboard">
              <BrandLogo variant="wordmark" className="h-7" />
            </Link>
          </div>

          <p className="hidden min-w-0 flex-1 truncate text-sm font-semibold text-[var(--foreground-soft)] lg:block">
            {navItems.find((item) => pathname === item.href)?.label ?? 'Lecturer portal'}
          </p>

          <ThemeToggle variant="compact" />
          <NotificationCenter />
        </header>

        {blockedFeature ? (
          <div className="p-6">
            <div className="mx-auto mt-10 max-w-lg rounded-[28px] border border-[var(--border)] bg-[var(--surface)] p-8 text-center shadow-[var(--shadow)]">
              <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[var(--accent-soft)] text-[var(--accent)]">
                <ShieldIcon className="h-7 w-7" />
              </span>
              <h1 className="mt-4 text-xl font-bold text-[var(--foreground)]">Not part of your role</h1>
              <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                The school has not given you{' '}
                <strong className="font-semibold text-[var(--foreground)]">
                  {LECTURER_FEATURE_LABELS[blockedFeature]}
                </strong>
                . Nothing is broken — not every tutor takes these, so the office decides who does.
              </p>
              <p className="mt-3 text-xs leading-5 text-[var(--muted)]">
                An admin can switch it on from your tutor record, without changing anybody else&rsquo;s.
              </p>
              <button
                type="button"
                onClick={() => router.push('/lecturer/dashboard')}
                className="mt-5 rounded-full bg-[var(--accent)] px-6 py-3 text-sm font-bold text-white transition hover:brightness-110"
              >
                Back to my dashboard
              </button>
            </div>
          </div>
        ) : (
          children
        )}
      </main>

      {/* Tutors get the same desk. A tutor whose roster is wrong or whose
          classroom will not open has exactly the same problem a student does,
          and pushing staff onto WhatsApp is what this replaced. */}

      {/*
        Message popups, mounted once per shell so they follow the reader onto
        every page rather than living on the community screen they are about.
        See PortalUpdates for why the card carries the real message text.
      */}
      <PortalUpdates />
      <HelpLauncher />
    </div>
  );
}
