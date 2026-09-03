"use client";

import { useEffect, useState } from "react";
import AdminShell from "@/components/AdminShell";

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
  const [link, setLink] = useState("");
  const [alsoEmail, setAlsoEmail] = useState(false);
  const [alsoPush, setAlsoPush] = useState(true);
  const [formError, setFormError] = useState("");
  const [formNotice, setFormNotice] = useState("");
  const [formBusy, setFormBusy] = useState(false);
  const [students, setStudents] = useState<StudentOption[]>([]);
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [lecturers, setLecturers] = useState<LecturerOption[]>([]);

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
      const [studentsRes, branchesRes, lecturersRes] = await Promise.all([
        fetch("/api/admin/students"),
        fetch("/api/admin/branches"),
        fetch("/api/admin/lecturers"),
      ]);

      if (studentsRes.ok) {
        const data = await studentsRes.json();
        setStudents(data.students || []);
      }

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

  async function handleCreateNotification() {
    setFormError("");
    setFormNotice("");

    if (!title.trim() || !message.trim()) {
      setFormError("Title and message are required.");
      return;
    }

    setFormBusy(true);

    const payload = {
      title: title.trim(),
      message: message.trim(),
      audience,
      link: link.trim() || null,
      alsoEmail,
      alsoPush,
      // Branch and level narrow students or tutors; the single-person pickers
      // are role-specific. "Everyone" sends all of it as null. The server
      // refuses any combination that does not belong to the chosen audience.
      studentId: targetingStudents ? studentId || null : null,
      lecturerId: targetingLecturers ? lecturerId || null : null,
      branchId: targetingEveryone ? null : branchId || null,
      level: targetingEveryone ? null : level || null,
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
            <p className="mt-2 text-sm text-[var(--muted)]">Create and monitor messages — to students or tutors, filtered by branch, level, or one person.</p>
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
              {targetingStudents ? (
                <label className="space-y-2 text-sm">
                  <span className="font-semibold text-[var(--muted)]">Student</span>
                  <select
                    value={studentId}
                    onChange={(event) => setStudentId(event.target.value)}
                    className="w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                  >
                    <option value="">All students</option>
                    {students.map((student) => (
                      <option key={student.id} value={student.id}>
                        {student.user.name || student.user.email}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
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
                    disabled={targetingLecturers && lecturerId !== ""}
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
              <label className="space-y-2 text-sm md:col-span-2">
                <span className="font-semibold text-[var(--muted)]">Message</span>
                <textarea
                  rows={4}
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  className="w-full rounded-3xl border border-[var(--border)] bg-[var(--background)] px-3 py-3 text-sm"
                />
              </label>
              {!targetingEveryone ? (
                <label className="space-y-2 text-sm">
                  <span className="font-semibold text-[var(--muted)]">Level</span>
                  <input
                    value={level}
                    onChange={(event) => setLevel(event.target.value)}
                    disabled={targetingLecturers && lecturerId !== ""}
                    placeholder={targetingLecturers ? "Any assigned level or e.g. B1" : "All levels or e.g. B1"}
                    className="w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm disabled:opacity-50"
                  />
                </label>
              ) : null}
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
            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
              <button
                type="button"
                onClick={handleCreateNotification}
                disabled={formBusy}
                className="rounded-lg bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
              >
                {formBusy ? "Sending…" : "Send notification"}
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
