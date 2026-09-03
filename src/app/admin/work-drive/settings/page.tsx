"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import AdminShell from "@/components/AdminShell";
import { ArrowLeftIcon } from "@/components/icons";

function gb(bytes: number) {
  return (bytes / 1024 ** 3).toFixed(bytes >= 1024 ** 3 ? 1 : 2);
}

export default function WorkDriveSettings() {
  const [cfg, setCfg] = useState<any>(null);
  const [quotaInput, setQuotaInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/work-drive/settings", { cache: "no-store" });
    if (res.ok) {
      const json = await res.json();
      setCfg(json);
      setQuotaInput(json.quotaIsDefault ? "" : String(Math.round((json.quotaBytes / 1024 ** 3) * 10) / 10));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function save(patch: Record<string, unknown>) {
    setSaving(true);
    setMsg(null);
    const res = await fetch("/api/admin/work-drive/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) setMsg((await res.json())?.error || "Could not save.");
    else {
      setMsg("Saved.");
      load();
    }
    setSaving(false);
  }

  return (
    <AdminShell>
      <div className="max-w-xl space-y-5">
        <Link href="/admin/work-drive" className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--muted)] hover:text-[var(--accent)]">
          <ArrowLeftIcon className="h-4 w-4" />
          Work Drive
        </Link>
        <h1 className="text-xl font-bold text-[var(--foreground)]">Work Drive settings</h1>

        {!cfg ? (
          <p className="text-sm text-[var(--muted)]">Loading…</p>
        ) : (
          <>
            <section className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-5">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h2 className="font-semibold text-[var(--foreground)]">Work Drive is {cfg.enabled ? "on" : "off"}</h2>
                  <p className="mt-1 text-sm text-[var(--muted)]">
                    When on, staff see the Work Drive in the sidebar and can create workspaces.
                  </p>
                </div>
                <button
                  onClick={() => save({ enabled: !cfg.enabled })}
                  disabled={saving}
                  className={`rounded-full px-4 py-2 text-sm font-bold text-white transition hover:brightness-110 disabled:opacity-50 ${
                    cfg.enabled ? "bg-[var(--muted)]" : "bg-[var(--accent)]"
                  }`}
                >
                  {cfg.enabled ? "Turn off" : "Turn on"}
                </button>
              </div>
            </section>

            <section className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-5">
              <h2 className="font-semibold text-[var(--foreground)]">Storage limit</h2>
              <p className="mt-1 text-sm text-[var(--muted)]">
                Using <strong>{gb(cfg.usedBytes)} GB</strong> of {gb(cfg.quotaBytes)} GB
                {cfg.quotaIsDefault ? " (platform default)" : ""}.
              </p>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--surface-alt)]">
                <div
                  className="h-full rounded-full bg-[var(--accent)]"
                  style={{ width: `${Math.min(100, (cfg.usedBytes / cfg.quotaBytes) * 100).toFixed(1)}%` }}
                />
              </div>
              <div className="mt-4 flex items-end gap-2">
                <label className="flex-1 text-sm">
                  <span className="text-[var(--foreground-soft)]">Limit in GB (blank = default)</span>
                  <input
                    value={quotaInput}
                    onChange={(e) => setQuotaInput(e.target.value)}
                    placeholder={String(Math.round(cfg.defaultQuotaBytes / 1024 ** 3))}
                    className="mt-1 w-full rounded-xl border border-[var(--border)] bg-[var(--surface-alt)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--accent)]"
                  />
                </label>
                <button
                  onClick={() => save({ quotaGb: quotaInput.trim() === "" ? null : quotaInput.trim() })}
                  disabled={saving}
                  className="rounded-full bg-[var(--accent)] px-5 py-2 text-sm font-bold text-white transition hover:brightness-110 disabled:opacity-50"
                >
                  Save
                </button>
              </div>
            </section>

            {msg && <p className="text-sm text-[var(--muted)]">{msg}</p>}
          </>
        )}
      </div>
    </AdminShell>
  );
}
