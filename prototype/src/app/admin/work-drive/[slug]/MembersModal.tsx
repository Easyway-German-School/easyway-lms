"use client";

import { useCallback, useEffect, useState } from "react";
import { CrossIcon, TrashIcon } from "@/components/icons";

type Member = { id: string; userId: string; role: string; name: string | null; email: string | null };

export default function MembersModal({
  workspaceSlug,
  canEdit,
  onClose,
}: {
  workspaceSlug: string;
  canEdit: boolean;
  onClose: () => void;
}) {
  const [members, setMembers] = useState<Member[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("viewer");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/admin/work-drive/workspaces/${workspaceSlug}/members`, { cache: "no-store" });
    const json = await res.json();
    setMembers(res.ok ? json.members ?? [] : []);
    setLoading(false);
  }, [workspaceSlug]);

  useEffect(() => {
    load();
  }, [load]);

  async function add() {
    if (!email.trim()) return;
    setErr(null);
    const res = await fetch(`/api/admin/work-drive/workspaces/${workspaceSlug}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, role }),
    });
    if (!res.ok) setErr((await res.json())?.error || "Could not add them.");
    else {
      setEmail("");
      load();
    }
  }

  async function remove(userId: string) {
    await fetch(`/api/admin/work-drive/workspaces/${workspaceSlug}/members?userId=${userId}`, { method: "DELETE" });
    load();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-[var(--foreground)]">Members</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-[var(--muted)] hover:bg-[var(--surface-alt)]">
            <CrossIcon className="h-5 w-5" />
          </button>
        </div>

        {canEdit && (
          <div className="mt-4 flex gap-2">
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="staff email"
              className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface-alt)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--accent)]"
            />
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="rounded-lg border border-[var(--border)] bg-[var(--surface-alt)] px-2 py-2 text-sm text-[var(--foreground)]"
            >
              <option value="viewer">Viewer</option>
              <option value="editor">Editor</option>
              <option value="owner">Owner</option>
            </select>
            <button
              onClick={add}
              className="rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-bold text-white transition hover:brightness-110"
            >
              Add
            </button>
          </div>
        )}
        {err && <p className="mt-2 text-xs text-rose-600 dark:text-rose-400">{err}</p>}

        <ul className="mt-4 max-h-72 space-y-2 overflow-y-auto">
          {loading ? (
            <li className="text-sm text-[var(--muted)]">Loading…</li>
          ) : (
            members.map((m) => (
              <li
                key={m.id}
                className="flex items-center justify-between gap-2 rounded-xl border border-[var(--border)] px-3 py-2 text-sm"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-[var(--foreground)]">{m.name ?? m.email}</p>
                  <p className="text-xs capitalize text-[var(--muted)]">{m.role}</p>
                </div>
                {canEdit && (
                  <button
                    onClick={() => remove(m.userId)}
                    className="rounded-lg p-1.5 text-[var(--muted)] transition hover:bg-[var(--surface-alt)] hover:text-rose-500"
                  >
                    <TrashIcon className="h-4 w-4" />
                  </button>
                )}
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}
