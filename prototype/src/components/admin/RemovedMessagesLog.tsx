"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ZoomableImage } from "@/components/ImageLightbox";

/**
 * The moderation audit log for the community.
 *
 * The room-by-room view (CommunityHub, on the "Rooms" tab) is where staff now
 * actually moderate — remove, pin, mute, in context. What that view does NOT
 * answer is "show me everything that has been taken down, across the whole
 * school", and the school promised its students a monitored space where
 * nothing is destroyed, only hidden. So this stays: every removed message,
 * every room, newest first, with a Restore button and the reason it went.
 *
 * A removal is a hide, never a delete — the row survives and only its
 * visibility to students changes, which is what makes "what was actually said?"
 * answerable at the one moment it matters.
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

/** How often the log refreshes itself while it is on screen. */
const POLL_MS = 30_000;

export default function RemovedMessagesLog() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [spaces, setSpaces] = useState<SpaceOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const [branchId, setBranchId] = useState("");
  const [level, setLevel] = useState("");
  const [sessionSlot, setSessionSlot] = useState("");
  const [search, setSearch] = useState("");

  const load = useCallback(async (opts: { quiet?: boolean } = {}) => {
    if (!opts.quiet) setLoading(true);
    try {
      const params = new URLSearchParams({ hidden: "true" });
      if (branchId) params.set("branchId", branchId);
      if (level) params.set("level", level);
      if (sessionSlot) params.set("sessionSlot", sessionSlot);
      if (search.trim()) params.set("search", search.trim());

      const res = await fetch(`/api/admin/community?${params.toString()}`, { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to fetch messages");
      const data = await res.json();

      setMessages(data.messages ?? []);
      setSpaces(data.spaces ?? []);
      setError("");
    } catch (err) {
      setError("Failed to load removed messages");
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [branchId, level, sessionSlot, search]);

  useEffect(() => {
    void load();
  }, [load]);

  // Keep the log current without a manual refresh — a moderator on another
  // screen restoring or removing something shows up here on its own.
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load({ quiet: true });
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  const branches = useMemo(() => {
    const byId = new Map<string, string>();
    for (const space of spaces) byId.set(space.branch.id, space.branch.name);
    return [...byId].map(([id, name]) => ({ id, name }));
  }, [spaces]);

  const levels = useMemo(() => [...new Set(spaces.map((s) => s.level))].sort(), [spaces]);

  const restore = useCallback(async (message: Message) => {
    setBusyId(message.id);
    try {
      const res = await fetch("/api/admin/community", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: message.id, hidden: false }),
      });
      if (!res.ok) throw new Error("Failed");
      // It is no longer removed, so it leaves this list.
      setMessages((current) => current.filter((m) => m.id !== message.id));
    } catch {
      setError("Could not restore that message");
    } finally {
      setBusyId(null);
    }
  }, []);

  return (
    <div className="space-y-4">
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
          placeholder="Search removed messages…"
          className="min-w-0 flex-1 rounded-xl border border-[var(--border)] bg-[var(--surface-alt)] px-3 py-2 text-sm"
        />
      </div>

      {error ? (
        <p className="rounded-2xl border border-rose-300 bg-rose-50 p-4 text-sm text-rose-700">{error}</p>
      ) : null}

      {loading ? (
        <p className="py-12 text-center text-sm text-[var(--muted)]">Loading…</p>
      ) : messages.length === 0 ? (
        <p className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] py-12 text-center text-sm text-[var(--muted)]">
          Nothing has been removed.
        </p>
      ) : (
        <div className="space-y-2">
          {messages.map((message) => {
            const badge = roleBadge(message.author.role);
            return (
              <div
                key={message.id}
                className="rounded-2xl border border-dashed border-rose-300 bg-rose-50/40 p-4"
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
                  <ZoomableImage
                    src={message.attachmentUrl}
                    alt=""
                    className="mt-2 max-h-40 rounded-xl object-cover"
                  />
                ) : null}

                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <p className="text-xs font-medium text-rose-600">
                    Removed{message.hiddenBy?.name ? ` by ${message.hiddenBy.name}` : ""}
                    {message.hiddenReason ? ` — ${message.hiddenReason}` : ""}
                  </p>
                  <button
                    onClick={() => void restore(message)}
                    disabled={busyId === message.id}
                    className="ml-auto rounded-full border border-[var(--border)] px-4 py-1.5 text-xs font-semibold text-[var(--foreground)] transition hover:bg-[var(--surface-alt)] disabled:opacity-40"
                  >
                    {busyId === message.id ? "Saving…" : "Restore"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
