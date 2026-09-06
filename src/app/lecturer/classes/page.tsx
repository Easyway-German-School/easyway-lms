"use client";

export const dynamic = "force-dynamic";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import LecturerShell from "@/components/LecturerShell";
import BrandLoader from "@/components/BrandLoader";
import { BroadcastIcon, CalendarIcon, UsersIcon } from "@/components/icons";

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
  groups?: Array<{ level: string; sessionSlot: string; batch?: string }>;
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

/** One class the tutor runs, with its own roster, live room and intake range. */
type GroupCard = {
  key: string;
  branchId: string;
  branchName: string;
  level: string;
  sessionSlot: string;
  batch: string | null;
  batchRange: string;
  roomName: string;
  label: string;
  studentCount: number;
  roster: RosterEntry[];
};

type Payload = {
  profile: Profile;
  assignment: Assignment;
  groups: GroupCard[];
  cohort: Cohort;
  roster: RosterEntry[];
  branches: Array<{ id: string; name: string; mode: string }>;
};

/**
 * The "Batch" row on the facts panel.
 *
 * A per-group intake is spelled out as its full teaching span against the class
 * it belongs to — "B1 Evening · September – October" — so a tutor running two
 * intakes can tell them apart at a glance. Falls back to the standalone picker,
 * then to "All batches".
 */
function batchSummary(groups: GroupCard[], assignment: Assignment | undefined): string {
  const pinned = groups.filter((group) => group.batchRange);
  if (pinned.length) {
    return pinned
      .map((group) => `${group.label} · ${group.batchRange}`)
      .join(",  ");
  }
  return assignment?.batches.length ? assignment.batches.join(", ") : "All batches";
}

/**
 * My classes.
 *
 * This page used to be where a tutor CHOSE their branch, level and sitting.
 * That was the wrong shape: the school needs one reliable answer to "who
 * teaches this class", and a tutor who could move themselves could pull
 * another tutor's entire roster, attendance history and gradebook onto their
 * own dashboard by changing a dropdown.
 *
 * So the assignment is read-only here and set by the office. What a tutor
 * genuinely controls — the day-to-day shape of each class: its topics, times,
 * materials, postponing it, and starting it live — is reached from the per-
 * class cards below. A tutor who runs more than one class (A1 morning AND B1
 * evening, say) gets one card per class: separate rosters, separate
 * timetables, separate "go live". Nothing is merged.
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
  const branchModes = new Map((data?.branches ?? []).map((branch) => [branch.id, branch.mode]));
  const assignment = data?.assignment;
  const groups = data?.groups ?? [];
  const assigned = Boolean(data?.cohort.assigned);
  const multi = groups.length > 1;

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
    ["Batch", batchSummary(groups, assignment)],
  ];

  return (
    <LecturerShell>
      <div className="h-screen overflow-y-auto">
        <div className="border-b border-[var(--border)] bg-gradient-to-r from-[var(--accent)]/20 to-transparent p-6">
          <div className="mx-auto max-w-5xl">
            <h1 className="text-3xl font-bold text-[var(--foreground)]">My classes</h1>
            <p className="mt-2 text-[var(--muted)]">
              {multi
                ? "The classes the school has assigned you. Each one has its own timetable, roster and live room — nothing is shared between them."
                : "The class the school has assigned you, and everyone registered for it."}
            </p>
          </div>
        </div>

        <div className="mx-auto max-w-5xl space-y-6 p-6">
          {error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>
          ) : null}

          {!assigned ? (
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
              Each class&apos;s calendar is yours to run. Set a day&apos;s topic and times, attach the material to
              bring, or postpone a class to a new date — students see it immediately and get a notification for
              anything that changes their week. {multi ? "Use the class you want on its card below." : ""}
            </p>
            <Link
              href="/lecturer/timetable"
              className="mt-4 inline-flex rounded-full bg-[var(--accent)] px-5 py-2.5 text-sm font-semibold text-white"
            >
              Open my timetable
            </Link>
          </div>

          {assigned && groups.length > 0 ? (
            <div className="space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="flex items-center gap-2 text-lg font-bold text-[var(--foreground)]">
                  <UsersIcon className="h-5 w-5 text-[var(--accent)]" />
                  {multi ? `Your ${groups.length} classes` : "Your class"}
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
                    Message a class
                  </Link>
                </div>
              </div>

              {groups.map((group) => {
                const canGoLive = (branchModes.get(group.branchId) ?? "") !== "physical";
                const timetableHref = `/lecturer/timetable?branchId=${encodeURIComponent(
                  group.branchId,
                )}&level=${encodeURIComponent(group.level)}${
                  group.sessionSlot ? `&slot=${encodeURIComponent(group.sessionSlot)}` : ""
                }`;
                return (
                  <section
                    key={group.key}
                    className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)]"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[var(--border)] bg-[var(--surface-alt)] p-5">
                      <div className="min-w-0">
                        <p className="text-lg font-semibold text-[var(--foreground)]">
                          {group.label} class
                        </p>
                        <p className="mt-0.5 text-sm text-[var(--muted)]">
                          {group.branchName}
                          {group.batchRange ? (
                            <>
                              {" · "}
                              <span className="font-medium text-[var(--foreground-soft)]">
                                {group.batchRange} batch
                              </span>
                            </>
                          ) : null}
                          {" · "}
                          {group.studentCount} {group.studentCount === 1 ? "student" : "students"}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {canGoLive ? (
                          <Link
                            href={`/live?group=${encodeURIComponent(group.key)}`}
                            className="inline-flex items-center gap-1.5 rounded-full bg-[#0D7C7E] px-4 py-2 text-xs font-bold text-white transition hover:brightness-110"
                          >
                            <BroadcastIcon className="h-3.5 w-3.5" />
                            Go live with this class
                          </Link>
                        ) : null}
                        <Link
                          href={timetableHref}
                          className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] px-4 py-2 text-xs font-semibold text-[var(--foreground)] transition hover:bg-[var(--surface)]"
                        >
                          <CalendarIcon className="h-3.5 w-3.5" />
                          Open timetable
                        </Link>
                      </div>
                    </div>

                    {group.roster.length === 0 ? (
                      <p className="p-5 text-sm text-[var(--muted)]">
                        No students in this class yet. They appear here as soon as they enrol into it — nobody has to
                        add them.
                      </p>
                    ) : (
                      <div className="overflow-x-auto p-5">
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
                            {group.roster.map((student) => (
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
                  </section>
                );
              })}

              {/* Students on this tutor by name who do not fall into any single
                  class cohort — a mid-term move, a one-to-one cover. Shown so
                  they are never dropped just because they do not match a group. */}
              {(() => {
                const grouped = new Set(groups.flatMap((group) => group.roster.map((student) => student.id)));
                const loose = (data?.roster ?? []).filter((student) => !grouped.has(student.id));
                if (loose.length === 0) return null;
                return (
                  <section className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
                    <div className="border-b border-[var(--border)] bg-[var(--surface-alt)] p-5">
                      <p className="text-lg font-semibold text-[var(--foreground)]">Assigned to you individually</p>
                      <p className="mt-0.5 text-sm text-[var(--muted)]">
                        {loose.length} {loose.length === 1 ? "student the office put" : "students the office put"} on
                        you by name, outside the class cohorts above.
                      </p>
                    </div>
                    <div className="overflow-x-auto p-5">
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
                          {loose.map((student) => (
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
                  </section>
                );
              })()}
            </div>
          ) : null}
        </div>
      </div>
    </LecturerShell>
  );
}
