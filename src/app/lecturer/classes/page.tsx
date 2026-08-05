"use client";

export const dynamic = "force-dynamic";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import LecturerShell from "@/components/LecturerShell";
import BrandLoader from "@/components/BrandLoader";
import { CalendarIcon, UsersIcon } from "@/components/icons";

type Profile = {
  name: string | null;
  branchId: string | null;
  branchName: string | null;
  isOnlineBranch: boolean;
  level: string | null;
  sessionSlot: string | null;
};

type Assignment = {
  branchIds: string[];
  levels: string[];
  sessionSlots: string[];
  classTypes: string[];
  batches: string[];
};

type Cohort = { assigned: boolean; label: string; roomName: string; studentCount: number };

type RosterEntry = {
  id: string;
  name: string;
  email: string;
  studentCode: string | null;
  level: string;
  branchName: string | null;
  sessionSlot: string;
};

type Payload = {
  profile: Profile;
  assignment: Assignment;
  cohort: Cohort;
  roster: RosterEntry[];
  branches: Array<{ id: string; name: string; mode: string }>;
};

/**
 * My classes.
 *
 * This page used to be where a tutor CHOSE their branch, level and sitting.
 * That was the wrong shape: the school needs one reliable answer to "who
 * teaches this class", and a tutor who could move themselves could pull
 * another tutor's entire roster, attendance history and gradebook onto their
 * own dashboard by changing a dropdown.
 *
 * So the assignment is now read-only here and set by the office. What a tutor
 * genuinely controls — the day-to-day shape of their own class: its topics,
 * its times, its materials, and postponing it — lives on the timetable, which
 * this page points at.
 */
export default function LecturerClassesPage() {
  const router = useRouter();
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/lecturer/profile", { cache: "no-store" });
      if (res.status === 401) {
        router.push("/auth/lecturer/signin");
        return;
      }
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(payload.error || "Could not load your classes");
        return;
      }
      setData(payload);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load your classes");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <LecturerShell>
        <BrandLoader fill size="lg" title="Einen Moment…" message="Loading your classes." />
      </LecturerShell>
    );
  }

  const branchNames = new Map((data?.branches ?? []).map((branch) => [branch.id, branch.name]));
  const assignment = data?.assignment;

  const facts: Array<[string, string]> = [
    [
      "Branch",
      assignment?.branchIds.length
        ? assignment.branchIds.map((id) => branchNames.get(id) ?? "Unknown").join(", ")
        : "Not assigned",
    ],
    ["Level", assignment?.levels.length ? assignment.levels.join(", ") : "Not assigned"],
    [
      "Session",
      assignment?.sessionSlots.length
        ? assignment.sessionSlots.map((slot) => slot.charAt(0).toUpperCase() + slot.slice(1)).join(", ")
        : "All sittings",
    ],
    ["Class type", assignment?.classTypes.length ? assignment.classTypes.join(", ") : "All types"],
    ["Batch", assignment?.batches.length ? assignment.batches.join(", ") : "All batches"],
  ];

  return (
    <LecturerShell>
      <div className="h-screen overflow-y-auto">
        <div className="border-b border-[var(--border)] bg-gradient-to-r from-[var(--accent)]/20 to-transparent p-6">
          <div className="mx-auto max-w-5xl">
            <h1 className="text-3xl font-bold text-[var(--foreground)]">My classes</h1>
            <p className="mt-2 text-[var(--muted)]">
              The classes the school has assigned you, and everyone registered for them.
            </p>
          </div>
        </div>

        <div className="mx-auto max-w-5xl space-y-6 p-6">
          {error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>
          ) : null}

          {!data?.cohort.assigned ? (
            <div className="rounded-2xl border border-amber-300 bg-amber-50 p-5 text-sm text-amber-900">
              <p className="font-semibold">You have not been assigned a class yet</p>
              <p className="mt-1">
                The school office sets which branch, level and sitting you take. Until they do, your timetable and
                roster have nothing to show. Ask them to add you and everything below fills in on its own.
              </p>
            </div>
          ) : null}

          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6">
            <h2 className="text-lg font-bold text-[var(--foreground)]">What you teach</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">
              Set by the school office. If any of this is wrong, contact them — it decides who appears on your roster,
              whose attendance you take and whose work you grade.
            </p>

            <dl className="mt-5 grid gap-x-6 gap-y-3 sm:grid-cols-2">
              {facts.map(([label, value]) => (
                <div
                  key={label}
                  className="flex justify-between gap-3 border-b border-[var(--border)]/50 pb-2 last:border-0"
                >
                  <dt className="text-xs uppercase tracking-wide text-[var(--muted)]">{label}</dt>
                  <dd className="text-right text-sm font-medium capitalize text-[var(--foreground)]">{value}</dd>
                </div>
              ))}
            </dl>
          </div>

          {/* The thing a tutor actually controls. */}
          <div className="rounded-2xl border border-[var(--accent)]/30 bg-[var(--accent-soft)] p-6">
            <h2 className="flex items-center gap-2 text-lg font-bold text-[var(--foreground)]">
              <CalendarIcon className="h-5 w-5 text-[var(--accent)]" />
              What you can change
            </h2>
            <p className="mt-1 text-sm text-[var(--foreground-soft)]">
              Your students&apos; calendar is yours to run. Set each day&apos;s topic and times, attach the material
              they need to bring, or postpone a class to a new date — they see it immediately and get a notification
              for anything that changes their week.
            </p>
            <Link
              href="/lecturer/timetable"
              className="mt-4 inline-flex rounded-full bg-[var(--accent)] px-5 py-2.5 text-sm font-semibold text-white"
            >
              Open my timetable
            </Link>
          </div>

          {data?.cohort.assigned ? (
            <div className="grid gap-4 md:grid-cols-3">
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
                <p className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">Your class</p>
                <p className="mt-2 text-lg font-semibold text-[var(--foreground)]">{data.cohort.label}</p>
                {data.profile.isOnlineBranch ? (
                  <p className="mt-1 text-xs font-medium text-[var(--accent)]">Taught live over video</p>
                ) : null}
              </div>
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
                <p className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">Students</p>
                <p className="mt-2 text-3xl font-bold text-[var(--foreground)]">{data.cohort.studentCount}</p>
              </div>
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
                <p className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">Live room</p>
                <p className="mt-2 truncate text-sm font-medium text-[var(--foreground)]">{data.cohort.roomName}</p>
                <Link
                  href="/live"
                  className="mt-3 inline-flex rounded-full bg-[var(--accent)] px-4 py-1.5 text-xs font-semibold text-white"
                >
                  Open the classroom
                </Link>
              </div>
            </div>
          ) : null}

          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="flex items-center gap-2 text-lg font-bold text-[var(--foreground)]">
                <UsersIcon className="h-5 w-5 text-[var(--accent)]" />
                Your roster
              </h2>
              <div className="flex gap-2">
                <Link
                  href="/lecturer/attendance"
                  className="rounded-lg border border-[var(--border)] px-4 py-2 text-xs font-semibold text-[var(--foreground)]"
                >
                  Take attendance
                </Link>
                <Link
                  href="/lecturer/messages"
                  className="rounded-lg bg-[var(--accent)] px-4 py-2 text-xs font-semibold text-white"
                >
                  Message the class
                </Link>
              </div>
            </div>

            {(data?.roster.length ?? 0) === 0 ? (
              <p className="mt-4 text-sm text-[var(--muted)]">
                No students in this class yet. They appear here as soon as they enrol at a branch and level you are
                assigned to — nobody has to add them.
              </p>
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-[var(--border)] text-xs uppercase tracking-wide text-[var(--muted)]">
                    <tr>
                      <th className="py-2 pr-4">Student</th>
                      <th className="py-2 pr-4">Student code</th>
                      <th className="py-2 pr-4">Branch</th>
                      <th className="py-2 pr-4">Level</th>
                      <th className="py-2">Session</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data?.roster.map((student) => (
                      <tr key={student.id} className="border-b border-[var(--border)]/60 last:border-0">
                        <td className="py-2.5 pr-4 font-medium text-[var(--foreground)]">{student.name}</td>
                        <td className="py-2.5 pr-4 text-[var(--muted)]">{student.studentCode || "—"}</td>
                        <td className="py-2.5 pr-4 text-[var(--muted)]">{student.branchName || "—"}</td>
                        <td className="py-2.5 pr-4 text-[var(--muted)]">{student.level}</td>
                        <td className="py-2.5 capitalize text-[var(--muted)]">{student.sessionSlot}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </LecturerShell>
  );
}
