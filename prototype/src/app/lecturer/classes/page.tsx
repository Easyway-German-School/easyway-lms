"use client";

export const dynamic = "force-dynamic";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import LecturerShell from "@/components/LecturerShell";
import BrandLoader from "@/components/BrandLoader";

type Profile = {
  name: string | null;
  branchId: string | null;
  branchName: string | null;
  isOnlineBranch: boolean;
  level: string | null;
  sessionSlot: string | null;
};

type Cohort = { assigned: boolean; label: string; roomName: string; studentCount: number };

type RosterEntry = {
  id: string;
  name: string;
  email: string;
  studentCode: string | null;
  level: string;
  sessionSlot: string;
};

type Payload = {
  profile: Profile;
  cohort: Cohort;
  roster: RosterEntry[];
  branches: Array<{ id: string; name: string; mode: string }>;
  levels: readonly string[];
  slots: readonly string[];
};

/**
 * Customise my classes.
 *
 * This page was in the sidebar from the start but never existed, so every
 * tutor who clicked it got a 404. What it needed to be is the answer to "which
 * class am I actually teaching?" — because that single answer drives the
 * tutor's timetable, their roster, their live room and who their announcements
 * reach. Nothing else in the portal worked properly until it could be set.
 */
export default function LecturerClassesPage() {
  const router = useRouter();
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const [branchId, setBranchId] = useState("");
  const [level, setLevel] = useState("");
  const [sessionSlot, setSessionSlot] = useState("");

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
      setBranchId(payload.profile.branchId || "");
      setLevel(payload.profile.level || "");
      setSessionSlot(payload.profile.sessionSlot || "");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load your classes");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    load();
  }, [load]);

  async function save() {
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      const res = await fetch("/api/lecturer/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branchId, level, sessionSlot }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || "Could not save your class");
      setSaved(true);
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save your class");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <LecturerShell>
        <BrandLoader fill size="lg" title="Einen Moment…" message="Loading your classes." />
      </LecturerShell>
    );
  }

  const dirty =
    branchId !== (data?.profile.branchId || "") ||
    level !== (data?.profile.level || "") ||
    sessionSlot !== (data?.profile.sessionSlot || "");

  return (
    <LecturerShell>
      <div className="h-screen overflow-y-auto">
        <div className="border-b border-[var(--border)] bg-gradient-to-r from-[var(--accent)]/20 to-transparent p-6">
          <div className="mx-auto max-w-5xl">
            <h1 className="text-3xl font-bold text-[var(--foreground)]">Customise my classes</h1>
            <p className="mt-2 text-[var(--muted)]">
              Set the cohort you teach. Your timetable, roster, live room and announcements all follow from it.
            </p>
          </div>
        </div>

        <div className="mx-auto max-w-5xl space-y-6 p-6">
          {error ? <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div> : null}
          {saved ? (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
              Saved. Your class is now {data?.cohort.label}.
            </div>
          ) : null}

          {!data?.cohort.assigned ? (
            <div className="rounded-2xl border border-amber-300 bg-amber-50 p-5 text-sm text-amber-900">
              <p className="font-semibold">You have not been assigned a class yet</p>
              <p className="mt-1">
                Pick your branch, level and session below. Until you do, your timetable and roster have nothing to show.
              </p>
            </div>
          ) : null}

          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6">
            <h2 className="text-lg font-bold text-[var(--foreground)]">The class you teach</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">
              A class is a branch, a level and a sitting. The same level runs morning, afternoon and evening, and those are
              different classes with different students.
            </p>

            <div className="mt-5 grid gap-4 md:grid-cols-3">
              <div>
                <label htmlFor="branch" className="mb-2 block text-sm font-semibold text-[var(--foreground)]">Branch</label>
                <select
                  id="branch"
                  value={branchId}
                  onChange={(event) => setBranchId(event.target.value)}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-4 py-2 text-[var(--foreground)]"
                >
                  <option value="">Select a branch…</option>
                  {data?.branches.map((branch) => (
                    <option key={branch.id} value={branch.id}>
                      {branch.name}{branch.mode === "online" ? " — live over video" : ""}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="level" className="mb-2 block text-sm font-semibold text-[var(--foreground)]">Level</label>
                <select
                  id="level"
                  value={level}
                  onChange={(event) => setLevel(event.target.value)}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-4 py-2 text-[var(--foreground)]"
                >
                  <option value="">Select a level…</option>
                  {data?.levels.map((item) => (
                    <option key={item} value={item}>{item}</option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="slot" className="mb-2 block text-sm font-semibold text-[var(--foreground)]">Session</label>
                <select
                  id="slot"
                  value={sessionSlot}
                  onChange={(event) => setSessionSlot(event.target.value)}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-4 py-2 text-[var(--foreground)]"
                >
                  <option value="">Select a session…</option>
                  {data?.slots.map((slot) => (
                    <option key={slot} value={slot}>{slot.charAt(0).toUpperCase() + slot.slice(1)}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-3">
              <button
                onClick={save}
                disabled={saving || !dirty}
                className="rounded-lg bg-[var(--accent)] px-6 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save my class"}
              </button>
              {dirty ? <span className="text-xs text-[var(--muted)]">You have unsaved changes.</span> : null}
            </div>
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
                <Link href="/live" className="mt-3 inline-flex rounded-full bg-[var(--accent)] px-4 py-1.5 text-xs font-semibold text-white">
                  Open the classroom
                </Link>
              </div>
            </div>
          ) : null}

          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-bold text-[var(--foreground)]">Your roster</h2>
              <div className="flex gap-2">
                <Link href="/lecturer/attendance" className="rounded-lg border border-[var(--border)] px-4 py-2 text-xs font-semibold text-[var(--foreground)]">
                  Take attendance
                </Link>
                <Link href="/lecturer/messages" className="rounded-lg bg-[var(--accent)] px-4 py-2 text-xs font-semibold text-white">
                  Message the class
                </Link>
              </div>
            </div>

            {(data?.roster.length ?? 0) === 0 ? (
              <p className="mt-4 text-sm text-[var(--muted)]">
                No students in this class yet. They appear here as soon as they enrol at this branch and level.
              </p>
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-[var(--border)] text-xs uppercase tracking-wide text-[var(--muted)]">
                    <tr>
                      <th className="py-2 pr-4">Student</th>
                      <th className="py-2 pr-4">Student code</th>
                      <th className="py-2 pr-4">Email</th>
                      <th className="py-2">Session</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data?.roster.map((student) => (
                      <tr key={student.id} className="border-b border-[var(--border)]/60 last:border-0">
                        <td className="py-2.5 pr-4 font-medium text-[var(--foreground)]">{student.name}</td>
                        <td className="py-2.5 pr-4 text-[var(--muted)]">{student.studentCode || "—"}</td>
                        <td className="py-2.5 pr-4 text-[var(--muted)]">{student.email}</td>
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
