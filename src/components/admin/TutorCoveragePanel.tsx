"use client";

import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import { SESSION_SLOTS } from "@/lib/lecturer-assignment";

/**
 * "Who teaches each class" — the campus tutor and the online tutor for every
 * group cohort, shown next to the class timetable so the office can see and
 * fix a gap (a hybrid cohort with nobody on its online room, a class with no
 * tutor at all) without leaving the schedule.
 *
 * Data comes from GET /api/admin/tutor-coverage. Assigning or removing a tutor
 * rewrites that tutor's assignment through the existing
 * PATCH /api/admin/lecturers, so a change here reads back the same everywhere
 * the roster does.
 */

type Role = "campus" | "online" | "both";

type CohortTutor = { lecturerId: string; name: string; status: string; role: Role };

export type TutorCoverageCohort = {
  key: string;
  branchId: string;
  branchName: string;
  branchMode: string;
  level: string;
  sessionSlot: string;
  students: { total: number; physical: number; hybrid: number; online: number };
  campusTutors: CohortTutor[];
  onlineTutors: CohortTutor[];
  gaps: string[];
};

type Assignment = {
  branchIds: string[];
  levels: string[];
  sessionSlots: string[];
  assignmentGroups: Array<{ branchId: string; level: string; sessionSlot: string; batch?: string }>;
  classTypes: string[];
  batches: string[];
};

export type TutorCoverageTutor = {
  lecturerId: string;
  name: string;
  status: string;
  assignable: boolean;
  role: Role;
  classTypes: string[];
  assignment: Assignment;
  cohortCount: number;
};

export type TutorCoverage = {
  cohorts: TutorCoverageCohort[];
  tutors: TutorCoverageTutor[];
  summary: {
    cohorts: number;
    missingAnyTutor: number;
    missingCampusTutor: number;
    missingOnlineTutor: number;
  };
};

const SLOT_LABEL: Record<string, string> = {
  morning: "Morning",
  afternoon: "Afternoon",
  evening: "Evening",
  weekend: "Weekend",
};

/* ------------------------------------------------------- assignment merge */

type Target = { branchId: string; level: string; sessionSlot: string };

function materializeGroups(a: Assignment): Assignment["assignmentGroups"] {
  if (a.assignmentGroups.length) return a.assignmentGroups.map((g) => ({ ...g }));
  const slots = a.sessionSlots.length ? a.sessionSlots : [...SESSION_SLOTS];
  const out: Assignment["assignmentGroups"] = [];
  for (const branchId of a.branchIds)
    for (const level of a.levels)
      for (const sessionSlot of slots)
        out.push({ branchId, level: level.toUpperCase(), sessionSlot: sessionSlot.toLowerCase() });
  return out;
}

function sameGroup(g: { branchId: string; level: string; sessionSlot: string }, t: Target) {
  return (
    g.branchId === t.branchId &&
    g.level.toUpperCase() === t.level.toUpperCase() &&
    g.sessionSlot.toLowerCase() === t.sessionSlot.toLowerCase()
  );
}

/** The full assignment body to PATCH so `tutor` gains (or loses) `target`. */
function mergeAssignment(
  a: Assignment,
  target: Target,
  opts: { add: boolean; role: Role },
): { body: Record<string, unknown>; warning?: string } {
  const groups = materializeGroups(a).filter((g) => !sameGroup(g, target));
  if (opts.add) {
    groups.push({
      branchId: target.branchId,
      level: target.level.toUpperCase(),
      sessionSlot: target.sessionSlot.toLowerCase(),
    });
  }

  const uniq = (xs: string[]) => [...new Set(xs)];
  const branchIds = uniq(groups.map((g) => g.branchId));
  const levels = uniq(groups.map((g) => g.level.toUpperCase()));
  const sessionSlots = uniq(groups.map((g) => g.sessionSlot.toLowerCase()));

  let classTypes = a.classTypes.map((c) => c.toLowerCase());
  let warning: string | undefined;
  if (opts.add && (opts.role === "campus" || opts.role === "online")) {
    const want = opts.role === "campus" ? "physical" : "online";
    const hadPrivate = classTypes.includes("private");
    const groupRoles = classTypes.filter((c) => c !== "private");
    if (groupRoles.length === 0 || (groupRoles.length === 1 && groupRoles[0] === want)) {
      classTypes = hadPrivate ? [want, "private"] : [want];
    } else {
      warning = `This tutor already covers ${groupRoles.join(" & ")} across their classes, so their class-type setting was left as-is. Set it on their tutor page if this cohort needs a strict campus/online split.`;
    }
  }

  return { body: { branchIds, levels, sessionSlots, assignmentGroups: groups, classTypes, batches: a.batches }, warning };
}

/* --------------------------------------------------------------- component */

export default function TutorCoveragePanel({
  coverage,
  loading,
  onReload,
}: {
  coverage: TutorCoverage | null;
  loading: boolean;
  onReload: () => void;
}) {
  const [branch, setBranch] = useState("");
  const [onlyGaps, setOnlyGaps] = useState(false);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [pick, setPick] = useState<{ lecturerId: string; role: Role }>({ lecturerId: "", role: "campus" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const branchNames = useMemo(() => {
    const set = new Set<string>();
    coverage?.cohorts.forEach((c) => set.add(c.branchName));
    return [...set].sort();
  }, [coverage]);

  const rows = useMemo(() => {
    let list = coverage?.cohorts ?? [];
    if (branch) list = list.filter((c) => c.branchName === branch);
    if (onlyGaps) list = list.filter((c) => c.gaps.length > 0);
    return list;
  }, [coverage, branch, onlyGaps]);

  async function patchLecturer(lecturerId: string, body: Record<string, unknown>) {
    const res = await fetch("/api/admin/lecturers", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ lecturerId, ...body }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? "Could not update this tutor");
  }

  async function assign(cohort: TutorCoverageCohort) {
    const tutor = coverage?.tutors.find((t) => t.lecturerId === pick.lecturerId);
    if (!tutor) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const target: Target = { branchId: cohort.branchId, level: cohort.level, sessionSlot: cohort.sessionSlot };
      const { body, warning } = mergeAssignment(tutor.assignment, target, { add: true, role: pick.role });
      await patchLecturer(tutor.lecturerId, body);
      setNotice(warning ? `${tutor.name} added. ${warning}` : `${tutor.name} now teaches ${cohortLabel(cohort)}.`);
      setOpenKey(null);
      setPick({ lecturerId: "", role: "campus" });
      onReload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not assign this tutor");
    } finally {
      setBusy(false);
    }
  }

  async function remove(cohort: TutorCoverageCohort, t: CohortTutor) {
    const tutor = coverage?.tutors.find((x) => x.lecturerId === t.lecturerId);
    if (!tutor) return;
    if (!window.confirm(`Take ${t.name} off ${cohortLabel(cohort)}?`)) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const target: Target = { branchId: cohort.branchId, level: cohort.level, sessionSlot: cohort.sessionSlot };
      const { body } = mergeAssignment(tutor.assignment, target, { add: false, role: "both" });
      await patchLecturer(tutor.lecturerId, body);
      setNotice(`${t.name} taken off ${cohortLabel(cohort)}.`);
      onReload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not remove this tutor");
    } finally {
      setBusy(false);
    }
  }

  const summary = coverage?.summary;

  return (
    <section className="mt-10">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Who teaches each class</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            The campus tutor and the online tutor for every group cohort. A hybrid cohort needs both.
          </p>
        </div>
        <Link
          href="/admin/lecturer-invite"
          className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-semibold"
        >
          Manage tutors
        </Link>
      </div>

      {summary && (
        <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <StatTile label="Group cohorts" value={summary.cohorts} />
          <StatTile label="No tutor at all" value={summary.missingAnyTutor} warn={summary.missingAnyTutor > 0} />
          <StatTile label="Missing campus tutor" value={summary.missingCampusTutor} warn={summary.missingCampusTutor > 0} />
          <StatTile label="Missing online tutor" value={summary.missingOnlineTutor} warn={summary.missingOnlineTutor > 0} />
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
        <select
          value={branch}
          onChange={(e) => setBranch(e.target.value)}
          className="rounded-lg border border-[var(--border)] bg-[var(--surface-alt)] px-3 py-2 text-sm"
        >
          <option value="">All branches</option>
          {branchNames.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm font-medium text-[var(--foreground-soft)]">
          <input type="checkbox" checked={onlyGaps} onChange={(e) => setOnlyGaps(e.target.checked)} />
          Only classes with a gap
        </label>
      </div>

      {error && <p className="mb-3 rounded-lg bg-rose-500/10 p-3 text-sm text-rose-600">{error}</p>}
      {notice && <p className="mb-3 rounded-lg bg-emerald-500/10 p-3 text-sm text-emerald-600">{notice}</p>}

      {loading ? (
        <p className="py-10 text-center text-[var(--muted)]">Loading tutor coverage…</p>
      ) : !coverage ? (
        <p className="rounded-xl border border-[var(--border)] p-6 text-sm text-[var(--muted)]">
          Tutor coverage could not be loaded.
        </p>
      ) : rows.length === 0 ? (
        <p className="rounded-xl border border-[var(--border)] p-6 text-sm text-[var(--muted)]">
          {coverage.cohorts.length > 0 ? "No cohorts match these filters." : "No active group cohorts yet."}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
          <table className="w-full min-w-[52rem] text-left text-sm">
            <thead className="bg-[var(--surface-alt)] text-xs uppercase text-[var(--muted)]">
              <tr>
                <th className="p-3">Cohort</th>
                <th className="p-3">Students</th>
                <th className="p-3">Campus tutor</th>
                <th className="p-3">Online tutor</th>
                <th className="p-3" />
              </tr>
            </thead>
            <tbody>
              {rows.map((cohort) => {
                const isOpen = openKey === cohort.key;
                return (
                  <Fragment key={cohort.key}>
                    <tr className="border-t border-[var(--border)] align-top">
                      <td className="p-3">
                        <p className="font-medium">{cohort.level} · {SLOT_LABEL[cohort.sessionSlot] ?? cohort.sessionSlot}</p>
                        <p className="text-xs text-[var(--muted)]">{cohort.branchName}</p>
                        {cohort.gaps.map((gap) => (
                          <span
                            key={gap}
                            className="mt-1 mr-1 inline-block rounded bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-semibold text-amber-700 dark:text-amber-300"
                          >
                            {gap}
                          </span>
                        ))}
                      </td>
                      <td className="p-3 text-xs text-[var(--muted)]">
                        <span className="text-[var(--foreground)]">{cohort.students.total}</span> total
                        <br />
                        {cohort.students.physical} campus · {cohort.students.hybrid} hybrid · {cohort.students.online} online
                      </td>
                      <td className="p-3">
                        <TutorCell tutors={cohort.campusTutors} onRemove={(t) => remove(cohort, t)} busy={busy} />
                      </td>
                      <td className="p-3">
                        <TutorCell tutors={cohort.onlineTutors} onRemove={(t) => remove(cohort, t)} busy={busy} />
                      </td>
                      <td className="p-3 text-right">
                        <button
                          type="button"
                          onClick={() => {
                            setOpenKey(isOpen ? null : cohort.key);
                            setPick({ lecturerId: "", role: cohort.gaps.includes("Needs an online tutor") ? "online" : "campus" });
                            setError("");
                            setNotice("");
                          }}
                          className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold hover:bg-[var(--surface-alt)]"
                        >
                          {isOpen ? "Close" : "Assign"}
                        </button>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="border-t border-[var(--border)] bg-[var(--surface-alt)]">
                        <td colSpan={5} className="p-3">
                          <div className="flex flex-wrap items-end gap-3">
                            <label className="text-xs font-medium text-[var(--muted)]">
                              <span className="block">Tutor</span>
                              <select
                                value={pick.lecturerId}
                                onChange={(e) => setPick({ ...pick, lecturerId: e.target.value })}
                                className="mt-1 min-w-[14rem] rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)]"
                              >
                                <option value="">Choose a tutor…</option>
                                {(coverage?.tutors ?? []).map((t) => (
                                  <option key={t.lecturerId} value={t.lecturerId}>
                                    {t.name}
                                    {t.assignable ? "" : ` (${t.status.replace("_", " ")})`} · {roleWord(t.role)} · {t.cohortCount} class{t.cohortCount === 1 ? "" : "es"}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label className="text-xs font-medium text-[var(--muted)]">
                              <span className="block">Takes</span>
                              <select
                                value={pick.role}
                                onChange={(e) => setPick({ ...pick, role: e.target.value as Role })}
                                className="mt-1 rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)]"
                              >
                                <option value="campus">The campus class</option>
                                <option value="online">The online class</option>
                                <option value="both">The whole class</option>
                              </select>
                            </label>
                            <button
                              type="button"
                              onClick={() => assign(cohort)}
                              disabled={busy || !pick.lecturerId}
                              className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                            >
                              {busy ? "Saving…" : "Assign"}
                            </button>
                          </div>
                          <p className="mt-2 text-xs text-[var(--muted)]">
                            &ldquo;Campus&rdquo; sets the tutor&rsquo;s class type to in-person, &ldquo;online&rdquo; to over-video — so a
                            hybrid cohort&rsquo;s two rooms go to the right people. &ldquo;Whole class&rdquo; leaves their class type alone.
                          </p>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function TutorCell({
  tutors,
  onRemove,
  busy,
}: {
  tutors: CohortTutor[];
  onRemove: (t: CohortTutor) => void;
  busy: boolean;
}) {
  if (tutors.length === 0) return <span className="text-xs text-[var(--muted)]">—</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {tutors.map((t) => (
        <span
          key={t.lecturerId}
          className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--surface)] px-2 py-0.5 text-xs"
        >
          {t.name}
          {t.role === "both" && <span className="text-[10px] text-[var(--muted)]">(all)</span>}
          <button
            type="button"
            onClick={() => onRemove(t)}
            disabled={busy}
            aria-label={`Remove ${t.name}`}
            className="text-[var(--muted)] hover:text-rose-600 disabled:opacity-50"
          >
            ×
          </button>
        </span>
      ))}
    </div>
  );
}

function StatTile({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div
      className={`rounded-xl border p-3 ${
        warn ? "border-amber-500/30 bg-amber-500/10" : "border-[var(--border)] bg-[var(--surface)]"
      }`}
    >
      <p className={`text-2xl font-bold ${warn ? "text-amber-600" : ""}`}>{value}</p>
      <p className="text-xs text-[var(--muted)]">{label}</p>
    </div>
  );
}

function roleWord(role: Role): string {
  return role === "campus" ? "campus" : role === "online" ? "online" : "campus + online";
}

function cohortLabel(c: TutorCoverageCohort): string {
  return `${c.level} · ${SLOT_LABEL[c.sessionSlot] ?? c.sessionSlot} · ${c.branchName}`;
}
