'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import LecturerShell from '@/components/LecturerShell';
import LecturerGradeEntry from '@/components/LecturerGradeEntry';
import { ExamIcon, ResultsIcon } from '@/components/icons';

interface StudentGrade {
  id: string;
  studentId: string;
  studentName: string;
  email: string;
  examName: string;
  score: number;
  totalScore: number;
  grade: string;
  studentCode?: string | null;
  feedback?: string;
  submissionMode?: string;
  graded?: boolean;
}

interface GradeSession {
  id: string;
  examId: string;
  examName: string;
  courseId: string;
  courseName: string;
  totalStudents: number;
  gradedStudents: number;
  resultsReleased: boolean;
}

export default function LecturerGrades() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [sessions, setSessions] = useState<GradeSession[]>([]);
  const [selectedExam, setSelectedExam] = useState('');
  const [students, setStudents] = useState<StudentGrade[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [releasing, setReleasing] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

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
      const res = await fetch('/api/lecturer/grades');
      
      if (res.status === 401) {
        router.push('/auth/lecturer/signin');
        return;
      }

      if (!res.ok) throw new Error('Failed to fetch grade sessions');
      
      const data = await res.json();
      setSessions(data.sessions);
      if (data.sessions.length > 0) {
        setSelectedExam(data.sessions[0].examId);
        fetchStudents(data.sessions[0].examId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  }

  async function fetchStudents(examId: string) {
    try {
      const res = await fetch(`/api/lecturer/grades/students?examId=${examId}`);
      if (!res.ok) throw new Error('Failed to fetch students');
      const data = await res.json();
      setStudents(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch students');
    }
  }

  async function updateGrade(
    studentId: string,
    newScore: number,
    newFeedback?: string,
    newSubmissionMode?: string,
  ) {
    if (newScore < 0 || newScore > 100) {
      setError('Score must be between 0 and 100');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/lecturer/grades', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentId,
          examId: selectedExam,
          score: newScore,
          feedback: newFeedback,
          submissionMode: newSubmissionMode,
        }),
      });

      if (!res.ok) throw new Error('Failed to update grade');

      const updated = await res.json();
      setStudents(
        students.map((s) =>
          s.studentId === studentId
            ? {
                ...s,
                score: updated.score,
                grade: updated.grade,
                feedback: updated.feedback ?? '',
                submissionMode: updated.submissionMode ?? 'platform',
                graded: true,
              }
            : s
        )
      );
      setEditingId(null);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update');
    } finally {
      setSaving(false);
    }
  }

  async function toggleRelease() {
    if (!selectedExam) return;
    setReleasing(true);
    setError('');
    try {
      const res = await fetch('/api/lecturer/results/release', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ examId: selectedExam }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || 'Could not update result release');
      setSessions((current) =>
        current.map((s) =>
          s.examId === selectedExam ? { ...s, resultsReleased: payload.resultsReleased } : s,
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update result release');
    } finally {
      setReleasing(false);
    }
  }

  const selectedSession = sessions.find((s) => s.examId === selectedExam);

  function calculateGrade(score: number): string {
    if (score >= 90) return 'A';
    if (score >= 80) return 'B';
    if (score >= 70) return 'C';
    if (score >= 60) return 'D';
    return 'F';
  }

  if (status === 'loading' || loading) {
    return (
      <LecturerShell>
        <div className="flex items-center justify-center h-screen">
          <div className="text-center">
            <div className="mb-4">⏳</div>
            <p className="text-[var(--foreground)]">Loading grades...</p>
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
          <div className="max-w-7xl mx-auto">
            <h1 className="flex items-center gap-3 text-3xl font-bold text-[var(--foreground)]"><ExamIcon className="h-7 w-7 text-[var(--accent)]" />Enter results</h1>
            <p className="text-[var(--muted)] mt-2">Record classwork marks for your students, and scores for exam sittings</p>
          </div>
        </div>

        {/* Content */}
        <div className="max-w-7xl mx-auto p-6">
          {error && (
            <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4 text-red-800">
              {error}
            </div>
          )}

          {/* Marking the class comes first. The exam grid below only reaches
              students who have BOOKED a sitting, which almost nobody has —
              that is why there was previously no way to record the classwork
              and speaking marks a tutor actually gives out every week. */}
          <div className="mb-8 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6">
            <h2 className="mb-1 text-lg font-bold text-[var(--foreground)]">Mark my class</h2>
            <p className="mb-4 text-sm text-[var(--muted)]">
              Everyone the office assigned you. Scores here go straight onto the student&apos;s results page.
            </p>
            <LecturerGradeEntry />
          </div>

          <h2 className="mb-4 text-lg font-bold text-[var(--foreground)]">Exam sittings</h2>

          {/* Exam Selection */}
          <div className="mb-6 bg-[var(--surface)] border border-[var(--border)] rounded-lg p-6">
            <h2 className="text-lg font-bold text-[var(--foreground)] mb-4">Select Exam/Test</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-semibold text-[var(--foreground)] mb-2">
                  Choose Exam/Test
                </label>
                <select
                  value={selectedExam}
                  onChange={(e) => {
                    setSelectedExam(e.target.value);
                    fetchStudents(e.target.value);
                  }}
                  className="w-full px-4 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)] text-[var(--foreground)]"
                >
                  {sessions.map((s) => (
                    <option key={s.examId} value={s.examId}>
                      {s.examName}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-semibold text-[var(--foreground)] mb-2">
                  Course
                </label>
                <div className="px-4 py-2 bg-[var(--surface-alt)] rounded-lg text-sm text-[var(--foreground)]">
                  {sessions.find((s) => s.examId === selectedExam)?.courseName || 'N/A'}
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-[var(--foreground)] mb-2">
                  Progress
                </label>
                <div className="px-4 py-2 bg-[var(--surface-alt)] rounded-lg text-sm text-[var(--foreground)]">
                  {sessions.find((s) => s.examId === selectedExam)?.gradedStudents || 0} /{' '}
                  {sessions.find((s) => s.examId === selectedExam)?.totalStudents || 0}
                </div>
              </div>
            </div>

            {/* Results release. Exam scores stay hidden on the student's
                results page until this is on — a tutor keys the whole sitting
                in, checks it, then publishes the lot and every graded student
                is notified. */}
            {selectedSession && (
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface-alt)] p-4">
                <div className="text-sm">
                  <p className="font-semibold text-[var(--foreground)]">
                    {selectedSession.resultsReleased
                      ? 'Results are visible to students'
                      : 'Results are hidden from students'}
                  </p>
                  <p className="text-[var(--muted)]">
                    {selectedSession.resultsReleased
                      ? 'Every graded student can see their score on their results page.'
                      : 'Students cannot see any score for this sitting yet. Classwork marks are not affected.'}
                  </p>
                </div>
                <button
                  onClick={toggleRelease}
                  disabled={releasing}
                  className={`rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 ${
                    selectedSession.resultsReleased
                      ? 'bg-[var(--muted)] hover:opacity-90'
                      : 'bg-[var(--accent)] hover:opacity-90'
                  }`}
                >
                  {releasing
                    ? 'Saving…'
                    : selectedSession.resultsReleased
                      ? 'Hide results'
                      : 'Release results'}
                </button>
              </div>
            )}
          </div>

          {/* Grade Guide */}
          <div className="mb-6 grid grid-cols-5 gap-2">
            {[
              { grade: 'A', range: '90-100', color: 'bg-green-100 text-green-700' },
              { grade: 'B', range: '80-89', color: 'bg-blue-100 text-blue-700' },
              { grade: 'C', range: '70-79', color: 'bg-yellow-100 text-yellow-700' },
              { grade: 'D', range: '60-69', color: 'bg-orange-100 text-orange-700' },
              { grade: 'F', range: '0-59', color: 'bg-red-100 text-red-700' },
            ].map((g) => (
              <div key={g.grade} className={`p-2 rounded text-center ${g.color}`}>
                <div className="font-bold">{g.grade}</div>
                <div className="text-xs">{g.range}</div>
              </div>
            ))}
          </div>

          {/* Students Grades */}
          {students.length === 0 ? (
            <div className="text-center py-12">
              <ResultsIcon className="mx-auto mb-2 h-9 w-9 text-[var(--muted)]" />
              <p className="text-[var(--foreground)] font-semibold">No students for this exam</p>
              <p className="text-[var(--muted)] text-sm mt-1">Enroll students to enter their grades</p>
            </div>
          ) : (
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg overflow-hidden">
              <table className="w-full">
                <thead className="bg-[var(--surface-alt)] border-b border-[var(--border)]">
                  <tr>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-[var(--foreground)]">Student</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-[var(--foreground)]">Email</th>
                    <th className="px-4 py-3 text-center text-sm font-semibold text-[var(--foreground)]">Score (out of 100)</th>
                    <th className="px-4 py-3 text-center text-sm font-semibold text-[var(--foreground)]">Grade</th>
                    <th className="px-4 py-3 text-center text-sm font-semibold text-[var(--foreground)]">Sat</th>
                    <th className="px-4 py-3 text-center text-sm font-semibold text-[var(--foreground)]">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {students.map((student) => (
                    <tr
                      key={student.studentId}
                      className="border-b border-[var(--border)] hover:bg-[var(--surface-alt)] transition-colors"
                    >
                      <td className="px-4 py-3 text-sm text-[var(--foreground)]">
                        {student.studentName}
                        {student.studentCode && (
                          <span className="ml-2 font-mono text-xs text-[var(--muted)]">{student.studentCode}</span>
                        )}
                        {/*
                          The feedback the student actually reads on their
                          results page — a bare number says nothing about what
                          to work on next.
                        */}
                        {editingId === student.studentId ? (
                          <input
                            id={`feedback-${student.studentId}`}
                            defaultValue={student.feedback ?? ''}
                            placeholder="Feedback for this student (optional)"
                            className="mt-2 w-full rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xs"
                          />
                        ) : student.feedback ? (
                          <p className="mt-1 text-xs italic text-[var(--muted)]">{student.feedback}</p>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-sm text-[var(--muted)]">{student.email}</td>
                      <td className="px-4 py-3 text-center">
                        {editingId === student.studentId ? (
                          <input
                            type="number"
                            min="0"
                            max="100"
                            defaultValue={student.score}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                const fb = (document.getElementById(`feedback-${student.studentId}`) as HTMLInputElement | null)?.value;
                                const mode = (document.getElementById(`mode-${student.studentId}`) as HTMLSelectElement | null)?.value;
                                updateGrade(student.studentId, parseInt(e.currentTarget.value), fb, mode);
                              }
                            }}
                            autoFocus
                            className="w-16 px-2 py-1 border border-[var(--border)] rounded bg-[var(--background)] text-[var(--foreground)] text-center"
                          />
                        ) : (
                          <span className={`font-semibold ${student.graded === false ? "text-[var(--muted)]" : "text-[var(--foreground)]"}`}>
                            {student.graded === false ? "—" : student.score}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span
                          className={`px-3 py-1 rounded-full text-sm font-semibold ${
                            student.grade === 'A'
                              ? 'bg-green-100 text-green-700'
                              : student.grade === 'B'
                              ? 'bg-blue-100 text-blue-700'
                              : student.grade === 'C'
                              ? 'bg-yellow-100 text-yellow-700'
                              : student.grade === 'D'
                              ? 'bg-orange-100 text-orange-700'
                              : 'bg-red-100 text-red-700'
                          }`}
                        >
                          {student.grade}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        {editingId === student.studentId ? (
                          <select
                            id={`mode-${student.studentId}`}
                            defaultValue={student.submissionMode ?? 'platform'}
                            className="rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xs text-[var(--foreground)]"
                          >
                            <option value="platform">On platform</option>
                            <option value="physical">On paper</option>
                          </select>
                        ) : student.graded === false ? (
                          <span className="text-[var(--muted)]">—</span>
                        ) : (
                          <span
                            className={`rounded-full px-2 py-1 text-xs font-semibold ${
                              student.submissionMode === 'physical'
                                ? 'bg-purple-100 text-purple-700'
                                : 'bg-[var(--surface-alt)] text-[var(--foreground-soft)]'
                            }`}
                          >
                            {student.submissionMode === 'physical' ? 'Paper' : 'Platform'}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {editingId === student.studentId ? (
                          <div className="flex items-center justify-center gap-2">
                            <button
                              onClick={() => {
                                const feedbackEl = document.getElementById(`feedback-${student.studentId}`) as HTMLInputElement | null;
                                const scoreEl = feedbackEl?.closest('tr')?.querySelector<HTMLInputElement>('input[type=number]');
                                const modeEl = document.getElementById(`mode-${student.studentId}`) as HTMLSelectElement | null;
                                updateGrade(
                                  student.studentId,
                                  parseInt(scoreEl?.value ?? String(student.score)),
                                  feedbackEl?.value,
                                  modeEl?.value,
                                );
                              }}
                              disabled={saving}
                              className="text-sm px-3 py-1 bg-[var(--accent)] text-white rounded hover:opacity-90 disabled:opacity-50"
                            >
                              {saving ? 'Saving…' : 'Save'}
                            </button>
                            <button
                              onClick={() => setEditingId(null)}
                              className="text-sm px-3 py-1 border border-[var(--border)] rounded"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setEditingId(student.studentId)}
                            disabled={saving}
                            className="text-sm px-3 py-1 bg-[var(--accent)] text-white rounded hover:opacity-90 transition-opacity disabled:opacity-50"
                          >
                            Edit
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </LecturerShell>
  );
}
