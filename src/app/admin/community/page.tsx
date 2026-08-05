"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import AdminShell from "@/components/AdminShell";

/**
 * Moderation view for the community hub.
 *
 * Students only ever see their own branch+level space; this page deliberately
 * shows every space at once so staff can moderate the whole school from one
 * place, filter down to a branch or level, and remove individual replies
 * without deleting the thread around them.
 */

type Person = { id: string; name: string | null; email: string; role: string };

type Comment = {
  id: string;
  body: string;
  createdAt: string;
  author: Person;
};

type Thread = {
  id: string;
  title: string;
  body: string;
  pinned: boolean;
  createdAt: string;
  lastActivityAt: string;
  author: Person;
  channel: {
    id: string;
    name: string;
    slug: string;
    space: { id: string; name: string; level: string; branch: { id: string; name: string } };
  };
  comments: Comment[];
};

type SpaceOption = {
  id: string;
  name: string;
  level: string;
  branch: { id: string; name: string };
};

function roleBadge(role: string) {
  const r = (role || "").toLowerCase();
  if (r === "admin") return { label: "Admin", className: "bg-purple-100 text-purple-700" };
  if (r === "lecturer") return { label: "Tutor", className: "bg-blue-100 text-blue-700" };
  return { label: "Student", className: "bg-slate-100 text-slate-600" };
}

export default function AdminCommunityPage() {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [spaces, setSpaces] = useState<SpaceOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const [branchId, setBranchId] = useState("");
  const [level, setLevel] = useState("");
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (branchId) params.set("branchId", branchId);
      if (level) params.set("level", level);
      if (search.trim()) params.set("search", search.trim());

      const res = await fetch(`/api/admin/community?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch threads");
      const data = await res.json();

      setThreads(data.threads ?? []);
      setSpaces(data.spaces ?? []);
      setError("");
    } catch (err) {
      setError("Failed to load community posts");
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [branchId, level, search]);

  useEffect(() => {
    load();
  }, [load]);

  const branches = useMemo(() => {
    const byId = new Map<string, string>();
    for (const space of spaces) byId.set(space.branch.id, space.branch.name);
    return [...byId].map(([id, name]) => ({ id, name }));
  }, [spaces]);

  const levels = useMemo(
    () => [...new Set(spaces.map((s) => s.level))].sort(),
    [spaces],
  );

  async function handlePin(id: string, pinned: boolean) {
    try {
      const res = await fetch("/api/admin/community", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, pinned: !pinned }),
      });
      if (!res.ok) throw new Error("Failed to update thread");

      // Reflect immediately; the list re-sorts on the next load.
      setThreads((prev) => prev.map((t) => (t.id === id ? { ...t, pinned: !pinned } : t)));
      setError("");
    } catch (err) {
      setError("Failed to update the post");
      console.error(err);
    }
  }

  async function handleDelete(id: string, type: "thread" | "comment") {
    const what = type === "thread" ? "this post and all its replies" : "this reply";
    if (!confirm(`Delete ${what}? This cannot be undone.`)) return;

    try {
      const res = await fetch("/api/admin/community", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, type }),
      });
      if (!res.ok) throw new Error("Failed to delete");

      if (type === "thread") {
        setThreads((prev) => prev.filter((t) => t.id !== id));
      } else {
        setThreads((prev) =>
          prev.map((t) => ({ ...t, comments: t.comments.filter((c) => c.id !== id) })),
        );
      }
      setError("");
    } catch (err) {
      setError("Failed to delete");
      console.error(err);
    }
  }

  return (
    <AdminShell>
      <div className="p-8">
        <div className="mb-6">
          <h1 className="text-3xl font-bold">Community moderation</h1>
          <p className="mt-1 text-sm text-gray-500">
            Every space across all branches and levels. Students only see their own.
          </p>
        </div>

        <div className="mb-6 flex flex-wrap gap-3">
          <select
            value={branchId}
            onChange={(e) => setBranchId(e.target.value)}
            className="rounded-lg border px-3 py-2 text-sm"
          >
            <option value="">All branches</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>

          <select
            value={level}
            onChange={(e) => setLevel(e.target.value)}
            className="rounded-lg border px-3 py-2 text-sm"
          >
            <option value="">All levels</option>
            {levels.map((l) => (
              <option key={l} value={l}>{l}</option>
            ))}
          </select>

          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search posts…"
            className="min-w-56 flex-1 rounded-lg border px-3 py-2 text-sm"
          />
        </div>

        {error && <div className="mb-4 rounded bg-red-100 p-4 text-red-700">{error}</div>}

        {loading ? (
          <div className="py-12 text-center text-gray-500">Loading…</div>
        ) : threads.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-gray-500">
              {branchId || level || search
                ? "No posts match these filters."
                : "No posts yet anywhere in the community."}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-gray-500">
              {threads.length} post{threads.length === 1 ? "" : "s"}
            </p>

            {threads.map((thread) => {
              const expanded = expandedId === thread.id;
              const badge = roleBadge(thread.author.role);

              return (
                <div key={thread.id} className="rounded-lg border bg-white p-6">
                  <div className="mb-3 flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        {thread.pinned && (
                          <span className="rounded bg-yellow-100 px-2 py-1 text-xs font-medium text-yellow-700">
                            PINNED
                          </span>
                        )}
                        <span className="rounded bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600">
                          {thread.channel.space.branch.name} · {thread.channel.space.level}
                        </span>
                        <span className="text-xs text-gray-500">#{thread.channel.slug}</span>
                      </div>

                      <h3 className="text-lg font-semibold">{thread.title}</h3>
                      <p className="mt-1 text-sm text-gray-600">
                        by {thread.author.name ?? thread.author.email}{" "}
                        <span className={`ml-1 rounded px-1.5 py-0.5 text-xs font-medium ${badge.className}`}>
                          {badge.label}
                        </span>{" "}
                        on {new Date(thread.createdAt).toLocaleDateString()}
                      </p>
                    </div>

                    <div className="flex shrink-0 gap-2">
                      <button
                        onClick={() => handlePin(thread.id, thread.pinned)}
                        className={`rounded px-3 py-1 text-sm font-medium ${
                          thread.pinned
                            ? "bg-yellow-100 text-yellow-700 hover:bg-yellow-200"
                            : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                        }`}
                      >
                        {thread.pinned ? "Unpin" : "Pin"}
                      </button>
                      <button
                        onClick={() => handleDelete(thread.id, "thread")}
                        className="rounded bg-red-100 px-3 py-1 text-sm font-medium text-red-700 hover:bg-red-200"
                      >
                        Delete
                      </button>
                    </div>
                  </div>

                  <p className={`text-sm text-gray-700 ${expanded ? "whitespace-pre-wrap" : "line-clamp-2"}`}>
                    {thread.body}
                  </p>

                  {expanded && thread.comments.length > 0 && (
                    <div className="mt-4 space-y-3 border-t pt-4">
                      <p className="font-medium text-gray-600">
                        {thread.comments.length} repl{thread.comments.length === 1 ? "y" : "ies"}
                      </p>
                      {thread.comments.map((comment) => {
                        const commentBadge = roleBadge(comment.author.role);
                        return (
                          <div key={comment.id} className="flex items-start gap-3 rounded bg-gray-50 p-3">
                            <div className="min-w-0 flex-1">
                              <p className="text-xs text-gray-500">
                                {comment.author.name ?? comment.author.email}
                                <span className={`ml-1 rounded px-1.5 py-0.5 text-[10px] font-medium ${commentBadge.className}`}>
                                  {commentBadge.label}
                                </span>{" "}
                                — {new Date(comment.createdAt).toLocaleDateString()}
                              </p>
                              <p className="mt-1 whitespace-pre-wrap text-sm">{comment.body}</p>
                            </div>
                            <button
                              onClick={() => handleDelete(comment.id, "comment")}
                              className="shrink-0 rounded px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-100"
                            >
                              Remove
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  <button
                    onClick={() => setExpandedId(expanded ? null : thread.id)}
                    className="mt-2 text-sm text-blue-600 hover:text-blue-800"
                  >
                    {expanded
                      ? "Show less"
                      : thread.comments.length > 0
                        ? `Show ${thread.comments.length} repl${thread.comments.length === 1 ? "y" : "ies"}`
                        : "Show more"}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </AdminShell>
  );
}
