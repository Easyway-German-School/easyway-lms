'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import LecturerShell from '@/components/LecturerShell';

function StatIcon({ children }: { children: React.ReactNode }) {
  return <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[var(--accent-soft)] text-[var(--accent)] shadow-sm">{children}</span>;
}

function DashboardCardIcon({ className }: { className?: string }) {
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
      <path d="M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2" />
      <circle cx="9.5" cy="7" r="3" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function MaterialsIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v15H6.5A2.5 2.5 0 0 0 4 19.5V4.5A2.5 2.5 0 0 1 6.5 2Z" />
      <path d="M8 7h8" />
      <path d="M8 11h8" />
    </svg>
  );
}

function AttendanceRateIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 12h18" />
      <path d="M12 3v18" />
      <path d="M4 4l16 16" />
      <path d="M4 20 20 4" />
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

interface DashboardStats {
  totalClasses: number;
  totalStudents: number;
  totalMaterials: number;
  averageAttendance: number;
}

export default function LecturerDashboard() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/auth/lecturer/signin');
      return;
    }

    if (status === 'authenticated') {
      fetchStats();
    }
  }, [status, router]);

  async function fetchStats() {
    try {
      const res = await fetch('/api/lecturer/dashboard');
      
      if (res.status === 401) {
        router.push('/auth/lecturer/signin');
        return;
      }

      if (!res.ok) throw new Error('Failed to fetch stats');
      
      const data = await res.json();
      setStats(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  }

  if (status === 'loading' || loading) {
    return (
      <LecturerShell>
        <div className="flex items-center justify-center h-screen">
          <div className="text-center">
            <div className="mb-4 flex justify-center">
              <div className="h-10 w-10 animate-spin rounded-full border-2 border-[var(--accent)]/25 border-t-[var(--accent)]" />
            </div>
            <p className="text-[var(--foreground)]">Loading...</p>
          </div>
        </div>
      </LecturerShell>
    );
  }

  return (
    <LecturerShell>
      <div className="h-screen overflow-y-auto">
        {/* Header */}
        <div className="bg-gradient-to-r from-[var(--accent)]/20 to-transparent p-6 border-b border-[var(--border)]">
          <div className="max-w-7xl">
            <h1 className="text-3xl font-bold text-[var(--foreground)]">
              Welcome back, {session?.user?.name || 'Lecturer'}
            </h1>
            <p className="text-[var(--muted)] mt-2">
              Manage your classes, upload materials, and track student progress
            </p>
          </div>
        </div>

        {/* Stats Grid */}
        {error ? (
          <div className="max-w-7xl mx-auto p-6">
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-800">
              {error}
            </div>
          </div>
        ) : stats ? (
          <div className="max-w-7xl mx-auto p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Total Classes */}
              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg p-6 hover:shadow-md transition-shadow">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-[var(--muted)] text-sm">Total Classes</p>
                    <h3 className="text-3xl font-bold text-[var(--foreground)] mt-2">
                      {stats.totalClasses}
                    </h3>
                  </div>
                  <StatIcon><StudentsIcon className="h-5 w-5" /></StatIcon>
                </div>
                <p className="text-xs text-[var(--muted)] mt-3">Classes assigned</p>
              </div>

              {/* Total Students */}
              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg p-6 hover:shadow-md transition-shadow">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-[var(--muted)] text-sm">Total Students</p>
                    <h3 className="text-3xl font-bold text-[var(--foreground)] mt-2">
                      {stats.totalStudents}
                    </h3>
                  </div>
                  <StatIcon><DashboardCardIcon className="h-5 w-5" /></StatIcon>
                </div>
                <p className="text-xs text-[var(--muted)] mt-3">Enrolled students</p>
              </div>

              {/* Materials */}
              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg p-6 hover:shadow-md transition-shadow">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-[var(--muted)] text-sm">Materials Uploaded</p>
                    <h3 className="text-3xl font-bold text-[var(--foreground)] mt-2">
                      {stats.totalMaterials}
                    </h3>
                  </div>
                  <StatIcon><MaterialsIcon className="h-5 w-5" /></StatIcon>
                </div>
                <p className="text-xs text-[var(--muted)] mt-3">Available resources</p>
              </div>

              {/* Attendance Rate */}
              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg p-6 hover:shadow-md transition-shadow">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-[var(--muted)] text-sm">Avg Attendance</p>
                    <h3 className="text-3xl font-bold text-[var(--foreground)] mt-2">
                      {stats.averageAttendance}%
                    </h3>
                  </div>
                  <StatIcon><AttendanceRateIcon className="h-5 w-5" /></StatIcon>
                </div>
                <p className="text-xs text-[var(--muted)] mt-3">Student average</p>
              </div>
            </div>

            {/* Quick Actions */}
            <div className="mt-8">
              <h2 className="text-xl font-bold text-[var(--foreground)] mb-4">Quick Actions</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <button
                  onClick={() => {}}
                  className="bg-[var(--surface)] border border-[var(--border)] rounded-lg p-4 hover:bg-[var(--surface-alt)] transition-colors text-center"
                >
                  <div className="mb-2 flex justify-center text-[var(--accent)]"><AttendanceRateIcon className="h-5 w-5" /></div>
                  <p className="font-semibold text-sm text-[var(--foreground)]">Mark Attendance</p>
                </button>
                <button
                  onClick={() => {}}
                  className="bg-[var(--surface)] border border-[var(--border)] rounded-lg p-4 hover:bg-[var(--surface-alt)] transition-colors text-center"
                >
                  <div className="mb-2 flex justify-center text-[var(--accent)]"><MaterialsIcon className="h-5 w-5" /></div>
                  <p className="font-semibold text-sm text-[var(--foreground)]">Upload Material</p>
                </button>
                <button
                  onClick={() => {}}
                  className="bg-[var(--surface)] border border-[var(--border)] rounded-lg p-4 hover:bg-[var(--surface-alt)] transition-colors text-center"
                >
                  <div className="mb-2 flex justify-center text-[var(--accent)]"><GradeIcon className="h-5 w-5" /></div>
                  <p className="font-semibold text-sm text-[var(--foreground)]">Enter Grades</p>
                </button>
                <button
                  onClick={() => {}}
                  className="bg-[var(--surface)] border border-[var(--border)] rounded-lg p-4 hover:bg-[var(--surface-alt)] transition-colors text-center"
                >
                  <div className="mb-2 flex justify-center text-[var(--accent)]"><MessageIcon className="h-5 w-5" /></div>
                  <p className="font-semibold text-sm text-[var(--foreground)]">Send Message</p>
                </button>
              </div>
            </div>

            {/* Recent Activity */}
            <div className="mt-8">
              <h2 className="text-xl font-bold text-[var(--foreground)] mb-4">Recent Activity</h2>
              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg p-6">
                <div className="space-y-4">
                  <div className="flex items-start gap-3 pb-4 border-b border-[var(--border)]">
                    <span className="text-2xl">📚</span>
                    <div>
                      <p className="font-semibold text-[var(--foreground)]">New material uploaded</p>
                      <p className="text-sm text-[var(--muted)]">JavaScript Fundamentals - 2 hours ago</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 pb-4 border-b border-[var(--border)]">
                    <span className="text-2xl">✅</span>
                    <div>
                      <p className="font-semibold text-[var(--foreground)]">Attendance marked</p>
                      <p className="text-sm text-[var(--muted)]">15 students present - 4 hours ago</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <span className="text-2xl">📝</span>
                    <div>
                      <p className="font-semibold text-[var(--foreground)]">Grades submitted</p>
                      <p className="text-sm text-[var(--muted)]">Exam A1 scores entered - 1 day ago</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </LecturerShell>
  );
}
