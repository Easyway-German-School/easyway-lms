"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import AdminShell from "@/components/AdminShell";
import {
  ArrowLeftIcon,
  AudioIcon,
  ClockIcon,
  DocumentIcon,
  DownloadIcon,
  FilmIcon,
  FolderIcon,
  GradebookIcon,
  ImageIcon,
  PackageIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  TrashIcon,
  UploadIcon,
  UsersIcon,
} from "@/components/icons";
import { uploadWorkDriveFile } from "@/lib/work-drive/upload-client";
import FileDrawer, { type DrawerFile } from "./FileDrawer";
import MembersModal from "./MembersModal";

type Folder = { id: string; name: string; parentId: string | null; path: string };
type SearchHit = {
  id: string;
  name: string;
  kind: string;
  sizeBytes: number;
  updatedAt: string;
  workspaceName: string | null;
  workspaceSlug: string | null;
};
type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  kind: string;
  createdAt: string;
  updatedAt: string;
  version: number;
};
type Activity = {
  id: string;
  action: string;
  actorId: string | null;
  fileId: string | null;
  meta: Record<string, unknown> | null;
  createdAt: string;
};
type WorkspacePayload = {
  workspace: { id: string; name: string; slug: string; description: string | null; visibility: string };
  access: { canView: boolean; canEdit: boolean; memberRole: string | null };
  folderId: string | null;
  folders: Folder[];
  files: DriveFile[];
  activity: Activity[];
};

function bytes(n: number): string {
  if (!n) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${u[i]}`;
}

function when(v: string): string {
  return new Date(v).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function KindIcon({ kind, className }: { kind: string; className?: string }) {
  const map: Record<string, ReactNode> = {
    image: <ImageIcon className={className} />,
    video: <FilmIcon className={className} />,
    audio: <AudioIcon className={className} />,
    spreadsheet: <GradebookIcon className={className} />,
    archive: <PackageIcon className={className} />,
  };
  return <>{map[kind] ?? <DocumentIcon className={className} />}</>;
}

const ACTION_TEXT: Record<string, string> = {
  uploaded: "uploaded",
  renamed: "renamed",
  moved: "moved",
  new_version: "added a version to",
  deleted: "deleted",
  restored: "restored",
  shared: "shared",
  downloaded: "downloaded",
  commented: "commented on",
};

export default function WorkspacePage() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug;

  const [data, setData] = useState<WorkspacePayload | null>(null);
  const [folderId, setFolderId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState<string[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [drawerFile, setDrawerFile] = useState<DrawerFile | null>(null);
  const [showMembers, setShowMembers] = useState(false);
  const [searchQ, setSearchQ] = useState("");
  const [searchResults, setSearchResults] = useState<SearchHit[] | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = folderId ? `?folderId=${encodeURIComponent(folderId)}` : "";
      const res = await fetch(`/api/admin/work-drive/workspaces/${slug}${qs}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Could not open this workspace.");
      setData(json);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }, [slug, folderId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const q = searchQ.trim();
    if (q.length < 2) {
      setSearchResults(null);
      return;
    }
    const t = setTimeout(async () => {
      const res = await fetch(`/api/admin/work-drive/search?q=${encodeURIComponent(q)}`, { cache: "no-store" });
      const json = await res.json();
      setSearchResults(res.ok ? json.files ?? [] : []);
    }, 250);
    return () => clearTimeout(t);
  }, [searchQ]);

  const childFolders = useMemo(
    () => (data?.folders ?? []).filter((f) => f.parentId === folderId),
    [data, folderId],
  );

  const breadcrumb = useMemo(() => {
    if (!data) return [];
    const byId = new Map(data.folders.map((f) => [f.id, f]));
    const chain: Folder[] = [];
    let cur = folderId ? byId.get(folderId) : undefined;
    while (cur) {
      chain.unshift(cur);
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    return chain;
  }, [data, folderId]);

  async function onPick(files: FileList | null) {
    if (!files || files.length === 0 || !data) return;
    const list = Array.from(files);
    setUploading(list.map((f) => f.name));
    for (const file of list) {
      try {
        await uploadWorkDriveFile(file, { workspaceSlug: slug, folderId });
      } catch (e) {
        setError(`${file.name}: ${e instanceof Error ? e.message : "upload failed"}`);
      }
      setUploading((u) => u.filter((n) => n !== file.name));
    }
    if (fileInput.current) fileInput.current.value = "";
    load();
  }

  async function newFolder() {
    const name = window.prompt("Folder name");
    if (!name?.trim()) return;
    const res = await fetch("/api/admin/work-drive/folders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceSlug: slug, name, parentId: folderId }),
    });
    const json = await res.json();
    if (!res.ok) setError(json?.error || "Could not create the folder.");
    else load();
  }

  async function rename(file: DriveFile) {
    const name = window.prompt("Rename file", file.name);
    if (!name?.trim() || name === file.name) return;
    setBusyId(file.id);
    const res = await fetch(`/api/admin/work-drive/files/${file.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) setError((await res.json())?.error || "Rename failed.");
    setBusyId(null);
    load();
  }

  async function remove(file: DriveFile) {
    if (!window.confirm(`Move "${file.name}" to the workspace trash?`)) return;
    setBusyId(file.id);
    const res = await fetch(`/api/admin/work-drive/files/${file.id}`, { method: "DELETE" });
    if (!res.ok) setError((await res.json())?.error || "Delete failed.");
    setBusyId(null);
    load();
  }

  const canEdit = data?.access.canEdit ?? false;

  return (
    <AdminShell>
      <div className="space-y-5">
        <Link
          href="/admin/work-drive"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--muted)] transition hover:text-[var(--accent)]"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          All workspaces
        </Link>

        {error && (
          <div className="rounded-2xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
            {error}
          </div>
        )}

        {data && (
          <>
            <header className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h1 className="text-xl font-bold text-[var(--foreground)]">{data.workspace.name}</h1>
                {data.workspace.description && (
                  <p className="mt-1 text-sm text-[var(--muted)]">{data.workspace.description}</p>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setShowMembers(true)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] px-3.5 py-2 text-sm font-semibold text-[var(--foreground-soft)] transition hover:bg-[var(--surface-alt)]"
                >
                  <UsersIcon className="h-4 w-4" />
                  Members
                </button>
                {canEdit && (
                  <>
                    <button
                      onClick={newFolder}
                      className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] px-3.5 py-2 text-sm font-semibold text-[var(--foreground-soft)] transition hover:bg-[var(--surface-alt)]"
                    >
                      <PlusIcon className="h-4 w-4" />
                      Folder
                    </button>
                    <button
                      onClick={() => fileInput.current?.click()}
                      className="inline-flex items-center gap-1.5 rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-bold text-white transition hover:brightness-110"
                    >
                      <UploadIcon className="h-4 w-4" />
                      Upload
                    </button>
                    <input
                      ref={fileInput}
                      type="file"
                      multiple
                      hidden
                      onChange={(e) => onPick(e.target.files)}
                    />
                  </>
                )}
              </div>
            </header>

            {/* Search — across every workspace this admin can see */}
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted)]" />
              <input
                value={searchQ}
                onChange={(e) => setSearchQ(e.target.value)}
                placeholder="Search files by name or content…"
                className="w-full rounded-full border border-[var(--border)] bg-[var(--surface)] py-2 pl-9 pr-3 text-sm text-[var(--foreground)] outline-none focus:border-[var(--accent)]"
              />
            </div>

            {searchResults !== null ? (
              <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)]">
                {searchResults.length === 0 ? (
                  <p className="p-8 text-center text-sm text-[var(--muted)]">No files match “{searchQ}”.</p>
                ) : (
                  <ul className="divide-y divide-[var(--border)]">
                    {searchResults.map((hit) => (
                      <li key={hit.id} className="flex items-center gap-3 px-4 py-3 transition hover:bg-[var(--surface-alt)]">
                        <span className="text-[var(--muted)]">
                          <KindIcon kind={hit.kind} className="h-5 w-5" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium text-[var(--foreground)]">{hit.name}</p>
                          <p className="text-xs text-[var(--muted)]">
                            {bytes(hit.sizeBytes)}
                            {hit.workspaceName ? ` · in ${hit.workspaceName}` : ""}
                          </p>
                        </div>
                        {hit.workspaceSlug && hit.workspaceSlug !== slug && (
                          <Link
                            href={`/admin/work-drive/${hit.workspaceSlug}`}
                            className="rounded-lg px-2 py-1 text-xs font-semibold text-[var(--muted)] transition hover:text-[var(--accent)]"
                          >
                            Open
                          </Link>
                        )}
                        <a
                          href={`/api/admin/work-drive/files/${hit.id}/download`}
                          className="rounded-lg p-2 text-[var(--muted)] transition hover:text-[var(--accent)]"
                        >
                          <DownloadIcon className="h-4 w-4" />
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : (
             <>
            {/* Breadcrumb */}
            <nav className="flex flex-wrap items-center gap-1 text-sm">
              <button
                onClick={() => setFolderId(null)}
                className={`rounded-lg px-2 py-1 transition hover:bg-[var(--surface-alt)] ${
                  folderId === null ? "font-semibold text-[var(--foreground)]" : "text-[var(--muted)]"
                }`}
              >
                {data.workspace.name}
              </button>
              {breadcrumb.map((f) => (
                <span key={f.id} className="flex items-center gap-1">
                  <span className="text-[var(--muted)]">/</span>
                  <button
                    onClick={() => setFolderId(f.id)}
                    className={`rounded-lg px-2 py-1 transition hover:bg-[var(--surface-alt)] ${
                      folderId === f.id ? "font-semibold text-[var(--foreground)]" : "text-[var(--muted)]"
                    }`}
                  >
                    {f.name}
                  </button>
                </span>
              ))}
            </nav>

            <div className="grid gap-5 lg:grid-cols-[1fr_18rem]">
              {/* Files + folders */}
              <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)]">
                {uploading.length > 0 && (
                  <div className="border-b border-[var(--border)] px-4 py-2 text-xs text-[var(--muted)]">
                    Uploading {uploading.join(", ")}…
                  </div>
                )}

                {loading ? (
                  <div className="p-8 text-center text-sm text-[var(--muted)]">Loading…</div>
                ) : childFolders.length === 0 && data.files.length === 0 ? (
                  <div className="p-10 text-center">
                    <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-[var(--surface-alt)] text-[var(--muted)]">
                      <FolderIcon className="h-6 w-6" />
                    </span>
                    <p className="mt-3 text-sm text-[var(--muted)]">
                      This folder is empty.{canEdit ? " Upload a file or make a subfolder." : ""}
                    </p>
                  </div>
                ) : (
                  <ul className="divide-y divide-[var(--border)]">
                    {childFolders.map((f) => (
                      <li key={f.id}>
                        <button
                          onClick={() => setFolderId(f.id)}
                          className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-[var(--surface-alt)]"
                        >
                          <span className="text-[var(--accent)]">
                            <FolderIcon className="h-5 w-5" />
                          </span>
                          <span className="flex-1 font-medium text-[var(--foreground)]">{f.name}</span>
                          <span className="text-xs text-[var(--muted)]">Folder</span>
                        </button>
                      </li>
                    ))}
                    {data.files.map((file) => (
                      <li
                        key={file.id}
                        className="flex items-center gap-3 px-4 py-3 transition hover:bg-[var(--surface-alt)]"
                      >
                        <span className="text-[var(--muted)]">
                          <KindIcon kind={file.kind} className="h-5 w-5" />
                        </span>
                        <button
                          onClick={() =>
                            setDrawerFile({
                              id: file.id,
                              name: file.name,
                              kind: file.kind,
                              sizeBytes: file.sizeBytes,
                              mimeType: file.mimeType,
                              version: file.version,
                              updatedAt: file.updatedAt,
                            })
                          }
                          className="min-w-0 flex-1 text-left"
                        >
                          <p className="truncate font-medium text-[var(--foreground)]">{file.name}</p>
                          <p className="text-xs text-[var(--muted)]">
                            {bytes(file.sizeBytes)} · {when(file.updatedAt)}
                            {file.version > 1 ? ` · v${file.version}` : ""}
                          </p>
                        </button>
                        <div className="flex items-center gap-1">
                          <a
                            href={`/api/admin/work-drive/files/${file.id}/download`}
                            className="rounded-lg p-2 text-[var(--muted)] transition hover:bg-[var(--surface)] hover:text-[var(--accent)]"
                            title="Download"
                          >
                            <DownloadIcon className="h-4 w-4" />
                          </a>
                          {canEdit && (
                            <>
                              <button
                                onClick={() => rename(file)}
                                disabled={busyId === file.id}
                                className="rounded-lg p-2 text-[var(--muted)] transition hover:bg-[var(--surface)] hover:text-[var(--accent)] disabled:opacity-40"
                                title="Rename"
                              >
                                <PencilIcon className="h-4 w-4" />
                              </button>
                              <button
                                onClick={() => remove(file)}
                                disabled={busyId === file.id}
                                className="rounded-lg p-2 text-[var(--muted)] transition hover:bg-[var(--surface)] hover:text-rose-500 disabled:opacity-40"
                                title="Delete"
                              >
                                <TrashIcon className="h-4 w-4" />
                              </button>
                            </>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Activity */}
              <aside className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-4">
                <h2 className="flex items-center gap-2 text-sm font-bold text-[var(--foreground)]">
                  <ClockIcon className="h-4 w-4 text-[var(--muted)]" />
                  Recent activity
                </h2>
                {data.activity.length === 0 ? (
                  <p className="mt-3 text-xs text-[var(--muted)]">Nothing yet.</p>
                ) : (
                  <ul className="mt-3 space-y-3">
                    {data.activity.map((a) => (
                      <li key={a.id} className="text-xs text-[var(--muted)]">
                        <span className="text-[var(--foreground-soft)]">
                          {ACTION_TEXT[a.action] ?? a.action}
                        </span>{" "}
                        {typeof a.meta?.name === "string" ? `"${a.meta.name}"` : ""}
                        {typeof a.meta?.to === "string" ? ` → "${a.meta.to}"` : ""}
                        <span className="block text-[10px] opacity-70">{when(a.createdAt)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </aside>
            </div>
             </>
            )}
          </>
        )}
      </div>

      {drawerFile && data && (
        <FileDrawer
          file={drawerFile}
          workspaceSlug={slug}
          canEdit={data.access.canEdit}
          onClose={() => setDrawerFile(null)}
          onChanged={() => {
            load();
            setDrawerFile(null);
          }}
        />
      )}
      {showMembers && (
        <MembersModal
          workspaceSlug={slug}
          canEdit={data?.access.canEdit ?? false}
          onClose={() => setShowMembers(false)}
        />
      )}
    </AdminShell>
  );
}
