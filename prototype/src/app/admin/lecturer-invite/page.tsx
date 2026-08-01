"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import AdminShell from "@/components/AdminShell";
import PasswordInput from "@/components/PasswordInput";
import AssignmentPicker from "@/components/admin/AssignmentPicker";
import { ArrowLeftIcon, LecturerIcon, UsersIcon } from "@/components/icons";
import {
  BATCHES,
  CLASS_TYPES,
  COURSE_LEVELS,
  SESSION_SLOTS,
  type LecturerAssignment,
} from "@/lib/lecturer-assignment";

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
  assignment: LecturerAssignment;
  assignmentLabel: string;
  studentCount: number;
};

type PrivateStudent = {
  id: string;
  name: string;
  email: string;
  studentCode: string | null;
  level: string;
  branchName: string | null;
  totalPaid: number;
  tuitionFee: number;
  hasPaid: boolean;
  currentTutorId: string | null;
  currentTutorName: string | null;
};

const EMPTY_ASSIGNMENT: LecturerAssignment = {
  branchIds: [],
  levels: [],
  sessionSlots: [],
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

      <AssignmentPicker
        label="Assign a level"
        required
        options={COURSE_LEVELS.map((level) => ({ value: level, label: level }))}
        selected={value.levels}
        onChange={(next) => set("levels", next)}
        emptyMeans="No level selected — this tutor will have no students until one is."
      />

      <AssignmentPicker
        label="Assign a class session"
        options={SESSION_SLOTS.map((slot) => ({
          value: slot,
          label: slot.charAt(0).toUpperCase() + slot.slice(1),
        }))}
        selected={value.sessionSlots}
        onChange={(next) => set("sessionSlots", next)}
        emptyMeans="Nothing selected — this tutor takes every sitting of the levels above."
      />

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
 * The private-class pairing panel.
 *
 * Only appears once "Private" is one of the class types, because that is the
 * only case where a student needs naming individually — every other kind of
 * class finds its students from branch + level automatically.
 */
function PrivateStudentSearch({ lecturerId, tutorName }: { lecturerId: string; tutorName: string }) {
  const [query, setQuery] = useState("");
  const [students, setStudents] = useState<PrivateStudent[]>([]);
  const [loading, setLoading] = useState(false);
  const [assigningId, setAssigningId] = useState("");
  const [message, setMessage] = useState("");

  const search = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/lecturers/private-students?q=${encodeURIComponent(query)}`, {
        cache: "no-store",
      });
      const data = await res.json().catch(() => ({}));
      setStudents(data.students || []);
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    // Debounced so typing a name does not fire a request per keystroke.
    const timer = window.setTimeout(search, 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  async function assign(student: PrivateStudent) {
    setAssigningId(student.id);
    setMessage("");
    try {
      const res = await fetch("/api/admin/lecturers/private-students", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId: student.id, lecturerId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not assign this student");
      setMessage(`${student.name} has been assigned to ${tutorName} and notified.`);
      await search();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not assign this student");
    } finally {
      setAssigningId("");
    }
  }

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-alt)] p-5">
      <p className="text-sm font-semibold text-[var(--foreground)]">Private students</p>
      <p className="mt-1 text-xs text-[var(--muted)]">
        Search students on a private package and pair one with this tutor. They are notified with the tutor&apos;s name.
      </p>

      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search by name, email or student code…"
        className="mt-3 w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-4 py-2.5 text-sm"
      />

      {message ? (
        <p className="mt-3 rounded-xl bg-emerald-500/10 px-4 py-2.5 text-xs text-emerald-800">{message}</p>
      ) : null}

      <div className="mt-3 space-y-2">
        {loading ? <p className="text-xs text-[var(--muted)]">Searching…</p> : null}
        {!loading && students.length === 0 ? (
          <p className="text-xs text-[var(--muted)]">
            No students on a private package match. A student gets one by choosing the private-class package at signup or
            checkout.
          </p>
        ) : null}

        {students.map((student) => (
          <div
            key={student.id}
            className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-[var(--foreground)]">{student.name}</p>
              <p className="truncate text-xs text-[var(--muted)]">
                {student.studentCode || student.email} · {student.level}
                {student.branchName ? ` · ${student.branchName}` : ""}
              </p>
            </div>

            <span
              className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                student.hasPaid ? "bg-emerald-500/10 text-emerald-700" : "bg-amber-500/15 text-amber-800"
              }`}
            >
              {student.hasPaid ? "Paid" : `${naira(student.tuitionFee - student.totalPaid)} owing`}
            </span>

            {student.currentTutorId === lecturerId ? (
              <span className="rounded-full bg-[var(--accent-soft)] px-3 py-1 text-[11px] font-semibold text-[var(--accent)]">
                Assigned
              </span>
            ) : (
              <button
                type="button"
                onClick={() => assign(student)}
                disabled={assigningId === student.id}
                className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
              >
                {assigningId === student.id
                  ? "Assigning…"
                  : student.currentTutorName
                    ? `Move from ${student.currentTutorName}`
                    : "Assign"}
              </button>
            )}
          </div>
        ))}
      </div>
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

  const [form, setForm] = useState({ name: "", email: "", password: "", phone: "", specialization: "", bio: "" });
  const [newAssignment, setNewAssignment] = useState<LecturerAssignment>(EMPTY_ASSIGNMENT);
  const [creating, setCreating] = useState(false);

  const [editingId, setEditingId] = useState("");
  const [editAssignment, setEditAssignment] = useState<LecturerAssignment>(EMPTY_ASSIGNMENT);
  const [savingEdit, setSavingEdit] = useState(false);

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

  async function createTutor() {
    setCreating(true);
    setError("");
    setSuccess("");
    try {
      const res = await fetch("/api/admin/lecturers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, ...newAssignment }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not create the tutor account");

      setSuccess(
        `Tutor account created for ${data.lecturer?.email}. Temporary password: ${data.lecturer?.password} — hand this over now, it is not shown again.`,
      );
      setForm({ name: "", email: "", password: "", phone: "", specialization: "", bio: "" });
      setNewAssignment(EMPTY_ASSIGNMENT);
      await load();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Could not create the tutor account");
    } finally {
      setCreating(false);
    }
  }

  async function saveAssignment() {
    if (!editingId) return;
    setSavingEdit(true);
    setError("");
    setSuccess("");
    try {
      const res = await fetch("/api/admin/lecturers", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lecturerId: editingId, ...editAssignment }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not save the assignment");
      setSuccess("Assignment saved. The tutor has been notified and their roster is already updated.");
      setEditingId("");
      await load();
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
            {loading ? "Loading…" : `${tutors.length} tutor${tutors.length === 1 ? "" : "s"}.`}
          </p>

          <div className="mt-5 space-y-3">
            {!loading && tutors.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-[var(--border)] p-5 text-sm text-[var(--muted)]">
                No tutor accounts yet. Create one below.
              </p>
            ) : null}

            {tutors.map((tutor) => {
              const isEditing = editingId === tutor.id;
              return (
                <div key={tutor.id} className="rounded-2xl border border-[var(--border)] bg-[var(--surface-alt)] p-5">
                  <div className="flex flex-wrap items-start gap-4">
                    {tutor.photoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={tutor.photoUrl} alt="" className="h-12 w-12 shrink-0 rounded-full object-cover" />
                    ) : (
                      <div className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-[var(--accent-soft)] text-lg font-bold text-[var(--accent)]">
                        {(tutor.user.name || tutor.user.email).slice(0, 1).toUpperCase()}
                      </div>
                    )}

                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-[var(--foreground)]">{tutor.user.name || "Unnamed tutor"}</p>
                      <p className="text-sm text-[var(--muted)]">{tutor.user.email}</p>
                      <p className="mt-2 text-sm text-[var(--foreground-soft)]">{tutor.assignmentLabel}</p>
                      {tutor.assignment.classTypes.length ? (
                        <p className="mt-1 text-xs text-[var(--muted)]">
                          Class types: {tutor.assignment.classTypes.map((type) => CLASS_TYPE_LABELS[type] ?? type).join(", ")}
                        </p>
                      ) : null}
                      {tutor.assignment.batches.length ? (
                        <p className="mt-1 text-xs text-[var(--muted)]">Batches: {tutor.assignment.batches.join(", ")}</p>
                      ) : null}
                    </div>

                    <div className="flex flex-col items-end gap-2">
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--accent-soft)] px-3 py-1 text-xs font-semibold text-[var(--accent)]">
                        <UsersIcon className="h-3.5 w-3.5" />
                        {tutor.studentCount} student{tutor.studentCount === 1 ? "" : "s"}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingId(isEditing ? "" : tutor.id);
                          setEditAssignment(tutor.assignment);
                        }}
                        className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-xs font-semibold text-[var(--foreground)]"
                      >
                        {isEditing ? "Close" : "Edit assignment"}
                      </button>
                    </div>
                  </div>

                  {isEditing ? (
                    <div className="mt-5 space-y-5 border-t border-[var(--border)] pt-5">
                      <AssignmentFields branches={branches} value={editAssignment} onChange={setEditAssignment} />

                      {editAssignment.classTypes.includes("private") ? (
                        <PrivateStudentSearch
                          lecturerId={tutor.id}
                          tutorName={tutor.user.name || tutor.user.email}
                        />
                      ) : null}

                      <div className="flex flex-wrap gap-3">
                        <button
                          type="button"
                          onClick={saveAssignment}
                          disabled={savingEdit}
                          className="rounded-lg bg-[var(--accent)] px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
                        >
                          {savingEdit ? "Saving…" : "Save assignment"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingId("")}
                          className="rounded-lg border border-[var(--border)] px-5 py-2.5 text-sm font-semibold"
                        >
                          Cancel
                        </button>
                      </div>
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
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[var(--accent)]">Assignment</p>
            <p className="mt-1 mb-5 text-xs text-[var(--muted)]">
              Students appear on this tutor&apos;s dashboard automatically once they register for a matching branch and
              level. Nobody adds them by hand.
            </p>
            <AssignmentFields branches={branches} value={newAssignment} onChange={setNewAssignment} />
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
