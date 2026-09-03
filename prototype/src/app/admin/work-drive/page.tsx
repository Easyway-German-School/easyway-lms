"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import AdminShell from "@/components/AdminShell";
import {
  BriefcaseIcon,
  FolderIcon,
  PlusIcon,
  UsersIcon,
  LockIcon,
  UnlockIcon,
  BranchIcon,
} from "@/components/icons";

/**
 * The Work Drive: a staff-only file store, organised into workspaces. Each
 * workspace is a team hub — its own folders, files and (later) calendar. See
 * docs/WORK_DRIVE.md.
 */

type Workspace = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  icon: string;
  color: string;
  kind: string;
  visibility: string;
  branchId: string | null;
  storageUsedBytes: number;
  fileCount: number;
  memberCount: number;
  updatedAt: string;
};

const COLORS: Record<string, string> = {
  slate: "var(--foreground-soft)",
  sky: "#0284c7",
  amber: "#d97706",
  emerald: "#059669",
  violet: "#7c3aed",
  rose: "#e11d48",
};

type SharedFile = {
  id: string;
  name: string;
  kind: string;
  sizeBytes: number;
  permission: string;
  workspaceName: string;
  sharedBy: string | null;
};

function bytes(n: number): string {
  if (!n) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function VisibilityTag({ v }: { v: string }) {
  const map: Record<string, { label: string; icon: ReactNode }> = {
    private: { label: "Private", icon: <LockIcon className="h-3 w-3" /> },
    staff: { label: "All staff", icon: <UnlockIcon className="h-3 w-3" /> },
    branch: { label: "Branch", icon: <BranchIcon className="h-3 w-3" /> },
  };
  const m = map[v] ?? map.private;
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] px-2 py-0.5 text-[11px] font-medium text-[var(--muted)]">
      {m.icon}
      {m.label}
    </span>
  );
}

export default function WorkDrivePage() {
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(true);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [shared, setShared] = useState<SharedFile[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [wsRes, shRes] = await Promise.all([
        fetch("/api/admin/work-drive/workspaces", { cache: "no-store" }),
        fetch("/api/admin/work-drive/shared", { cache: "no-store" }),
      ]);
      const data = await wsRes.json();
      if (!wsRes.ok) throw new Error(data?.error || "Could not load the Work Drive.");
      setEnabled(data.enabled !== false);
      setWorkspaces(data.workspaces ?? []);
      if (shRes.ok) setShared((await shRes.json()).files ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <AdminShell>
      <div className="space-y-6">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-2xl bg-[var(--accent-soft)] text-[var(--accent)]">
              <BriefcaseIcon className="h-6 w-6" />
            </span>
            <div>
              <h1 className="text-xl font-bold text-[var(--foreground)]">Work Drive</h1>
              <p className="mt-1 max-w-xl text-sm text-[var(--muted)]">
                The office&rsquo;s own file store — policies, templates, finance sheets, scanned
                paperwork. Grouped into workspaces so each team&rsquo;s files stay together.
              </p>
            </div>
          </div>
          {enabled && (
            <button
              onClick={() => setCreating(true)}
              className="inline-flex items-center gap-2 rounded-full bg-[var(--accent)] px-4 py-2.5 text-sm font-bold text-white transition hover:brightness-110"
            >
              <PlusIcon className="h-4 w-4" />
              New workspace
            </button>
          )}
        </header>

        {!enabled && !loading && (
          <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-8 text-center">
            <h2 className="text-lg font-semibold text-[var(--foreground)]">The Work Drive is switched off</h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-[var(--muted)]">
              A super admin can turn it on in General settings, or the platform operator can enable it
              for this school.
            </p>
          </div>
        )}

        {error && (
          <div className="rounded-2xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
            {error}
          </div>
        )}

        {shared.length > 0 && (
          <section className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-4">
            <h2 className="text-sm font-bold text-[var(--foreground)]">Shared with you</h2>
            <ul className="mt-3 divide-y divide-[var(--border)]">
              {shared.map((f) => (
                <li key={f.id} className="flex items-center gap-3 py-2.5 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-[var(--foreground)]">{f.name}</p>
                    <p className="text-xs text-[var(--muted)]">
                      {bytes(f.sizeBytes)} · in {f.workspaceName}
                      {f.sharedBy ? ` · from ${f.sharedBy}` : ""} · can {f.permission === "edit" ? "edit" : "view"}
                    </p>
                  </div>
                  <a
                    href={`/api/admin/work-drive/files/${f.id}/download`}
                    className="rounded-lg px-2 py-1 text-xs font-semibold text-[var(--muted)] transition hover:text-[var(--accent)]"
                  >
                    Download
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}

        {loading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-40 animate-pulse rounded-3xl border border-[var(--border)] bg-[var(--surface-alt)]" />
            ))}
          </div>
        ) : enabled && workspaces.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-[var(--border)] bg-[var(--surface)] p-10 text-center">
            <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[var(--surface-alt)] text-[var(--muted)]">
              <FolderIcon className="h-7 w-7" />
            </span>
            <h2 className="mt-4 text-lg font-semibold text-[var(--foreground)]">No workspaces yet</h2>
            <p className="mx-auto mt-1 max-w-sm text-sm text-[var(--muted)]">
              Start with one per team — Finance, HR, Marketing — or one for a specific event.
            </p>
            <button
              onClick={() => setCreating(true)}
              className="mt-5 inline-flex items-center gap-2 rounded-full bg-[var(--accent)] px-4 py-2.5 text-sm font-bold text-white transition hover:brightness-110"
            >
              <PlusIcon className="h-4 w-4" />
              Create the first workspace
            </button>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {workspaces.map((w) => (
              <Link
                key={w.id}
                href={`/admin/work-drive/${w.slug}`}
                className="group flex flex-col rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-5 transition hover:border-[var(--border-strong)] hover:shadow-[var(--shadow)]"
              >
                <div className="flex items-center justify-between">
                  <span
                    className="grid h-10 w-10 place-items-center rounded-2xl bg-[var(--surface-alt)]"
                    style={{ color: COLORS[w.color] ?? COLORS.slate }}
                  >
                    <FolderIcon className="h-5 w-5" />
                  </span>
                  <VisibilityTag v={w.visibility} />
                </div>
                <h3 className="mt-4 font-semibold text-[var(--foreground)] group-hover:text-[var(--accent)]">
                  {w.name}
                </h3>
                {w.description && (
                  <p className="mt-1 line-clamp-2 text-sm text-[var(--muted)]">{w.description}</p>
                )}
                <div className="mt-4 flex items-center gap-4 text-xs text-[var(--muted)]">
                  <span className="inline-flex items-center gap-1">
                    <FolderIcon className="h-3.5 w-3.5" />
                    {w.fileCount} file{w.fileCount === 1 ? "" : "s"}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <UsersIcon className="h-3.5 w-3.5" />
                    {w.memberCount}
                  </span>
                  <span className="ml-auto">{bytes(w.storageUsedBytes)}</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      {creating && (
        <CreateWorkspaceModal
          onClose={() => setCreating(false)}
          onCreated={(slug) => {
            setCreating(false);
            window.location.href = `/admin/work-drive/${slug}`;
          }}
        />
      )}
    </AdminShell>
  );
}

function CreateWorkspaceModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (slug: string) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState("private");
  const [color, setColor] = useState("slate");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (!name.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/admin/work-drive/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description, visibility, color }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Could not create the workspace.");
      onCreated(data.workspace.slug);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Something went wrong.");
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-2xl">
        <h2 className="text-lg font-bold text-[var(--foreground)]">New workspace</h2>
        <div className="mt-4 space-y-4">
          <label className="block">
            <span className="text-sm font-medium text-[var(--foreground-soft)]">Name</span>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Finance"
              className="mt-1 w-full rounded-xl border border-[var(--border)] bg-[var(--surface-alt)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--accent)]"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-[var(--foreground-soft)]">Description (optional)</span>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Invoices, statements, budgets"
              className="mt-1 w-full rounded-xl border border-[var(--border)] bg-[var(--surface-alt)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--accent)]"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-[var(--foreground-soft)]">Who can see it</span>
            <select
              value={visibility}
              onChange={(e) => setVisibility(e.target.value)}
              className="mt-1 w-full rounded-xl border border-[var(--border)] bg-[var(--surface-alt)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--accent)]"
            >
              <option value="private">Private — only people I add</option>
              <option value="staff">All staff can view</option>
            </select>
          </label>
          <div>
            <span className="text-sm font-medium text-[var(--foreground-soft)]">Colour</span>
            <div className="mt-2 flex gap-2">
              {Object.keys(COLORS).map((c) => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  aria-label={c}
                  className={`h-7 w-7 rounded-full border-2 transition ${
                    color === c ? "border-[var(--accent)]" : "border-transparent"
                  }`}
                  style={{ background: COLORS[c] }}
                />
              ))}
            </div>
          </div>
          {err && <p className="text-sm text-rose-600 dark:text-rose-400">{err}</p>}
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-full px-4 py-2 text-sm font-medium text-[var(--muted)] transition hover:bg-[var(--surface-alt)]"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={busy || !name.trim()}
            className="rounded-full bg-[var(--accent)] px-5 py-2 text-sm font-bold text-white transition hover:brightness-110 disabled:opacity-50"
          >
            {busy ? "Creating…" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}
