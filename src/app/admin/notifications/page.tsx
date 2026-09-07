"use client";

import { useEffect, useState } from "react";
import AdminShell from "@/components/AdminShell";
import { LEVELS } from "@/lib/levels";
import { MONTH_NAMES } from "@/lib/batch";

type NotificationRecord = {
  id: string;
  title: string;
  message: string;
  channel: string;
  status: string;
  createdAt: string;
  audience?: string | null;
  recipientCount?: number;
  student?: { user: { name?: string | null; email: string } } | null;
  branch?: { name: string } | null;
};

type StudentOption = { id: string; user: { name?: string | null; email: string } };
type BranchOption = { id: string; name: string };
type LecturerOption = {
  id: string;
  user: { id: string; name?: string | null; email: string };
  assignmentLabel?: string | null;
};

export default function AdminNotificationsPage() {
  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  /** students | lecturers | everyone. See /api/admin/notifications. */
  const [audience, setAudience] = useState("students");
  const [studentId, setStudentId] = useState("");
  const [lecturerId, setLecturerId] = useState("");
  const [branchId, setBranchId] = useState("");
  const [level, setLevel] = useState("");
  /** Students only — narrows a level to one sitting. See /api/admin/notifications. */
  const [sessionSlot, setSessionSlot] = useState("");
  /** Students only — physical | hybrid | online. */
  const [deliveryMode, setDeliveryMode] = useState("");
  /** Students only — intake month name, matched against admission.batch. */
  const [batch, setBatch] = useState("");
  const [link, setLink] = useState("");
  const [alsoEmail, setAlsoEmail] = useState(false);
  const [alsoPush, setAlsoPush] = useState(true);
  const [formError, setFormError] = useState("");
  const [formNotice, setFormNotice] = useState("");
  const [formBusy, setFormBusy] = useState(false);
  const [students, setStudents] = useState<StudentOption[]>([]);
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [lecturers, setLecturers] = useState<LecturerOption[]>([]);
  /**
   * Who the current filters actually resolve to. Null until "Preview
   * recipients" is pressed; cleared the moment any filter changes. Send is
   * disabled until this is set — a few hundred bells cannot be un-rung.
   */
  const [preview, setPreview] = useState<{ count: number; sample: { name: string | null; email: string }[] } | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);

  // Students and tutors each get branch + level, plus their own "one person"
  // picker. "Everyone" takes no filter — the server rejects any combination the
  // form should not have offered, and the form hides what does not apply.
  const targetingStudents = audience === "students";
  const targetingLecturers = audience === "lecturers";
  const targetingEveryone = audience === "everyone";

  async function loadNotifications() {
    try {
      const res = await fetch("/api/admin/notifications");
      if (!res.ok) throw new Error("Unable to load notifications");
      const data = await res.json();
      setNotifications(data.notifications ?? []);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  }

  async function loadRelationships() {
    try {
      const [branchesRes, lecturersRes] = await Promise.all([
        fetch("/api/admin/branches"),
        fetch("/api/admin/lecturers"),
      ]);

      /**
       * The single-student picker needs EVERY active student, not the first
       * page. `/api/admin/students` caps a page at 100 and defaults to 20, so
       * page through until a short page comes back. Safety cap at 5,000 so a
       * bad response can't spin forever.
       */
      const collected: StudentOption[] = [];
      for (let page = 1; page <= 50; page += 1) {
        const res = await fetch(`/api/admin/students?page=${page}&pageSize=100`);
        if (!res.ok) break;
        const data = await res.json();
        const rows: StudentOption[] = data.students || [];
        collected.push(...rows);
        if (rows.length < 100) break;
      }
      collected.sort((a, b) =>
        (a.user.name || a.user.email).localeCompare(b.user.name || b.user.email),
      );
      setStudents(collected);

      if (branchesRes.ok) {
        const data = await branchesRes.json();
        setBranches(data.branches || []);
      }

      if (lecturersRes.ok) {
        const data = await lecturersRes.json();
        setLecturers(data.lecturers || []);
      }
    } catch (error) {
      console.error(error);
    }
  }

  useEffect(() => {
    loadNotifications();
    loadRelationships();
  }, []);

  // Who the send is aimed at, in the shape the API wants. Shared by the preview
  // and the real send so the number you approve is the number that goes out.
  const audiencePayload = {
    audience,
    studentId: targetingStudents ? studentId || null : null,
    lecturerId: targetingLecturers ? lecturerId || null : null,
    branchId: targetingEveryone ? null : branchId || null,
    level: targetingEveryone ? null : level || null,
    sessionSlot: targetingStudents ? sessionSlot || null : null,
    deliveryMode: targetingStudents ? deliveryMode || null : null,
    batch: targetingStudents ? batch || null : null,
  };

  // Any change to who-it-goes-to invalidates a preview taken against the old
  // filters. Serialising is simpler than nine deps and cannot fall out of step.
  const audienceKey = JSON.stringify(audiencePayload);
  useEffect(() => {
    setPreview(null);
  }, [audienceKey]);

  async function runPreview() {
    setFormError("");
    setPreviewBusy(true);
    try {
      const res = await fetch("/api/admin/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...audiencePayload, preview: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not work out the audience");
      setPreview({ count: data.count ?? 0, sample: data.sample ?? [] });
    } catch (error) {
      setPreview(null);
      setFormError(error instanceof Error ? error.message : "Could not work out the audience");
    } finally {
      setPreviewBusy(false);
    }
  }

  async function handleCreateNotification() {
    setFormError("");
    setFormNotice("");

    if (!title.trim() || !message.trim()) {
      setFormError("Title and message are required.");
      return;
    }
    if (!preview) {
      setFormError("Preview the recipients first, so you can see who this reaches.");
      return;
    }

    setFormBusy(true);

    const payload = {
      ...audiencePayload,
      title: title.trim(),
      message: message.trim(),
      link: link.trim() || null,
      alsoEmail,
      alsoPush,
    };

    try {
      const res = await fetch("/api/admin/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Unable to send notification");
      }

      // Reported back, because "it saved" and "it reached 84 people" are
      // different claims and only the second one is what the office wanted.
      setFormNotice(
        `Sent to ${data.sent} ${data.sent === 1 ? "person" : "people"}` +
          (data.pushed ? ` · ${data.pushed} phone${data.pushed === 1 ? "" : "s"} buzzed` : "") +
          (data.emailed ? ` · ${data.emailed} email${data.emailed === 1 ? "" : "s"} queued` : ""),
      );
      setTitle("");
      setMessage("");
      setStudentId("");
      setLecturerId("");
      setBranchId("");
      setLevel("");
      setSessionSlot("");
      setDeliveryMode("");
      setBatch("");
      setLink("");
      setShowForm(false);
      setLoading(true);
      await loadNotifications();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Unable to send notification");
    } finally {
      setFormBusy(false);
    }
  }

  return (
    <AdminShell>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.24em] text-[var(--accent)]">Admin</p>
            <h1 className="text-3xl font-bold">Notifications</h1>
            <p className="mt-2 text-sm text-[var(--muted)]">Create and monitor messages — to students or tutors, narrowed by branch, level, sitting, attendance and intake, or to one person. Preview who it reaches before sending.</p>
          </div>
          <button
            type="button"
            className="rounded-lg bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-white"
            onClick={() => setShowForm((current) => !current)}
          >
            {showForm ? "Close form" : "New notification"}
          </button>
        </div>

        {formNotice ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-emerald-300 bg-emerald-50 px-6 py-4 text-sm font-semibold text-emerald-800">
            <span>{formNotice}</span>
            <button
              type="button"
              onClick={() => setFormNotice("")}
              className="rounded-lg border border-emerald-300 px-3 py-1.5 text-xs"
            >
              Dismiss
            </button>
          </div>
        ) : null}

        {showForm ? (
          <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm">
            <div className="grid gap-4 md:grid-cols-2">
              <label className="space-y-2 text-sm">
                <span className="font-semibold text-[var(--muted)]">Title</span>
                <input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  className="w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                />
              </label>
              <label className="space-y-2 text-sm">
                <span className="font-semibold text-[var(--muted)]">Send to</span>
                <select
                  value={audience}
                  onChange={(event) => setAudience(event.target.value)}
                  className="w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                >
                  <option value="students">Students</option>
                  <option value="lecturers">Tutors</option>
                  <option value="everyone">Everyone (students, tutors and staff)</option>
                </select>
              </label>
              {targetingLecturers ? (
                <label className="space-y-2 text-sm">
                  <span className="font-semibold text-[var(--muted)]">Tutor</span>
                  <select
                    value={lecturerId}
                    onChange={(event) => setLecturerId(event.target.value)}
                    className="w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                  >
                    <option value="">All tutors</option>
                    {lecturers.map((lecturer) => (
                      <option key={lecturer.id} value={lecturer.id}>
                        {lecturer.user.name || lecturer.user.email}
                        {lecturer.assignmentLabel ? ` — ${lecturer.assignmentLabel}` : ""}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              {!targetingEveryone ? (
                <label className="space-y-2 text-sm">
                  <span className="font-semibold text-[var(--muted)]">Branch</span>
                  <select
                    value={branchId}
                    onChange={(event) => setBranchId(event.target.value)}
                    disabled={(targetingLecturers && lecturerId !== "") || (targetingStudents && studentId !== "")}
                    className="w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm disabled:opacity-50"
                  >
                    <option value="">All branches</option>
                    {branches.map((branch) => (
                      <option key={branch.id} value={branch.id}>
                        {branch.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              {!targetingEveryone ? (
                <label className="space-y-2 text-sm">
                  <span className="font-semibold text-[var(--muted)]">Level</span>
                  <select
                    value={level}
                    onChange={(event) => setLevel(event.target.value)}
                    disabled={(targetingLecturers && lecturerId !== "") || (targetingStudents && studentId !== "")}
                    className="w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm disabled:opacity-50"
                  >
                    <option value="">{targetingLecturers ? "Any assigned level" : "All levels"}</option>
                    {LEVELS.map((l) => (
                      <option key={l} value={l}>
                        {l}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              {targetingStudents ? (
                <label className="space-y-2 text-sm">
                  <span className="font-semibold text-[var(--muted)]">Sitting</span>
                  <select
                    value={sessionSlot}
                    onChange={(event) => setSessionSlot(event.target.value)}
                    disabled={studentId !== ""}
                    className="w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm disabled:opacity-50"
                  >
                    <option value="">All sittings</option>
                    <option value="morning">Morning</option>
                    <option value="afternoon">Afternoon</option>
                    <option value="evening">Evening</option>
                    <option value="weekend">Weekend</option>
                  </select>
                </label>
              ) : null}
              {targetingStudents ? (
                <label className="space-y-2 text-sm">
                  <span className="font-semibold text-[var(--muted)]">Attendance</span>
                  <select
                    value={deliveryMode}
                    onChange={(event) => setDeliveryMode(event.target.value)}
                    disabled={studentId !== ""}
                    className="w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm disabled:opacity-50"
                  >
                    <option value="">Any attendance</option>
                    <option value="physical">Physical — campus</option>
                    <option value="hybrid">Hybrid</option>
                    <option value="online">Online</option>
                  </select>
                </label>
              ) : null}
              {targetingStudents ? (
                <label className="space-y-2 text-sm">
                  <span className="font-semibold text-[var(--muted)]">Intake month</span>
                  <select
                    value={batch}
                    onChange={(event) => setBatch(event.target.value)}
                    disabled={studentId !== ""}
                    className="w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm disabled:opacity-50"
                  >
                    <option value="">Any intake</option>
                    {MONTH_NAMES.map((m) => (
                      <option key={m} value={m}>
                        {m} intake
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              {targetingStudents ? (
                <p className="text-xs text-[var(--muted)] md:col-span-2">
                  Branch, level, sitting, attendance and intake stack — leave one on &ldquo;all&rdquo; and it does not narrow.
                  Set all of them and the send reaches exactly one class, e.g. <strong>Lagos · A1 · Morning · Physical · September</strong>.
                  Then press <strong>Preview recipients</strong> to see exactly who is on the list.
                </p>
              ) : null}
              {targetingStudents ? (
                <label className="space-y-2 text-sm md:col-span-2">
                  <span className="font-semibold text-[var(--muted)]">Or send to one person</span>
                  <select
                    value={studentId}
                    onChange={(event) => setStudentId(event.target.value)}
                    className="w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                  >
                    <option value="">— use the filters above —</option>
                    {students.map((student) => (
                      <option key={student.id} value={student.id}>
                        {student.user.name || student.user.email}
                      </option>
                    ))}
                  </select>
                  <span className="block text-xs font-normal text-[var(--muted)]">
                    Picking a name here <strong>overrides every filter above</strong> and sends to just that student.
                    Leave it on &ldquo;use the filters above&rdquo; for a group send.
                  </span>
                </label>
              ) : null}
              <label className="space-y-2 text-sm md:col-span-2">
                <span className="font-semibold text-[var(--muted)]">Message</span>
                <textarea
                  rows={4}
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  className="w-full rounded-3xl border border-[var(--border)] bg-[var(--background)] px-3 py-3 text-sm"
                />
              </label>
              <label className="space-y-2 text-sm">
                <span className="font-semibold text-[var(--muted)]">Opens (optional)</span>
                <input
                  value={link}
                  onChange={(event) => setLink(event.target.value)}
                  placeholder="/calendar"
                  className="w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                />
                <span className="block text-xs font-normal text-[var(--muted)]">
                  Where tapping it takes the reader. Leave blank and it just opens the bell.
                </span>
              </label>
              <div className="space-y-2 text-sm md:col-span-2">
                <span className="font-semibold text-[var(--muted)]">Also deliver by</span>
                <div className="flex flex-wrap gap-4">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={alsoPush}
                      onChange={(event) => setAlsoPush(event.target.checked)}
                      className="h-4 w-4"
                    />
                    Phone notification
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={alsoEmail}
                      onChange={(event) => setAlsoEmail(event.target.checked)}
                      className="h-4 w-4"
                    />
                    Email
                  </label>
                </div>
                <p className="text-xs text-[var(--muted)]">
                  The in-app bell always rings. Anyone who has muted this kind in their own settings is skipped.
                </p>
              </div>
            </div>
            {/* WHO THIS REACHES. Resolved by the same server code the send runs,
                so the number here is the number that goes out. Send stays
                disabled until it has been shown — a bell cannot be un-rung. */}
            <div className="mt-5 rounded-2xl border border-[var(--border)] bg-[var(--background)] p-4">
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={runPreview}
                  disabled={previewBusy || formBusy}
                  className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm font-semibold disabled:opacity-60"
                >
                  {previewBusy ? "Checking…" : "Preview recipients"}
                </button>
                {preview ? (
                  <span className={`text-sm font-semibold ${preview.count === 0 ? "text-red-500" : "text-[var(--foreground)]"}`}>
                    {preview.count === 0
                      ? "Nobody matches these filters — nothing would be sent."
                      : `This will reach ${preview.count} ${preview.count === 1 ? "person" : "people"}.`}
                  </span>
                ) : (
                  <span className="text-sm text-[var(--muted)]">Not previewed yet.</span>
                )}
              </div>
              {preview && preview.sample.length > 0 ? (
                <div className="mt-3 max-h-40 overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2 text-xs text-[var(--muted)]">
                  {preview.sample.map((r) => (
                    <div key={r.email}>{r.name || r.email}{r.name ? ` · ${r.email}` : ""}</div>
                  ))}
                  {preview.count > preview.sample.length ? (
                    <p className="mt-1 italic">…and {preview.count - preview.sample.length} more</p>
                  ) : null}
                </div>
              ) : null}
            </div>

            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
              <button
                type="button"
                onClick={handleCreateNotification}
                disabled={formBusy || !preview || preview.count === 0}
                className="rounded-lg bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
                title={!preview ? "Preview the recipients first" : undefined}
              >
                {formBusy ? "Sending…" : preview ? `Send to ${preview.count}` : "Preview first"}
              </button>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                disabled={formBusy}
                className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm font-semibold text-[var(--foreground-soft)]"
              >
                Cancel
              </button>
              {formError ? <p className="text-sm text-red-500">{formError}</p> : null}
            </div>
          </div>
        ) : null}

        <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-[var(--border)] text-sm">
              <thead className="bg-[var(--background)] text-left uppercase tracking-[0.16em] text-[var(--muted)]">
                <tr>
                  <th className="px-4 py-3">Title</th>
                  <th className="px-4 py-3">Reached</th>
                  <th className="px-4 py-3">User</th>
                  <th className="px-4 py-3">Branch</th>
                  <th className="px-4 py-3">Message</th>
                  <th className="px-4 py-3">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)] bg-[var(--background)]">
                {loading ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-center text-sm text-[var(--muted)]">Loading notifications…</td>
                  </tr>
                ) : notifications.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-center text-sm text-[var(--muted)]">No notifications yet.</td>
                  </tr>
                ) : (
                  notifications.map((notification) => (
                    <tr key={notification.id}>
                      <td className="px-4 py-3">{notification.title}</td>
                      <td className="px-4 py-3">
                        {notification.recipientCount && notification.recipientCount > 1
                          ? `${notification.recipientCount} people`
                          : "1 person"}
                      </td>
                      <td className="px-4 py-3">{notification.student?.user.name ?? notification.student?.user.email ?? "All"}</td>
                      <td className="px-4 py-3">{notification.branch?.name ?? "All"}</td>
                      <td className="px-4 py-3">{notification.message}</td>
                      <td className="px-4 py-3">{new Date(notification.createdAt).toLocaleDateString()}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </AdminShell>
  );
}
