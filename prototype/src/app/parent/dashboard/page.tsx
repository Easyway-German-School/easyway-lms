"use client";

import { useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import BrandLoader from "@/components/BrandLoader";
import SignOutButton from "@/components/SignOutButton";
import { AttendanceIcon, BookOpenIcon, FamilyIcon, GradebookIcon } from "@/components/icons";

/**
 * The parent portal's landing page.
 *
 * Deliberately a placeholder: the signup/signin flow needed somewhere real to
 * land, but the actual monitoring (attendance, results, notifications) is a
 * separate, later build — see the Parent model doc-comment in
 * prisma/schema.prisma. This just confirms the account exists and sets
 * expectations for what is coming.
 */
export default function ParentDashboard() {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status !== "loading" && normalizeRole(session?.user) !== "parent") {
      router.replace("/auth/parent/signin");
    }
  }, [status, session, router]);

  function normalizeRole(user: unknown) {
    return String((user as { role?: string } | undefined)?.role || "").toLowerCase();
  }

  if (status === "loading" || normalizeRole(session?.user) !== "parent") {
    return <BrandLoader fullscreen size="lg" title="Loading…" message="Taking you to your parent dashboard." />;
  }

  const name = session?.user?.name || "there";

  return (
    <div className="min-h-screen bg-[var(--background)] px-4 py-10 sm:px-8">
      <div className="mx-auto max-w-3xl space-y-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--accent-soft)] text-[var(--accent)]">
              <FamilyIcon className="h-6 w-6" />
            </span>
            <h1 className="mt-4 text-2xl font-bold text-[var(--foreground)]">Welcome, {name}</h1>
            <p className="mt-2 text-sm text-[var(--muted)]">
              Your parent account is set up. The school is confirming the link to your child's record.
            </p>
          </div>
          <SignOutButton callbackUrl="/auth/parent/signin" tone="slate" />
        </div>

        <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6">
          <p className="text-sm font-semibold text-[var(--foreground)]">Coming to this dashboard</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            {[
              { icon: <AttendanceIcon className="h-5 w-5" />, label: "Attendance", blurb: "Which classes your child has attended." },
              { icon: <GradebookIcon className="h-5 w-5" />, label: "Results & exams", blurb: "Grades, certificates and exam entries." },
              { icon: <BookOpenIcon className="h-5 w-5" />, label: "Classes & updates", blurb: "Their timetable and school notifications." },
            ].map((item) => (
              <div key={item.label} className="rounded-2xl border border-[var(--border)] bg-[var(--surface-alt)] p-4">
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]">{item.icon}</span>
                <p className="mt-3 text-sm font-semibold text-[var(--foreground)]">{item.label}</p>
                <p className="mt-1 text-xs text-[var(--muted)]">{item.blurb}</p>
              </div>
            ))}
          </div>
          <p className="mt-5 text-xs text-[var(--muted)]">
            None of this is live yet — you will be notified once it is. If your child's details need correcting, contact your branch office.
          </p>
        </div>
      </div>
    </div>
  );
}
