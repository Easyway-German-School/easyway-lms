'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import BrandLogo from "@/components/BrandLogo";
import NotificationCenter from "@/components/NotificationCenter";
import {
  AssignmentIcon,
  AttendanceIcon,
  BookOpenIcon,
  BroadcastIcon,
  BroadcastMessageIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CrossIcon,
  CustomiseIcon,
  DashboardIcon,
  ExamIcon,
  GradebookIcon,
  LessonBuilderIcon,
  MailIcon,
  MenuIcon,
  PrivateClassIcon,
  SettingsIcon,
  TimetableIcon,
  UsersIcon,
} from "@/components/icons";

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
  { label: 'Customise my classes', href: '/lecturer/classes', icon: <CustomiseIcon /> },
  { label: 'My students', href: '/lecturer/students', icon: <UsersIcon /> },
  { label: 'Timetable', href: '/lecturer/timetable', icon: <TimetableIcon /> },
  { label: 'Private classes', href: '/lecturer/private-classes', icon: <PrivateClassIcon /> },
  { label: 'Assignments', href: '/lecturer/assignments', icon: <AssignmentIcon /> },
  { label: 'Materials', href: '/lecturer/materials', icon: <BookOpenIcon /> },
  { label: 'Attendance', href: '/lecturer/attendance', icon: <AttendanceIcon /> },
  { label: 'Exam/Test', href: '/lecturer/grades', icon: <ExamIcon /> },
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
  // Below lg the sidebar is a drawer. A tutor marking attendance on their
  // phone had 288px of the 375px screen taken by a sidebar they could not
  // dismiss.
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

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
        className={`fixed left-0 top-0 z-50 flex h-screen flex-col border-r border-white/60 bg-white/95 shadow-[0_24px_70px_rgba(15,23,42,0.08)] backdrop-blur-xl transition-transform duration-300 lg:z-40 lg:translate-x-0 lg:bg-white/80 lg:transition-all ${
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
            {navItems.map((item) => {
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

        <div className={`border-t border-slate-200/70 p-4 ${collapsed ? 'text-center' : ''}`}>
          <p className="text-xs text-slate-500">{collapsed ? 'v1' : 'AI-ready lecturer workspace'}</p>
        </div>
      </aside>

      <main className={`flex-1 transition-all duration-300 ${collapsed ? 'lg:ml-20' : 'lg:ml-72'}`}>
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

        {children}
      </main>
    </div>
  );
}
