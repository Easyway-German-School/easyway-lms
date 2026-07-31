"use client";

export const dynamic = "force-dynamic";

import { useCallback, useEffect, useState } from "react";
import AdminShell from "@/components/AdminShell";
import { AlertIcon, CheckIcon, ShieldIcon } from "@/components/icons";

/**
 * Super Admin only: who else is an admin, and what each of them can reach.
 *
 * The three presets are a starting point, not a cage. Every office ends up
 * with somebody who is a Secretary except that they also handle the fee book,
 * and the choice used to be to promote them to Super Admin — which also hands
 * them the power to change everyone else's access — or to say no.
 *
 * So the preset sets the tick boxes and the tick boxes can then be changed.
 * What is stored is the difference from the preset, which means widening a
 * preset later still reaches the people who were adjusted by hand.
 */

type Admin = {
  id: string;
  name: string | null;
  email: string;
  adminRole: string;
  label: string;
  presetCapabilities: string[];
  capabilities: string[];
  overrides: { grant: string[]; revoke: string[] };
};

type RoleOption = { value: string; label: string; capabilities: string[] };
type CapabilityOption = { value: string; label: string };

const ROLE_SUMMARY: Record<string, string> = {
  super: "Everything, including who else is an admin.",
  secretary: "Students, attendance, exams, materials and branches.",
  data_comm: "Payments, community, emails, reports and integrations.",
};

export default function AdminStaffPage() {
  const [admins, setAdmins] = useState<Admin[]>([]);
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [allCapabilities, setAllCapabilities] = useState<CapabilityOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/staff", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Unable to load admins");
      setAdmins(data.admins ?? []);
      setRoles(data.roles ?? []);
      setAllCapabilities(data.allCapabilities ?? []);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function save(userId: string, patch: { adminRole?: string; capabilities?: string[] }) {
    setSavingId(userId);
    setSaved(null);
    try {
      const res = await fetch("/api/admin/staff", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId, ...patch }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not update");
      await load();
      setError("");
      setSaved(userId);
      window.setTimeout(() => setSaved(null), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update");
    } finally {
      setSavingId(null);
    }
  }

  /** Ticking a box sends the whole intended list; the route works out the diff. */
  function toggleCapability(admin: Admin, capability: string) {
    const next = admin.capabilities.includes(capability)
      ? admin.capabilities.filter((c) => c !== capability)
      : [...admin.capabilities, capability];
    void save(admin.id, { capabilities: next });
  }

  return (
    <AdminShell>
      <div>
        <div className="mb-6 flex items-start gap-4">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-[var(--accent)]/10 text-[var(--accent)]">
            <ShieldIcon className="h-6 w-6" />
          </span>
          <div>
            <h1 className="text-2xl font-bold sm:text-3xl">Admin roles</h1>
            <p className="mt-1 text-sm text-slate-500">
              Who works in the office, and which parts of the system each of them can open. Start from a
              role, then adjust anyone who needs something slightly different.
            </p>
          </div>
        </div>

        {error && (
          <div className="mb-4 flex items-start gap-2 rounded-2xl bg-red-500/10 p-4 text-sm font-medium text-red-700">
            <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        <div className="mb-6 grid gap-3 sm:grid-cols-3">
          {roles.map((r) => (
            <div key={r.value} className="rounded-2xl border border-slate-200 bg-white p-4">
              <p className="text-sm font-semibold">{r.label}</p>
              <p className="mt-1 text-xs text-slate-500">{ROLE_SUMMARY[r.value]}</p>
            </div>
          ))}
        </div>

        {loading ? (
          <div className="py-12 text-center text-slate-500">Loading…</div>
        ) : admins.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 py-12 text-center text-slate-500">
            No admin accounts yet.
          </div>
        ) : (
          <div className="space-y-3">
            {admins.map((admin) => {
              const isOpen = expanded === admin.id;
              const adjusted = admin.overrides.grant.length + admin.overrides.revoke.length;

              return (
                <div key={admin.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                  <div className="flex flex-wrap items-center gap-3 p-4">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-slate-900">{admin.name ?? "—"}</p>
                      <p className="text-sm text-slate-500">{admin.email}</p>
                    </div>

                    {saved === admin.id && (
                      <span className="flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-600">
                        <CheckIcon className="h-3.5 w-3.5" />
                        Saved
                      </span>
                    )}

                    {adjusted > 0 && (
                      <span className="rounded-full bg-[var(--accent)]/10 px-3 py-1.5 text-xs font-semibold text-[var(--accent)]">
                        {adjusted} adjusted
                      </span>
                    )}

                    <select
                      value={admin.adminRole}
                      disabled={savingId === admin.id}
                      onChange={(e) => save(admin.id, { adminRole: e.target.value })}
                      className="rounded-xl border border-slate-200 px-3 py-2 text-sm disabled:opacity-60"
                    >
                      {roles.map((r) => (
                        <option key={r.value} value={r.value}>
                          {r.label}
                        </option>
                      ))}
                    </select>

                    <button
                      onClick={() => setExpanded(isOpen ? null : admin.id)}
                      className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
                    >
                      {isOpen ? "Done" : "Customise"}
                    </button>
                  </div>

                  {isOpen && (
                    <div className="border-t border-slate-100 bg-slate-50/60 p-4">
                      <p className="mb-3 text-xs text-slate-500">
                        Ticked is what they can reach. Anything different from the{" "}
                        <span className="font-semibold">{admin.label}</span> preset is marked, and stays
                        marked if the preset changes later.
                      </p>

                      <div className="grid gap-2 sm:grid-cols-2">
                        {allCapabilities.map((capability) => {
                          const has = admin.capabilities.includes(capability.value);
                          const inPreset = admin.presetCapabilities.includes(capability.value);
                          const granted = has && !inPreset;
                          const revoked = !has && inPreset;

                          return (
                            <label
                              key={capability.value}
                              className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-sm transition ${
                                granted
                                  ? "border-emerald-300 bg-emerald-50"
                                  : revoked
                                    ? "border-amber-300 bg-amber-50"
                                    : "border-slate-200 bg-white hover:border-slate-300"
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={has}
                                disabled={savingId === admin.id}
                                onChange={() => toggleCapability(admin, capability.value)}
                                className="mt-0.5 h-4 w-4 accent-[var(--accent)]"
                              />
                              <span className="min-w-0 flex-1">
                                <span className="block font-medium text-slate-800">{capability.label}</span>
                                {granted && (
                                  <span className="mt-0.5 block text-xs font-semibold text-emerald-600">
                                    Added for this person
                                  </span>
                                )}
                                {revoked && (
                                  <span className="mt-0.5 block text-xs font-semibold text-amber-600">
                                    Removed for this person
                                  </span>
                                )}
                              </span>
                            </label>
                          );
                        })}
                      </div>

                      {adjusted > 0 && (
                        <button
                          onClick={() => save(admin.id, { capabilities: admin.presetCapabilities })}
                          disabled={savingId === admin.id}
                          className="mt-4 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
                        >
                          Reset to the {admin.label} preset
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </AdminShell>
  );
}
