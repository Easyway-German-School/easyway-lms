"use client";

import Link from "next/link";
import { ArrowLeftIcon } from "@/components/icons";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import BrandLoader from "@/components/BrandLoader";

export default function CourseDetailPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const [course, setCourse] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadCourse = async () => {
      try {
        const res = await fetch(`/api/courses`);
        if (!res.ok) throw new Error("Failed to load course");
        const data = await res.json();
        const match = (data.courses || []).find((item: any) => item.id === params.id);
        setCourse(match || null);
      } catch (error) {
        console.error("Failed to load course details", error);
      } finally {
        setLoading(false);
      }
    };

    loadCourse();
  }, [params.id]);

  if (loading) {
    return (
      <BrandLoader fill size="lg" title="Kurs wird geladen…" message="Loading your course." />
    );
  }

  if (!course) {
    return (
      <div className="min-h-screen bg-[var(--background)] flex items-center justify-center px-6 text-[var(--foreground)]">
        <div className="max-w-md rounded-2xl bg-[var(--surface)] p-8 text-center">
          <h1 className="text-2xl font-bold">Course not found</h1>
          <p className="mt-3 text-[var(--muted)]">This course is not available right now.</p>
          <button
            onClick={() => router.back()}
            className="mt-6 rounded-full bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-[var(--surface)]"
          >
            Go back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--background)] py-10 text-[var(--foreground)]">
      <div className="mx-auto max-w-4xl px-6">
        <Link href="/dashboard" className="inline-flex items-center gap-2 text-[var(--accent)] font-semibold"><ArrowLeftIcon /> Back to dashboard</Link>
        <div className="mt-6 rounded-3xl bg-[var(--surface)] p-8 shadow-sm">
          <p className="text-sm uppercase tracking-[0.2em] text-[var(--accent)]">Course overview</p>
          <h1 className="mt-3 text-3xl font-bold">{course.title}</h1>
          <p className="mt-4 text-[var(--muted)]">{course.description}</p>

          <div className="mt-6 grid gap-4 md:grid-cols-3">
            <div className="rounded-2xl bg-[var(--surface-alt)] p-4">
              <p className="text-sm text-[var(--muted)]">Level</p>
              <p className="mt-2 font-semibold">{course.level || "A1"}</p>
            </div>
            <div className="rounded-2xl bg-[var(--surface-alt)] p-4">
              <p className="text-sm text-[var(--muted)]">Progress</p>
              <p className="mt-2 font-semibold">{course.progress || 0}%</p>
            </div>
            <div className="rounded-2xl bg-[var(--surface-alt)] p-4">
              <p className="text-sm text-[var(--muted)]">Status</p>
              <p className="mt-2 font-semibold">{course.status || "Active"}</p>
            </div>
          </div>

          <div className="mt-8 rounded-2xl border border-[var(--border)] bg-[var(--surface-alt)] p-6">
            <h2 className="text-xl font-semibold">What happens next?</h2>
            <p className="mt-3 text-[var(--muted)]">
              This page is the course landing screen. From here, the next step would be to open lessons, assignments, or the lesson path for this course.
            </p>
            <Link href="/lesson" className="mt-5 inline-flex rounded-full bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-[var(--surface)]">
              Open a lesson
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
