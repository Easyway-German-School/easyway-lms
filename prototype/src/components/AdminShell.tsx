'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useEffect, useState, type ReactNode } from 'react';

type NavItem = {
  capability?: string;
  label: string;
  href: string;
  icon: ReactNode;
  group?: string;
};

function DashboardIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="4" rx="1.5" />
      <rect x="14" y="9" width="7" height="12" rx="1.5" />
      <rect x="3" y="12" width="7" height="9" rx="1.5" />
    </svg>
  );
}

function StudentsIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="3" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function BranchIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  );
}

function LecturerIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="3" />
      <path d="M2 12a6 6 0 1 0 12 0 6 6 0 0 0-12 0" />
    </svg>
  );
}

function AttendanceIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M8 2v4" />
      <path d="M16 2v4" />
      <path d="M3 10h18" />
      <path d="M8 14h3" />
      <path d="M8 18h8" />
    </svg>
  );
}

function ExamIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <path d="M9 15h2" />
      <path d="M13 15h2" />
      <path d="M9 11h6" />
    </svg>
  );
}

function MaterialIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v15H6.5A2.5 2.5 0 0 0 4 19.5V4.5A2.5 2.5 0 0 1 6.5 2Z" />
      <path d="M8 7h8" />
      <path d="M8 11h8" />
    </svg>
  );
}

function CommunityIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      <path d="M8 9h8" />
      <path d="M8 13h5" />
    </svg>
  );
}

function PaymentIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="1" y="4" width="22" height="16" rx="2.5" ry="2.5" />
      <path d="M1 10h22" />
      <circle cx="5.5" cy="14" r="1.5" />
    </svg>
  );
}

function NotificationIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

function IntegrationIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 5v14" />
      <path d="M5 12h14" />
      <circle cx="12" cy="12" r="2" />
    </svg>
  );
}

function SettingsIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01A1.65 1.65 0 0 0 10 3.09V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01A1.65 1.65 0 0 0 20.91 10H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
    </svg>
  );
}

const navItems: NavItem[] = [
  { label: 'Dashboard', href: '/admin', icon: <DashboardIcon className="h-4 w-4" />, group: 'Main' },
  
  { label: 'Students', href: '/admin/students', capability: 'students' as const, icon: <StudentsIcon className="h-4 w-4" />, group: 'Academics' },
  { label: 'Import students', href: '/admin/students/import', capability: 'students' as const, icon: <StudentsIcon className="h-4 w-4" />, group: 'Academics' },
  { label: 'Enquiries', href: '/admin/leads', capability: 'students' as const, icon: <StudentsIcon className="h-4 w-4" />, group: 'Academics' },
  { label: 'Branches', href: '/admin/branches', capability: 'branches' as const, icon: <BranchIcon className="h-4 w-4" />, group: 'Academics' },
  { label: 'Lecturers', href: '/admin/lecturer-invite', capability: 'staff' as const, icon: <LecturerIcon className="h-4 w-4" />, group: 'Academics' },
  { label: 'Attendance', href: '/admin/attendance', capability: 'attendance' as const, icon: <AttendanceIcon className="h-4 w-4" />, group: 'Academics' },
  { label: 'Promotions', href: '/admin/promotions', capability: 'students' as const, icon: <StudentsIcon className="h-4 w-4" />, group: 'Academics' },
  
  { label: 'Exams', href: '/admin/exams', capability: 'exams' as const, icon: <ExamIcon className="h-4 w-4" />, group: 'Exams' },
  { label: 'Exam centre', href: '/admin/exam-centre', capability: 'exams' as const, icon: <ExamIcon className="h-4 w-4" />, group: 'Exams' },
  { label: 'Exam Registrations', href: '/admin/exam-registrations', capability: 'exams' as const, icon: <ExamIcon className="h-4 w-4" />, group: 'Exams' },
  
  { label: 'Materials', href: '/admin/materials', capability: 'materials' as const, icon: <MaterialIcon className="h-4 w-4" />, group: 'Content' },
  { label: 'Community', href: '/admin/community', capability: 'community' as const, icon: <CommunityIcon className="h-4 w-4" />, group: 'Content' },
  
  { label: 'Payments', href: '/admin/payments', capability: 'payments' as const, icon: <PaymentIcon className="h-4 w-4" />, group: 'Billing' },
  
  { label: 'Compose email', href: '/admin/emails/compose', capability: 'emails' as const, icon: <NotificationIcon className="h-4 w-4" />, group: 'Settings' },
  { label: 'Notifications', href: '/admin/notifications', capability: 'emails' as const, icon: <NotificationIcon className="h-4 w-4" />, group: 'Settings' },
  { label: 'Admin roles', href: '/admin/staff', capability: 'staff' as const, icon: <SettingsIcon className="h-4 w-4" />, group: 'Settings' },
  { label: 'Integrations', href: '/admin/integrations', capability: 'integrations' as const, icon: <IntegrationIcon className="h-4 w-4" />, group: 'Settings' },
  { label: 'Personalization', href: '/admin/personalization', icon: <SettingsIcon className="h-4 w-4" />, group: 'Settings' },
];

export default function AdminShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { data: session, status } = useSession();
  const [collapsed, setCollapsed] = useState(false);
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

  const groups = ['Main', 'Academics', 'Exams', 'Content', 'Billing', 'Settings'];

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

  return (
    <div className="flex min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(255,102,0,0.08),_transparent_40%),linear-gradient(135deg,_#f9f7f5_0%,_#fffbf8_100%)] text-[var(--foreground)]">
      {/* Sidebar */}
      <aside className={`fixed left-0 top-0 z-40 flex h-screen flex-col border-r border-white/60 bg-white/85 shadow-[0_24px_70px_rgba(15,23,42,0.08)] backdrop-blur-xl transition-all duration-300 ${collapsed ? 'w-20' : 'w-72'}`}>
        {/* Header */}
        <div className="border-b border-slate-200/70 p-4">
          <div className="flex items-center justify-between gap-3">
            <div className={`flex items-center gap-3 ${collapsed ? 'hidden' : ''}`}>
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-[var(--accent)] to-[var(--accent-strong)] text-sm font-semibold text-white shadow-lg shadow-[var(--accent)]/20">
                AW
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-[var(--muted)]">Admin</p>
                <h1 className="text-sm font-bold text-slate-900">Easyway Admin</h1>
                {adminRoleLabel && (
                  <p className="text-[11px] font-medium text-[var(--accent)]">{adminRoleLabel}</p>
                )}
              </div>
            </div>
            <button
              onClick={() => setCollapsed(!collapsed)}
              className="rounded-xl p-2 text-slate-500 transition hover:bg-slate-100 hover:text-[var(--accent)]"
            >
              {collapsed ? '→' : '←'}
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
      <main className={`flex-1 transition-all duration-300 ${collapsed ? 'ml-20' : 'ml-72'}`}>
        <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(255,102,0,0.08),_transparent_40%),linear-gradient(135deg,_#f9f7f5_0%,_#fffbf8_100%)] p-8">
          <div className="mx-auto max-w-7xl">{children}</div>
        </div>
      </main>
    </div>
  );
}
