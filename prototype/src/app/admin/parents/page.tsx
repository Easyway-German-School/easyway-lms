"use client";

import { useEffect, useState } from "react";
import AdminShell from "@/components/AdminShell";
import PasswordInput from "@/components/PasswordInput";

type LinkedChild = {
  id: string; // ParentStudent row id
  studentId: string;
  student: {
    id: string;
    studentCode: string | null;
    user: { name: string | null; email: string };
  };
};

type ParentRow = {
  id: string;
  phone: string | null;
  childName: string | null;
  childEmail: string | null;
  childStudentCode: string | null;
  user: { id: string; name: string | null; email: string; createdAt: string };
  // @deprecated single-child legacy link — `children` is the real list now.
  student: {
    id: string;
    studentCode: string | null;
    user: { name: string | null; email: string };
  } | null;
  children: LinkedChild[];
};

type StudentOption = {
  id: string;
  studentCode: string | null;
  level: string;
  user: { name: string | null; email: string };
};

const emptyForm = {
  name: "",
  email: "",
  password: "",
  phone: "",
  childName: "",
  childEmail: "",
  childStudentCode: "",
};

export default function AdminParentsPage() {
  const [parents, setParents] = useState<ParentRow[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [selectedStudent, setSelectedStudent] = useState<StudentOption | null>(null);
  const [studentQuery, setStudentQuery] = useState("");
  const [studentOptions, setStudentOptions] = useState<StudentOption[]>([]);
  const [searchingStudents, setSearchingStudents] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedCredentials, setSavedCredentials] = useState<{ name: string; email: string; password: string } | null>(null);
  // Only meaningful once a parent exists (editingId set) — a brand-new parent
  // gets its first child via `selectedStudent` at creation, then more are
  // added here after saving once.
  const [linkedChildren, setLinkedChildren] = useState<LinkedChild[]>([]);
  const [addingChild, setAddingChild] = useState(false);

  async function loadParents() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      const res = await fetch(`/api/admin/parents?${params.toString()}`);
      const data = await res.json().catch(() => ({}));
      setParents(data.parents || []);
      setTotalCount(data.totalCount || 0);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadParents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  // Debounced live search against the real student roster, so a link made
  // here points at somebody the office actually picked rather than a typed
  // email that might not match.
  useEffect(() => {
    if (!studentQuery.trim()) {
      setStudentOptions([]);
      return;
    }
    setSearchingStudents(true);
    const handle = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/admin/students?search=${encodeURIComponent(studentQuery)}&pageSize=8`);
        const data = await res.json().catch(() => ({}));
        setStudentOptions(
          (data.students || []).map((s: any) => ({
            id: s.id,
            studentCode: s.studentCode,
            level: s.level,
            user: { name: s.user?.name, email: s.user?.email },
          })),
        );
      } finally {
        setSearchingStudents(false);
      }
    }, 300);
    return () => window.clearTimeout(handle);
  }, [studentQuery]);

  function resetForm() {
    setForm(emptyForm);
    setSelectedStudent(null);
    setStudentQuery("");
    setStudentOptions([]);
    setEditingId(null);
    setLinkedChildren([]);
    setError("");
  }

  function startEdit(row: ParentRow) {
    setEditingId(row.id);
    setForm({
      name: row.user.name || "",
      email: row.user.email,
      password: "",
      phone: row.phone || "",
      childName: row.childName || "",
      childEmail: row.childEmail || "",
      childStudentCode: row.childStudentCode || "",
    });
    setSelectedStudent(null);
    setLinkedChildren(row.children);
    setStudentQuery("");
    setStudentOptions([]);
    setError("");
    setShowForm(true);
  }

  async function addChild(parentId: string, student: StudentOption) {
    setAddingChild(true);
    try {
      const res = await fetch(`/api/admin/parents/${parentId}/children`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId: student.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Unable to link child");
      setLinkedChildren((prev) => [
        ...prev,
        { id: `pending-${student.id}`, studentId: student.id, student: { id: student.id, studentCode: student.studentCode, user: student.user } },
      ]);
      setStudentQuery("");
      setStudentOptions([]);
      await loadParents();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to link child");
    } finally {
      setAddingChild(false);
    }
  }

  async function removeChild(parentId: string, studentId: string) {
    setLinkedChildren((prev) => prev.filter((c) => c.studentId !== studentId));
    await fetch(`/api/admin/parents/${parentId}/children`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ studentId }),
    });
    await loadParents();
  }

  async function handleSave() {
    setError("");
    if (!form.name.trim() || !form.email.trim()) {
      setError("Name and email are required.");
      return;
    }
    if (!editingId && form.password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (form.password && form.password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    setSaving(true);
    try {
      if (editingId) {
        const res = await fetch("/api/admin/parents", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            parentId: editingId,
            name: form.name,
            email: form.email,
            ...(form.password ? { password: form.password } : {}),
            phone: form.phone,
            childName: form.childName,
            childEmail: form.childEmail,
            childStudentCode: form.childStudentCode,
            // Note: no studentId here — the legacy single-child scalar is
            // deprecated. Children are managed via linkedChildren/addChild/
            // removeChild against /api/admin/parents/[id]/children instead.
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Unable to update parent");
      } else {
        const res = await fetch("/api/admin/parents", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: form.name,
            email: form.email,
            password: form.password,
            phone: form.phone,
            childName: form.childName,
            childEmail: form.childEmail,
            childStudentCode: form.childStudentCode,
            studentId: selectedStudent?.id ?? null,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Unable to create parent");
        setSavedCredentials({ name: form.name, email: form.email, password: form.password });
      }

      setShowForm(false);
      resetForm();
      await loadParents();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(row: ParentRow) {
    if (!window.confirm(`Remove ${row.user.name || row.user.email}'s parent account? This cannot be undone.`)) return;
    await fetch("/api/admin/parents", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ parentId: row.id }),
    });
    await loadParents();
  }

  return (
    <AdminShell>
      <div className="space-y-6 p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-[var(--foreground)]">Parents</h1>
            <p className="mt-1 text-sm text-[var(--muted)]">
              {totalCount} parent account{totalCount === 1 ? "" : "s"}. Create one by hand, and link every child this
              parent should see in their timetable and attendance dashboard.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search parent or child name/email…"
              className="w-64 rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
            />
            <button
              type="button"
              onClick={() => {
                if (showForm) {
                  setShowForm(false);
                  resetForm();
                } else {
                  resetForm();
                  setShowForm(true);
                }
              }}
              className="rounded-lg bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-white"
            >
              {showForm ? "Close form" : "Add parent"}
            </button>
          </div>
        </div>

        {savedCredentials ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-emerald-300 bg-emerald-50 px-6 py-4 text-sm text-emerald-800">
            <p>
              <strong>{savedCredentials.name}</strong> was added. Login — email:{" "}
              <span className="font-mono">{savedCredentials.email}</span>, password:{" "}
              <span className="font-mono">{savedCredentials.password}</span>
            </p>
            <button
              type="button"
              onClick={() => setSavedCredentials(null)}
              className="rounded-lg border border-emerald-300 px-3 py-1.5 text-xs font-semibold text-emerald-800"
            >
              Dismiss
            </button>
          </div>
        ) : null}

        {showForm ? (
          <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm">
            <div className="grid gap-4 md:grid-cols-2">
              <label className="space-y-2 text-sm">
                <span className="font-semibold text-[var(--muted)]">Name</span>
                <input
                  value={form.name}
                  onChange={(event) => setForm((f) => ({ ...f, name: event.target.value }))}
                  className="w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                />
              </label>
              <label className="space-y-2 text-sm">
                <span className="font-semibold text-[var(--muted)]">Email</span>
                <input
                  value={form.email}
                  onChange={(event) => setForm((f) => ({ ...f, email: event.target.value }))}
                  className="w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                />
              </label>
              <label className="space-y-2 text-sm">
                <span className="font-semibold text-[var(--muted)]">{editingId ? "Reset password (optional)" : "Password"}</span>
                <PasswordInput
                  value={form.password}
                  onChange={(event) => setForm((f) => ({ ...f, password: event.target.value }))}
                  className="w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                />
              </label>
              <label className="space-y-2 text-sm">
                <span className="font-semibold text-[var(--muted)]">Phone</span>
                <input
                  value={form.phone}
                  onChange={(event) => setForm((f) => ({ ...f, phone: event.target.value }))}
                  className="w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                />
              </label>
            </div>

            <div className="mt-6 border-t border-[var(--border)] pt-5">
              <p className="text-sm font-semibold text-[var(--foreground)]">Linked children</p>
              <p className="mt-1 text-xs text-[var(--muted)]">
                {editingId
                  ? "A parent can see every child linked here — add as many as this family has enrolled."
                  : "Search the real roster and pick a student this parent may see. More children can be added once this account is saved."}
              </p>

              {editingId && linkedChildren.length ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {linkedChildren.map((child) => (
                    <div
                      key={child.studentId}
                      className="flex items-center gap-2 rounded-full border border-[var(--accent)]/30 bg-[var(--accent-soft)] px-3 py-1.5 text-xs"
                    >
                      <span className="font-semibold text-[var(--foreground)]">
                        {child.student.user.name || child.student.user.email}
                      </span>
                      <span className="text-[var(--muted)]">{child.student.studentCode || ""}</span>
                      <button
                        type="button"
                        onClick={() => removeChild(editingId, child.studentId)}
                        className="ml-1 font-semibold text-red-600"
                        aria-label={`Unlink ${child.student.user.name || child.student.user.email}`}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}

              {!editingId && selectedStudent ? (
                <div className="mt-3 flex items-center justify-between rounded-2xl border border-[var(--accent)]/30 bg-[var(--accent-soft)] px-4 py-3">
                  <div className="text-sm">
                    <p className="font-semibold text-[var(--foreground)]">{selectedStudent.user.name || selectedStudent.user.email}</p>
                    <p className="text-xs text-[var(--muted)]">
                      {selectedStudent.studentCode || "No student code"} · {selectedStudent.user.email}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedStudent(null)}
                    className="rounded-lg border border-[var(--border)] bg-white px-3 py-1.5 text-xs font-semibold"
                  >
                    Unlink
                  </button>
                </div>
              ) : (
                <div className="mt-3 space-y-2">
                  <input
                    value={studentQuery}
                    onChange={(event) => setStudentQuery(event.target.value)}
                    placeholder="Search student by name or email…"
                    disabled={addingChild}
                    className="w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                  />
                  {searchingStudents ? <p className="text-xs text-[var(--muted)]">Searching…</p> : null}
                  {studentOptions.length ? (
                    <div className="max-h-48 space-y-1 overflow-y-auto rounded-xl border border-[var(--border)] bg-white p-1">
                      {studentOptions
                        .filter((option) => !linkedChildren.some((c) => c.studentId === option.id))
                        .map((option) => (
                          <button
                            key={option.id}
                            type="button"
                            onClick={() => {
                              if (editingId) {
                                addChild(editingId, option);
                              } else {
                                setSelectedStudent(option);
                                setStudentQuery("");
                                setStudentOptions([]);
                              }
                            }}
                            className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm hover:bg-[var(--accent-soft)]"
                          >
                            <span>{option.user.name || option.user.email}</span>
                            <span className="text-xs text-[var(--muted)]">{option.studentCode || option.level}</span>
                          </button>
                        ))}
                    </div>
                  ) : null}
                </div>
              )}

              <p className="mt-4 text-xs font-semibold text-[var(--muted)]">
                Or record what the parent claims, even if there is no roster match yet:
              </p>
              <div className="mt-2 grid gap-4 md:grid-cols-3">
                <label className="space-y-2 text-sm">
                  <span className="font-semibold text-[var(--muted)]">Child's name</span>
                  <input
                    value={form.childName}
                    onChange={(event) => setForm((f) => ({ ...f, childName: event.target.value }))}
                    className="w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                  />
                </label>
                <label className="space-y-2 text-sm">
                  <span className="font-semibold text-[var(--muted)]">Child's email</span>
                  <input
                    value={form.childEmail}
                    onChange={(event) => setForm((f) => ({ ...f, childEmail: event.target.value }))}
                    className="w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                  />
                </label>
                <label className="space-y-2 text-sm">
                  <span className="font-semibold text-[var(--muted)]">Child's student code</span>
                  <input
                    value={form.childStudentCode}
                    onChange={(event) => setForm((f) => ({ ...f, childStudentCode: event.target.value }))}
                    className="w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                  />
                </label>
              </div>
            </div>

            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="rounded-lg bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
              >
                {saving ? "Saving…" : editingId ? "Update parent" : "Save parent"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowForm(false);
                  resetForm();
                }}
                className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm font-semibold text-[var(--foreground-soft)]"
              >
                Cancel
              </button>
              {error ? <p className="text-sm text-red-500">{error}</p> : null}
            </div>
          </div>
        ) : null}

        <div className="overflow-hidden rounded-3xl border border-[var(--border)] bg-[var(--background)] shadow-sm">
          <div className="w-full overflow-x-auto">
            <table className="min-w-full divide-y divide-[var(--border)]">
              <thead className="bg-[var(--surface)] text-left text-sm uppercase tracking-[0.16em] text-[var(--muted)]">
                <tr>
                  <th className="px-6 py-4">Name</th>
                  <th className="px-6 py-4">Email</th>
                  <th className="px-6 py-4">Phone</th>
                  <th className="px-6 py-4">Linked children</th>
                  <th className="px-6 py-4">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)] bg-[var(--background)]">
                {loading ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-10 text-center text-sm text-[var(--muted)]">Loading parents…</td>
                  </tr>
                ) : parents.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-10 text-center text-sm text-[var(--muted)]">No parent accounts yet.</td>
                  </tr>
                ) : (
                  parents.map((row) => (
                    <tr key={row.id}>
                      <td className="px-6 py-4 text-sm font-semibold text-[var(--foreground)]">{row.user.name || "—"}</td>
                      <td className="px-6 py-4 text-sm text-[var(--muted)]">{row.user.email}</td>
                      <td className="px-6 py-4 text-sm text-[var(--muted)]">{row.phone || "—"}</td>
                      <td className="px-6 py-4 text-sm">
                        {row.children.length ? (
                          <div className="flex flex-wrap gap-1.5">
                            {row.children.map((child) => (
                              <span
                                key={child.studentId}
                                className="inline-flex items-center gap-2 rounded-full border border-emerald-300 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700"
                              >
                                {child.student.user.name || child.student.user.email}
                              </span>
                            ))}
                          </div>
                        ) : row.childName || row.childEmail ? (
                          <span className="inline-flex items-center gap-2 rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">
                            Unconfirmed: {row.childName || row.childEmail}
                          </span>
                        ) : (
                          <span className="text-xs text-[var(--muted)]">Not linked</span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-sm">
                        <div className="flex items-center gap-3">
                          <button
                            type="button"
                            onClick={() => startEdit(row)}
                            className="font-semibold text-[var(--accent)] hover:underline"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(row)}
                            className="font-semibold text-red-600 hover:underline"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
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
