'use client';

import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { useEffect, useState, type ReactNode } from 'react';
import BrandLogo from '@/components/BrandLogo';
import NotificationCenter from '@/components/NotificationCenter';
import ThemeToggle, { useHideFloatingThemeToggle } from '@/components/ThemeToggle';
import PortalUpdates from '@/components/PortalUpdates';
import SignOutButton from '@/components/SignOutButton';
import {
  AlertIcon,
  AttendanceIcon,
  BellIcon,
  SlidersIcon,
  BookOpenIcon,
  BranchIcon,
  BriefcaseIcon,
  BroadcastIcon,
  CalendarIcon,
  CertificateIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CommunityIcon,
  CompassIcon,
  CrossIcon,
  DashboardIcon,
  ExamIcon,
  FamilyIcon,
  InboxIcon,
  IntegrationIcon,
  LecturerIcon,
  LessonBuilderIcon,
  LevelUpIcon,
  LinkIcon,
  MailIcon,
  MapIcon,
  MenuIcon,
  PaletteIcon,
  PaymentIcon,
  PencilIcon,
  PlaneIcon,
  PulseIcon,
  ResultsIcon,
  RobotIcon,
  SendIcon,
  ShieldIcon,
  TicketIcon,
  KeyIcon,
  TrendingUpIcon,
  UserPlusIcon,
  UsersIcon,
  WalletIcon,
} from '@/components/icons';
import { capabilityForAdminPath } from '@/lib/admin-routes';

type NavItem = {
  label: string;
  href: string;
  icon: ReactNode;
  group?: string;
};

/**
 * The capability each entry sits behind is no longer written here.
 *
 * It used to be a field on every nav item, which made this file one of two
 * places that knew which admin page needs which capability — and the other
 * place, the dashboard, had no such table at all, so its tiles linked wherever
 * seemed reasonable and could land a reader on "Not your area". Both now read
 * src/lib/admin-routes.ts, so a new page is classified once.
 */
const capabilityOf = (item: NavItem) => capabilityForAdminPath(item.href);

// One icon per destination. Four of the Academics entries used to share the
// same pair-of-people glyph and all three Exams entries the same page, so the
// grouping headers were doing all the work.
const navItems: NavItem[] = [
  { label: 'Dashboard', href: '/admin', icon: <DashboardIcon />, group: 'Main' },

  { label: 'Students', href: '/admin/students', icon: <UsersIcon />, group: 'Academics' },
  { label: 'Import students', href: '/admin/students/import', icon: <UserPlusIcon />, group: 'Academics' },
  // The relocation track — its own console because ₦980,000 walk-in
  // students need watching differently from the self-service roster.
  { label: 'Travel Package', href: '/admin/travel-package', icon: <PlaneIcon />, group: 'Academics' },
  { label: 'Parents', href: '/admin/parents', icon: <FamilyIcon />, group: 'Academics' },
  // Two different things that both used to be called "Enquiries". A ticket is
  // a student who is already here and stuck; a lead is a stranger the school is
  // trying to enrol. One label for both is how a help request ends up counted
  // as a conversion opportunity.
  { label: 'Enquiries', href: '/admin/enquiries', icon: <InboxIcon />, group: 'Academics' },
  { label: 'Lead funnel', href: '/admin/leads', icon: <TicketIcon />, group: 'Academics' },
  { label: 'Branches', href: '/admin/branches', icon: <BranchIcon />, group: 'Academics' },
  { label: 'Tutors', href: '/admin/lecturer-invite', icon: <LecturerIcon />, group: 'Academics' },
  { label: 'Attendance', href: '/admin/attendance', icon: <AttendanceIcon />, group: 'Academics' },
  { label: 'All schedules', href: '/admin/schedule', icon: <CalendarIcon />, group: 'Academics' },
  { label: 'Live classes', href: '/admin/live', icon: <PulseIcon />, group: 'Academics' },
  { label: 'Full timetable', href: '/lecturer/timetable', icon: <CalendarIcon />, group: 'Academics' },
  { label: 'Cohort sign-off', href: '/admin/journey', icon: <MapIcon />, group: 'Academics' },
  { label: 'Batch completions', href: '/admin/completions', icon: <ResultsIcon />, group: 'Academics' },
  { label: 'Promotions', href: '/admin/promotions', icon: <LevelUpIcon />, group: 'Academics' },
  { label: 'Certificates', href: '/admin/certificates', icon: <CertificateIcon />, group: 'Academics' },

  { label: 'Exams', href: '/admin/exams', icon: <ExamIcon />, group: 'Exams' },
  // The dashboard has counted unmarked work since it was built and had nowhere
  // to send anybody. This is that somewhere.
  { label: 'Marking queue', href: '/admin/marking', icon: <PencilIcon />, group: 'Exams' },
  // The hand-keyed side of assessment: what every tutor has entered, and who
  // is behind on it. The marking queue's counterpart for scores with no
  // submission behind them.
  { label: 'School gradebook', href: '/admin/gradebook', icon: <ResultsIcon />, group: 'Exams' },

  // Course create/delete/import used to be on the demo page at `/lecturer`,
  // an admin screen sitting in the tutor portal. It lives here now, above the
  // Materials page that reads what it produces.
  { label: 'Courses', href: '/admin/courses', icon: <LessonBuilderIcon />, group: 'Content' },
  { label: 'Materials', href: '/admin/materials', icon: <BookOpenIcon />, group: 'Content' },
  { label: 'Community', href: '/admin/community', icon: <CommunityIcon />, group: 'Content' },
  // The office's own file store — not student-facing material. Its own
  // capability (`work_drive`), so it only appears for admins who hold it.
  { label: 'Work Drive', href: '/admin/work-drive', icon: <BriefcaseIcon />, group: 'Content' },
  // The staff calendar that rides alongside it — gated on `events`.
  { label: 'Staff calendar', href: '/admin/calendar', icon: <CalendarIcon />, group: 'Content' },
  { label: 'Webinars', href: '/admin/webinars', icon: <BroadcastIcon />, group: 'Content' },

  // Finance first: for an Accountant this is the whole portal, and the
  // transaction list is what you open from it rather than the other way round.
  { label: 'Finance', href: '/admin/finance', icon: <WalletIcon />, group: 'Billing' },
  { label: 'Payments', href: '/admin/payments', icon: <PaymentIcon />, group: 'Billing' },
  { label: 'Legal & refunds', href: '/admin/legal', icon: <AlertIcon />, group: 'Billing' },
  // Money going OUT to tutors — its own capability, separate from `payments`
  // (money coming in from students). See the note in admin-roles.ts.
  { label: 'Tutor payroll', href: '/admin/payroll', icon: <WalletIcon />, group: 'Billing' },
  { label: 'Reports', href: '/admin/reports', icon: <TrendingUpIcon />, group: 'Billing' },
  // What this school owes for running on the platform ("Platform usage") is no
  // longer here. It moved to EduPrime — the platform's own space — at
  // /platform/billing, alongside the operator console. It stays reachable from
  // the low-balance notification and the top-up callback.

  // What the school's students actually DO, read as patterns rather than as a
  // list of page views. First in this group because it is the one screen here
  // that answers a question about students rather than about the software.
  { label: 'Learner patterns', href: '/admin/intelligence', icon: <CompassIcon />, group: 'Intelligence' },
  { label: 'Assistant', href: '/admin/assistant', icon: <RobotIcon />, group: 'Intelligence' },
  { label: 'AI usage', href: '/admin/ai-usage', icon: <PulseIcon />, group: 'Intelligence' },
  { label: 'Beta lab', href: '/admin/beta', icon: <PulseIcon />, group: 'Intelligence' },
  // Sat under Settings, where nobody looking for analytics would ever find
  // it, and titled with a word that told you nothing about what it showed.
  { label: 'Study plan health', href: '/admin/personalization', icon: <PaletteIcon />, group: 'Intelligence' },

  { label: 'General settings', href: '/admin/settings', icon: <SlidersIcon />, group: 'Settings' },
  { label: 'Email centre', href: '/admin/emails', icon: <MailIcon />, group: 'Settings' },
  { label: 'Compose email', href: '/admin/emails/compose', icon: <SendIcon />, group: 'Settings' },
  { label: 'Notifications', href: '/admin/notifications', icon: <BellIcon />, group: 'Settings' },
  { label: 'Notification rules', href: '/admin/notification-settings', icon: <SlidersIcon />, group: 'Settings' },
  { label: 'Admin roles', href: '/admin/staff', icon: <ShieldIcon />, group: 'Settings' },
  { label: 'Security & recovery', href: '/admin/security', icon: <KeyIcon />, group: 'Settings' },
  { label: 'Integrations', href: '/admin/integrations', icon: <IntegrationIcon />, group: 'Settings' },
  // Built with the platform layer and reachable only by POSTing JSON by hand
  // until now. The office that needs to notice an endpoint has gone quiet is
  // not the office that will open a terminal to check.
  { label: 'Webhooks', href: '/admin/webhooks', icon: <LinkIcon />, group: 'Settings' },

  // The platform operator console ("Schools & API keys") is no longer in this
  // sidebar. It is not part of running a school — it is the business that sells
  // the software to schools — so it lives in its own brand, EduPrime, at
  // /platform. Operators reach it there directly.
];

export default function AdminShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { data: session, status } = useSession();
  useHideFloatingThemeToggle();
  const [collapsed, setCollapsed] = useState(false);
  // Below lg the sidebar is a drawer. The admin area is used from a phone at
  // the front desk more often than the desktop-only layout assumed.
  const [drawerOpen, setDrawerOpen] = useState(false);
  // null while unknown — everything stays visible rather than flickering
  // items away on first paint.
  const [capabilities, setCapabilities] = useState<string[] | null>(null);
  const [adminRoleLabel, setAdminRoleLabel] = useState<string | null>(null);
  /** Help requests nobody in the office has opened yet. Drives the ping. */
  const [unreadEnquiries, setUnreadEnquiries] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/admin/me', { cache: 'no-store' });
        if (!res.ok || cancelled) return;
        const data = await res.json();
        setCapabilities(data.capabilities ?? null);
        setAdminRoleLabel(data.label ?? null);
      } catch {
        /* Leave the sidebar fully visible; the routes still enforce access. */
      }
    })();
    return () => { cancelled = true; };
  }, []);

  /**
   * THE PING.
   *
   * A help desk that has to be visited to be checked is a help desk that gets
   * checked on Fridays. `?count=1` is two indexed counts and no rows, which is
   * cheap enough to ask for on a two-minute clock from every admin page — and
   * the route refuses anybody without the `students` capability, so an
   * accountant is neither shown the badge nor charged the query.
   */
  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      try {
        const res = await fetch('/api/admin/enquiries?count=1', { cache: 'no-store' });
        if (!res.ok || cancelled) return;
        const data = await res.json();
        setUnreadEnquiries(Number(data.unread) || 0);
      } catch {
        /* A missing badge is not worth a console full of noise. */
      }
    };

    poll();
    const timer = window.setInterval(poll, 120_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, []);

  const groups = ['Main', 'Academics', 'Exams', 'Content', 'Billing', 'Intelligence', 'Settings'];

  useEffect(() => {
    if (status === 'unauthenticated' || (status === 'authenticated' && session?.user?.role?.toLowerCase() !== 'admin')) {
      router.replace('/auth/admin');
    }
  }, [router, session?.user?.role, status]);

  if (status === 'loading') {
    return <div className="app-canvas flex min-h-screen items-center justify-center text-[var(--foreground-soft)]">Loading admin portal...</div>;
  }

  if (status === 'unauthenticated' || session?.user?.role?.toLowerCase() !== 'admin') {
    return <div className="app-canvas flex min-h-screen items-center justify-center text-[var(--foreground-soft)]">Redirecting to admin sign-in...</div>;
  }

  /**
   * THE DOOR, not just the signpost.
   *
   * Hiding a nav item is presentation; it is not access control, and it was
   * the only thing standing between a Secretary and `/admin/payments` if they
   * typed the URL, followed an old bookmark, or hit browser history. The APIs
   * behind those pages do refuse them — which is why nothing leaked — but what
   * the person actually saw was the full payments screen with every panel
   * empty or spinning, indistinguishable from the portal being broken. On a
   * Monday full-test that is a bug report, and the person filing it is right
   * to file it.
   *
   * So the shell renders a plain refusal instead. `capabilities === null`
   * means the lookup has not answered yet and nothing is blocked — a network
   * hiccup must not lock an admin out of their own portal, and the routes are
   * still the real enforcement either way.
   */
  /**
   * THE LONGEST MATCH WINS, and that is not a detail.
   *
   * The obvious `navItems.find(item => pathname.startsWith(item.href + '/'))`
   * is wrong here because the very first entry is Dashboard at `/admin`, and
   * every admin path in the product starts with `/admin/`. So the lookup
   * matched Dashboard for `/admin/payments`, Dashboard carries no capability,
   * and the gate silently passed everything — a Secretary got the full
   * payments screen reading "No payments recorded yet", which is worse than
   * no gate at all because it states something false about the school.
   */
  const currentArea = navItems
    .filter((item) => pathname === item.href || pathname.startsWith(item.href + '/'))
    .sort((a, b) => b.href.length - a.href.length)[0];

  const currentCapability = currentArea ? capabilityOf(currentArea) : null;
  const blocked = Boolean(
    currentCapability && capabilities !== null && !capabilities.includes(currentCapability),
  );

  return (
    <div className="app-canvas flex min-h-screen text-[var(--foreground)]">
      {drawerOpen && (
        <button
          aria-label="Close menu"
          onClick={() => setDrawerOpen(false)}
          className="fixed inset-0 z-40 cursor-default bg-slate-950/40 backdrop-blur-sm lg:hidden"
        />
      )}

      {/* Sidebar */}
      <aside
        className={`sidebar-glass fixed left-0 top-0 z-50 flex h-dvh flex-col border-r border-[var(--border)] transition-transform duration-300 lg:z-40 lg:translate-x-0 lg:transition-all ${
          drawerOpen ? 'translate-x-0' : '-translate-x-full'
        } w-[17rem] ${collapsed ? 'lg:w-20' : 'lg:w-72'}`}
      >
        {/* Header */}
        <div className="border-b border-[var(--border)] p-4">
          {/* Collapsed rail (desktop only): the brand mark stacked over a
              full-width expand control, both centred so nothing is crammed
              against the edge of the 80px rail. */}
          {collapsed && (
            <div className="hidden flex-col items-center gap-3 lg:flex">
              <Link href="/admin" aria-label="Go to dashboard">
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
            {/* The real logo, not an "AW" placeholder — the school has artwork
                and every other portal was already using it. */}
            <div className="min-w-0">
              <Link href="/admin" aria-label="Go to dashboard">
                <BrandLogo variant="wordmark" className="h-8" />
              </Link>
              <p className="mt-1.5 text-[11px] font-semibold uppercase tracking-[0.28em] text-[var(--muted)]">
                Admin portal
              </p>
              {adminRoleLabel && (
                <p className="text-[11px] font-medium text-[var(--accent)]">{adminRoleLabel}</p>
              )}
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

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto p-3">
          {groups.map((group) => {
            // Hide areas this admin's sub-role does not cover. The routes
            // enforce it too — this only avoids showing doors that 403.
            const groupItems = navItems.filter((item) => {
              if (item.group !== group) return false;
              const capability = capabilityOf(item);
              return !capability || capabilities === null || capabilities.includes(capability);
            });
            if (groupItems.length === 0) return null;
            return (
              <div
                key={group}
                className={
                  collapsed
                    ? 'mb-3 lg:mt-3 lg:border-t lg:border-[var(--border)] lg:pt-3 lg:first:mt-0 lg:first:border-t-0 lg:first:pt-0'
                    : 'mb-6'
                }
              >
                {!collapsed && (
                  <p className="mb-3 px-3 text-xs font-bold uppercase tracking-[0.3em] text-[var(--muted)]">{group}</p>
                )}
                <div className="space-y-1">
                  {groupItems.map((item) => {
                    const active = pathname === item.href || pathname.startsWith(item.href + '/');
                    // One badge in the whole sidebar, and it is on the one
                    // entry where a number means "somebody is waiting".
                    const badge = item.href === '/admin/enquiries' ? unreadEnquiries : 0;
                    return (
                      <button
                        key={item.href}
                        onClick={() => {
                          setDrawerOpen(false);
                          router.push(item.href);
                        }}
                        title={collapsed ? item.label : ''}
                        className={`group flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left text-sm transition-all duration-200 ${
                          collapsed ? 'lg:justify-center lg:gap-0 lg:px-0' : ''
                        } ${
                          active
                            ? 'bg-[var(--accent-soft)] text-[var(--accent)] shadow-[0_8px_24px_rgba(255,102,0,0.12)]'
                            : 'text-[var(--foreground-soft)] hover:bg-[var(--surface-alt)] hover:text-[var(--foreground)]'
                        }`}
                      >
                        <span
                          className={`relative flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface-alt)] text-base shadow-sm transition ${
                            active ? 'border-[var(--accent)]/30 bg-[var(--accent-soft)] text-[var(--accent)]' : 'group-hover:border-[var(--border-strong)]'
                          }`}
                        >
                          {item.icon}
                          {/* Collapsed, the label is gone and the count with
                              it — so the icon itself carries a dot, which is
                              the only thing that still fits. */}
                          {badge > 0 && collapsed ? (
                            <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-[var(--accent)] ring-2 ring-[var(--surface-alt)] lg:block" />
                          ) : null}
                        </span>
                        {!collapsed && <span className="flex-1 font-medium">{item.label}</span>}
                        {!collapsed && badge > 0 ? (
                          <span className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-[var(--accent)] px-1.5 text-[10px] font-bold text-white">
                            {badge > 99 ? '99+' : badge}
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="border-t border-[var(--border)] p-3">
          {/* Of the three portals this is the one that most needs a way out —
              an admin left signed in on an office machine exposes every
              student record, payment and staff account in the school. */}
          <SignOutButton callbackUrl="/auth/admin" collapsed={collapsed} tone="slate" portalLabel="the admin portal" />
          <p className={`mt-2 px-3 text-xs text-[var(--muted)] ${collapsed ? 'lg:text-center' : ''}`}>
            {collapsed ? 'v1' : 'Professional admin panel'}
          </p>
        </div>
      </aside>

      {/* Main Content */}
      {/* See the note in LecturerShell: a flex child defaults to
          `min-width: auto` and will not shrink below its widest content, and
          `body { overflow-x: hidden }` then hides the overflow instead of
          letting the page scroll to it. The admin area is the worst case for
          this — it is nothing but wide tables of emails and amounts. */}
      <main className={`min-w-0 flex-1 overflow-x-clip transition-all duration-300 ${collapsed ? 'lg:ml-20' : 'lg:ml-72'}`}>
        <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-[var(--border)] bg-[var(--surface-soft)] px-3 py-2 backdrop-blur-xl sm:px-6">
          <button
            onClick={() => setDrawerOpen(true)}
            aria-label="Open menu"
            className="grid h-10 w-10 place-items-center rounded-xl text-[var(--muted)] transition hover:bg-[var(--surface-alt)] lg:hidden"
          >
            <MenuIcon className="h-5 w-5" />
          </button>

          <div className="min-w-0 flex-1 lg:hidden">
            <Link href="/admin" aria-label="Go to dashboard">
              <BrandLogo variant="wordmark" className="h-7" />
            </Link>
          </div>

          <p className="hidden min-w-0 flex-1 truncate text-sm font-semibold text-[var(--foreground-soft)] lg:block">
            {navItems.find((item) => pathname === item.href)?.label ?? 'Admin'}
          </p>

          <ThemeToggle variant="compact" />
          <NotificationCenter />
        </header>

        <div className="app-canvas min-h-screen p-4 sm:p-6 lg:p-8">
          <div className="mx-auto max-w-7xl">
            {blocked ? (
              <div className="mx-auto mt-10 max-w-lg rounded-[28px] border border-[var(--border)] bg-[var(--surface)] p-8 text-center shadow-[var(--shadow)]">
                <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[var(--accent-soft)] text-[var(--accent)]">
                  <ShieldIcon className="h-7 w-7" />
                </span>
                <h1 className="mt-4 text-xl font-bold text-[var(--foreground)]">Not your area</h1>
                {/* Not `${label}s do not cover` — that renders "Secretarys",
                    and a permissions screen that cannot spell the role is not
                    one anybody trusts. The label goes in parentheses instead,
                    which works for every role name including future ones. */}
                <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                  Your admin role{adminRoleLabel ? ` (${adminRoleLabel})` : ''} does not cover{' '}
                  <strong className="font-semibold text-[var(--foreground)]">{currentArea?.label}</strong>. Nothing is broken —
                  this is simply not part of your role.
                </p>
                <p className="mt-3 text-xs leading-5 text-[var(--muted)]">
                  A super admin can hand you this one from Admin roles, without changing anybody else&rsquo;s access.
                </p>
                <button
                  type="button"
                  onClick={() => router.push('/admin')}
                  className="mt-5 rounded-full bg-[var(--accent)] px-6 py-3 text-sm font-bold text-white transition hover:brightness-110"
                >
                  Back to my dashboard
                </button>
              </div>
            ) : (
              children
            )}
          </div>
        </div>

      </main>

      {/*
        Message popups, mounted once per shell so they follow the reader onto
        every page rather than living on the community screen they are about.
        See PortalUpdates for why the card carries the real message text.
      */}
      <PortalUpdates />

    </div>
  );
}
