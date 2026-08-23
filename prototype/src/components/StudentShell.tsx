"use client";

import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { useEffect, useState, type ReactNode } from "react";
import CommunityLauncher from "@/components/CommunityLauncher";
import ImpersonationBanner from "@/components/ImpersonationBanner";
import PortalUpdates from "@/components/PortalUpdates";
import HelpLauncher from "@/components/HelpLauncher";
import BrandLogo from "@/components/BrandLogo";
import LiveClassCall from "@/components/live/LiveClassCall";
import MomentDock from "@/components/MomentDock";
import GameTurnToast from "@/components/GameTurnToast";
import BetaFeedbackPrompt from "@/components/BetaFeedbackPrompt";
import StudentUsageTracker from "@/components/StudentUsageTracker";
import NotificationCenter from "@/components/NotificationCenter";
import ThemeToggle, { useHideFloatingThemeToggle } from "@/components/ThemeToggle";
import PaymentLockScreen from "@/components/PaymentLockScreen";
import SignOutButton from "@/components/SignOutButton";
import { MomentQueueProvider } from "@/lib/moment-queue";
import { canAttendLive, isLiveOnlyRoute, isTuitionGatedRoute } from "@/lib/access";
import { LiveClassProvider, useLiveClass } from "@/lib/useLiveClass";
import { useStudentAccess } from "@/lib/useStudentAccess";
import {
  AssignmentIcon,
  AttendanceIcon,
  BellIcon,
  BookOpenIcon,
  BroadcastIcon,
  CalendarIcon,
  CertificateIcon,
  ChainIcon,
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
  QuizIcon,
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
  // NOT under the live-class gate. This is played in a branch classroom on
  // the phone in the student's hand, so a campus student is the intended
  // player rather than the exception.
  { label: "Quiz game", href: "/play", icon: <QuizIcon /> },
  { label: "AI Coach & Games", href: "/games", icon: <ChainIcon /> },
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

/**
 * The provider is OUTSIDE the shell body, not inside it.
 *
 * The shell itself is a consumer — the sidebar needs the live dot — and a
 * component cannot read a context it renders. Splitting it here also means the
 * poll lives above everything in the portal, so navigating between pages does
 * not tear it down and start a fresh twenty-second clock each time.
 *
 * Polling is suspended on /live: the classroom already knows it is live.
 */
export default function StudentShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const insideClassroom = pathname?.startsWith("/live") ?? false;

  return (
    <LiveClassProvider enabled={!insideClassroom}>
      <StudentShellBody>{children}</StudentShellBody>
    </LiveClassProvider>
  );
}

function StudentShellBody({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { status } = useSession();
  const { live } = useLiveClass();
  useHideFloatingThemeToggle();
  const [collapsed, setCollapsed] = useState(false);
  // Below lg the sidebar is a drawer, not a column. It used to be a fixed 288px
  // pane with the content pushed 288px right, which on a phone left the portal
  // showing a sliver of itself off the side of the screen.
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { access, hasAccess } = useStudentAccess();

  /**
   * The live classroom belongs to students who attend over video.
   *
   * A campus student who taps "Live class" finds an empty room and concludes
   * the portal is broken, so the entry is not there for them at all. While the
   * access state is still in flight `access` is null and this reads false —
   * the entry appears once we know, rather than flashing at everybody first.
   *
   * Class type is passed as well as delivery mode: a private student meets
   * their tutor wherever the session is booked, video included, and the live
   * endpoints have always let them in. Asking on mode alone is what used to
   * hide the room from the one student whose tutor had booked it.
   */
  const showsLiveClass = canAttendLive(access?.deliveryMode, access?.classType);
  const visibleNavItems = navItems.filter((item) => showsLiveClass || !isLiveOnlyRoute(item.href));

  // Navigating is the end of the drawer's job.
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  /**
   * Signed out means signed out — the same guard AdminShell has always had.
   *
   * Without this, tapping Back after signing out re-rendered the whole student
   * portal: sidebar, dashboard, quest board and all. Nothing real was in it,
   * because every fetch on this side is gated on `authenticated` and the APIs
   * refuse an anonymous caller anyway — but a shell full of zeroes and "Welcome
   * back, Learner" reads as *still signed in*, which is the one thing sign-out
   * has to disprove. On a shared phone that is the difference between handing
   * the device over and worrying about it.
   */
  useEffect(() => {
    if (status === "unauthenticated") router.replace("/auth/signin");
  }, [router, status]);

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

  // Hiding the sidebar entry is cosmetic — /live is still reachable by typing
  // it. The route is refused here too, and again on the server.
  const wrongDeliveryMode = access !== null && !showsLiveClass && isLiveOnlyRoute(pathname);

  return (
    // The queue lives in the shell rather than on the dashboard, so every
    // student page shares one director. Six components each deciding for
    // themselves when to open is how a first login came to mean five stacked
    // overlays — see lib/moment-queue.tsx.
    <MomentQueueProvider>
    <ImpersonationBanner />
    {/* Was a hardcoded blue gradient, which is why the portal stayed daylight-
        blue whatever theme was chosen. The themed canvas is the page's job. */}
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
        className={`sidebar-glass fixed left-0 top-0 z-50 flex h-dvh flex-col border-r border-[var(--border)] transition-transform duration-300 lg:z-40 lg:translate-x-0 lg:transition-all ${
          drawerOpen ? "translate-x-0" : "-translate-x-full"
        } w-[17rem] ${collapsed ? "lg:w-20" : "lg:w-72"}`}
      >
        <div className="border-b border-[var(--border)] p-4">
          <div className="flex items-center justify-between gap-3">
            {/* The wordmark already carries the school name, so it is not
                repeated beside it — only which portal you are in. */}
            {collapsed ? (
              <Link href="/dashboard" aria-label="Go to dashboard" className="hidden lg:block">
                <BrandLogo variant="mark" className="h-10 w-10" />
              </Link>
            ) : null}
            <div className={`min-w-0 ${collapsed ? "lg:hidden" : ""}`}>
              <Link href="/dashboard" aria-label="Go to dashboard">
                <BrandLogo variant="wordmark" className="h-9" />
              </Link>
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
            {visibleNavItems.map((item) => {
              const active = pathname === item.href || pathname.startsWith(item.href + "/");
              // Locked items stay clickable on purpose: tapping Classes and
              // meeting the padlock explains the paywall far better than a
              // dead, greyed-out button does.
              const locked = !hasAccess && isTuitionGatedRoute(item.href);
              // A class in progress is the one thing in this sidebar that is
              // true right now and stops being true. It gets a pulse; nothing
              // else does, which is what keeps the pulse meaning something.
              const isLiveNow = Boolean(live) && item.href === "/live";
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
                  <span className={`relative flex h-9 w-9 items-center justify-center rounded-xl border text-base shadow-sm transition ${
                    isLiveNow
                      ? "border-[#0D7C7E]/40 bg-[#0D7C7E]/10 text-[#0D7C7E]"
                      : active
                      ? "border-[var(--accent)]/30 bg-[var(--accent-soft)] text-[var(--accent)]"
                      : "border-[var(--border)] bg-[var(--surface-alt)] group-hover:border-[var(--border-strong)]"
                  }`}>
                    {item.icon}
                    {isLiveNow && (
                      <span className="absolute -right-0.5 -top-0.5 flex h-2.5 w-2.5">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-400" />
                        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-rose-500 ring-2 ring-[var(--surface)]" />
                      </span>
                    )}
                  </span>
                  {!collapsed && <span className="flex-1 font-medium">{item.label}</span>}
                  {!collapsed && isLiveNow && (
                    <span className="shrink-0 rounded-full bg-rose-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-rose-600">
                      Live
                    </span>
                  )}
                  {!collapsed && locked && !isLiveNow && <LockIcon className="h-3.5 w-3.5 shrink-0 text-[var(--accent)]/70" strokeWidth={2.2} />}
                </button>
              );
            })}
          </div>
        </nav>

        {/* The way out. Phones get shared and cybercafé machines get walked away
            from, so this is not decoration — it was missing entirely until now. */}
        <div className="border-t border-[var(--border)] p-3">
          <SignOutButton callbackUrl="/auth/signin" collapsed={collapsed} portalLabel="the student portal" />
          <p className={`mt-2 px-3 text-xs text-[var(--muted)] ${collapsed ? "lg:text-center" : ""}`}>
            {collapsed ? "v1" : "AI-ready student workspace"}
          </p>
        </div>
      </aside>

      {/*
        `min-w-0` IS THE WHOLE MOBILE FIX, and it is not obvious.

        A flex child defaults to `min-width: auto`, which means it refuses to
        shrink below the intrinsic width of its widest content. One table, one
        long unbroken email address or one grid with a fixed column anywhere in
        the student portal was therefore able to push this element wider than
        the phone — measured at 416px inside a 375px viewport — and everything
        laid out against it spilled off the right edge. The page did not even
        scroll sideways to reveal it, because the body clips: content was
        simply gone.

        That is why the symptom looked like a dozen unrelated "this page is too
        wide" bugs on a dozen different pages. There was one bug, here.

        `overflow-x-clip` is the second line of defence: a future page with a
        genuinely un-shrinkable element gets clipped locally instead of
        dragging the whole layout sideways.
      */}
      <main
        className={`min-w-0 w-0 flex-1 max-w-[100vw] overflow-x-clip transition-all duration-300 ${
          collapsed ? "lg:ml-20" : "lg:ml-72"
        }`}
      >
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
            <Link href="/dashboard" aria-label="Go to dashboard">
              <BrandLogo variant="wordmark" className="h-7" />
            </Link>
          </div>

          <p className="hidden min-w-0 flex-1 truncate text-sm font-semibold text-[var(--foreground-soft)] lg:block">
            {lockedAreaLabel === "This page" ? "Student portal" : lockedAreaLabel}
          </p>

          <ThemeToggle variant="compact" />
          <NotificationCenter />
        </header>

        {wrongDeliveryMode ? (
          <div className="mx-auto max-w-xl p-8">
            <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-8 text-center">
              <h1 className="text-2xl font-bold text-[var(--foreground)]">This is an online-class page</h1>
              <p className="mt-3 text-sm text-[var(--muted)]">
                You are registered for classes on campus, so there is no video room for your class — your lessons
                happen in person. If you would rather attend online as well, the branch office can move you to the
                online/hybrid option.
              </p>
              <button
                onClick={() => router.push("/calendar")}
                className="mt-6 rounded-full bg-[var(--accent)] px-6 py-2.5 text-sm font-semibold text-white"
              >
                See my class timetable
              </button>
            </div>
          </div>
        ) : routeLocked ? (
          <PaymentLockScreen areaLabel={lockedAreaLabel} access={access} />
        ) : (
          children
        )}
      </main>

      {/* Lives in the shell, not on one page, so the community (and its unread
          badge) is one tap away from anywhere in the portal. The community is
          itself a paid feature, so it goes away entirely while locked. */}
      {pathname !== "/community" && hasAccess && <CommunityLauncher />}

      {/*
        Deliberately NOT behind `hasAccess`. A student who cannot get into the
        portal because their payment has not landed is precisely the student who
        most needs to reach the office, and gating the help button behind the
        thing they need help with is how a paywall turns into a dead end.
      */}

      <HelpLauncher />

      {/*
        Message popups, mounted once per shell so they follow the reader onto
        every page rather than living on the community screen they are about.
        See PortalUpdates for why the card carries the real message text.
      */}
      <PortalUpdates />

      {/* Whatever the queue held back. Bottom left, because the community
          launcher and the theme switch already own the other corner. */}
      <MomentDock />

      {/* The old dashboard "waiting on you" games card, now a queued nudge
          instead of a permanent section — see lib/moment-queue.tsx. */}
      <GameTurnToast />

      {/* Outranks all of the above, and knows it. A class that has started is
          the only thing in this portal that expires while you look at it. */}
      <LiveClassCall />
      <BetaFeedbackPrompt />
      <StudentUsageTracker />
    </div>
    </MomentQueueProvider>
  );
}
