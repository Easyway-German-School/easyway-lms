'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import LecturerShell from '@/components/LecturerShell';
import { AttendanceIcon, CheckIcon, CrossIcon, UsersIcon } from '@/components/icons';
import LecturerStudentRoster from '@/components/LecturerStudentRoster';

interface Student {
  id: string;
  name: string;
  email: string;
  branch: string;
  present: boolean;
}

interface AttendanceSession {
  id: string;
  courseId: string;
  courseName: string;
  date: string;
  totalStudents: number;
  presentStudents: number;
}

export default function LecturerAttendance() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [sessions, setSessions] = useState<AttendanceSession[]>([]);
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [selectedCourse, setSelectedCourse] = useState('');
  const [students, setStudents] = useState<Student[]>([]);
  const [studentFilter, setStudentFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  /**
   * Replaces an `alert()`. A modal dialog for a routine confirmation is a
   * click the tutor has to dismiss before they can mark the next class, and it
   * is the one piece of UI that cannot be styled to look like the school's.
   */
  const [saved, setSaved] = useState('');
  const [marking, setMarking] = useState(false);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/auth/lecturer/signin');
      return;
    }

    if (status === 'authenticated') {
      fetchSessions();
    }
  }, [status, router]);

  async function fetchSessions() {
    try {
      const res = await fetch('/api/lecturer/attendance');
      
      if (res.status === 401) {
        router.push('/auth/lecturer/signin');
        return;
      }

      if (!res.ok) throw new Error('Failed to fetch attendance');
      
      const data = await res.json();
      setSessions(data.sessions);
      // The register no longer depends on a Class row existing. A tutor with
      // no course template still has students — they are found from the
      // branch + level the office assigned — so this loads either way.
      const firstCourseId = data.sessions?.[0]?.courseId ?? '';
      setSelectedCourse(firstCourseId);
      fetchStudents(firstCourseId, selectedDate);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  }

  async function fetchStudents(courseId: string, date: string) {
    try {
      const query = new URLSearchParams({ date });
      if (courseId) query.set('courseId', courseId);
      const res = await fetch(`/api/lecturer/attendance/students?${query.toString()}`);
      if (!res.ok) throw new Error('Failed to fetch students');
      const data = await res.json();
      setStudents(data);
      setStudentFilter('all');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch students');
    }
  }

  function toggleAttendance(studentId: string) {
    setStudents(
      students.map((s) =>
        s.id === studentId ? { ...s, present: !s.present } : s
      )
    );
  }

  async function handleSubmit() {
    setMarking(true);
    try {
      const res = await fetch('/api/lecturer/attendance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          courseId: selectedCourse,
          date: selectedDate,
          attendance: students.map((s) => ({
            studentId: s.id,
            present: s.present,
          })),
        }),
      });

      if (!res.ok) throw new Error('Failed to save attendance');

      setError('');
      setSaved(`Attendance saved for ${students.length} student${students.length === 1 ? '' : 's'}.`);
      window.setTimeout(() => setSaved(''), 4000);
      fetchSessions();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setMarking(false);
    }
  }

  if (status === 'loading' || loading) {
    return (
      <LecturerShell>
        <div className="flex items-center justify-center h-screen">
          <div className="text-center">
            <div className="mb-4">⏳</div>
            <p className="text-[var(--foreground)]">Loading attendance...</p>
          </div>
        </div>
      </LecturerShell>
    );
  }

  const visibleStudents =
    studentFilter === 'all' ? students : students.filter((s) => s.id === studentFilter);

  return (
    <LecturerShell>
      <div className="h-screen overflow-y-auto">
        {/* Header */}
        <div className="bg-gradient-to-r from-[var(--accent)]/20 to-transparent p-6 border-b border-[var(--border)]">
          <div className="max-w-7xl mx-auto">
            <h1 className="flex items-center gap-3 text-3xl font-bold text-[var(--foreground)]"><AttendanceIcon className="h-7 w-7 text-[var(--accent)]" />Mark Attendance</h1>
            <p className="text-[var(--muted)] mt-2">Record student attendance for your classes</p>
          </div>
        </div>

        {/* Content */}
        <div className="max-w-7xl mx-auto p-6">
          {error && (
            <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4 text-red-800">
              {error}
            </div>
          )}

          {saved && (
            <div className="mb-6 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-emerald-800">
              {saved}
            </div>
          )}

          {/* Who is actually in this tutor's class.
              The marking grid below still works off Enrollment, which most
              cohorts have no rows in — so a tutor with a full class saw "No
              students enrolled". This reads the branch + level + sitting
              grouping the rest of the school uses, so the names are always
              here even when the enrolment records are not. */}
          <div className="mb-6 bg-[var(--surface)] border border-[var(--border)] rounded-lg p-6">
            <h2 className="text-lg font-bold text-[var(--foreground)] mb-4">My class register</h2>
            <LecturerStudentRoster />
          </div>

          {/* Filters */}
          <div className="mb-6 bg-[var(--surface)] border border-[var(--border)] rounded-lg p-6">
            <h2 className="text-lg font-bold text-[var(--foreground)] mb-4">Attendance Details</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div>
                <label className="block text-sm font-semibold text-[var(--foreground)] mb-2">
                  Select Class
                </label>
                <select
                  value={selectedCourse}
                  onChange={(e) => {
                    setSelectedCourse(e.target.value);
                    fetchStudents(e.target.value, selectedDate);
                  }}
                  className="w-full px-4 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)] text-[var(--foreground)]"
                >
                  <option value="">My whole class</option>
                  {sessions.map((s) => (
                    <option key={s.courseId} value={s.courseId}>
                      {s.courseName}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-semibold text-[var(--foreground)] mb-2">
                  Select Date
                </label>
                <input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => {
                    setSelectedDate(e.target.value);
                    fetchStudents(selectedCourse, e.target.value);
                  }}
                  className="w-full px-4 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)] text-[var(--foreground)]"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-[var(--foreground)] mb-2">
                  Find student
                </label>
                <select
                  value={studentFilter}
                  onChange={(e) => setStudentFilter(e.target.value)}
                  className="w-full px-4 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)] text-[var(--foreground)]"
                >
                  <option value="all">All students ({students.length})</option>
                  {students.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-semibold text-[var(--foreground)] mb-2">
                  Summary
                </label>
                <div className="px-4 py-2 bg-[var(--surface-alt)] rounded-lg">
                  <p className="text-sm text-[var(--foreground)]">
                    <strong>{students.filter((s) => s.present).length}</strong> / {students.length} Present
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Students List */}
          {students.length === 0 ? (
            <div className="text-center py-12">
              <UsersIcon className="mx-auto mb-2 h-9 w-9 text-[var(--muted)]" />
              <p className="text-[var(--foreground)] font-semibold">Nobody to mark yet</p>
              <p className="text-[var(--muted)] text-sm mt-1">
                Students appear here automatically once they register for the branch and level the office assigned you.
                If this stays empty, ask the office to check your assignment.
              </p>
            </div>
          ) : (
            <>
              {studentFilter !== 'all' && (
                <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                  <span>
                    Showing one student. Saving still records attendance for the whole class.
                  </span>
                  <button
                    onClick={() => setStudentFilter('all')}
                    className="font-semibold underline"
                  >
                    Show all students
                  </button>
                </div>
              )}

              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg overflow-hidden">
                <table className="w-full">
                  <thead className="bg-[var(--surface-alt)] border-b border-[var(--border)]">
                    <tr>
                      <th className="px-4 py-3 text-left text-sm font-semibold text-[var(--foreground)]">Student Name</th>
                      <th className="px-4 py-3 text-left text-sm font-semibold text-[var(--foreground)]">Email</th>
                      <th className="px-4 py-3 text-left text-sm font-semibold text-[var(--foreground)]">Branch</th>
                      <th className="px-4 py-3 text-center text-sm font-semibold text-[var(--foreground)]">Attendance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleStudents.map((student) => (
                      <tr
                        key={student.id}
                        className="border-b border-[var(--border)] hover:bg-[var(--surface-alt)] transition-colors"
                      >
                        <td className="px-4 py-3 text-sm text-[var(--foreground)]">{student.name}</td>
                        <td className="px-4 py-3 text-sm text-[var(--muted)]">{student.email}</td>
                        <td className="px-4 py-3 text-sm text-[var(--muted)]">{student.branch}</td>
                        <td className="px-4 py-3 text-center">
                          <button
                            onClick={() => toggleAttendance(student.id)}
                            className={`inline-flex items-center gap-1.5 px-4 py-1 rounded-full text-sm font-semibold transition-colors ${
                              student.present
                                ? 'bg-green-100 text-green-700'
                                : 'bg-red-100 text-red-700'
                            }`}
                          >
                            {student.present ? <><CheckIcon className="h-3.5 w-3.5" /> Present</> : <><CrossIcon className="h-3.5 w-3.5" /> Absent</>}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Submit Button */}
              <div className="mt-6 flex justify-end gap-4">
                <button
                  onClick={() => fetchStudents(selectedCourse, selectedDate)}
                  className="px-6 py-2 border border-[var(--border)] rounded-lg text-[var(--foreground)] hover:bg-[var(--surface-alt)] transition-colors"
                >
                  Reset
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={marking}
                  className="px-6 py-2 bg-[var(--accent)] text-white rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50"
                >
                  {marking ? 'Saving...' : 'Save Attendance'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </LecturerShell>
  );
}
