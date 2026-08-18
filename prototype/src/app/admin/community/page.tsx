"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import AdminShell from "@/components/AdminShell";

/**
 * Moderation view for the community.
 *
 * A student sees exactly one room — their branch, their level, their sitting.
 * This page deliberately ignores all of that, because the school has told its
 * students the space is monitored and that promise needs somebody who can
 * actually see every room at once.
 *
 * What it does NOT offer is an edit box. A moderator can take a message down
 * and put it back, and that is the whole list. Staff able to silently rewrite a
 * student's words would make every transcript here worthless the moment one
 * was needed — which is the moment somebody asks what was actually said.
 *
 * Removal is a hide, never a delete, so "show me what was taken down" has an
 * answer. Under the old forum it did not: moderating meant destroying the row.
 */

type Person = { id: string; name: string | null; email: string; role: string };

type Message = {
  id: string;
  body: string;
  createdAt: string;
  editedAt: string | null;
  hiddenAt: string | null;
  hiddenReason: string | null;
  hiddenBy: { id: string; name: string | null } | null;
  attachmentUrl: string | null;
  author: Person;
  replyTo: { id: string; body: string; author: { name: string | null } } | null;
  channel: {
    id: string;
    name: string;
    slug: string;
    space: {
      id: string;
      name: string;
      level: string;
      sessionSlot: string;
      branch: { id: string; name: string };
    };
  };
};

type SpaceOption = {
  id: string;
  name: string;
  level: string;
  sessionSlot: string;
  label: string;
  branch: { id: string; name: string };
};

const SLOT_LABEL: Record<string, string> = {
  morning: "Morning",
  afternoon: "Afternoon",
  evening: "Evening",
};

function roleBadge(role: string) {
  const r = (role || "").toLowerCase();
  if (r === "admin") return { label: "Office", className: "bg-purple-100 text-purple-700" };
  if (r === "lecturer") return { label: "Tutor", className: "bg-blue-100 text-blue-700" };
  return { label: "Student", className: "bg-[var(--surface-alt)] text-[var(--muted)]" };
}

export default function AdminCommunityPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [spaces, setSpaces] = useState<SpaceOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const [branchId, setBranchId] = useState("");
  const [level, setLevel] = useState("");
  const [sessionSlot, setSessionSlot] = useState("");
  const [search, setSearch] = useState("");
  const [hiddenOnly, setHiddenOnly] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (branchId) params.set("branchId", branchId);
      if (level) params.set("level", level);
      if (sessionSlot) params.set("sessionSlot", sessionSlot);
      if (search.trim()) params.set("search", search.trim());
      if (hiddenOnly) params.set("hidden", "true");

      const res = await fetch(`/api/admin/community?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch messages");
      const data = await res.json();

      setMessages(data.messages ?? []);
      setSpaces(data.spaces ?? []);
      setError("");
    } catch (err) {
      setError("Failed to load community messages");
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [branchId, level, sessionSlot, search, hiddenOnly]);

  useEffect(() => {
    load();
  }, [load]);

  const branches = useMemo(() => {
    const byId = new Map<string, string>();
    for (const space of spaces) byId.set(space.branch.id, space.branch.name);
    return [...byId].map(([id, name]) => ({ id, name }));
  }, [spaces]);

  const levels = useMemo(() => [...new Set(spaces.map((s) => s.level))].sort(), [spaces]);

  const moderate = useCallback(async (message: Message) => {
    const hiding = !message.hiddenAt;
    // A reason is optional but asked for, because "why was this removed?" is
    // the first question anybody asks and the hardest to reconstruct later.
    const reason = hiding ? window.prompt("Why is this being removed? (optional)") ?? "" : "";
    if (hiding && reason === null) return;

    setBusyId(message.id);
    try {
      const res = await fetch("/api/admin/community", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: message.id, hidden: hiding, reason }),
      });
      if (!res.ok) throw new Error("Failed");
      const updated = await res.json();
      setMessages((current) =>
        current.map((m) =>
          m.id === message.id
            ? { ...m, hiddenAt: updated.hiddenAt, hiddenReason: updated.hiddenReason, hiddenBy: updated.hiddenBy }
            : m,
        ),
      );
    } catch {
      setError("Could not update that message");
    } finally {
      setBusyId(null);
    }
  }, []);

  return (
    <AdminShell>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-[var(--foreground)]">Community</h1>
          <p className="mt-1.5 text-sm text-[var(--muted)]">
            Every class group in the school, newest first. Removing a message hides it from students and keeps the record.
          </p>
        </div>

        {/* ------------------------------------------------------- filters */}
        <div className="flex flex-wrap gap-2 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3">
          <select
            value={branchId}
            onChange={(e) => setBranchId(e.target.value)}
            className="rounded-xl border border-[var(--border)] bg-[var(--surface-alt)] px-3 py-2 text-sm"
          >
            <option value="">All branches</option>
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>{branch.name}</option>
            ))}
          </select>

          <select
            value={level}
            onChange={(e) => setLevel(e.target.value)}
            className="rounded-xl border border-[var(--border)] bg-[var(--surface-alt)] px-3 py-2 text-sm"
          >
            <option value="">All levels</option>
            {levels.map((lvl) => (
              <option key={lvl} value={lvl}>{lvl}</option>
            ))}
          </select>

          {/*
            The filter that did not exist and now has to: three A1 rooms differ
            only by the time of day, so without this the list is unreadable.
          */}
          <select
            value={sessionSlot}
            onChange={(e) => setSessionSlot(e.target.value)}
            className="rounded-xl border border-[var(--border)] bg-[var(--surface-alt)] px-3 py-2 text-sm"
          >
            <option value="">All sittings</option>
            <option value="morning">Morning</option>
            <option value="afternoon">Afternoon</option>
            <option value="evening">Evening</option>
          </select>

          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search messages…"
            className="min-w-0 flex-1 rounded-xl border border-[var(--border)] bg-[var(--surface-alt)] px-3 py-2 text-sm"
          />

          <label className="flex items-center gap-2 rounded-xl border border-[var(--border)] px-3 py-2 text-sm">
            <input type="checkbox" checked={hiddenOnly} onChange={(e) => setHiddenOnly(e.target.checked)} />
            Removed only
          </label>
        </div>

        {error ? (
          <p className="rounded-2xl border border-rose-300 bg-rose-50 p-4 text-sm text-rose-700">{error}</p>
        ) : null}

        {/* ------------------------------------------------------ messages */}
        {loading ? (
          <p className="py-12 text-center text-sm text-[var(--muted)]">Loading…</p>
        ) : messages.length === 0 ? (
          <p className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] py-12 text-center text-sm text-[var(--muted)]">
            {hiddenOnly ? "Nothing has been removed." : "No messages match these filters."}
          </p>
        ) : (
          <div className="space-y-2">
            {messages.map((message) => {
              const badge = roleBadge(message.author.role);
              const hidden = Boolean(message.hiddenAt);
              return (
                <div
                  key={message.id}
                  className={`rounded-2xl border p-4 ${
                    hidden ? "border-dashed border-rose-300 bg-rose-50/40" : "border-[var(--border)] bg-[var(--surface)]"
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="font-semibold text-[var(--foreground)]">
                      {message.author.name ?? message.author.email}
                    </span>
                    <span className={`rounded-full px-2 py-0.5 font-semibold ${badge.className}`}>{badge.label}</span>
                    <span className="text-[var(--muted)]">
                      {message.channel.space.branch?.name} · {message.channel.space.level} ·{" "}
                      {SLOT_LABEL[message.channel.space.sessionSlot] ?? message.channel.space.sessionSlot} · #
                      {message.channel.name}
                    </span>
                    <span className="ml-auto text-[var(--muted)]">
                      {new Date(message.createdAt).toLocaleString()}
                    </span>
                  </div>

                  {message.replyTo ? (
                    <div className="mt-2 border-l-2 border-[var(--accent)] pl-2 text-xs text-[var(--muted)]">
                      <span className="font-semibold">{message.replyTo.author.name ?? "Someone"}: </span>
                      {message.replyTo.body.slice(0, 120)}
                    </div>
                  ) : null}

                  <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-[var(--foreground)]">
                    {message.body}
                  </p>

                  {message.attachmentUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={message.attachmentUrl} alt="" className="mt-2 max-h-40 rounded-xl object-cover" />
                  ) : null}

                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    {hidden ? (
                      <p className="text-xs font-medium text-rose-600">
                        Removed{message.hiddenBy?.name ? ` by ${message.hiddenBy.name}` : ""}
                        {message.hiddenReason ? ` — ${message.hiddenReason}` : ""}
                      </p>
                    ) : null}
                    <button
                      onClick={() => void moderate(message)}
                      disabled={busyId === message.id}
                      className={`ml-auto rounded-full px-4 py-1.5 text-xs font-semibold transition disabled:opacity-40 ${
                        hidden
                          ? "border border-[var(--border)] text-[var(--foreground)] hover:bg-[var(--surface-alt)]"
                          : "bg-rose-500 text-white hover:brightness-110"
                      }`}
                    >
                      {busyId === message.id ? "Saving…" : hidden ? "Restore" : "Remove"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </AdminShell>
  );
}
