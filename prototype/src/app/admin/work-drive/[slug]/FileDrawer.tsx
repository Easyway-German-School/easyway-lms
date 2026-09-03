"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  ClockIcon,
  CrossIcon,
  DownloadIcon,
  InfoIcon,
  RefreshIcon,
  SendIcon,
  UploadIcon,
  UsersIcon,
} from "@/components/icons";
import { uploadWorkDriveFile } from "@/lib/work-drive/upload-client";

type Tab = "details" | "versions" | "share" | "comments";

export type DrawerFile = {
  id: string;
  name: string;
  kind: string;
  sizeBytes: number;
  mimeType: string;
  version: number;
  updatedAt: string;
};

function bytes(n: number): string {
  if (!n) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${u[i]}`;
}
function when(v: string): string {
  return new Date(v).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function FileDrawer({
  file,
  workspaceSlug,
  canEdit,
  onClose,
  onChanged,
}: {
  file: DrawerFile;
  workspaceSlug: string;
  canEdit: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [tab, setTab] = useState<Tab>("details");

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/40 backdrop-blur-sm" onClick={onClose}>
      <div
        className="flex h-full w-full max-w-md flex-col border-l border-[var(--border)] bg-[var(--surface)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-[var(--border)] p-4">
          <div className="min-w-0">
            <p className="truncate font-semibold text-[var(--foreground)]">{file.name}</p>
            <p className="text-xs text-[var(--muted)]">
              {bytes(file.sizeBytes)} · v{file.version} · {when(file.updatedAt)}
            </p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-[var(--muted)] hover:bg-[var(--surface-alt)]">
            <CrossIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="flex gap-1 border-b border-[var(--border)] px-2">
          {(
            [
              ["details", "Details", <InfoIcon key="i" className="h-4 w-4" />],
              ["versions", "Versions", <ClockIcon key="c" className="h-4 w-4" />],
              ["share", "Share", <UsersIcon key="u" className="h-4 w-4" />],
              ["comments", "Comments", <SendIcon key="s" className="h-4 w-4" />],
            ] as [Tab, string, ReactNode][]
          ).map(([id, label, icon]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-medium transition ${
                tab === id
                  ? "border-[var(--accent)] text-[var(--accent)]"
                  : "border-transparent text-[var(--muted)] hover:text-[var(--foreground)]"
              }`}
            >
              {icon}
              {label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {tab === "details" && <DetailsTab file={file} />}
          {tab === "versions" && (
            <VersionsTab file={file} workspaceSlug={workspaceSlug} canEdit={canEdit} onChanged={onChanged} />
          )}
          {tab === "share" && <ShareTab file={file} canEdit={canEdit} />}
          {tab === "comments" && <CommentsTab file={file} />}
        </div>
      </div>
    </div>
  );
}

function DetailsTab({ file }: { file: DrawerFile }) {
  const rows: [string, string][] = [
    ["Type", file.mimeType || "—"],
    ["Category", file.kind],
    ["Size", bytes(file.sizeBytes)],
    ["Current version", `v${file.version}`],
    ["Last change", when(file.updatedAt)],
  ];
  return (
    <div className="space-y-3">
      <a
        href={`/api/admin/work-drive/files/${file.id}/download`}
        className="inline-flex items-center gap-2 rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-bold text-white transition hover:brightness-110"
      >
        <DownloadIcon className="h-4 w-4" />
        Download
      </a>
      <dl className="mt-4 divide-y divide-[var(--border)] rounded-2xl border border-[var(--border)]">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4 px-3 py-2.5 text-sm">
            <dt className="text-[var(--muted)]">{k}</dt>
            <dd className="text-right font-medium text-[var(--foreground)]">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function VersionsTab({
  file,
  workspaceSlug,
  canEdit,
  onChanged,
}: {
  file: DrawerFile;
  workspaceSlug: string;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const [versions, setVersions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/admin/work-drive/files/${file.id}/versions`, { cache: "no-store" });
    const json = await res.json();
    setVersions(res.ok ? json.versions ?? [] : []);
    setLoading(false);
  }, [file.id]);

  useEffect(() => {
    load();
  }, [load]);

  async function onPick(f: File | undefined) {
    if (!f) return;
    setBusy(true);
    setErr(null);
    try {
      // Reuse the upload-client presign flow, but post to the versions route.
      const contentType = f.type || "application/octet-stream";
      const p = await fetch("/api/admin/work-drive/presign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: f.name, contentType, size: f.size }),
      });
      const plan = await p.json();
      if (!p.ok) throw new Error(plan?.error || "Upload could not start.");
      if (plan.mode === "direct") {
        const put = await fetch(plan.uploadUrl, { method: "PUT", headers: { "Content-Type": contentType }, body: f });
        if (!put.ok) throw new Error(`Upload failed (${put.status}).`);
      }
      const note = window.prompt("What changed in this version? (optional)") || undefined;
      const res = await fetch(`/api/admin/work-drive/files/${file.id}/versions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storageKey: plan.key, url: plan.url, mimeType: contentType, size: f.size, note }),
      });
      if (!res.ok) throw new Error((await res.json())?.error || "Could not save the version.");
      await load();
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="space-y-3">
      {canEdit && (
        <>
          <button
            onClick={() => input.current?.click()}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] px-4 py-2 text-sm font-semibold text-[var(--foreground-soft)] transition hover:bg-[var(--surface-alt)] disabled:opacity-50"
          >
            <UploadIcon className="h-4 w-4" />
            {busy ? "Uploading…" : "Upload new version"}
          </button>
          <input ref={input} type="file" hidden onChange={(e) => onPick(e.target.files?.[0])} />
        </>
      )}
      {err && <p className="text-sm text-rose-600 dark:text-rose-400">{err}</p>}
      {loading ? (
        <p className="text-sm text-[var(--muted)]">Loading…</p>
      ) : (
        <ul className="space-y-2">
          {versions.map((v) => (
            <li
              key={v.id}
              className="flex items-center justify-between gap-3 rounded-xl border border-[var(--border)] px-3 py-2 text-sm"
            >
              <div className="min-w-0">
                <p className="font-medium text-[var(--foreground)]">
                  v{v.versionNumber}
                  {v.current && <span className="ml-2 text-xs font-semibold text-[var(--accent)]">current</span>}
                </p>
                <p className="text-xs text-[var(--muted)]">
                  {bytes(v.sizeBytes)} · {v.uploaderName ?? "—"} · {when(v.createdAt)}
                </p>
                {v.note && <p className="mt-0.5 text-xs italic text-[var(--muted)]">“{v.note}”</p>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ShareTab({ file, canEdit }: { file: DrawerFile; canEdit: boolean }) {
  const [shares, setShares] = useState<any[]>([]);
  const [email, setEmail] = useState("");
  const [permission, setPermission] = useState("view");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/admin/work-drive/files/${file.id}/shares`, { cache: "no-store" });
    const json = await res.json();
    setShares(res.ok ? json.shares ?? [] : []);
    setLoading(false);
  }, [file.id]);

  useEffect(() => {
    load();
  }, [load]);

  async function add() {
    if (!email.trim()) return;
    setErr(null);
    const res = await fetch(`/api/admin/work-drive/files/${file.id}/shares`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, permission }),
    });
    if (!res.ok) setErr((await res.json())?.error || "Could not share.");
    else {
      setEmail("");
      load();
    }
  }
  async function revoke(shareId: string) {
    await fetch(`/api/admin/work-drive/files/${file.id}/shares?shareId=${shareId}`, { method: "DELETE" });
    load();
  }

  return (
    <div className="space-y-3">
      {canEdit && (
        <div className="space-y-2 rounded-2xl border border-[var(--border)] p-3">
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="colleague@school.example"
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-alt)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--accent)]"
          />
          <div className="flex gap-2">
            <select
              value={permission}
              onChange={(e) => setPermission(e.target.value)}
              className="rounded-lg border border-[var(--border)] bg-[var(--surface-alt)] px-2 py-2 text-sm text-[var(--foreground)]"
            >
              <option value="view">Can view</option>
              <option value="edit">Can edit</option>
            </select>
            <button
              onClick={add}
              className="flex-1 rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-bold text-white transition hover:brightness-110"
            >
              Share
            </button>
          </div>
          {err && <p className="text-xs text-rose-600 dark:text-rose-400">{err}</p>}
        </div>
      )}
      {loading ? (
        <p className="text-sm text-[var(--muted)]">Loading…</p>
      ) : shares.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">Not shared with anyone outside the workspace.</p>
      ) : (
        <ul className="space-y-2">
          {shares.map((s) => (
            <li
              key={s.id}
              className="flex items-center justify-between gap-2 rounded-xl border border-[var(--border)] px-3 py-2 text-sm"
            >
              <div className="min-w-0">
                <p className="truncate font-medium text-[var(--foreground)]">{s.name ?? s.email}</p>
                <p className="text-xs text-[var(--muted)]">{s.permission === "edit" ? "Can edit" : "Can view"}</p>
              </div>
              {canEdit && (
                <button
                  onClick={() => revoke(s.id)}
                  className="text-xs font-semibold text-rose-600 hover:underline dark:text-rose-400"
                >
                  Revoke
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CommentsTab({ file }: { file: DrawerFile }) {
  const [comments, setComments] = useState<any[]>([]);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/admin/work-drive/files/${file.id}/comments`, { cache: "no-store" });
    const json = await res.json();
    setComments(res.ok ? json.comments ?? [] : []);
    setLoading(false);
  }, [file.id]);

  useEffect(() => {
    load();
  }, [load]);

  async function send() {
    if (!text.trim()) return;
    const res = await fetch(`/api/admin/work-drive/files/${file.id}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: text }),
    });
    if (res.ok) {
      setText("");
      load();
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-3">
        {loading ? (
          <p className="text-sm text-[var(--muted)]">Loading…</p>
        ) : comments.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">No comments yet.</p>
        ) : (
          comments.map((c) => (
            <div key={c.id} className="rounded-xl border border-[var(--border)] px-3 py-2">
              <p className="text-xs font-semibold text-[var(--foreground-soft)]">{c.authorName ?? "Someone"}</p>
              <p className="mt-0.5 whitespace-pre-wrap text-sm text-[var(--foreground)]">{c.body}</p>
              <p className="mt-1 text-[10px] text-[var(--muted)]">{when(c.createdAt)}</p>
            </div>
          ))
        )}
      </div>
      <div className="mt-3 flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder="Add a comment…"
          className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface-alt)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--accent)]"
        />
        <button
          onClick={send}
          className="rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-bold text-white transition hover:brightness-110"
        >
          <SendIcon className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
