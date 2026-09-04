"use client";

export const dynamic = "force-dynamic";

import { useCallback, useEffect, useState } from "react";
import PortalShell from "@/components/PortalShell";
import { AttachmentIcon, CalendarIcon } from "@/components/icons";

/**
 * Tutor timetable editor.
 *
 * The rotation engine decides which days a cohort meets; this is where a tutor
 * says what actually happens on those days. Saving writes a ClassSession row
 * that lands on every student's calendar straight away, and — for a
 * postponement, a cancellation, a new material or a time change — sends them a
 * notification, because a class that quietly moves is a class people turn up
 * for.
 *
 * The branch and level pickers are gone for tutors. This page used to let any
 * tutor edit any cohort at any branch; what they teach is now the admin's
 * decision, and the server refuses anything outside it either way.
 */

type Material = { id: string; title: string; fileType: string; course: { level: string } | null };
type Branch = { id: string; name: string; mode: string };

type Session = {
  date: string;
  weekday: string;
  title: string;
  defaultFocus: string;
  timeSlot: string;
  startTime: string;
  endTime: string;
  topic: string | null;
  notes: string | null;
  status: string;
  postponedTo: string | null;
  edited: boolean;
  material: { id: string; title: string } | null;
};

type Month = { label: string; sessions: Session[] };

type Assignment = {
  branchIds: string[];
  levels: string[];
  sessionSlots: string[];
  groups: Array<{ branchId: string; level: string; sessionSlot: string }>;
  classTypes: string[];
  batches: string[];
};

/**
 * Postponed is PINK — its own colour, not the red that cancelled uses.
 * A student scanning their month needs "this moved" and "this is not
 * happening" to be tellable apart at a glance; two shades of red are not.
 */
const STATUS_STYLES: Record<string, string> = {
  scheduled: "bg-[var(--surface-alt)] text-[var(--foreground-soft)]",
  postponed: "bg-pink-100 text-pink-700 dark:bg-pink-500/20 dark:text-pink-200",
  cancelled: "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-200",
  held: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-200",
};

const SLOT_LABELS: Record<string, string> = {
  morning: "Morning",
  afternoon: "Afternoon",
  evening: "Evening",
};

function toDateInput(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

export default function LecturerTimetablePage() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [months, setMonths] = useState<Month[]>([]);
  const [assignment, setAssignment] = useState<Assignment | null>(null);
  const [canChooseCohort, setCanChooseCohort] = useState(false);

  const [branchId, setBranchId] = useState("");
  const [level, setLevel] = useState("");
  const [slot, setSlot] = useState("");

  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [editing, setEditing] = useState<Session | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const query = new URLSearchParams();
      if (branchId) query.set("branchId", branchId);
      if (level) query.set("level", level);
      if (slot) query.set("slot", slot);

      const res = await fetch(`/api/lecturer/sessions?${query.toString()}`, { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Unable to load the timetable");

      setMonths(data.months ?? []);
      setMaterials(data.materials ?? []);
      setBranches(data.branches ?? []);
      setAssignment(data.assignment ?? null);
      setCanChooseCohort(Boolean(data.canChooseCohort));

      // The server decides which cohort we are looking at when the page has
      // not chosen one, so mirror what it answered rather than guessing.
      if (data.context) {
        setBranchId((current) => current || data.context.branchId || "");
        setLevel((current) => current || data.context.level || "");
        setSlot((current) => current || data.context.slot || "");
      }
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }, [branchId, level, slot]);

  useEffect(() => {
    load();
  }, [load]);

  async function save(session: Session, patch: Partial<Session> & { materialId?: string | null }) {
    setSavingKey(session.date);
    setSaved("");
    try {
      const nextStatus = patch.status ?? session.status;
      const res = await fetch("/api/lecturer/sessions", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          branchId,
          level,
          date: session.date,
          // The sitting comes from the page, never from the row: it is part of
          // the row's identity, so editing it here would silently move the day
          // into a different class.
          timeSlot: slot,
          topic: patch.topic ?? session.topic,
          notes: patch.notes ?? session.notes,
          status: nextStatus,
          startTime: patch.startTime ?? session.startTime,
          endTime: patch.endTime ?? session.endTime,
          materialId: patch.materialId !== undefined ? patch.materialId : (session.material?.id ?? null),
          postponedTo:
            nextStatus === "postponed"
              ? (patch.postponedTo ?? session.postponedTo ?? null)
              : null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not save");

      setSaved(
        nextStatus === "postponed"
          ? "Saved. Your students have been told the class moved, and their calendar now shows the new date."
          : nextStatus === "cancelled"
            ? "Saved. Your students have been told the class is cancelled."
            : "Saved. Your students' calendars are updated.",
      );
      await load();
      setEditing(null);
      setError("");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save");
    } finally {
      setSavingKey(null);
    }
  }

  const levelMaterials = materials.filter((item) => !item.course?.level || item.course.level === level);

  const branchName = branches.find((branch) => branch.id === branchId)?.name ?? "—";
  const hasClass = Boolean(branchId && level);

  // A tutor may switch between the cohorts the office gave them, but nothing
  // else. An admin gets the full list from the server.
  //
  // When the admin pinned exact teaching groups, offer only the levels and
  // sittings that actually appear in a group for the branch in view. The flat
  // levels/sessionSlots arrays are a union mirror that is not pruned when a
  // group is removed, so trusting them here would let a tutor pick a
  // level/sitting the server then refuses with "not yours to edit".
  const groupsForBranch = (assignment?.groups ?? []).filter(
    (group) => !branchId || group.branchId === branchId,
  );
  const selectableBranches = branches;
  const selectableLevels = canChooseCohort
    ? ["A1", "A2", "B1", "B2", "C1", "C2"]
    : assignment?.groups?.length
      ? [...new Set(groupsForBranch.map((group) => group.level))]
      : (assignment?.levels ?? []);
  const selectableSlots = canChooseCohort
    ? ["morning", "afternoon", "evening", "weekend"]
    : assignment?.groups?.length
      ? [...new Set(groupsForBranch.filter((group) => group.level === level).map((group) => group.sessionSlot))]
      : assignment?.sessionSlots.length
        ? assignment.sessionSlots
        : ["morning", "afternoon", "evening", "weekend"];

  return (
    <PortalShell>
      <div className="h-screen overflow-y-auto">
        <div className="border-b border-[var(--border)] bg-gradient-to-r from-[var(--accent)]/20 to-transparent p-6">
          <div className="mx-auto max-w-5xl">
            <h1 className="flex items-center gap-3 text-3xl font-bold text-[var(--foreground)]">
              <CalendarIcon className="h-7 w-7 text-[var(--accent)]" />
              Class timetable
            </h1>
            <p className="mt-2 text-[var(--muted)]">
              Set each day&apos;s topic, times and materials, or postpone it. Whatever you save here is what your
              students see on their calendar, and they are notified when it matters.
            </p>
          </div>
        </div>

        <div className="mx-auto max-w-5xl space-y-6 p-6">
          {!hasClass && !loading ? (
            <div className="rounded-2xl border border-amber-300 bg-amber-50 p-5 text-sm text-amber-900">
              <p className="font-semibold">You have not been assigned a class yet</p>
              <p className="mt-1">
                The school office decides which branch, level and sitting you take. Ask them to set it and this
                timetable fills in automatically.
              </p>
            </div>
          ) : null}

          {hasClass ? (
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
              <p className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
                {canChooseCohort ? "Editing" : "Your class"}
              </p>

              <div className="mt-3 flex flex-wrap items-center gap-3">
                {selectableBranches.length > 1 || canChooseCohort ? (
                  <select
                    value={branchId}
                    onChange={(event) => setBranchId(event.target.value)}
                    className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)]"
                  >
                    {selectableBranches.map((branch) => (
                      <option key={branch.id} value={branch.id}>
                        {branch.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="rounded-lg bg-[var(--surface-alt)] px-3 py-2 text-sm font-semibold text-[var(--foreground)]">
                    {branchName}
                  </span>
                )}

                {selectableLevels.length > 1 ? (
                  <select
                    value={level}
                    onChange={(event) => setLevel(event.target.value)}
                    className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)]"
                  >
                    {selectableLevels.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="rounded-lg bg-[var(--surface-alt)] px-3 py-2 text-sm font-semibold text-[var(--foreground)]">
                    {level}
                  </span>
                )}

                {selectableSlots.length > 1 ? (
                  <select
                    value={slot}
                    onChange={(event) => setSlot(event.target.value)}
                    className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)]"
                  >
                    {selectableSlots.map((item) => (
                      <option key={item} value={item}>
                        {SLOT_LABELS[item] ?? item} session
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="rounded-lg bg-[var(--surface-alt)] px-3 py-2 text-sm font-semibold capitalize text-[var(--foreground)]">
                    {SLOT_LABELS[slot] ?? slot} session
                  </span>
                )}
              </div>

              {!canChooseCohort ? (
                <p className="mt-3 text-xs text-[var(--muted)]">
                  Your branch and level are set by the school office. You control what happens on each day of it — the
                  topic, the times, the materials, and whether a class is postponed.
                </p>
              ) : null}
            </div>
          ) : null}

          {error ? (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>
          ) : null}
          {saved ? (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">{saved}</div>
          ) : null}

          {loading ? (
            <div className="py-12 text-center text-[var(--muted)]">Loading timetable…</div>
          ) : months.length === 0 ? (
            hasClass ? (
              <div className="py-12 text-center text-[var(--muted)]">No classes generated for this cohort.</div>
            ) : null
          ) : (
            <div className="space-y-8">
              {months.map((month) => (
                <div key={month.label}>
                  <h2 className="mb-3 text-lg font-semibold text-[var(--foreground)]">{month.label}</h2>
                  <div className="space-y-2">
                    {month.sessions.map((session) => {
                      const isEditing = editing?.date === session.date;
                      return (
                        <div
                          key={session.date}
                          className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-sm font-semibold text-[var(--foreground)]">
                                  {session.weekday} {new Date(session.date).toLocaleDateString()}
                                </span>
                                <span
                                  className={`rounded px-2 py-0.5 text-xs font-medium capitalize ${
                                    STATUS_STYLES[session.status] ?? STATUS_STYLES.scheduled
                                  }`}
                                >
                                  {session.status}
                                </span>
                                <span className="text-xs text-[var(--muted)]">
                                  {session.startTime}–{session.endTime}
                                </span>
                              </div>

                              <p className="mt-1 truncate text-sm text-[var(--foreground-soft)]">
                                {session.topic || (
                                  <span className="italic text-[var(--muted)]">{session.defaultFocus}</span>
                                )}
                              </p>

                              {session.status === "postponed" && session.postponedTo ? (
                                <p className="mt-1 text-xs font-semibold text-pink-700 dark:text-pink-300">
                                  Moved to {new Date(session.postponedTo).toLocaleDateString()}
                                </p>
                              ) : null}

                              {session.material ? (
                                <p className="mt-1 flex items-center gap-1.5 text-xs text-[var(--accent)]">
                                  <AttachmentIcon className="h-3.5 w-3.5" /> {session.material.title}
                                </p>
                              ) : null}
                            </div>

                            <button
                              onClick={() => setEditing(isEditing ? null : session)}
                              className="shrink-0 rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm font-medium text-[var(--foreground)] hover:bg-[var(--surface-alt)]"
                            >
                              {isEditing ? "Close" : "Edit"}
                            </button>
                          </div>

                          {isEditing && editing ? (
                            <div className="mt-4 grid gap-3 border-t border-[var(--border)] pt-4 sm:grid-cols-2">
                              <label className="sm:col-span-2">
                                <span className="text-xs font-medium text-[var(--muted)]">Topic for this class</span>
                                <input
                                  defaultValue={session.topic ?? ""}
                                  placeholder={session.defaultFocus}
                                  onChange={(event) => setEditing({ ...editing, topic: event.target.value })}
                                  className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)]"
                                />
                              </label>

                              <label>
                                <span className="text-xs font-medium text-[var(--muted)]">Status</span>
                                <select
                                  value={editing.status}
                                  onChange={(event) => setEditing({ ...editing, status: event.target.value })}
                                  className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)]"
                                >
                                  <option value="scheduled">Scheduled</option>
                                  <option value="postponed">Postponed</option>
                                  <option value="cancelled">Cancelled</option>
                                  <option value="held">Held</option>
                                </select>
                              </label>

                              {/* Only asked for when it means something, and
                                  required then — the server refuses a
                                  postponement with no new date, because a
                                  class that vanishes without one is exactly
                                  what students complain about. */}
                              {editing.status === "postponed" ? (
                                <label>
                                  <span className="text-xs font-medium text-pink-700 dark:text-pink-300">
                                    Moved to which date?
                                  </span>
                                  <input
                                    type="date"
                                    value={toDateInput(editing.postponedTo)}
                                    onChange={(event) =>
                                      setEditing({
                                        ...editing,
                                        postponedTo: event.target.value ? new Date(event.target.value).toISOString() : null,
                                      })
                                    }
                                    className="mt-1 w-full rounded-lg border border-pink-300 bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)]"
                                  />
                                </label>
                              ) : null}

                              <label>
                                <span className="text-xs font-medium text-[var(--muted)]">Starts</span>
                                <input
                                  type="time"
                                  defaultValue={session.startTime}
                                  onChange={(event) => setEditing({ ...editing, startTime: event.target.value })}
                                  className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)]"
                                />
                              </label>

                              <label>
                                <span className="text-xs font-medium text-[var(--muted)]">Ends</span>
                                <input
                                  type="time"
                                  defaultValue={session.endTime}
                                  onChange={(event) => setEditing({ ...editing, endTime: event.target.value })}
                                  className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)]"
                                />
                              </label>

                              <label className="sm:col-span-2">
                                <span className="text-xs font-medium text-[var(--muted)]">Note for your students</span>
                                <textarea
                                  defaultValue={session.notes ?? ""}
                                  rows={2}
                                  placeholder="Bring your workbook · we finish early today · anything they should know"
                                  onChange={(event) => setEditing({ ...editing, notes: event.target.value })}
                                  className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)]"
                                />
                              </label>

                              <label className="sm:col-span-2">
                                <span className="text-xs font-medium text-[var(--muted)]">Material for this class</span>
                                <select
                                  defaultValue={session.material?.id ?? ""}
                                  onChange={(event) =>
                                    setEditing({
                                      ...editing,
                                      material: event.target.value ? { id: event.target.value, title: "" } : null,
                                    })
                                  }
                                  className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)]"
                                >
                                  <option value="">No material</option>
                                  {levelMaterials.map((item) => (
                                    <option key={item.id} value={item.id}>
                                      {item.title}
                                    </option>
                                  ))}
                                </select>
                              </label>

                              <div className="sm:col-span-2 flex flex-wrap items-center gap-3">
                                <button
                                  onClick={() =>
                                    save(session, { ...editing, materialId: editing.material?.id ?? null })
                                  }
                                  disabled={
                                    savingKey === session.date ||
                                    (editing.status === "postponed" && !editing.postponedTo)
                                  }
                                  className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  {savingKey === session.date ? "Saving…" : "Save class"}
                                </button>
                                {editing.status === "postponed" && !editing.postponedTo ? (
                                  <span className="text-xs text-pink-700 dark:text-pink-300">
                                    Pick the new date before saving.
                                  </span>
                                ) : null}
                              </div>
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </PortalShell>
  );
}
