"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import AdminShell from "@/components/AdminShell";
import PasswordInput from "@/components/PasswordInput";
import PhotoCapture from "@/components/PhotoCapture";
import AssignmentPicker from "@/components/admin/AssignmentPicker";
import { uploadImage } from "@/lib/upload";
import { ArrowLeftIcon, BroadcastMessageIcon, LecturerIcon, MailIcon, UsersIcon } from "@/components/icons";
import {
  BATCHES,
  CLASS_TYPES,
  COURSE_LEVELS,
  SESSION_SLOTS,
  assignmentBatches,
  type LecturerAssignment,
} from "@/lib/lecturer-assignment";
import {
  EMPLOYMENT_TYPE_LABELS,
  EMPLOYMENT_TYPES,
  LECTURER_STATUS_META,
  LECTURER_STATUSES,
  type EmploymentType,
  type LecturerStatus,
} from "@/lib/lecturer-status";
import {
  LECTURER_FEATURES,
  LECTURER_FEATURE_HINTS,
  LECTURER_FEATURE_LABELS,
} from "@/lib/lecturer-features";

/**
 * Tutors.
 *
 * This page used to be "Lecturer Invite Management": a secret code nobody
 * checked (nothing in the signup path ever read it), plus a create form whose
 * only assignment field was a list of levels. A tutor created here could not
 * be told which branch they worked at, could not be edited afterwards, and
 * could set their own class from inside the tutor portal.
 *
 * All of that is now here and only here. The invite code is gone along with
 * the self-signup route it pretended to guard.
 */

type Branch = { id: string; name: string; mode: string };

type Tutor = {
  id: string;
  user: { id: string; name: string | null; email: string; role: string };
  specialization: string | null;
  bio: string | null;
  phone: string | null;
  photoUrl: string | null;
  status: LecturerStatus;
  statusNote: string | null;
  statusChangedAt: string | null;
  employmentType: EmploymentType | null;
  startedAt: string | null;
  assignment: LecturerAssignment;
  assignmentLabel: string;
  studentCount: number;
  /** Which optional areas of the portal this tutor may open. */
  features: string[];
};

type RosterStudent = {
  id: string;
  name: string;
  email: string;
  studentCode: string | null;
  level: string;
  sessionSlot: string;
  classType: string;
  deliveryMode: string;
  branchName: string | null;
  totalPaid: number;
  tuitionFee: number;
  hasPaid: boolean;
  waitingBatch?: string | null;
  /** Intake month, so batch sits next to level and sitting on every row. */
  batch?: string | null;
  currentTutorId: string | null;
  currentTutorName: string | null;
  /** Extra tutors already on this student. */
  coTutorIds?: string[];
  namedByOffice: boolean;
  /** What linking this student to THIS tutor would do — decided server-side by lib/tutor-class-match.ts. */
  plan?: {
    action: "linked" | "add_primary" | "add_co_tutor" | "shares_class" | "conflict" | "blocked" | "no_fit";
    role: "online" | null;
    reason: string;
  } | null;
};

type LinkSummary = {
  linked: number;
  add_primary: number;
  add_co_tutor: number;
  shares_class: number;
  conflict: number;
  blocked: number;
  no_fit: number;
};

const EMPTY_ASSIGNMENT: LecturerAssignment = {
  branchIds: [],
  levels: [],
  sessionSlots: [],
  groups: [],
  classTypes: [],
  batches: [],
};

const CLASS_TYPE_LABELS: Record<string, string> = {
  physical: "Physical",
  online: "Online / hybrid",
  private: "Private (one-to-one)",
};

function naira(amount: number) {
  return `₦${Math.max(0, Math.round(amount)).toLocaleString()}`;
}

/**
 * Whether this tutor's coverage reaches a delivery mode — the same "empty or
 * every class type = no restriction" rule `studentWhereForAssignment` uses
 * server-side, kept in sync here so the directory filter agrees with the
 * roster it is filtering.
 */
function tutorCoversMode(tutor: Tutor, mode: "physical" | "online" | "private"): boolean {
  const types = tutor.assignment.classTypes.map((t) => t.toLowerCase());
  if (!types.length || types.length >= CLASS_TYPES.length) return true;
  return types.includes(mode);
}

/**
 * Remove a teaching group AND re-derive the flat levels/sessionSlots mirrors
 * from what is left.
 *
 * `levels` and `sessionSlots` have no picker of their own on this form — they
 * are only ever filled by `addGroup` unioning each group in. So when a group
 * comes out they have to be recomputed, or they keep listing a level/sitting
 * the tutor no longer teaches. That stale mirror is what made the tutor's own
 * timetable answer "That class is not yours to edit". `branchIds` is left alone
 * because it does have its own picker and may hold a branch on purpose.
 */
function pruneGroup(value: LecturerAssignment, group: LecturerAssignment["groups"][number]): LecturerAssignment {
  const groups = value.groups.filter((item) => item !== group);
  return {
    ...value,
    groups,
    levels: [...new Set(groups.map((item) => item.level))],
    sessionSlots: [...new Set(groups.map((item) => item.sessionSlot))],
  };
}

/**
 * An order-independent fingerprint of an assignment, for "has the form changed
 * from what is saved?" and for reloading the student list when the saved class
 * changes. Comparing raw JSON would call a class "changed" just because the
 * server returned the same lists in another order.
 */
function assignmentSignature(value: LecturerAssignment): string {
  const sorted = (list: string[]) => [...list].map((item) => item.toLowerCase()).sort();
  return JSON.stringify({
    branchIds: [...value.branchIds].sort(),
    levels: sorted(value.levels),
    sessionSlots: sorted(value.sessionSlots),
    classTypes: sorted(value.classTypes),
    batches: sorted(value.batches),
    groups: value.groups
      .map((group) => `${group.branchId}|${group.level}|${group.sessionSlot}|${group.batch ?? ""}`.toLowerCase())
      .sort(),
  });
}

/** The five pickers, shared by the create form and every edit panel. */
function AssignmentFields({
  branches,
  value,
  onChange,
}: {
  branches: Branch[];
  value: LecturerAssignment;
  onChange: (next: LecturerAssignment) => void;
}) {
  const set = <K extends keyof LecturerAssignment>(key: K, next: string[]) =>
    onChange({ ...value, [key]: next });
  const [groupBranch, setGroupBranch] = useState(value.branchIds[0] ?? "");
  const [groupLevel, setGroupLevel] = useState(value.levels[0] ?? "A1");
  const [groupSlot, setGroupSlot] = useState(value.sessionSlots[0] ?? "morning");
  // "" means this level/sitting runs for every intake — the same as leaving the
  // standalone batch picker below untouched.
  const [groupBatch, setGroupBatch] = useState("");

  function addGroup() {
    if (
      !groupBranch ||
      value.groups.some(
        (group) =>
          group.branchId === groupBranch &&
          group.level === groupLevel &&
          group.sessionSlot === groupSlot &&
          (group.batch ?? "") === groupBatch,
      )
    )
      return;
    const nextGroup = groupBatch
      ? { branchId: groupBranch, level: groupLevel, sessionSlot: groupSlot, batch: groupBatch }
      : { branchId: groupBranch, level: groupLevel, sessionSlot: groupSlot };
    onChange({
      ...value,
      groups: [...value.groups, nextGroup],
      branchIds: [...new Set([...value.branchIds, groupBranch])],
      levels: [...new Set([...value.levels, groupLevel])],
      sessionSlots: [...new Set([...value.sessionSlots, groupSlot])],
    });
  }

  return (
    <div className="space-y-5">
      <AssignmentPicker
        label="Assign a branch"
        required
        options={branches.map((branch) => ({
          value: branch.id,
          label: branch.mode === "online" ? `${branch.name} (online)` : branch.name,
        }))}
        selected={value.branchIds}
        onChange={(next) => set("branchIds", next)}
        emptyMeans="No branch selected — this tutor will have no students until one is."
      />

      <div className="rounded-2xl border border-[var(--accent)]/30 bg-[var(--accent-soft)] p-4">
        <p className="text-sm font-bold text-[var(--foreground)]">Teaching groups</p>
        <p className="mt-1 text-xs text-[var(--muted)]">Pair each level with its own sitting, and — if it matters — the one intake month it runs for. A tutor can teach the September A1 morning class and the August B2 afternoon class without August touching the A1 group. Leave the month on <em>Any</em> for a level/sitting that runs every intake.</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_0.7fr_0.9fr_0.9fr_auto]">
          <select value={groupBranch} onChange={(event) => setGroupBranch(event.target.value)} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"><option value="">Choose branch</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select>
          <select value={groupLevel} onChange={(event) => setGroupLevel(event.target.value)} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm">{COURSE_LEVELS.map((level) => <option key={level}>{level}</option>)}</select>
          <select value={groupSlot} onChange={(event) => setGroupSlot(event.target.value)} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm">{SESSION_SLOTS.map((slot) => <option key={slot} value={slot}>{slot.charAt(0).toUpperCase() + slot.slice(1)}</option>)}</select>
          <select value={groupBatch} onChange={(event) => setGroupBatch(event.target.value)} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"><option value="">Any month</option>{BATCHES.map((batch) => <option key={batch} value={batch}>{batch.slice(0, 3)}</option>)}</select>
          <button type="button" onClick={addGroup} className="rounded-xl bg-[var(--accent-strong)] px-4 py-2 text-sm font-bold text-white">Add</button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">{value.groups.map((group) => <button key={`${group.branchId}-${group.level}-${group.sessionSlot}-${group.batch ?? "any"}`} type="button" onClick={() => onChange(pruneGroup(value, group))} className="rounded-full border border-[var(--accent)]/40 bg-[var(--surface)] px-3 py-1.5 text-xs font-semibold text-[var(--foreground)]">{branches.find((branch) => branch.id === group.branchId)?.name ?? "Branch"} · {group.level} · {group.sessionSlot}{group.batch ? ` · ${group.batch}` : ""} ×</button>)}</div>
      </div>

      <AssignmentPicker
        label="Assign a class type"
        options={CLASS_TYPES.map((type) => ({ value: type, label: CLASS_TYPE_LABELS[type] ?? type }))}
        selected={value.classTypes}
        onChange={(next) => set("classTypes", next)}
        emptyMeans="Nothing selected — this tutor takes every kind of class."
      />

      <AssignmentPicker
        label="Assign a batch"
        options={BATCHES.map((batch) => ({ value: batch, label: batch.slice(0, 3) }))}
        selected={value.batches}
        onChange={(next) => set("batches", next)}
        emptyMeans="Nothing selected — this tutor takes every batch."
      />
    </div>
  );
}

/**
 * WHAT THIS TUTOR CAN OPEN — a different question from what they teach.
 *
 * Deliberately its own block, below the assignment and visually separated,
 * because the two get confused otherwise. "Assign a class type: online" says
 * this tutor's students take online classes. It does not say this tutor is the
 * person who runs the video call, and in most schools it is one or two people
 * who do — everybody else prepares material and marks work.
 *
 * Note the inverted empty rule against every picker above it. Elsewhere on this
 * form, nothing selected means "everything", because an unset assignment should
 * not silently narrow a tutor's roster. Here nothing selected means nothing,
 * because an access list that grows when you clear it is a trap.
 */
function PortalAccessFields({
  value,
  onChange,
}: {
  value: string[];
  onChange: (next: string[]) => void;
}) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <p className="text-sm font-bold text-[var(--foreground)]">Portal access</p>
      <p className="mt-1 text-xs text-[var(--muted)]">
        Not every tutor takes live or private classes. Tick only what this one should see — the sidebar entry
        disappears for the rest, and the pages refuse them if they follow an old link.
      </p>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        {LECTURER_FEATURES.map((feature) => {
          const on = value.includes(feature);
          return (
            <button
              key={feature}
              type="button"
              onClick={() => onChange(on ? value.filter((entry) => entry !== feature) : [...value, feature])}
              className={`rounded-2xl border p-3 text-left transition ${
                on
                  ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                  : "border-[var(--border)] bg-[var(--background)] hover:border-[var(--border-strong)]"
              }`}
            >
              <span className="flex items-center gap-2">
                <span
                  className={`grid h-4 w-4 shrink-0 place-items-center rounded border text-[10px] font-black ${
                    on ? "border-[var(--accent)] bg-[var(--accent)] text-white" : "border-[var(--border-strong)]"
                  }`}
                >
                  {on ? "✓" : ""}
                </span>
                <span className="text-sm font-semibold">{LECTURER_FEATURE_LABELS[feature]}</span>
              </span>
              <span className="mt-1.5 block text-[11px] leading-4 text-[var(--muted)]">
                {LECTURER_FEATURE_HINTS[feature]}
              </span>
            </button>
          );
        })}
      </div>
      {value.length === 0 && (
        <p className="mt-2 text-xs font-semibold text-amber-700">
          Nothing ticked — this tutor gets none of these three areas.
        </p>
      )}
    </div>
  );
}

/**
 * A tutor's photo, or their initial if there is none — or if there was one
 * but it no longer loads.
 *
 * A stale `photoUrl` (a file that was moved, or that predates the current
 * storage setup) used to render as the browser's bare broken-image glyph,
 * sitting in the corner of the circle instead of filling it. `onError` here
 * catches exactly that and drops back to the same initial-letter circle a
 * tutor with no photo at all gets, so a dead link never reads as a bug.
 */
function TutorAvatar({
  photoUrl,
  label,
  size = "h-12 w-12",
  textSize = "text-lg",
}: {
  photoUrl: string | null | undefined;
  label: string;
  size?: string;
  textSize?: string;
}) {
  const [broken, setBroken] = useState(false);

  if (photoUrl && !broken) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={photoUrl}
        alt=""
        className={`${size} shrink-0 rounded-full object-cover`}
        onError={() => setBroken(true)}
      />
    );
  }

  return (
    <div className={`grid ${size} shrink-0 place-items-center rounded-full bg-[var(--accent-soft)] ${textSize} font-bold text-[var(--accent)]`}>
      {label.slice(0, 1).toUpperCase()}
    </div>
  );
}

function StatusBadge({ status }: { status: LecturerStatus }) {
  const meta = LECTURER_STATUS_META[status];
  return (
    <span className={`rounded-full px-3 py-1 text-[11px] font-semibold ${meta.tone}`}>{meta.label}</span>
  );
}

/**
 * Where a tutor is marked as having left, gone on leave, or come back.
 *
 * Kept separate from the assignment panel below it because the two answer
 * different questions — "do they still work here?" and "which classes do they
 * take?" — and folding them together would mean you could not record somebody
 * leaving without also touching their timetable.
 */
function StatusPanel({
  tutor,
  onSaved,
  onError,
}: {
  tutor: Tutor;
  onSaved: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [status, setStatus] = useState<LecturerStatus>(tutor.status);
  const [note, setNote] = useState(tutor.statusNote ?? "");
  const [employmentType, setEmploymentType] = useState<string>(tutor.employmentType ?? "");
  const [startedAt, setStartedAt] = useState(tutor.startedAt ? tutor.startedAt.slice(0, 10) : "");
  const [saving, setSaving] = useState(false);

  const meta = LECTURER_STATUS_META[status];
  const dirty =
    status !== tutor.status ||
    note !== (tutor.statusNote ?? "") ||
    employmentType !== (tutor.employmentType ?? "") ||
    startedAt !== (tutor.startedAt ? tutor.startedAt.slice(0, 10) : "");

  async function save() {
    // Losing access is not something to do by mis-click.
    if (status === "inactive" && tutor.status !== "inactive") {
      const name = tutor.user.name || tutor.user.email;
      if (
        !confirm(
          `Mark ${name} as inactive?\n\nThey will be signed out and will not be able to sign in again. Their marks, classes and history are all kept, and you can set them back to active at any time.`,
        )
      ) {
        return;
      }
    }

    setSaving(true);
    try {
      const res = await fetch("/api/admin/lecturers", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lecturerId: tutor.id,
          status,
          statusNote: note,
          employmentType: employmentType || null,
          startedAt: startedAt || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not save the status");
      onSaved(`${tutor.user.name || tutor.user.email} is now marked ${LECTURER_STATUS_META[status].label.toLowerCase()}.`);
    } catch (saveError) {
      onError(saveError instanceof Error ? saveError.message : "Could not save the status");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-alt)] p-5">
      <p className="text-sm font-semibold text-[var(--foreground)]">Status &amp; employment</p>
      <p className="mt-1 text-xs text-[var(--muted)]">
        Marking somebody inactive is how a tutor leaves. It is not a deletion — every mark they entered and every
        class they taught stays exactly where it is.
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        {LECTURER_STATUSES.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setStatus(option)}
            className={`rounded-full px-4 py-2 text-xs font-semibold transition ${
              status === option
                ? `${LECTURER_STATUS_META[option].tone} ring-2 ring-[var(--accent)]/40`
                : "border border-[var(--border)] bg-[var(--surface)] text-[var(--muted)] hover:text-[var(--foreground)]"
            }`}
          >
            {LECTURER_STATUS_META[option].label}
          </button>
        ))}
      </div>
      <p className="mt-2 text-xs text-[var(--muted)]">{meta.description}</p>

      <label className="mt-4 block text-sm font-medium">
        Note
        <input
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Maternity leave until March · contract ended · resigned"
          className="mt-2 w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-4 py-2.5 text-sm"
        />
      </label>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <label className="block text-sm font-medium">
          Employment
          <select
            value={employmentType}
            onChange={(event) => setEmploymentType(event.target.value)}
            className="mt-2 w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-4 py-2.5 text-sm"
          >
            <option value="">Not recorded</option>
            {EMPLOYMENT_TYPES.map((type) => (
              <option key={type} value={type}>
                {EMPLOYMENT_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm font-medium">
          Started
          <input
            type="date"
            value={startedAt}
            onChange={(event) => setStartedAt(event.target.value)}
            className="mt-2 w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-4 py-2.5 text-sm"
          />
        </label>
      </div>

      <button
        type="button"
        onClick={save}
        disabled={saving || !dirty}
        className="mt-5 rounded-lg bg-[var(--accent)] px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
      >
        {saving ? "Saving…" : "Save status"}
      </button>
    </div>
  );
}

/** One student, drawn the same way in the roster and in the search results. */
function StudentLine({
  student,
  right,
}: {
  student: RosterStudent;
  right: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-[var(--foreground)]">{student.name}</p>
        <p className="truncate text-xs text-[var(--muted)]">
          {student.studentCode || student.email} · {student.level} · {student.sessionSlot}
          {student.batch ? ` · ${student.batch}` : ""}
          {student.branchName ? ` · ${student.branchName}` : ""}
          {student.deliveryMode === "hybrid" ? " · hybrid" : student.deliveryMode === "online" ? " · online" : ""}
          {student.classType === "private" ? " · private" : ""}
        </p>
        {student.currentTutorName ? (
          <p className="truncate text-[11px] text-[var(--muted)]">Tutor: {student.currentTutorName}</p>
        ) : null}
      </div>

      <span
        className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
          student.waitingBatch
            ? "bg-sky-500/10 text-sky-700"
            : student.hasPaid
              ? "bg-emerald-500/10 text-emerald-700"
              : "bg-amber-500/15 text-amber-800"
        }`}
      >
        {student.waitingBatch
          ? `${student.waitingBatch.split(" ")[0]} intake`
          : student.hasPaid
            ? "Paid"
            : `${naira(Math.max(0, student.tuitionFee - student.totalPaid))} owing`}
      </span>

      {right}
    </div>
  );
}

/**
 * Opened from the "N students" badge on a tutor's card. Read-first, unlike
 * ClassRoster below it — this is not where pairings change, it is where the
 * office reaches the people already in them: one message to everybody in the
 * class, or a private note to one student, without leaving the tutor list.
 */
function TutorRosterPanel({
  lecturerId,
  tutorName,
  onClose,
}: {
  lecturerId: string;
  tutorName: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [roster, setRoster] = useState<RosterStudent[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState("");
  const [dmBusyId, setDmBusyId] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/admin/lecturers/students?lecturerId=${encodeURIComponent(lecturerId)}`,
          { cache: "no-store" },
        );
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        const list: RosterStudent[] = data.roster || [];
        setRoster(list);
        setSelected(new Set(list.map((student) => student.id)));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [lecturerId]);

  function toggle(studentId: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(studentId)) next.delete(studentId);
      else next.add(studentId);
      return next;
    });
  }

  async function sendBroadcast() {
    if (!title.trim() || !message.trim() || selected.size === 0) return;
    setSending(true);
    setNotice("");
    try {
      const res = await fetch("/api/admin/lecturers/announce", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lecturerId, studentIds: [...selected], title, message }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not send that message");
      setNotice(`Sent to ${data.sentTo} student${data.sentTo === 1 ? "" : "s"}.`);
      setTitle("");
      setMessage("");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not send that message");
    } finally {
      setSending(false);
    }
  }

  async function messagePrivately(student: RosterStudent) {
    setDmBusyId(student.id);
    setNotice("");
    try {
      const res = await fetch("/api/community/dms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId: student.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not open that conversation");
      router.push(`/admin/community?channel=${encodeURIComponent(data.channelId)}`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not open that conversation");
      setDmBusyId("");
    }
  }

  const allSelected = roster.length > 0 && selected.size === roster.length;

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-alt)] p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-[var(--foreground)]">{tutorName}&apos;s students</p>
          <p className="mt-1 text-xs text-[var(--muted)]">
            Message the whole class at once, or open a private chat with one student.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--muted)]"
        >
          Close
        </button>
      </div>

      {loading ? <p className="mt-3 text-xs text-[var(--muted)]">Loading…</p> : null}
      {!loading && roster.length === 0 ? (
        <p className="mt-3 rounded-xl bg-amber-500/10 px-4 py-2.5 text-xs text-amber-800">
          This tutor has no students yet.
        </p>
      ) : null}

      {notice ? (
        <p className="mt-3 rounded-xl bg-emerald-500/10 px-4 py-2.5 text-xs text-emerald-800">{notice}</p>
      ) : null}

      {roster.length ? (
        <>
          <div className="mt-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
            <div className="flex items-center gap-2">
              <BroadcastMessageIcon className="h-4 w-4 text-[var(--accent)]" />
              <p className="text-sm font-semibold text-[var(--foreground)]">Message the class</p>
            </div>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Title"
              className="mt-3 w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-4 py-2.5 text-sm"
            />
            <textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              rows={3}
              placeholder="What do you want to tell them?"
              className="mt-2 w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-4 py-2.5 text-sm"
            />
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => setSelected(allSelected ? new Set() : new Set(roster.map((s) => s.id)))}
                className="text-xs font-semibold text-[var(--accent)]"
              >
                {allSelected ? "Deselect all" : "Select all"}
              </button>
              <button
                type="button"
                onClick={sendBroadcast}
                disabled={sending || !title.trim() || !message.trim() || selected.size === 0}
                className="rounded-lg bg-[var(--accent)] px-4 py-2 text-xs font-semibold text-white disabled:opacity-60"
              >
                {sending
                  ? "Sending…"
                  : `Send to ${selected.size} student${selected.size === 1 ? "" : "s"}`}
              </button>
            </div>
          </div>

          <div className="mt-4 space-y-2">
            {roster.map((student) => (
              <StudentLine
                key={student.id}
                student={student}
                right={
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      aria-label={`Include ${student.name} in the class message`}
                      checked={selected.has(student.id)}
                      onChange={() => toggle(student.id)}
                      className="h-4 w-4"
                    />
                    <button
                      type="button"
                      onClick={() => messagePrivately(student)}
                      disabled={dmBusyId === student.id}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--foreground)] disabled:opacity-60"
                    >
                      <MailIcon className="h-3.5 w-3.5" />
                      {dmBusyId === student.id ? "Opening…" : "Message"}
                    </button>
                  </div>
                }
              />
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

/**
 * Who this tutor teaches, and the one place to change it.
 *
 * THE LIST IS THE CLASS, NOT THE SCHOOL. Opening a tutor used to show the 25
 * newest students in the whole LMS under "Add a student", whatever the tutor
 * taught. Now it shows exactly the students who fit this tutor's branch, level,
 * sitting, intake month and delivery mode — including the online half of
 * hybrid students — and each one carries what linking them would do, decided
 * on the server by the one rule in `lib/tutor-class-match.ts`:
 *
 *   no tutor yet                      → this tutor becomes their tutor
 *   already has a tutor, online       → this tutor is added BESIDE them (co-tutor)
 *   physical / one-to-one with tutor  → left alone unless the office clicks "Move"
 *
 * "Link all" applies the first two in one go and never replaces anybody. The
 * search box is only for the exceptions — cover, a sitting that moved, a
 * one-to-one — and it is the only thing that reaches outside the class.
 */
function ClassRoster({
  lecturerId,
  tutorName,
  onChanged,
  refreshKey,
  unsavedChanges,
}: {
  lecturerId: string;
  tutorName: string;
  onChanged: () => void;
  /** Changes whenever the tutor's SAVED class changes, so this list reloads after "Save assignment". */
  refreshKey: string;
  /** The form above differs from what is saved — this list still reflects the saved class. */
  unsavedChanges: boolean;
}) {
  const [query, setQuery] = useState("");
  const [roster, setRoster] = useState<RosterStudent[]>([]);
  const [results, setResults] = useState<RosterStudent[]>([]);
  const [summary, setSummary] = useState<LinkSummary | null>(null);
  const [sharedStudentsEnabled, setSharedStudentsEnabled] = useState(false);
  const [hasClassAssignment, setHasClassAssignment] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [message, setMessage] = useState("");
  const [bulk, setBulk] = useState<{ done: number; total: number } | null>(null);
  const [skipped, setSkipped] = useState<Array<{ studentName: string | null; reason: string }>>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/admin/lecturers/students?lecturerId=${encodeURIComponent(lecturerId)}&q=${encodeURIComponent(query)}`,
        { cache: "no-store" },
      );
      const data = await res.json().catch(() => ({}));
      setRoster(data.roster || []);
      setResults(data.results || []);
      setSummary(data.summary || null);
      setSharedStudentsEnabled(Boolean(data.sharedStudentsEnabled));
      setHasClassAssignment(Boolean(data.hasClassAssignment));
    } finally {
      setLoading(false);
    }
    // refreshKey is a dependency on purpose: a saved class change must reload the list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lecturerId, query, refreshKey]);

  useEffect(() => {
    // Debounced so typing a name does not fire a request per keystroke.
    const timer = window.setTimeout(load, 250);
    return () => window.clearTimeout(timer);
  }, [load]);

  /** Replace the student's primary tutor with this one — the explicit "Move", never automatic. */
  async function pair(student: RosterStudent) {
    setBusyId(student.id);
    setMessage("");
    setSkipped([]);
    try {
      const res = await fetch("/api/admin/lecturers/students", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId: student.id, lecturerId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not change this student's tutor");
      setMessage(`${student.name} is now assigned to ${tutorName}. Both have been notified.`);
      await load();
      // The tutor card above shows a student count, and it is now wrong.
      onChanged();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not change this student's tutor");
    } finally {
      setBusyId("");
    }
  }

  /** Take the student off THIS tutor only — a co-tutor removal must not clear somebody else's primary. */
  async function unlink(student: RosterStudent) {
    setBusyId(student.id);
    setMessage("");
    setSkipped([]);
    try {
      const res = await fetch("/api/admin/lecturers/students", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId: student.id, lecturerId, unlink: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not remove this student");
      setMessage(`${student.name} has been removed from ${tutorName}'s class.`);
      await load();
      onChanged();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not remove this student");
    } finally {
      setBusyId("");
    }
  }

  /** Link students by the rule: primary if they have no tutor, co-tutor if they do and are online/hybrid. Sent in small chunks. */
  async function link(students: RosterStudent[]) {
    if (!students.length) return;
    setMessage("");
    setSkipped([]);
    const ids = students.map((student) => student.id);
    const single = ids.length === 1;
    if (single) setBusyId(ids[0]);
    else setBulk({ done: 0, total: ids.length });

    let primary = 0;
    let coTutor = 0;
    const notDone: Array<{ studentName: string | null; reason: string }> = [];
    try {
      for (let i = 0; i < ids.length; i += 25) {
        const chunk = ids.slice(i, i + 25);
        const res = await fetch("/api/admin/lecturers/students/link", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lecturerId, studentIds: chunk }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Could not link these students");
        primary += data.linked?.primary ?? 0;
        coTutor += data.linked?.coTutor ?? 0;
        notDone.push(...(data.skipped ?? []));
        if (!single) setBulk({ done: Math.min(i + chunk.length, ids.length), total: ids.length });
      }
      const parts = [
        primary ? `${primary} now have ${tutorName} as their tutor` : "",
        coTutor ? `${coTutor} have ${tutorName} added alongside their current tutor` : "",
      ].filter(Boolean);
      setMessage(
        parts.length
          ? `${parts.join(" · ")}. They can see it on their dashboard, and ${tutorName} has been told.`
          : "Nothing was linked.",
      );
      setSkipped(notDone);
      await load();
      onChanged();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not link these students");
    } finally {
      setBusyId("");
      setBulk(null);
    }
  }

  /** Outside the class: add as an extra tutor by hand, keeping the current primary. */
  async function addCoTutorManually(student: RosterStudent) {
    setBusyId(student.id);
    setMessage("");
    setSkipped([]);
    try {
      const res = await fetch("/api/admin/students", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studentId: student.id,
          coTutorIds: [...new Set([...(student.coTutorIds ?? []), lecturerId])],
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not add this tutor");
      setMessage(`${student.name} is now also assigned to ${tutorName}.`);
      await load();
      onChanged();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not add this tutor");
    } finally {
      setBusyId("");
    }
  }

  const rosterIds = new Set(roster.map((student) => student.id));
  const linkable = roster.filter(
    (student) => student.plan?.action === "add_primary" || student.plan?.action === "add_co_tutor",
  );
  const linkedCount = roster.filter((student) => student.namedByOffice).length;
  const needDecision = (summary?.shares_class ?? 0) + (summary?.conflict ?? 0) + (summary?.blocked ?? 0);
  const outsideResults = results.filter((student) => !rosterIds.has(student.id));

  const buttonBase = "rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-60";
  const primaryButton = `${buttonBase} bg-[var(--accent)] text-white`;
  const quietButton = `${buttonBase} border border-[var(--border)] text-[var(--foreground)]`;

  function rowAction(student: RosterStudent, outside: boolean) {
    const busy = busyId === student.id || Boolean(bulk);
    const plan = student.plan;
    const moveLabel = student.currentTutorName ? `Move from ${student.currentTutorName}` : "Add as primary tutor";

    if (student.namedByOffice) {
      const isPrimary = student.currentTutorId === lecturerId;
      return (
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-[var(--accent-soft)] px-2.5 py-1 text-[11px] font-semibold text-[var(--accent)]">
            {isPrimary ? "Primary tutor" : "Co-tutor"}
          </span>
          <button type="button" onClick={() => unlink(student)} disabled={busy} className={`${quietButton} text-[var(--muted)]`}>
            {busyId === student.id ? "Removing…" : "Remove"}
          </button>
        </div>
      );
    }

    if (plan?.action === "add_primary") {
      return (
        <button type="button" onClick={() => link([student])} disabled={busy} className={primaryButton} title={plan.reason}>
          {busyId === student.id ? "Assigning…" : "Assign as tutor"}
        </button>
      );
    }

    if (plan?.action === "add_co_tutor") {
      return (
        <button
          type="button"
          onClick={() => link([student])}
          disabled={busy}
          className={primaryButton}
          title={`${plan.reason} ${student.currentTutorName ? `${student.currentTutorName} stays as their tutor.` : ""}`}
        >
          {busyId === student.id ? "Adding…" : plan.role === "online" ? "Add as online tutor" : "Add as co-tutor"}
        </button>
      );
    }

    if (plan?.action === "blocked") {
      return (
        <span className="max-w-[16rem] text-right text-[11px] text-amber-800" title={plan.reason}>
          Needs multi-tutor mode on — see /platform
        </span>
      );
    }

    if (plan?.action === "shares_class" || plan?.action === "conflict") {
      return (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span className="text-[11px] text-[var(--muted)]" title={plan.reason}>
            {plan.action === "conflict" ? "One-to-one" : "Also in this class"}
          </span>
          <button
            type="button"
            onClick={() => pair(student)}
            disabled={busy}
            className={quietButton}
            title="Replace their current primary tutor with this one"
          >
            {busyId === student.id ? "Moving…" : moveLabel}
          </button>
        </div>
      );
    }

    if (outside) {
      // Not a fit for this tutor's class — an exception the office is choosing to make.
      const canShare =
        student.classType === "group" &&
        ["online", "hybrid"].includes(student.deliveryMode) &&
        Boolean(student.currentTutorId) &&
        student.currentTutorId !== lecturerId;
      return (
        <div className="flex flex-wrap justify-end gap-2">
          {canShare ? (
            <button
              type="button"
              onClick={() => addCoTutorManually(student)}
              disabled={busy}
              className={primaryButton}
              title="Keep their current tutor and add this tutor beside them"
            >
              {busyId === student.id ? "Adding…" : "Add as co-tutor"}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => pair(student)}
            disabled={busy}
            className={canShare ? quietButton : primaryButton}
            title="Make this tutor their primary tutor"
          >
            {busyId === student.id ? "Assigning…" : moveLabel}
          </button>
        </div>
      );
    }

    return (
      <span
        className="rounded-full bg-[var(--accent-soft)] px-3 py-1 text-[11px] font-semibold text-[var(--accent)]"
        title="In this class because they match the branch, level and sitting set above."
      >
        Matched
      </span>
    );
  }

  return (
    <div id={`class-roster-${lecturerId}`} className="rounded-2xl border border-[var(--border)] bg-[var(--surface-alt)] p-5">
      <p className="text-sm font-semibold text-[var(--foreground)]">Students who fit this tutor&apos;s class</p>
      <p className="mt-1 text-xs text-[var(--muted)]">
        Only students in the exact branch, level, sitting and intake month set above. A student with no tutor gets{" "}
        {tutorName}; an online or hybrid student who already has a tutor gets {tutorName} added beside them. Nobody&apos;s
        current tutor is replaced unless you click Move.
      </p>

      {unsavedChanges ? (
        <p className="mt-3 rounded-xl bg-amber-500/10 px-4 py-2.5 text-xs text-amber-800">
          You have changed the class above. This list still shows the saved class — press Save assignment to update it.
        </p>
      ) : null}

      {loading && !roster.length ? <p className="mt-3 text-xs text-[var(--muted)]">Finding students who fit…</p> : null}

      {message ? (
        <p className="mt-3 rounded-xl bg-emerald-500/10 px-4 py-2.5 text-xs text-emerald-800">{message}</p>
      ) : null}
      {skipped.length ? (
        <div className="mt-3 rounded-xl bg-amber-500/10 px-4 py-2.5 text-xs text-amber-800">
          <p className="font-semibold">Left for you to decide ({skipped.length}):</p>
          <ul className="mt-1 list-disc pl-4">
            {skipped.slice(0, 8).map((item, index) => (
              <li key={index}>
                {item.studentName ?? "A student"} — {item.reason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2 text-[11px] font-semibold">
        <span className="rounded-full bg-[var(--accent-soft)] px-3 py-1 text-[var(--accent)]">
          {roster.length} fit this class
        </span>
        <span className="rounded-full border border-[var(--border)] px-3 py-1 text-[var(--muted)]">
          {linkedCount} already linked
        </span>
        {(summary?.add_primary ?? 0) > 0 ? (
          <span className="rounded-full border border-[var(--border)] px-3 py-1 text-[var(--muted)]">
            {summary?.add_primary} with no tutor
          </span>
        ) : null}
        {(summary?.add_co_tutor ?? 0) > 0 ? (
          <span className="rounded-full border border-[var(--border)] px-3 py-1 text-[var(--muted)]">
            {summary?.add_co_tutor} to add as co-tutor
          </span>
        ) : null}
        {needDecision > 0 ? (
          <span className="rounded-full bg-amber-500/15 px-3 py-1 text-amber-800">{needDecision} need your decision</span>
        ) : null}
      </div>

      {!hasClassAssignment && !linkedCount ? (
        <p className="mt-3 rounded-xl bg-amber-500/10 px-4 py-2.5 text-xs text-amber-800">
          This tutor has no branch and level set above, and nobody named below — so their portal will tell them they
          have no class. Set the class, name a student, or both.
        </p>
      ) : null}

      {linkable.length > 0 ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--accent)]/30 bg-[var(--accent-soft)] px-4 py-3">
          <p className="text-xs text-[var(--foreground)]">
            <span className="font-semibold">
              {linkable.length} student{linkable.length === 1 ? "" : "s"} fit this class but are not linked to {tutorName}{" "}
              yet.
            </span>{" "}
            Until they are, their dashboard may still say &ldquo;Tutor being assigned&rdquo;.
            {!sharedStudentsEnabled ? " Multi-tutor mode is off, so only one extra tutor per student can be added." : ""}
          </p>
          <button
            type="button"
            onClick={() => link(linkable)}
            disabled={Boolean(bulk) || Boolean(busyId)}
            className={primaryButton}
          >
            {bulk ? `Linking ${bulk.done} / ${bulk.total}…` : `Link all ${linkable.length}`}
          </button>
        </div>
      ) : null}

      {roster.length ? (
        <div className="mt-4 space-y-2">
          {roster.map((student) => (
            <StudentLine key={student.id} student={student} right={rowAction(student, false)} />
          ))}
        </div>
      ) : !loading && hasClassAssignment ? (
        <p className="mt-4 text-xs text-[var(--muted)]">
          Nobody active fits this class yet. New students who match will appear here as they enrol.
        </p>
      ) : null}

      <p className="mt-5 text-sm font-semibold text-[var(--foreground)]">Add someone outside this class</p>
      <p className="mt-1 text-xs text-[var(--muted)]">
        For cover, a sitting that moved, or a one-to-one. Search the whole school by name, email or student code.
      </p>
      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search the whole school…"
        className="mt-2 w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-4 py-2.5 text-sm"
      />

      {query ? (
        <div className="mt-3 space-y-2">
          {outsideResults.length === 0 ? (
            <p className="text-xs text-[var(--muted)]">Nobody outside this class matches that search.</p>
          ) : null}
          {outsideResults.map((student) => (
            <StudentLine key={student.id} student={student} right={rowAction(student, true)} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default function AdminTutorsPage() {
  const router = useRouter();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [tutors, setTutors] = useState<Tutor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    phone: "",
    specialization: "",
    bio: "",
    employmentType: "",
    startedAt: "",
  });
  const [newAssignment, setNewAssignment] = useState<LecturerAssignment>(EMPTY_ASSIGNMENT);
  // A new tutor starts with everything, matching what every tutor created
  // before this field had. The office takes areas away deliberately.
  const [newFeatures, setNewFeatures] = useState<string[]>([...LECTURER_FEATURES]);
  const [creating, setCreating] = useState(false);
  const [createPhotoFile, setCreatePhotoFile] = useState<File | null>(null);
  const [createPhotoUrl, setCreatePhotoUrl] = useState<string | null>(null);
  const [uploadingCreatePhoto, setUploadingCreatePhoto] = useState(false);

  const [editingId, setEditingId] = useState("");
  const [editPhotoFile, setEditPhotoFile] = useState<File | null>(null);
  const [editPhotoUrl, setEditPhotoUrl] = useState<string | null>(null);
  const [uploadingEditPhoto, setUploadingEditPhoto] = useState(false);
  const [editAssignment, setEditAssignment] = useState<LecturerAssignment>(EMPTY_ASSIGNMENT);
  const [editFeatures, setEditFeatures] = useState<string[]>([...LECTURER_FEATURES]);
  const [savingEdit, setSavingEdit] = useState(false);
  /**
   * A save that would cover a lot of ground — several levels, or a lot of
   * students — gets one extra click instead of going straight through. This
   * is what would have caught the coverage pattern that swept in the entire
   * A1-B2 online/hybrid cohort onto one tutor before it ever saved.
   */
  const [coveragePreview, setCoveragePreview] = useState<{
    count: number;
    levels: string[];
    byLevel?: Record<string, number>;
    toLink?: { primary: number; coTutor: number; other: number };
  } | null>(null);
  const [checkingCoverage, setCheckingCoverage] = useState(false);

  /**
   * Defaults to the people who currently teach. Somebody who left two years
   * ago is kept forever and would otherwise crowd out the list the office
   * actually works from — but "All" is one click away, because the whole point
   * of a status is that the record survives.
   */
  const [statusFilter, setStatusFilter] = useState<LecturerStatus | "all" | "current">("current");
  /**
   * A campus and an online tutor can look identical in a flat list — same
   * level, same "Currently teaching" status — which is exactly the kind of
   * mix-up that let one tutor's coverage silently swallow every online AND
   * hybrid student for their level. This narrows the directory to one
   * delivery mode at a time so campus and online rosters are never read
   * side by side by mistake.
   */
  const [modeFilter, setModeFilter] = useState<"all" | "physical" | "online" | "private">("all");
  const [selectedTutorIds, setSelectedTutorIds] = useState<Set<string>>(new Set());

  /** Which tutor's student list is open, from clicking their "N students" badge. */
  const [rosterPanelId, setRosterPanelId] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/lecturers", { cache: "no-store" });
      if (res.status === 401 || res.status === 403) {
        router.push("/auth/admin");
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not load tutors");
      setTutors(data.lecturers || []);
      setBranches(data.branches || []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load tutors");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    load();
  }, [load]);

  const editingTutor = useMemo(() => tutors.find((tutor) => tutor.id === editingId) ?? null, [tutors, editingId]);

  const visibleTutors = useMemo(() => {
    const byStatus =
      statusFilter === "all"
        ? tutors
        : statusFilter === "current"
          ? tutors.filter((tutor) => tutor.status !== "inactive")
          : tutors.filter((tutor) => tutor.status === statusFilter);
    if (modeFilter === "all") return byStatus;
    return byStatus.filter((tutor) => tutorCoversMode(tutor, modeFilter));
  }, [tutors, statusFilter, modeFilter]);

  const modeCounts = useMemo(() => {
    const base = statusFilter === "current" ? tutors.filter((tutor) => tutor.status !== "inactive") : tutors;
    return {
      physical: base.filter((tutor) => tutorCoversMode(tutor, "physical")).length,
      online: base.filter((tutor) => tutorCoversMode(tutor, "online")).length,
      private: base.filter((tutor) => tutorCoversMode(tutor, "private")).length,
    };
  }, [tutors, statusFilter]);

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const tutor of tutors) counts[tutor.status] = (counts[tutor.status] ?? 0) + 1;
    return counts;
  }, [tutors]);

  async function deleteSelectedTutors() {
    const ids = [...selectedTutorIds];
    if (!ids.length) return;
    if (!confirm(`Are you sure you want to delete ${ids.length} tutors? This action is not reversible from the portal and will log them out everywhere.`)) return;
    const res = await fetch("/api/admin/lecturers", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lecturerIds: ids, confirmation: "DELETE TUTORS" }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error || "Could not delete selected tutors");
      return;
    }
    setSelectedTutorIds(new Set());
    await load();
  }

  async function uploadTutorPhoto(file: File | null, target: "create" | "edit") {
    if (!file) return null;

    if (target === "create") {
      setUploadingCreatePhoto(true);
    } else {
      setUploadingEditPhoto(true);
    }
    setError("");
    setSuccess("");

    try {
      const url = await uploadImage(file);
      if (!url) throw new Error("Upload failed");
      if (target === "create") {
        setCreatePhotoUrl(url);
      } else {
        setEditPhotoUrl(url);
      }
      return url;
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Could not upload the photo");
      return null;
    } finally {
      if (target === "create") {
        setUploadingCreatePhoto(false);
      } else {
        setUploadingEditPhoto(false);
      }
    }
  }

  async function createTutor() {
    setCreating(true);
    setError("");
    setSuccess("");
    try {
      let uploadedPhotoUrl = createPhotoUrl;
      if (createPhotoFile) {
        uploadedPhotoUrl = await uploadTutorPhoto(createPhotoFile, "create");
      }
      if (createPhotoFile && !uploadedPhotoUrl) {
        return;
      }

      const res = await fetch("/api/admin/lecturers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          ...newAssignment,
          assignmentGroups: newAssignment.groups,
          features: newFeatures,
          photoUrl: uploadedPhotoUrl ?? undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not create the tutor account");

      setSuccess(
        `Tutor account created for ${data.lecturer?.email}. Temporary password: ${data.lecturer?.password} — hand this over now, it is not shown again.`,
      );
      setForm({
        name: "",
        email: "",
        password: "",
        phone: "",
        specialization: "",
        bio: "",
        employmentType: "",
        startedAt: "",
      });
      setNewAssignment(EMPTY_ASSIGNMENT);
      setCreatePhotoFile(null);
      setCreatePhotoUrl(null);
      await load();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Could not create the tutor account");
    } finally {
      setCreating(false);
    }
  }

  const BROAD_COVERAGE_LEVELS = 2;
  const BROAD_COVERAGE_STUDENTS = 25;

  /** Runs on every "Save assignment" click — a broad-looking pattern stops here for a confirm click instead of saving straight away. */
  async function checkCoverageThenSave() {
    if (!editingId) return;
    setError("");
    setCoveragePreview(null);
    setCheckingCoverage(true);
    try {
      const res = await fetch("/api/admin/lecturers/coverage-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...editAssignment, assignmentGroups: editAssignment.groups, lecturerId: editingId }),
      });
      const data = await res.json().catch(() => ({ count: 0, levels: [] }));
      const broad = (data.levels?.length ?? 0) >= BROAD_COVERAGE_LEVELS || (data.count ?? 0) >= BROAD_COVERAGE_STUDENTS;
      if (broad) {
        setCoveragePreview({
          count: data.count ?? 0,
          levels: data.levels ?? [],
          byLevel: data.byLevel,
          toLink: data.toLink,
        });
        return;
      }
      await saveAssignment();
    } catch {
      // A failed preview must not block a genuine save — fall through.
      await saveAssignment();
    } finally {
      setCheckingCoverage(false);
    }
  }

  async function saveAssignment() {
    if (!editingId) return;
    setSavingEdit(true);
    setError("");
    setSuccess("");
    try {
      let uploadedPhotoUrl = editPhotoUrl;
      if (editPhotoFile) {
        uploadedPhotoUrl = await uploadTutorPhoto(editPhotoFile, "edit");
      }
      if (editPhotoFile && !uploadedPhotoUrl) {
        return;
      }

      const res = await fetch("/api/admin/lecturers", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lecturerId: editingId,
          ...editAssignment,
          assignmentGroups: editAssignment.groups,
          features: editFeatures,
          photoUrl: uploadedPhotoUrl ?? undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not save the assignment");
      setSuccess(
        "Assignment saved and the tutor has been told. The students who fit this class are listed below — link them to finish.",
      );
      // Stay on the tutor instead of closing: the very next thing the office
      // wants is the list of students who fit the class they just saved.
      setCoveragePreview(null);
      setEditPhotoFile(null);
      setEditPhotoUrl(null);
      await load();
      const targetId = editingId;
      window.setTimeout(() => {
        document.getElementById(`class-roster-${targetId}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 250);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save the assignment");
    } finally {
      setSavingEdit(false);
    }
  }

  const canCreate =
    form.name.trim() !== "" && form.email.trim() !== "" && form.password.length >= 8 && !creating;

  return (
    <AdminShell>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.24em] text-[var(--accent)]">Academics</p>
            <h1 className="flex items-center gap-3 text-3xl font-bold">
              <LecturerIcon className="h-7 w-7 text-[var(--accent)]" />
              Tutors
            </h1>
            <p className="mt-2 text-sm text-[var(--muted)]">
              Create tutor accounts and decide which classes each one takes. A tutor cannot change this from their own
              portal — what you set here is what their roster, timetable and attendance list show.
            </p>
          </div>
          <button
            type="button"
            onClick={() => router.back()}
            className="inline-flex items-center gap-2 rounded-lg border border-[var(--border)] px-4 py-3 text-sm font-semibold text-[var(--accent)]"
          >
            <ArrowLeftIcon /> Back
          </button>
        </div>

        {error ? <div className="rounded-2xl bg-rose-500/10 p-4 text-sm text-rose-700">{error}</div> : null}
        {success ? <div className="rounded-2xl bg-emerald-500/10 p-4 text-sm text-emerald-800">{success}</div> : null}

        {/* ---------------------------------------------------------------- */}
        <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm md:p-8">
          <h2 className="text-2xl font-bold">Tutor directory</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {loading
              ? "Loading…"
              : `Showing ${visibleTutors.length} of ${tutors.length} tutor${tutors.length === 1 ? "" : "s"}.`}
          </p>

          <div className="mt-4 flex flex-wrap gap-2">
            {(
              [
                { key: "current" as const, label: "Currently teaching" },
                ...LECTURER_STATUSES.map((status) => ({ key: status, label: LECTURER_STATUS_META[status].label })),
                { key: "all" as const, label: "All" },
              ]
            ).map((option) => {
              const count =
                option.key === "all"
                  ? tutors.length
                  : option.key === "current"
                    ? tutors.filter((tutor) => tutor.status !== "inactive").length
                    : statusCounts[option.key] ?? 0;
              return (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => setStatusFilter(option.key)}
                  className={`rounded-full px-4 py-2 text-xs font-semibold transition ${
                    statusFilter === option.key
                      ? "bg-[var(--accent)] text-white"
                      : "border border-[var(--border)] bg-[var(--surface-alt)] text-[var(--muted)] hover:text-[var(--foreground)]"
                  }`}
                >
                  {option.label} ({count})
                </button>
              );
            })}
          </div>

          {/* Physical and online coverage read identically in a flat list —
              same level, same "Currently teaching" badge — which is exactly
              what let one tutor's coverage silently absorb every online AND
              hybrid student at their level. This filter keeps the two apart. */}
          <div className="mt-2 flex flex-wrap gap-2">
            {(
              [
                { key: "all" as const, label: "All modes", count: tutors.length },
                { key: "physical" as const, label: "Physical", count: modeCounts.physical },
                { key: "online" as const, label: "Online", count: modeCounts.online },
                { key: "private" as const, label: "Private", count: modeCounts.private },
              ]
            ).map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => setModeFilter(option.key)}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                  modeFilter === option.key
                    ? "bg-[var(--foreground)] text-[var(--surface)]"
                    : "border border-dashed border-[var(--border)] text-[var(--muted)] hover:text-[var(--foreground)]"
                }`}
              >
                {option.label} ({option.count})
              </button>
            ))}
          </div>

          <div className="mt-5 space-y-3">
            {selectedTutorIds.size > 0 ? (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
                <span>{selectedTutorIds.size} tutor{selectedTutorIds.size === 1 ? "" : "s"} selected</span>
                <button type="button" onClick={deleteSelectedTutors} className="rounded-lg bg-red-600 px-4 py-2 font-semibold text-white">Delete selected</button>
              </div>
            ) : null}
            {!loading && tutors.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-[var(--border)] p-5 text-sm text-[var(--muted)]">
                No tutor accounts yet. Create one below.
              </p>
            ) : null}

            {!loading && tutors.length > 0 && visibleTutors.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-[var(--border)] p-5 text-sm text-[var(--muted)]">
                No tutors with this status.
              </p>
            ) : null}

            {visibleTutors.map((tutor) => {
              const isEditing = editingId === tutor.id;
              return (
                <div key={tutor.id} className="rounded-2xl border border-[var(--border)] bg-[var(--surface-alt)] p-5">
                  <div className="flex flex-wrap items-start gap-4">
                    <input type="checkbox" aria-label={`Select ${tutor.user.name || tutor.user.email}`} checked={selectedTutorIds.has(tutor.id)} onChange={(event) => setSelectedTutorIds((current) => { const next = new Set(current); if (event.target.checked) next.add(tutor.id); else next.delete(tutor.id); return next; })} className="mt-2 h-4 w-4" />
                    <TutorAvatar photoUrl={tutor.photoUrl} label={tutor.user.name || tutor.user.email} />

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold text-[var(--foreground)]">{tutor.user.name || "Unnamed tutor"}</p>
                        <StatusBadge status={tutor.status} />
                        {tutor.employmentType ? (
                          <span className="rounded-full border border-[var(--border)] px-2.5 py-1 text-[11px] font-semibold text-[var(--muted)]">
                            {EMPLOYMENT_TYPE_LABELS[tutor.employmentType]}
                          </span>
                        ) : null}
                      </div>
                      <p className="text-sm text-[var(--muted)]">{tutor.user.email}</p>
                      {tutor.statusNote ? (
                        <p className="mt-1 text-xs italic text-[var(--muted)]">{tutor.statusNote}</p>
                      ) : null}
                      <p className="mt-2 text-sm text-[var(--foreground-soft)]">{tutor.assignmentLabel}</p>
                      {tutor.assignment.classTypes.length ? (
                        <p className="mt-1 text-xs text-[var(--muted)]">
                          Class types: {tutor.assignment.classTypes.map((type) => CLASS_TYPE_LABELS[type] ?? type).join(", ")}
                        </p>
                      ) : null}
                      {assignmentBatches(tutor.assignment).length ? (
                        <p className="mt-1 text-xs text-[var(--muted)]">
                          Batches: {assignmentBatches(tutor.assignment).join(", ")}
                        </p>
                      ) : null}
                    </div>

                    <div className="flex flex-col items-end gap-2">
                      <button
                        type="button"
                        onClick={() => setRosterPanelId(rosterPanelId === tutor.id ? "" : tutor.id)}
                        className="inline-flex items-center gap-1.5 rounded-full bg-[var(--accent-soft)] px-3 py-1 text-xs font-semibold text-[var(--accent)] transition hover:brightness-95"
                      >
                        <UsersIcon className="h-3.5 w-3.5" />
                        {tutor.studentCount} student{tutor.studentCount === 1 ? "" : "s"}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingId(isEditing ? "" : tutor.id);
                          setEditAssignment(tutor.assignment);
                          setEditFeatures(tutor.features ?? [...LECTURER_FEATURES]);
                          setCoveragePreview(null);
                        }}
                        className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-xs font-semibold text-[var(--foreground)]"
                      >
                        {isEditing ? "Close" : "Edit tutor"}
                      </button>
                    </div>
                  </div>

                  {isEditing ? (
                    <div className="mt-5 space-y-5 border-t border-[var(--border)] pt-5">
                      <StatusPanel
                        key={`${tutor.id}-${tutor.status}`}
                        tutor={tutor}
                        onSaved={async (message) => {
                          setError("");
                          setSuccess(message);
                          await load();
                        }}
                        onError={(message) => {
                          setSuccess("");
                          setError(message);
                        }}
                      />

                      {/* Assigning a class to somebody who has left, or who is
                          away, is the mistake this whole field exists to catch
                          — so say it here, where the class is being given. */}
                      {!LECTURER_STATUS_META[tutor.status].assignable ? (
                        <p className="rounded-2xl bg-amber-500/10 p-4 text-xs text-amber-800">
                          This tutor is marked{" "}
                          <strong>{LECTURER_STATUS_META[tutor.status].label.toLowerCase()}</strong>. You can still
                          edit their assignment — but check that somebody is actually covering these classes.
                        </p>
                      ) : null}

                      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
                        <p className="text-sm font-semibold text-[var(--foreground)]">Tutor photo</p>
                        <p className="mt-1 text-xs text-[var(--muted)]">
                          Use the same photo picker as the student signup flow — take a photo or upload one.
                        </p>
                        <div className="mt-3">
                          <PhotoCapture
                            disabled={uploadingEditPhoto}
                            onChange={(file) => {
                              setEditPhotoFile(file);
                              setEditPhotoUrl(file ? "" : null);
                            }}
                          />
                        </div>
                        {editingTutor?.photoUrl && !editPhotoFile ? (
                          <div className="mt-3 inline-flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-alt)] px-3 py-2 text-xs text-[var(--muted)]">
                            <TutorAvatar
                              photoUrl={editingTutor.photoUrl}
                              label={editingTutor.user.name || editingTutor.user.email}
                              size="h-8 w-8"
                              textSize="text-xs"
                            />
                            Current photo on this tutor profile.
                          </div>
                        ) : null}
                      </div>

                      <AssignmentFields
                        branches={branches}
                        value={editAssignment}
                        onChange={(next) => {
                          setEditAssignment(next);
                          setCoveragePreview(null);
                        }}
                      />

                      <div className="mt-5">
                        <PortalAccessFields value={editFeatures} onChange={setEditFeatures} />
                      </div>

                      {/* Always shown. The pairing screen used to be hidden
                          behind the "Private" class type, so the one mechanism
                          that fixes a class the description cannot express was
                          invisible to the people who needed it. */}
                      <ClassRoster
                        lecturerId={tutor.id}
                        tutorName={tutor.user.name || tutor.user.email}
                        onChanged={load}
                        refreshKey={assignmentSignature(tutor.assignment)}
                        unsavedChanges={assignmentSignature(editAssignment) !== assignmentSignature(tutor.assignment)}
                      />

                      {coveragePreview ? (
                        <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
                          <p className="font-semibold">
                            This covers {coveragePreview.count} student{coveragePreview.count === 1 ? "" : "s"}
                            {coveragePreview.byLevel
                              ? ` (${Object.entries(coveragePreview.byLevel)
                                  .sort(([a], [b]) => a.localeCompare(b))
                                  .map(([level, count]) => `${level}: ${count}`)
                                  .join(", ")})`
                              : coveragePreview.levels.length
                                ? ` across ${coveragePreview.levels.join(", ")}`
                                : ""}
                            .
                          </p>
                          <p className="mt-1 text-xs text-amber-800">
                            That is a lot of ground for one tutor&apos;s coverage — double-check the levels, sessions and
                            class type above before confirming.
                            {coveragePreview.toLink
                              ? ` Saving does not link anyone yet: afterwards ${coveragePreview.toLink.primary} would get this tutor as their tutor, ${coveragePreview.toLink.coTutor} would get them added beside a current tutor, and ${coveragePreview.toLink.other} already have a tutor and stay as they are.`
                              : ""}
                          </p>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={saveAssignment}
                              disabled={savingEdit}
                              className="rounded-lg bg-amber-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-60"
                            >
                              {savingEdit ? "Saving…" : `Confirm — cover ${coveragePreview.count} students`}
                            </button>
                            <button
                              type="button"
                              onClick={() => setCoveragePreview(null)}
                              className="rounded-lg border border-amber-400 px-4 py-2 text-xs font-semibold text-amber-900"
                            >
                              Let me adjust it
                            </button>
                          </div>
                        </div>
                      ) : null}

                      <div className="flex flex-wrap gap-3">
                        <button
                          type="button"
                          onClick={checkCoverageThenSave}
                          disabled={savingEdit || checkingCoverage}
                          className="rounded-lg bg-[var(--accent)] px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
                        >
                          {checkingCoverage ? "Checking…" : savingEdit ? "Saving…" : "Save assignment"}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingId("");
                            setCoveragePreview(null);
                          }}
                          className="rounded-lg border border-[var(--border)] px-5 py-2.5 text-sm font-semibold"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : null}

                  {rosterPanelId === tutor.id ? (
                    <div className="mt-5 border-t border-[var(--border)] pt-5">
                      <TutorRosterPanel
                        lecturerId={tutor.id}
                        tutorName={tutor.user.name || tutor.user.email}
                        onClose={() => setRosterPanelId("")}
                      />
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>

        {/* ---------------------------------------------------------------- */}
        <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm md:p-8">
          <h2 className="text-2xl font-bold">Create a tutor</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Tutors can only be created here. There is no self-signup — the school decides who teaches.
          </p>

          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <label className="block text-sm font-medium">
              Full name
              <input
                value={form.name}
                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                className="mt-2 w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-4 py-3 text-sm"
                placeholder="Frau Ada Evans"
              />
            </label>
            <label className="block text-sm font-medium">
              Email
              <input
                type="email"
                value={form.email}
                onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
                className="mt-2 w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-4 py-3 text-sm"
                placeholder="tutor@easyway.test"
              />
            </label>
            <label className="block text-sm font-medium">
              Temporary password
              <PasswordInput
                value={form.password}
                onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))}
                className="mt-2 w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-4 py-3 text-sm"
                placeholder="Minimum 8 characters"
              />
            </label>
            <label className="block text-sm font-medium">
              Phone
              <input
                value={form.phone}
                onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))}
                className="mt-2 w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-4 py-3 text-sm"
                placeholder="+234 …"
              />
            </label>
            <label className="block text-sm font-medium">
              Employment
              <select
                value={form.employmentType}
                onChange={(event) => setForm((current) => ({ ...current, employmentType: event.target.value }))}
                className="mt-2 w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-4 py-3 text-sm"
              >
                <option value="">Not recorded</option>
                {EMPLOYMENT_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {EMPLOYMENT_TYPE_LABELS[type]}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm font-medium">
              Started
              <input
                type="date"
                value={form.startedAt}
                onChange={(event) => setForm((current) => ({ ...current, startedAt: event.target.value }))}
                className="mt-2 w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-4 py-3 text-sm"
              />
            </label>
            <label className="block text-sm font-medium md:col-span-2">
              Specialization
              <input
                value={form.specialization}
                onChange={(event) => setForm((current) => ({ ...current, specialization: event.target.value }))}
                className="mt-2 w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-4 py-3 text-sm"
                placeholder="German language, exam prep, business communication"
              />
            </label>
            <label className="block text-sm font-medium md:col-span-2">
              Bio
              <textarea
                value={form.bio}
                onChange={(event) => setForm((current) => ({ ...current, bio: event.target.value }))}
                rows={3}
                className="mt-2 w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-4 py-3 text-sm"
                placeholder="Optional"
              />
            </label>
          </div>

          <div className="mt-8 rounded-2xl border border-[var(--border)] bg-[var(--surface-alt)] p-5">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[var(--accent)]">Photo</p>
            <p className="mt-1 text-xs text-[var(--muted)]">
              Use the same photo picker as the student signup flow — take a photo or upload one for the new tutor.
            </p>
            <div className="mt-3">
              <PhotoCapture
                disabled={uploadingCreatePhoto}
                onChange={(file) => {
                  setCreatePhotoFile(file);
                  setCreatePhotoUrl(file ? "" : null);
                }}
              />
            </div>
          </div>

          <div className="mt-8 rounded-2xl border border-[var(--border)] bg-[var(--surface-alt)] p-5">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[var(--accent)]">Assignment</p>
            <p className="mt-1 mb-5 text-xs text-[var(--muted)]">
              Students appear on this tutor&apos;s dashboard automatically once they register for a matching branch and
              level. Nobody adds them by hand.
            </p>
            <AssignmentFields branches={branches} value={newAssignment} onChange={setNewAssignment} />

            <div className="mt-5">
              <PortalAccessFields value={newFeatures} onChange={setNewFeatures} />
            </div>
          </div>

          <button
            type="button"
            onClick={createTutor}
            disabled={!canCreate}
            className="mt-6 rounded-lg bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-white disabled:opacity-60"
          >
            {creating ? "Creating…" : "Create tutor account"}
          </button>
        </div>
      </div>
    </AdminShell>
  );
}
