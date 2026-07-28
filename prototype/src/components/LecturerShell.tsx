'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';

type NavItem = {
  label: string;
  href: string;
  icon: ReactNode;
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

function ClassIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2" />
      <circle cx="9.5" cy="7" r="3" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
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

function GradeIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
      <path d="M9 13h6" />
      <path d="M9 17h6" />
    </svg>
  );
}

function MessageIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      <path d="M8 9h8" />
      <path d="M8 13h5" />
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
  { label: 'Dashboard', href: '/lecturer/dashboard', icon: <DashboardIcon className="h-4 w-4" /> },
  { label: 'My Classes', href: '/lecturer/classes', icon: <ClassIcon className="h-4 w-4" /> },
  { label: 'Materials', href: '/lecturer/materials', icon: <MaterialIcon className="h-4 w-4" /> },
  { label: 'Attendance', href: '/lecturer/attendance', icon: <AttendanceIcon className="h-4 w-4" /> },
  { label: 'Grades', href: '/lecturer/grades', icon: <GradeIcon className="h-4 w-4" /> },
  { label: 'Messages', href: '/lecturer/messages', icon: <MessageIcon className="h-4 w-4" /> },
  { label: 'Settings', href: '/lecturer/settings', icon: <SettingsIcon className="h-4 w-4" /> },
];

export default function LecturerShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="flex min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(10,124,255,0.10),_transparent_30%),linear-gradient(135deg,_#f7faff_0%,_#eef3ff_100%)] text-[var(--foreground)]">
      <aside className={`fixed left-0 top-0 z-40 flex h-screen flex-col border-r border-white/60 bg-white/80 shadow-[0_24px_70px_rgba(15,23,42,0.08)] backdrop-blur-xl transition-all duration-300 ${collapsed ? 'w-20' : 'w-72'}`}>
        <div className="border-b border-slate-200/70 p-4">
          <div className="flex items-center justify-between gap-3">
            <div className={`flex items-center gap-3 ${collapsed ? 'hidden' : ''}`}>
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-[var(--accent)] to-[var(--accent-strong)] text-sm font-semibold text-white shadow-lg shadow-[var(--accent)]/20">
                EW
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-[var(--muted)]">Lecturer</p>
                <h1 className="text-sm font-bold text-slate-900">Easyway portal</h1>
              </div>
            </div>
            <button onClick={() => setCollapsed(!collapsed)} className="rounded-xl p-2 text-slate-500 transition hover:bg-slate-100 hover:text-[var(--accent)]">
              {collapsed ? '→' : '←'}
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

      <main className={`flex-1 transition-all duration-300 ${collapsed ? 'ml-20' : 'ml-72'}`}>
        {children}
      </main>
    </div>
  );
}
