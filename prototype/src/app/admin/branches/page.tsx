"use client";

import { useEffect, useState } from "react";
import AdminShell from "@/components/AdminShell";

type Branch = {
  id: string;
  name: string;
  location?: string | null;
  status: string;
};

export default function AdminBranchesPage() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingBranchId, setEditingBranchId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [status, setStatus] = useState("active");
  const [branchError, setBranchError] = useState("");

  async function loadBranches() {
    setLoading(true);
    const res = await fetch("/api/admin/branches");
    if (res.ok) {
      const data = await res.json();
      setBranches(data.branches || []);
    }
    setLoading(false);
  }

  useEffect(() => {
    loadBranches();
  }, []);

  async function handleSaveBranch() {
    setBranchError("");
    if (!name.trim()) {
      setBranchError("Branch name is required.");
      return;
    }

    const payload = {
      name: name.trim(),
      location: location.trim() || null,
      status,
    } as const;

    const res = await fetch("/api/admin/branches", {
      method: editingBranchId ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editingBranchId ? { branchId: editingBranchId, ...payload } : payload),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setBranchError(data?.error || "Unable to save branch.");
      return;
    }

    setEditingBranchId(null);
    setName("");
    setLocation("");
    setStatus("active");
    setShowForm(false);
    loadBranches();
  }

  function startEditingBranch(branch: Branch) {
    setEditingBranchId(branch.id);
    setName(branch.name);
    setLocation(branch.location || "");
    setStatus(branch.status || "active");
    setBranchError("");
    setShowForm(true);
  }

  function cancelEditingBranch() {
    setEditingBranchId(null);
    setName("");
    setLocation("");
    setStatus("active");
    setBranchError("");
    setShowForm(false);
  }


  return (
    <AdminShell>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.24em] text-[var(--accent)]">Admin</p>
            <h1 className="text-3xl font-bold">Branches</h1>
            <p className="mt-2 text-sm text-[var(--muted)]">Create and manage school branches, sessions, and tutors.</p>
          </div>
          <button
            type="button"
            className="rounded-lg bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-white"
            onClick={() => setShowForm((current) => !current)}
          >
            {showForm ? "Close form" : "Add branch"}
          </button>
        </div>

        {showForm ? (
          <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm">
            <div className="grid gap-4 md:grid-cols-3">
              <label className="space-y-2 text-sm">
                <span className="font-semibold text-[var(--muted)]">Branch name</span>
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  className="w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                />
              </label>
              <label className="space-y-2 text-sm">
                <span className="font-semibold text-[var(--muted)]">Location</span>
                <input
                  value={location}
                  onChange={(event) => setLocation(event.target.value)}
                  className="w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                />
              </label>
              <label className="space-y-2 text-sm">
                <span className="font-semibold text-[var(--muted)]">Status</span>
                <select
                  value={status}
                  onChange={(event) => setStatus(event.target.value)}
                  className="w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </label>
            </div>
            <div className="mt-4 flex items-center gap-3">
              <button
                type="button"
                onClick={handleSaveBranch}
                className="rounded-lg bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-white"
              >
                {editingBranchId ? "Update branch" : "Save branch"}
              </button>
              {editingBranchId ? (
                <button
                  type="button"
                  onClick={cancelEditingBranch}
                  className="rounded-lg border border-[var(--border)] bg-white px-4 py-3 text-sm font-semibold text-slate-700"
                >
                  Cancel
                </button>
              ) : null}
              {branchError ? <p className="text-sm text-red-500">{branchError}</p> : null}
            </div>
          </div>
        ) : null}

        <div className="overflow-hidden rounded-3xl border border-[var(--border)] bg-[var(--background)] shadow-sm">
          <table className="min-w-full divide-y divide-[var(--border)]">
            <thead className="bg-[var(--surface)] text-left text-sm uppercase tracking-[0.16em] text-[var(--muted)]">
              <tr>
                <th className="px-6 py-4">Branch</th>
                <th className="px-6 py-4">Location</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)] bg-[var(--background)]">
              {loading ? (
                <tr>
                  <td colSpan={4} className="px-6 py-10 text-center text-sm text-[var(--muted)]">Loading branches…</td>
                </tr>
              ) : branches.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-6 py-10 text-center text-sm text-[var(--muted)]">No branches found yet.</td>
                </tr>
              ) : (
                branches.map((branch) => (
                  <tr key={branch.id}>
                    <td className="px-6 py-4">{branch.name}</td>
                    <td className="px-6 py-4">{branch.location || "—"}</td>
                    <td className="px-6 py-4">{branch.status}</td>
                    <td className="px-6 py-4 flex gap-2">
                      <button
                        type="button"
                        className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm"
                        onClick={() => startEditingBranch(branch)}
                      >
                        Edit
                      </button>
                      {/*
                        No delete button by design. A branch is referenced by
                        students, classes, payments and community spaces; removing
                        one orphans all of it, and there is no undo. Branches are
                        closed rarely enough that it is not worth a self-service
                        button next to "Edit".
                      */}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </AdminShell>
  );
}
