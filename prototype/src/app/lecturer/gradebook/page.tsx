"use client";

import { useEffect, useState } from "react";
import { ArrowLeftIcon } from "@/components/icons";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function GradebookPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [courses, setCourses] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/auth/signin");
      return;
    }
    if (status === "authenticated") {
      const role = ((session as any)?.user?.role as string | undefined)?.toLowerCase();
      if (!(role === "lecturer" || role === "admin")) {
        router.push("/dashboard");
        return;
      }
      fetchGradebook();
    }
  }, [status, session, router]);

  const fetchGradebook = async () => {
    try {
      const res = await fetch("/api/lecturer/gradebook");
      if (!res.ok) {
        setCourses([]);
        return;
      }
      const data = await res.json();
      setCourses(data.courses || []);
    } catch (error) {
      console.error("Failed to load gradebook:", error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[var(--background)] py-10">
      <div className="mx-auto max-w-6xl px-6 md:px-10 space-y-8">
        <header className="rounded-3xl bg-[var(--surface)] p-8 shadow-[var(--shadow)]">
          <div className="mb-4">
            <Link href="/lecturer" className="inline-flex items-center gap-2 text-[var(--accent)] hover:brightness-110 text-sm font-semibold">
              <ArrowLeftIcon /> Back to lecturer dashboard
            </Link>
          </div>
          <h1 className="text-4xl font-bold text-[var(--foreground)]">Class Gradebook</h1>
          <p className="text-[var(--muted)] mt-2">Monitor student progress across your courses.</p>
        </header>

        {loading ? (
          <div className="text-center py-20">
            <p className="text-[var(--muted)]">Loading gradebook...</p>
          </div>
        ) : courses.length === 0 ? (
          <div className="rounded-3xl bg-[var(--surface)] p-8 shadow-[var(--shadow)] text-center">
            <p className="text-[var(--muted)]">No courses yet. Create a course to see student progress here.</p>
          </div>
        ) : (
          <div className="space-y-8">
            {courses.map((course) => (
              <div key={course.id} className="rounded-3xl bg-[var(--surface)] p-8 shadow-[var(--shadow)] space-y-6">
                <div>
                  <h2 className="text-2xl font-bold text-[var(--foreground)]">{course.title}</h2>
                  <p className="text-sm text-[var(--muted)]">Level: {course.level}</p>
                </div>

                {course.students.length === 0 ? (
                  <p className="text-sm text-[var(--muted)]">No enrolled students yet.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-[var(--border)]">
                          <th className="text-left py-3 px-4 font-semibold text-[var(--foreground)]">Student</th>
                          <th className="text-left py-3 px-4 font-semibold text-[var(--foreground)]">Email</th>
                          <th className="text-center py-3 px-4 font-semibold text-[var(--foreground)]">Progress</th>
                          <th className="text-center py-3 px-4 font-semibold text-[var(--foreground)]">Lessons</th>
                        </tr>
                      </thead>
                      <tbody>
                        {course.students.map((student: any, idx: number) => (
                          <tr key={idx} className="border-b border-[var(--border)] hover:bg-[var(--background)]">
                            <td className="py-3 px-4">{student.studentName}</td>
                            <td className="py-3 px-4 text-[var(--muted)]">{student.studentEmail}</td>
                            <td className="py-3 px-4 text-center">
                              <div className="flex items-center justify-center gap-2">
                                <div className="w-24 h-2 bg-[var(--surface)] rounded-full overflow-hidden">
                                  <div
                                    style={{ width: `${student.percentComplete}%` }}
                                    className="h-full bg-[var(--accent)]"
                                  ></div>
                                </div>
                                <span className="text-xs font-semibold text-[var(--muted)]">{student.percentComplete}%</span>
                              </div>
                            </td>
                            <td className="py-3 px-4 text-center text-[var(--muted)]">
                              {student.lessonsCompleted} / {student.totalLessons}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
