"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertIcon, KeyIcon, TrashIcon } from "@/components/icons";

/**
 * Self-serve admin API keys, on the security page — generate a key with a
 * chosen slice of capabilities, hand it to an automation or script, call
 * /api/admin/* with `Authorization: Bearer eak_...` instead of a browser
 * session. See AdminApiKey in schema.prisma and requireCapability in
 * src/lib/admin-roles.ts for how a key is resolved and scoped.
 *
 * Only ever usable when ADMIN_API_KEYS_ENABLED=true on the server — set in
 * .env.local, never in a deployed environment. This card still renders
 * either way; a key generated with the flag off simply will not authenticate
 * anything until it is on.
 */

type ApiKeyRow = {
  id: string;
  name: string;
  prefix: string;
  capabilities: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
};

export default function ApiKeysCard() {
  const [keys, setKeys] = useState<ApiKeyRow[]>([]);
  const [allCapabilities, setAllCapabilities] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<{ plaintext: string; name: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const response = await fetch("/api/admin/security/api-keys");
    if (response.ok) {
      const data = await response.json();
      setKeys(data.keys || []);
      setAllCapabilities(data.capabilities || []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function toggle(capability: string) {
    setPicked((current) =>
      current.includes(capability) ? current.filter((c) => c !== capability) : [...current, capability],
    );
  }

  async function create() {
    setCreating(true);
    setError(null);
    const response = await fetch("/api/admin/security/api-keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim() || "Untitled key", capabilities: picked }),
    });
    const data = await response.json().catch(() => ({}));
    setCreating(false);
    if (!response.ok) return setError(data?.error ?? "Could not create that key.");
    setRevealed({ plaintext: data.plaintext, name: data.key?.name ?? name });
    setName("");
    setPicked([]);
    void load();
  }

  async function revoke(id: string) {
    const confirmed = window.confirm("Revoke this key? Anything using it stops working immediately.");
    if (!confirmed) return;
    setBusyId(id);
    await fetch(`/api/admin/security/api-keys/${id}`, { method: "DELETE" });
    setBusyId(null);
    void load();
  }

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">API keys</h2>
      <p className="text-xs text-[var(--muted)]">
        A credential for calling the admin API without signing in through the browser — for a script
        or an automation you trust with a slice of this account&apos;s own access.
      </p>

      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
        {revealed ? (
          <div className="mb-4 space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-3">
            <p className="flex items-start gap-2 text-xs leading-5 text-amber-900">
              <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                <strong>Copy &quot;{revealed.name}&quot; now.</strong> It is stored as a hash and cannot
                be shown again.
              </span>
            </p>
            <code className="block break-all rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 font-mono text-xs">
              {revealed.plaintext}
            </code>
            <div className="flex gap-2">
              <button
                onClick={() => navigator.clipboard?.writeText(revealed.plaintext)}
                className="rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-semibold"
              >
                Copy
              </button>
              <button
                onClick={() => setRevealed(null)}
                className="rounded-lg bg-[var(--accent)] px-3 py-2 text-xs font-semibold text-white"
              >
                I&apos;ve saved it
              </button>
            </div>
          </div>
        ) : null}

        {error ? (
          <p className="mb-3 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">{error}</p>
        ) : null}

        <details className="mb-4">
          <summary className="cursor-pointer text-sm font-semibold">Generate a new key</summary>
          <div className="mt-3 space-y-3">
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="What is this key for?"
              className="w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
            />
            <div className="flex flex-wrap gap-2">
              {allCapabilities.map((capability) => (
                <label
                  key={capability}
                  className={`cursor-pointer rounded-lg border px-3 py-1.5 text-xs font-medium ${
                    picked.includes(capability)
                      ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]"
                      : "border-[var(--border)] text-[var(--muted)]"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={picked.includes(capability)}
                    onChange={() => toggle(capability)}
                    className="sr-only"
                  />
                  {capability}
                </label>
              ))}
            </div>
            <button
              onClick={create}
              disabled={creating || picked.length === 0}
              className="rounded-lg bg-[var(--accent)] px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
            >
              {creating ? "Generating…" : "Generate key"}
            </button>
          </div>
        </details>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-xs">
            <thead className="text-[var(--muted)]">
              <tr>
                <th className="py-2 pr-4">Name</th>
                <th className="py-2 pr-4">Key</th>
                <th className="py-2 pr-4">Capabilities</th>
                <th className="py-2 pr-4">Last used</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2"></th>
              </tr>
            </thead>
            <tbody>
              {keys.map((key) => {
                const expired = key.expiresAt && new Date(key.expiresAt).getTime() < Date.now();
                const dead = Boolean(key.revokedAt) || expired;
                return (
                  <tr key={key.id} className="border-t border-[var(--border)] align-top">
                    <td className="py-2 pr-4">{key.name}</td>
                    <td className="py-2 pr-4 font-mono">eak_{key.prefix}…</td>
                    <td className="py-2 pr-4">
                      <div className="flex flex-wrap gap-1">
                        {key.capabilities.split(",").filter(Boolean).map((c) => (
                          <span key={c} className="rounded border border-[var(--border)] px-1.5 py-0.5">
                            {c}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="py-2 pr-4 text-[var(--muted)]">
                      {key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleString() : "Never"}
                    </td>
                    <td className="py-2 pr-4">
                      {key.revokedAt ? (
                        <span className="text-red-600">Revoked</span>
                      ) : expired ? (
                        <span className="text-amber-600">Expired</span>
                      ) : (
                        <span className="text-emerald-600">Active</span>
                      )}
                    </td>
                    <td className="py-2 text-right">
                      {!dead ? (
                        <button
                          type="button"
                          disabled={busyId === key.id}
                          onClick={() => revoke(key.id)}
                          className="inline-flex items-center gap-1 rounded-lg border border-red-300 px-2 py-1 text-xs font-semibold text-red-700 disabled:opacity-50"
                        >
                          <TrashIcon className="h-3.5 w-3.5" />
                          Revoke
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
              {!loading && keys.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-[var(--muted)]">
                    <span className="inline-flex items-center gap-2">
                      <KeyIcon className="h-4 w-4" />
                      No keys yet.
                    </span>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
