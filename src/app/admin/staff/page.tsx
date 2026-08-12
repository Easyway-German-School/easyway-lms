"use client";

export const dynamic = "force-dynamic";

import { useCallback, useEffect, useState } from "react";
import AdminShell from "@/components/AdminShell";
import {
  AlertIcon,
  CheckIcon,
  KeyIcon,
  MailIcon,
  ShieldIcon,
  TrashIcon,
  UserPlusIcon,
} from "@/components/icons";

/**
 * Admin accounts: who is in the office, how they sign in, and what each of
 * them can open.
 *
 * The three presets are a starting point, not a cage. Every office ends up
 * with somebody who is a Secretary except that they also handle the fee book,
 * and the choice used to be to promote them to Super Admin — which also hands
 * them the power to change everyone else's access — or to say no. So the
 * preset sets the tick boxes and the tick boxes can then be changed. What is
 * stored is the difference from the preset, which means widening a preset
 * later still reaches the people who were adjusted by hand.
 *
 * WHAT THIS PAGE COULD NOT DO BEFORE: create an account, change an email, or
 * reset a password. All three now live here, because all three were otherwise
 * impossible anywhere in the product — a new secretary meant a hand-written
 * database row and a locked-out one stayed locked out.
 */

type Admin = {
  id: string;
  name: string | null;
  email: string;
  adminRole: string;
  label: string;
  mfaEnabled: boolean;
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
  const [branches, setBranches] = useState<Array<{ id: string; name: string }>>([]);
  const [signInPath, setSignInPath] = useState("/auth/admin");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  // Creating
  const [showNew, setShowNew] = useState(false);
  const [draft, setDraft] = useState({ name: "", email: "", password: "", adminRole: "secretary" });
  const [creating, setCreating] = useState(false);
  const [handover, setHandover] = useState<{ email: string; password: string } | null>(null);

  // Editing one account's details
  const [account, setAccount] = useState({ name: "", email: "", password: "" });

  // Changing my own password
  const [showMine, setShowMine] = useState(false);
  const [mine, setMine] = useState({ currentPassword: "", newPassword: "" });
  const [mineState, setMineState] = useState<{ busy: boolean; message: string; ok: boolean }>({
    busy: false,
    message: "",
    ok: false,
  });

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/staff", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Unable to load admins");
      setAdmins(data.admins ?? []);
      setRoles(data.roles ?? []);
      setAllCapabilities(data.allCapabilities ?? []);
      if (data.signInPath) setSignInPath(data.signInPath);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }, []);

  async function loadBranches() {
    try {
      const res = await fetch('/api/admin/branches');
      if (!res.ok) return;
      const data = await res.json();
      setBranches(data.branches || []);
    } catch (err) {
      // ignore branch load errors — branch access is optional
    }
  }

  useEffect(() => {
    load();
    void loadBranches();
  }, [load]);

  async function save(
    userId: string,
    patch: {
      adminRole?: string;
      capabilities?: string[];
      name?: string;
      email?: string;
      password?: string;
    },
  ) {
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
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update");
      return false;
    } finally {
      setSavingId(null);
    }
  }

  async function create() {
    setCreating(true);
    setHandover(null);
    try {
      const res = await fetch("/api/admin/staff", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(draft),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not create that admin");
      // Shown once. The server stores a hash and cannot tell us again.
      setHandover({ email: data.admin.email, password: data.password });
      setDraft({ name: "", email: "", password: "", adminRole: "secretary" });
      setShowNew(false);
      setError("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create that admin");
    } finally {
      setCreating(false);
    }
  }

  async function revoke(admin: Admin) {
    const sure = window.confirm(
      `Remove admin access for ${admin.name ?? admin.email}?\n\n` +
        "Their account stays, and so does everything they did — they simply " +
        "stop being able to open the admin area. You can make them an admin " +
        "again later.",
    );
    if (!sure) return;

    setSavingId(admin.id);
    try {
      const res = await fetch(`/api/admin/staff?userId=${encodeURIComponent(admin.id)}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not revoke that access");
      setError("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not revoke that access");
    } finally {
      setSavingId(null);
    }
  }

  async function changeMyPassword() {
    setMineState({ busy: true, message: "", ok: false });
    try {
      const res = await fetch("/api/admin/me/password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(mine),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not change your password");
      setMine({ currentPassword: "", newPassword: "" });
      setMineState({ busy: false, message: "Password changed. Use it next time you sign in.", ok: true });
    } catch (e) {
      setMineState({
        busy: false,
        message: e instanceof Error ? e.message : "Could not change your password",
        ok: false,
      });
    }
  }

  /** Ticking a box sends the whole intended list; the route works out the diff. */
  function toggleCapability(admin: Admin, capability: string) {
    const next = admin.capabilities.includes(capability)
      ? admin.capabilities.filter((c) => c !== capability)
      : [...admin.capabilities, capability];
    void save(admin.id, { capabilities: next });
  }

  function toggleBranchAccess(admin: Admin, branchId: string) {
    const current = Array.isArray((admin as any).branchAccess) ? (admin as any).branchAccess as string[] : [];
    const next = current.includes(branchId) ? current.filter((b) => b !== branchId) : [...current, branchId];
    void save(admin.id, { branchAccess: next });
  }

  function startEditing(admin: Admin) {
    setEditing(admin.id);
    setExpanded(null);
    setAccount({ name: admin.name ?? "", email: admin.email, password: "" });
  }

  return (
    <AdminShell>
      {/* min-w-0 so a long email can never widen the shell on a phone. */}
      <div className="min-w-0">
        <div className="mb-5 flex items-start gap-3 sm:mb-6 sm:gap-4">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-[var(--accent)]/10 text-[var(--accent)] sm:h-12 sm:w-12">
            <ShieldIcon className="h-5 w-5 sm:h-6 sm:w-6" />
          </span>
          <div className="min-w-0">
            <h1 className="text-xl font-bold sm:text-3xl">Admin accounts</h1>
            <p className="mt-1 text-sm text-slate-500">
              Who works in the office, how they sign in, and which parts of the system each of them
              can open.
            </p>
          </div>
        </div>

        {/* ---- How they sign in -----------------------------------------
            The single most-asked question about these accounts, answered on
            the page that creates them rather than in somebody's head. */}
        <div className="mb-5 rounded-2xl border border-[var(--accent)]/30 bg-[var(--accent)]/5 p-4">
          <p className="flex items-center gap-2 text-sm font-bold text-slate-900">
            <KeyIcon className="h-4 w-4 shrink-0" />
            How admins sign in
          </p>
          <p className="mt-1.5 text-sm leading-6 text-slate-600">
            Everyone below signs in at{" "}
            <code className="rounded bg-white px-1.5 py-0.5 font-mono text-xs font-semibold text-slate-900">
              {signInPath}
            </code>{" "}
            with the email and password set here — not the student sign-in page. Whatever role they
            hold, that is the same door; the role decides what they see once inside.
          </p>
        </div>

        {error && (
          <div className="mb-4 flex items-start gap-2 rounded-2xl bg-red-500/10 p-4 text-sm font-medium text-red-700">
            <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="min-w-0">{error}</span>
          </div>
        )}

        {/* ---- The password just set, shown once -------------------------- */}
        {handover && (
          <div className="mb-4 rounded-2xl border border-emerald-300 bg-emerald-50 p-4">
            <p className="flex items-center gap-2 text-sm font-bold text-emerald-900">
              <CheckIcon className="h-4 w-4 shrink-0" /> Account created
            </p>
            <p className="mt-1.5 text-sm text-emerald-800">
              Hand these over now — the password is stored scrambled and cannot be shown again. If
              it is lost, reset it from this page.
            </p>
            <dl className="mt-3 space-y-1.5 break-all font-mono text-sm text-emerald-950">
              <div>
                <dt className="inline font-sans text-xs font-semibold uppercase">Email: </dt>
                <dd className="inline">{handover.email}</dd>
              </div>
              <div>
                <dt className="inline font-sans text-xs font-semibold uppercase">Password: </dt>
                <dd className="inline">{handover.password}</dd>
              </div>
            </dl>
            <button
              onClick={() => setHandover(null)}
              className="mt-3 rounded-full border border-emerald-300 bg-white px-4 py-2 text-sm font-semibold text-emerald-800"
            >
              I have written it down
            </button>
          </div>
        )}

        {/* ---- Actions --------------------------------------------------- */}
        <div className="mb-5 flex flex-col gap-2.5 sm:flex-row">
          <button
            onClick={() => {
              setShowNew((current) => !current);
              setShowMine(false);
            }}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-110"
          >
            <UserPlusIcon className="h-4 w-4" />
            {showNew ? "Cancel" : "Add an admin"}
          </button>
          <button
            onClick={() => {
              setShowMine((current) => !current);
              setShowNew(false);
            }}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
          >
            <KeyIcon className="h-4 w-4" />
            Change my own password
          </button>
        </div>

        {/* ---- New admin ------------------------------------------------- */}
        {showNew && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void create();
            }}
            className="mb-5 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5"
          >
            <h2 className="text-sm font-bold text-slate-900">New admin account</h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field label="Full name">
                <input
                  required
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm"
                  placeholder="Ada Okafor"
                />
              </Field>
              <Field label="Email — this is their username">
                <input
                  required
                  type="email"
                  autoComplete="off"
                  value={draft.email}
                  onChange={(e) => setDraft({ ...draft, email: e.target.value })}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm"
                  placeholder="ada@easywayacademy.com"
                />
              </Field>
              <Field label="Password — at least 8 characters">
                <input
                  required
                  minLength={8}
                  type="text"
                  autoComplete="new-password"
                  value={draft.password}
                  onChange={(e) => setDraft({ ...draft, password: e.target.value })}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2.5 font-mono text-sm"
                  placeholder="Set one you can read out"
                />
              </Field>
              <Field label="Role">
                <select
                  value={draft.adminRole}
                  onChange={(e) => setDraft({ ...draft, adminRole: e.target.value })}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm"
                >
                  {roles.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <p className="mt-2.5 text-xs text-slate-500">
              {ROLE_SUMMARY[draft.adminRole]} You can adjust exactly what they reach once the
              account exists.
            </p>

            <button
              type="submit"
              disabled={creating}
              className="mt-4 w-full rounded-xl bg-[var(--accent)] px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60 sm:w-auto"
            >
              {creating ? "Creating…" : "Create account"}
            </button>
          </form>
        )}

        {/* ---- My own password ------------------------------------------- */}
        {showMine && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void changeMyPassword();
            }}
            className="mb-5 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5"
          >
            <h2 className="text-sm font-bold text-slate-900">Change my password</h2>
            <p className="mt-1 text-xs text-slate-500">
              Your current password is required — a session left open on a shared machine should not
              be enough to change it.
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field label="Current password">
                <input
                  required
                  type="password"
                  autoComplete="current-password"
                  value={mine.currentPassword}
                  onChange={(e) => setMine({ ...mine, currentPassword: e.target.value })}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm"
                />
              </Field>
              <Field label="New password — at least 8 characters">
                <input
                  required
                  minLength={8}
                  type="password"
                  autoComplete="new-password"
                  value={mine.newPassword}
                  onChange={(e) => setMine({ ...mine, newPassword: e.target.value })}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm"
                />
              </Field>
            </div>

            {mineState.message && (
              <p
                className={`mt-3 rounded-xl px-3 py-2 text-sm ${
                  mineState.ok ? "bg-emerald-500/10 text-emerald-800" : "bg-red-500/10 text-red-700"
                }`}
              >
                {mineState.message}
              </p>
            )}

            <button
              type="submit"
              disabled={mineState.busy}
              className="mt-4 w-full rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60 sm:w-auto"
            >
              {mineState.busy ? "Changing…" : "Change password"}
            </button>
          </form>
        )}

        {/* ---- Role reference -------------------------------------------- */}
        <div className="mb-5 grid gap-3 sm:grid-cols-3">
          {roles.map((r) => (
            <div key={r.value} className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4">
              <p className="text-sm font-semibold">{r.label}</p>
              <p className="mt-1 text-xs text-slate-500">{ROLE_SUMMARY[r.value]}</p>
            </div>
          ))}
        </div>

        {/* ---- The people ------------------------------------------------ */}
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
              const isEditing = editing === admin.id;
              const adjusted = admin.overrides.grant.length + admin.overrides.revoke.length;
              const busy = savingId === admin.id;

              return (
                <div key={admin.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                  {/* Stacked on a phone: a name, a role select and three
                      buttons on one flex-wrap row is the ragged block this
                      page used to be below 640px. */}
                  <div className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate font-semibold text-slate-900">{admin.name ?? "—"}</p>
                        {admin.mfaEnabled && (
                          <span className="shrink-0 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold uppercase text-emerald-700">
                            2FA on
                          </span>
                        )}
                        {saved === admin.id && (
                          <span className="flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold uppercase text-emerald-600">
                            <CheckIcon className="h-3 w-3" /> Saved
                          </span>
                        )}
                        {adjusted > 0 && (
                          <span className="shrink-0 rounded-full bg-[var(--accent)]/10 px-2 py-0.5 text-[10px] font-bold uppercase text-[var(--accent)]">
                            {adjusted} adjusted
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 flex items-center gap-1.5 text-sm text-slate-500">
                        <MailIcon className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">{admin.email}</span>
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        value={admin.adminRole}
                        disabled={busy}
                        onChange={(e) => save(admin.id, { adminRole: e.target.value })}
                        className="min-w-0 flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm disabled:opacity-60 lg:flex-none"
                      >
                        {roles.map((r) => (
                          <option key={r.value} value={r.value}>
                            {r.label}
                          </option>
                        ))}
                      </select>

                      <button
                        onClick={() => (isEditing ? setEditing(null) : startEditing(admin))}
                        className="whitespace-nowrap rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
                      >
                        {isEditing ? "Close" : "Login details"}
                      </button>

                      <button
                        onClick={() => {
                          setExpanded(isOpen ? null : admin.id);
                          setEditing(null);
                        }}
                        className="whitespace-nowrap rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
                      >
                        {isOpen ? "Done" : "Access"}
                      </button>

                      <button
                        onClick={() => revoke(admin)}
                        disabled={busy}
                        aria-label={`Remove admin access for ${admin.name ?? admin.email}`}
                        className="rounded-xl border border-slate-200 p-2 text-slate-400 transition hover:border-red-200 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                      >
                        <TrashIcon className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  {/* ---- Name, email, password ------------------------- */}
                  {isEditing && (
                    <form
                      onSubmit={async (event) => {
                        event.preventDefault();
                        const patch: { name?: string; email?: string; password?: string } = {};
                        if (account.name !== (admin.name ?? "")) patch.name = account.name;
                        if (account.email !== admin.email) patch.email = account.email;
                        if (account.password) patch.password = account.password;
                        if (Object.keys(patch).length === 0) {
                          setEditing(null);
                          return;
                        }
                        const ok = await save(admin.id, patch);
                        if (ok) {
                          setAccount({ ...account, password: "" });
                          setEditing(null);
                        }
                      }}
                      className="border-t border-slate-100 bg-slate-50/60 p-4"
                    >
                      <p className="mb-3 text-xs text-slate-500">
                        What this person types at{" "}
                        <code className="rounded bg-white px-1 py-0.5 font-mono">{signInPath}</code>.
                        Changing the email changes their username.
                      </p>

                      <div className="grid gap-3 sm:grid-cols-2">
                        <Field label="Name">
                          <input
                            value={account.name}
                            onChange={(e) => setAccount({ ...account, name: e.target.value })}
                            className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm"
                          />
                        </Field>
                        <Field label="Email">
                          <input
                            type="email"
                            value={account.email}
                            onChange={(e) => setAccount({ ...account, email: e.target.value })}
                            className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm"
                          />
                        </Field>
                        <Field label="New password — leave blank to keep the current one">
                          <input
                            type="text"
                            autoComplete="new-password"
                            minLength={8}
                            value={account.password}
                            onChange={(e) => setAccount({ ...account, password: e.target.value })}
                            placeholder="••••••••"
                            className="w-full rounded-xl border border-slate-200 px-3 py-2.5 font-mono text-sm"
                          />
                        </Field>
                      </div>

                      <p className="mt-2 text-xs text-slate-500">
                        Nobody can read an existing password, including you — resetting replaces it.
                        Tell the person the new one yourself.
                      </p>

                      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                        <button
                          type="submit"
                          disabled={busy}
                          className="rounded-xl bg-[var(--accent)] px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
                        >
                          {busy ? "Saving…" : "Save login details"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditing(null)}
                          className="rounded-xl border border-slate-200 px-5 py-2.5 text-sm font-semibold text-slate-600"
                        >
                          Cancel
                        </button>
                      </div>
                    </form>
                  )}

                  {/* ---- Capabilities ---------------------------------- */}
                  {isOpen && (
                    <div className="border-t border-slate-100 bg-slate-50/60 p-4">
                      <p className="mb-3 text-xs text-slate-500">
                        Ticked is what they can reach. Anything different from the{" "}
                        <span className="font-semibold">{admin.label}</span> preset is marked, and
                        stays marked if the preset changes later.
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
                                disabled={busy}
                                onChange={() => toggleCapability(admin, capability.value)}
                                className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--accent)]"
                              />
                              <span className="min-w-0 flex-1">
                                <span className="block font-medium text-slate-800">
                                  {capability.label}
                                </span>
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

                      <div className="mt-4">
                        <p className="mb-3 text-xs text-slate-500">Branch access — limit which branches this admin can reach (leave empty for all).</p>
                        <div className="grid gap-2 sm:grid-cols-2">
                          {branches.map((b) => {
                            const has = Array.isArray((admin as any).branchAccess) && (admin as any).branchAccess.includes(b.id);
                            return (
                              <label key={b.id} className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 text-sm ${has ? 'border-emerald-300 bg-emerald-50' : 'border-slate-200 bg-white hover:border-slate-300'}`}>
                                <input type="checkbox" checked={has} disabled={savingId === admin.id} onChange={() => toggleBranchAccess(admin, b.id)} className="h-4 w-4 accent-[var(--accent)]" />
                                <span className="min-w-0">{b.name}</span>
                              </label>
                            );
                          })}
                        </div>
                      </div>

                      {adjusted > 0 && (
                        <button
                          onClick={() => save(admin.id, { capabilities: admin.presetCapabilities })}
                          disabled={busy}
                          className="mt-4 w-full rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-50 sm:w-auto"
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="mb-1 block text-xs font-semibold text-slate-600">{label}</span>
      {children}
    </label>
  );
}
