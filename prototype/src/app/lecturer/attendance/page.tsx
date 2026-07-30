'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import LecturerShell from '@/components/LecturerShell';

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
      if (data.sessions.length > 0) {
        setSelectedCourse(data.sessions[0].courseId);
        fetchStudents(data.sessions[0].courseId, selectedDate);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  }

  async function fetchStudents(courseId: string, date: string) {
    try {
      const res = await fetch(`/api/lecturer/attendance/students?courseId=${courseId}&date=${date}`);
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
      alert('Attendance marked successfully!');
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
            <h1 className="text-3xl font-bold text-[var(--foreground)]">Mark Attendance 📋</h1>
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
              <p className="text-3xl mb-2">👥</p>
              <p className="text-[var(--foreground)] font-semibold">No students enrolled</p>
              <p className="text-[var(--muted)] text-sm mt-1">Enroll students to your class to mark attendance</p>
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
                            className={`px-4 py-1 rounded-full text-sm font-semibold transition-colors ${
                              student.present
                                ? 'bg-green-100 text-green-700'
                                : 'bg-red-100 text-red-700'
                            }`}
                          >
                            {student.present ? '✅ Present' : '❌ Absent'}
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
