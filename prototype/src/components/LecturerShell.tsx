'use client';

import { usePathname, useRouter } from 'next/navigation';
import { signOut } from 'next-auth/react';
import { useEffect, useState, type ReactNode } from 'react';
import BrandLogo from "@/components/BrandLogo";
import HelpLauncher from "@/components/HelpLauncher";
import PortalUpdates from "@/components/PortalUpdates";
import NotificationCenter from "@/components/NotificationCenter";
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
    <div className="flex min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(10,124,255,0.10),_transparent_30%),linear-gradient(135deg,_#f7faff_0%,_#eef3ff_100%)] text-[var(--foreground)]">
      {drawerOpen && (
        <button
          aria-label="Close menu"
          onClick={() => setDrawerOpen(false)}
          className="fixed inset-0 z-40 cursor-default bg-slate-950/40 backdrop-blur-sm lg:hidden"
        />
      )}

      <aside
        className={`fixed left-0 top-0 z-50 flex h-dvh flex-col border-r border-white/60 bg-white/95 shadow-[0_24px_70px_rgba(15,23,42,0.08)] backdrop-blur-xl transition-transform duration-300 lg:z-40 lg:translate-x-0 lg:bg-white/80 lg:transition-all ${
          drawerOpen ? 'translate-x-0' : '-translate-x-full'
        } w-[17rem] ${collapsed ? 'lg:w-20' : 'lg:w-72'}`}
      >
        <div className="border-b border-slate-200/70 p-4">
          <div className="flex items-center justify-between gap-3">
            {collapsed && <BrandLogo variant="mark" className="hidden h-10 w-10 lg:block" />}
            <div className={`min-w-0 ${collapsed ? 'lg:hidden' : ''}`}>
              <BrandLogo variant="wordmark" className="h-9" />
              <h1 className="mt-1.5 text-[11px] font-semibold uppercase tracking-[0.28em] text-[var(--muted)]">
                Lecturer portal
              </h1>
            </div>
            <button
              onClick={() => setCollapsed(!collapsed)}
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              className="hidden rounded-xl p-2 text-slate-500 transition hover:bg-slate-100 hover:text-[var(--accent)] lg:block"
            >
              {collapsed ? <ChevronRightIcon /> : <ChevronLeftIcon />}
            </button>
            <button
              onClick={() => setDrawerOpen(false)}
              aria-label="Close menu"
              className="rounded-xl p-2 text-slate-500 transition hover:bg-slate-100 hover:text-[var(--accent)] lg:hidden"
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
                    active
                      ? 'bg-[var(--accent-soft)] text-[var(--accent)] shadow-[0_8px_24px_rgba(10,124,255,0.12)]'
                      : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
                  }`}
                >
                  <span className={`flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white/80 text-base shadow-sm transition ${active ? 'border-[var(--accent)]/30 bg-[var(--accent-soft)] text-[var(--accent)]' : 'group-hover:border-slate-300'}`}>{item.icon}</span>
                  {!collapsed && <span className="font-medium">{item.label}</span>}
                </button>
              );
            })}
          </div>
        </nav>

        <div className="border-t border-slate-200/70 p-3">
          <SignOutButton callbackUrl="/auth/lecturer/signin" collapsed={collapsed} tone="slate" portalLabel="the tutor portal" />
          <p className={`mt-2 px-3 text-xs text-slate-500 ${collapsed ? 'lg:text-center' : ''}`}>
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
        <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-white/60 bg-white/80 px-3 py-2 backdrop-blur-xl sm:px-5">
          <button
            onClick={() => setDrawerOpen(true)}
            aria-label="Open menu"
            className="grid h-10 w-10 place-items-center rounded-xl text-slate-600 transition hover:bg-slate-100 lg:hidden"
          >
            <MenuIcon className="h-5 w-5" />
          </button>

          <div className="min-w-0 flex-1 lg:hidden">
            <BrandLogo variant="wordmark" className="h-7" />
          </div>

          <p className="hidden min-w-0 flex-1 truncate text-sm font-semibold text-slate-700 lg:block">
            {navItems.find((item) => pathname === item.href)?.label ?? 'Lecturer portal'}
          </p>

          <NotificationCenter />
        </header>

        {blockedFeature ? (
          <div className="p-6">
            <div className="mx-auto mt-10 max-w-lg rounded-[28px] border border-slate-200 bg-white p-8 text-center shadow-[0_24px_60px_rgba(15,23,42,0.08)]">
              <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[var(--accent-soft)] text-[var(--accent)]">
                <ShieldIcon className="h-7 w-7" />
              </span>
              <h1 className="mt-4 text-xl font-bold text-slate-900">Not part of your role</h1>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                The school has not given you{' '}
                <strong className="font-semibold text-slate-800">
                  {LECTURER_FEATURE_LABELS[blockedFeature]}
                </strong>
                . Nothing is broken — not every tutor takes these, so the office decides who does.
              </p>
              <p className="mt-3 text-xs leading-5 text-slate-500">
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
