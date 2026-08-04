'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useEffect, useState, type ReactNode } from 'react';
import BrandLogo from '@/components/BrandLogo';
import NotificationCenter from '@/components/NotificationCenter';
import {
  AttendanceIcon,
  BellIcon,
  SlidersIcon,
  BookOpenIcon,
  BranchIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CommunityIcon,
  CrossIcon,
  DashboardIcon,
  ExamCentreIcon,
  ExamIcon,
  InboxIcon,
  IntegrationIcon,
  LecturerIcon,
  LessonBuilderIcon,
  LevelUpIcon,
  MailIcon,
  MapIcon,
  MenuIcon,
  PaletteIcon,
  PaymentIcon,
  RobotIcon,
  RosterIcon,
  SendIcon,
  ShieldIcon,
  KeyIcon,
  TrendingUpIcon,
  UserPlusIcon,
  UsersIcon,
  WalletIcon,
} from '@/components/icons';

type NavItem = {
  capability?: string;
  label: string;
  href: string;
  icon: ReactNode;
  group?: string;
};

// One icon per destination. Four of the Academics entries used to share the
// same pair-of-people glyph and all three Exams entries the same page, so the
// grouping headers were doing all the work.
const navItems: NavItem[] = [
  { label: 'Dashboard', href: '/admin', icon: <DashboardIcon />, group: 'Main' },

  { label: 'Students', href: '/admin/students', capability: 'students' as const, icon: <UsersIcon />, group: 'Academics' },
  { label: 'Import students', href: '/admin/students/import', capability: 'students' as const, icon: <UserPlusIcon />, group: 'Academics' },
  { label: 'Enquiries', href: '/admin/leads', capability: 'students' as const, icon: <InboxIcon />, group: 'Academics' },
  { label: 'Branches', href: '/admin/branches', capability: 'branches' as const, icon: <BranchIcon />, group: 'Academics' },
  { label: 'Tutors', href: '/admin/lecturer-invite', capability: 'staff' as const, icon: <LecturerIcon />, group: 'Academics' },
  { label: 'Attendance', href: '/admin/attendance', capability: 'attendance' as const, icon: <AttendanceIcon />, group: 'Academics' },
  { label: 'Cohort sign-off', href: '/admin/journey', capability: 'students' as const, icon: <MapIcon />, group: 'Academics' },
  { label: 'Promotions', href: '/admin/promotions', capability: 'students' as const, icon: <LevelUpIcon />, group: 'Academics' },

  { label: 'Exams', href: '/admin/exams', capability: 'exams' as const, icon: <ExamIcon />, group: 'Exams' },
  { label: 'Exam centre', href: '/admin/exam-centre', capability: 'exams' as const, icon: <ExamCentreIcon />, group: 'Exams' },
  { label: 'Exam Registrations', href: '/admin/exam-registrations', capability: 'exams' as const, icon: <RosterIcon />, group: 'Exams' },

  // Course create/delete/import used to be on the demo page at `/lecturer`,
  // an admin screen sitting in the tutor portal. It lives here now, above the
  // Materials page that reads what it produces.
  { label: 'Courses', href: '/admin/courses', capability: 'materials' as const, icon: <LessonBuilderIcon />, group: 'Content' },
  { label: 'Materials', href: '/admin/materials', capability: 'materials' as const, icon: <BookOpenIcon />, group: 'Content' },
  { label: 'Community', href: '/admin/community', capability: 'community' as const, icon: <CommunityIcon />, group: 'Content' },

  { label: 'Payments', href: '/admin/payments', capability: 'payments' as const, icon: <PaymentIcon />, group: 'Billing' },
  // These three pages existed and were reachable from nowhere — built, then
  // never added to the sidebar, so nobody in the office knew they were there.
  { label: 'Finance overview', href: '/admin/finance', capability: 'payments' as const, icon: <WalletIcon />, group: 'Billing' },
  { label: 'Reports', href: '/admin/reports', capability: 'reports' as const, icon: <TrendingUpIcon />, group: 'Billing' },

  { label: 'Assistant', href: '/admin/assistant', icon: <RobotIcon />, group: 'Intelligence' },

  { label: 'Email centre', href: '/admin/emails', capability: 'emails' as const, icon: <MailIcon />, group: 'Settings' },
  { label: 'Compose email', href: '/admin/emails/compose', capability: 'emails' as const, icon: <SendIcon />, group: 'Settings' },
  { label: 'Notifications', href: '/admin/notifications', capability: 'emails' as const, icon: <BellIcon />, group: 'Settings' },
  { label: 'Notification rules', href: '/admin/notification-settings', capability: 'emails' as const, icon: <SlidersIcon />, group: 'Settings' },
  { label: 'Admin roles', href: '/admin/staff', capability: 'staff' as const, icon: <ShieldIcon />, group: 'Settings' },
  { label: 'Security & recovery', href: '/admin/security', capability: 'security' as const, icon: <KeyIcon />, group: 'Settings' },
  { label: 'Integrations', href: '/admin/integrations', capability: 'integrations' as const, icon: <IntegrationIcon />, group: 'Settings' },
  // Matches the capability its API now requires. A nav entry that leads
  // somewhere its own endpoint refuses is worse than no nav entry.
  { label: 'Personalization', href: '/admin/personalization', capability: 'reports' as const, icon: <PaletteIcon />, group: 'Settings' },
];

export default function AdminShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { data: session, status } = useSession();
  const [collapsed, setCollapsed] = useState(false);
  // Below lg the sidebar is a drawer. The admin area is used from a phone at
  // the front desk more often than the desktop-only layout assumed.
  const [drawerOpen, setDrawerOpen] = useState(false);
  // null while unknown — everything stays visible rather than flickering
  // items away on first paint.
  const [capabilities, setCapabilities] = useState<string[] | null>(null);
  const [adminRoleLabel, setAdminRoleLabel] = useState<string | null>(null);

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

  const groups = ['Main', 'Academics', 'Exams', 'Content', 'Billing', 'Intelligence', 'Settings'];

  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (status === 'unauthenticated' || (status === 'authenticated' && session?.user?.role?.toLowerCase() !== 'admin')) {
      router.replace('/auth/admin');
    }
  }, [router, session?.user?.role, status]);

  if (status === 'loading') {
    return <div className="flex min-h-screen items-center justify-center bg-[#fffbf8] text-slate-700">Loading admin portal...</div>;
  }

  if (status === 'unauthenticated' || session?.user?.role?.toLowerCase() !== 'admin') {
    return <div className="flex min-h-screen items-center justify-center bg-[#fffbf8] text-slate-700">Redirecting to admin sign-in...</div>;
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

  const blocked = Boolean(
    currentArea?.capability &&
      capabilities !== null &&
      !capabilities.includes(currentArea.capability),
  );

  return (
    <div className="flex min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(255,102,0,0.08),_transparent_40%),linear-gradient(135deg,_#f9f7f5_0%,_#fffbf8_100%)] text-[var(--foreground)]">
      {drawerOpen && (
        <button
          aria-label="Close menu"
          onClick={() => setDrawerOpen(false)}
          className="fixed inset-0 z-40 cursor-default bg-slate-950/40 backdrop-blur-sm lg:hidden"
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed left-0 top-0 z-50 flex h-screen flex-col border-r border-white/60 bg-white/95 shadow-[0_24px_70px_rgba(15,23,42,0.08)] backdrop-blur-xl transition-transform duration-300 lg:z-40 lg:translate-x-0 lg:bg-white/85 lg:transition-all ${
          drawerOpen ? 'translate-x-0' : '-translate-x-full'
        } w-[17rem] ${collapsed ? 'lg:w-20' : 'lg:w-72'}`}
      >
        {/* Header */}
        <div className="border-b border-slate-200/70 p-4">
          <div className="flex items-center justify-between gap-3">
            {/* The real logo, not an "AW" placeholder — the school has artwork
                and every other portal was already using it. */}
            <div className={`min-w-0 ${collapsed ? 'lg:hidden' : ''}`}>
              <BrandLogo variant="wordmark" className="h-8" />
              <p className="mt-1.5 text-[11px] font-semibold uppercase tracking-[0.28em] text-[var(--muted)]">
                Admin portal
              </p>
              {adminRoleLabel && (
                <p className="text-[11px] font-medium text-[var(--accent)]">{adminRoleLabel}</p>
              )}
            </div>
            {collapsed && <BrandLogo variant="mark" className="hidden h-10 w-10 lg:block" />}

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

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto p-3">
          {groups.map((group) => {
            // Hide areas this admin's sub-role does not cover. The routes
            // enforce it too — this only avoids showing doors that 403.
            const groupItems = navItems.filter(
              (item) =>
                item.group === group &&
                (!item.capability || capabilities === null || capabilities.includes(item.capability)),
            );
            if (groupItems.length === 0) return null;
            return (
              <div key={group} className="mb-6">
                {!collapsed && (
                  <p className="mb-3 px-3 text-xs font-bold uppercase tracking-[0.3em] text-slate-500">{group}</p>
                )}
                <div className="space-y-1">
                  {groupItems.map((item) => {
                    const active = pathname === item.href || pathname.startsWith(item.href + '/');
                    return (
                      <button
                        key={item.href}
                        onClick={() => router.push(item.href)}
                        title={collapsed ? item.label : ''}
                        className={`group flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left text-sm transition-all duration-200 ${
                          active
                            ? 'bg-[var(--accent-soft)] text-[var(--accent)] shadow-[0_8px_24px_rgba(255,102,0,0.12)]'
                            : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
                        }`}
                      >
                        <span
                          className={`flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white/80 text-base shadow-sm transition ${
                            active ? 'border-[var(--accent)]/30 bg-[var(--accent-soft)] text-[var(--accent)]' : 'group-hover:border-slate-300'
                          }`}
                        >
                          {item.icon}
                        </span>
                        {!collapsed && <span className="font-medium">{item.label}</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>

        {/* Footer */}
        <div className={`border-t border-slate-200/70 p-4 ${collapsed ? 'text-center' : ''}`}>
          <p className="text-xs text-slate-500">{collapsed ? 'v1' : 'Professional admin panel'}</p>
        </div>
      </aside>

      {/* Main Content */}
      {/* See the note in LecturerShell: a flex child defaults to
          `min-width: auto` and will not shrink below its widest content, and
          `body { overflow-x: hidden }` then hides the overflow instead of
          letting the page scroll to it. The admin area is the worst case for
          this — it is nothing but wide tables of emails and amounts. */}
      <main className={`min-w-0 flex-1 overflow-x-clip transition-all duration-300 ${collapsed ? 'lg:ml-20' : 'lg:ml-72'}`}>
        <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-white/60 bg-white/80 px-3 py-2 backdrop-blur-xl sm:px-6">
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
            {navItems.find((item) => pathname === item.href)?.label ?? 'Admin'}
          </p>

          <NotificationCenter />
        </header>

        <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(255,102,0,0.08),_transparent_40%),linear-gradient(135deg,_#f9f7f5_0%,_#fffbf8_100%)] p-4 sm:p-6 lg:p-8">
          <div className="mx-auto max-w-7xl">
            {blocked ? (
              <div className="mx-auto mt-10 max-w-lg rounded-[28px] border border-slate-200 bg-white p-8 text-center shadow-[0_24px_60px_rgba(15,23,42,0.08)]">
                <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[var(--accent-soft)] text-[var(--accent)]">
                  <ShieldIcon className="h-7 w-7" />
                </span>
                <h1 className="mt-4 text-xl font-bold text-slate-900">Not your area</h1>
                {/* Not `${label}s do not cover` — that renders "Secretarys",
                    and a permissions screen that cannot spell the role is not
                    one anybody trusts. The label goes in parentheses instead,
                    which works for every role name including future ones. */}
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  Your admin role{adminRoleLabel ? ` (${adminRoleLabel})` : ''} does not cover{' '}
                  <strong className="font-semibold text-slate-800">{currentArea?.label}</strong>. Nothing is broken —
                  this is simply not part of your role.
                </p>
                <p className="mt-3 text-xs leading-5 text-slate-500">
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
    </div>
  );
}
