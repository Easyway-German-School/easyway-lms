"use client";

export const dynamic = "force-dynamic";

import { useCallback, useEffect, useState } from "react";
import AdminShell from "@/components/AdminShell";

/** Super Admin only: who else is an admin, and what each of them can reach. */

type Admin = {
  id: string;
  name: string | null;
  email: string;
  adminRole: string;
  label: string;
};

type RoleOption = { value: string; label: string };

const ROLE_SUMMARY: Record<string, string> = {
  super: "Everything, including who else is an admin.",
  secretary: "Students, attendance, exams, materials and branches.",
  data_comm: "Payments, community, emails, reports and integrations.",
};

export default function AdminStaffPage() {
  const [admins, setAdmins] = useState<Admin[]>([]);
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/staff", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Unable to load admins");
      setAdmins(data.admins ?? []);
      setRoles(data.roles ?? []);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function setRole(userId: string, adminRole: string) {
    setSavingId(userId);
    try {
      const res = await fetch("/api/admin/staff", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId, adminRole }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not update");
      await load();
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update");
    } finally {
      setSavingId(null);
    }
  }

  return (
    <AdminShell>
      <div className="p-8">
        <div className="mb-6">
          <h1 className="text-3xl font-bold">Admin roles</h1>
          <p className="mt-1 text-sm text-slate-500">
            Who works in the office, and which parts of the system each of them can open.
          </p>
        </div>

        {error && <div className="mb-4 rounded bg-red-100 p-4 text-red-700">{error}</div>}

        <div className="mb-6 grid gap-3 sm:grid-cols-3">
          {roles.map((r) => (
            <div key={r.value} className="rounded-xl border bg-white p-4">
              <p className="text-sm font-semibold">{r.label}</p>
              <p className="mt-1 text-xs text-slate-500">{ROLE_SUMMARY[r.value]}</p>
            </div>
          ))}
        </div>

        {loading ? (
          <div className="py-12 text-center text-slate-500">Loading…</div>
        ) : (
          <div className="overflow-hidden rounded-xl border bg-white">
            <table className="w-full">
              <thead className="border-b bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Email</th>
                  <th className="px-4 py-3">Role</th>
                </tr>
              </thead>
              <tbody>
                {admins.map((a) => (
                  <tr key={a.id} className="border-b last:border-0">
                    <td className="px-4 py-3 text-sm font-medium">{a.name ?? "—"}</td>
                    <td className="px-4 py-3 text-sm text-slate-500">{a.email}</td>
                    <td className="px-4 py-3">
                      <select
                        value={a.adminRole}
                        disabled={savingId === a.id}
                        onChange={(e) => setRole(a.id, e.target.value)}
                        className="rounded-lg border px-3 py-2 text-sm disabled:opacity-60"
                      >
                        {roles.map((r) => (
                          <option key={r.value} value={r.value}>{r.label}</option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AdminShell>
  );
}
