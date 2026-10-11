"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { PlusIcon, SendIcon, UsersIcon, BriefcaseIcon, CommunityIcon } from "@/components/icons";

type Channel = {
  id: string;
  name: string;
  description: string | null;
  audience: string;
  audienceLabel: string;
  lastMessage: { body: string; authorName: string | null; createdAt: string } | null;
};

type Message = {
  id: string;
  body: string;
  createdAt: string;
  author: { id: string; name: string | null; email: string } | null;
};

const AUDIENCE_OPTIONS = [
  { value: "all_staff", label: "Everyone — admin staff and tutors" },
  { value: "admin", label: "Admin staff" },
  { value: "tutors", label: "Tutors" },
  { value: "growth", label: "Growth Desk (Sales & Business Development)" },
];

const AUDIENCE_ICON: Record<string, typeof SendIcon> = {
  admin: BriefcaseIcon,
  tutors: UsersIcon,
  growth: SendIcon,
  all_staff: CommunityIcon,
};

const time = (value: string) =>
  new Date(value).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

/**
 * Shell-agnostic: wrapped in AdminShell at /admin/channels and in
 * LecturerShell at /lecturer/channels, hitting the same API either way —
 * see src/lib/staff-channels.ts for how access is decided per role.
 */
export default function StaffChannelsView() {
  // A push notification links here with ?open=<channelId> — that channel
  // wins over "just pick the first one" so tapping a notification actually
  // lands where the message is, not wherever happened to sort first.
  const openParam = useSearchParams().get("open");
  const [channels, setChannels] = useState<Channel[]>([]);
  const [canCreate, setCanCreate] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [newChannel, setNewChannel] = useState({ name: "", description: "", audience: "all_staff" });

  function loadChannels(selectFirst = false) {
    fetch("/api/admin/channels", { cache: "no-store" })
      .then((r) => r.json())
      .then((body) => {
        if (body.error) throw new Error(body.error);
        const list: Channel[] = body.channels ?? [];
        setChannels(list);
        setCanCreate(Boolean(body.canCreate));
        if (selectFirst && list.length) {
          const wanted = openParam && list.find((c) => c.id === openParam);
          setActiveId(wanted ? wanted.id : list[0].id);
        }
        setError("");
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Unable to load channels."))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadChannels(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!activeId) return;
    fetch(`/api/admin/channels/${activeId}/messages`, { cache: "no-store" })
      .then((r) => r.json())
      .then((body) => {
        if (body.error) throw new Error(body.error);
        setMessages(body.messages ?? []);
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Unable to load messages."));
  }, [activeId]);

  async function send() {
    if (!activeId || !draft.trim()) return;
    const text = draft.trim();
    setDraft("");
    const res = await fetch(`/api/admin/channels/${activeId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: text }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Could not send that message.");
      return;
    }
    const refreshed = await fetch(`/api/admin/channels/${activeId}/messages`, { cache: "no-store" }).then((r) => r.json());
    setMessages(refreshed.messages ?? []);
    loadChannels();
  }

  async function createChannel() {
    if (!newChannel.name.trim()) return;
    const res = await fetch("/api/admin/channels", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newChannel),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Could not create that channel.");
      return;
    }
    setNewChannel({ name: "", description: "", audience: "all_staff" });
    setShowNew(false);
    loadChannels();
  }

  const active = channels.find((c) => c.id === activeId) ?? null;

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-bold text-[var(--foreground)]">Staff Channels</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Not a replacement for WhatsApp — the important stuff that needs a record and needs to actually reach
          people. Post here and everyone in the channel gets it on their phone, the same as a push notification,
          plus it stays searchable for good.
        </p>
      </header>

      {error ? <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</p> : null}

      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <aside className="space-y-2 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3">
          {canCreate && (
            <button
              type="button"
              onClick={() => setShowNew((s) => !s)}
              className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-[var(--border)] px-3 py-2 text-sm font-semibold text-[var(--muted)] hover:bg-[var(--surface-alt)]"
            >
              <PlusIcon className="h-4 w-4" />
              New channel
            </button>
          )}

          {showNew && (
            <div className="space-y-2 rounded-xl bg-[var(--surface-alt)] p-3">
              <input
                value={newChannel.name}
                onChange={(e) => setNewChannel({ ...newChannel, name: e.target.value })}
                placeholder="Channel name"
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-sm"
              />
              <select
                value={newChannel.audience}
                onChange={(e) => setNewChannel({ ...newChannel, audience: e.target.value })}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-sm"
              >
                {AUDIENCE_OPTIONS.map((a) => (
                  <option key={a.value} value={a.value}>{a.label}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => void createChannel()}
                disabled={!newChannel.name.trim()}
                className="w-full rounded-lg bg-[var(--accent)] px-2.5 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
              >
                Create
              </button>
            </div>
          )}

          {loading ? (
            <p className="py-6 text-center text-sm text-[var(--muted)]">Loading…</p>
          ) : channels.length === 0 ? (
            <p className="py-6 text-center text-sm text-[var(--muted)]">
              No channels yet. {canCreate ? "Create the first one above." : "Ask a Digital Communications admin to set one up."}
            </p>
          ) : (
            <ul className="space-y-1">
              {channels.map((c) => {
                const Icon = AUDIENCE_ICON[c.audience] ?? SendIcon;
                const isActive = activeId === c.id;
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => setActiveId(c.id)}
                      className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm transition-colors ${
                        isActive ? "bg-[var(--accent)] text-white shadow-sm" : "hover:bg-[var(--surface-alt)]"
                      }`}
                    >
                      <span
                        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
                          isActive ? "bg-white/20" : "bg-[var(--accent-soft)] text-[var(--accent)]"
                        }`}
                      >
                        <Icon className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <p className="truncate font-semibold">{c.name}</p>
                        <p className={`truncate text-xs ${isActive ? "text-white/80" : "text-[var(--muted)]"}`}>
                          {c.lastMessage ? `${c.lastMessage.authorName ?? "Someone"}: ${c.lastMessage.body}` : c.audienceLabel}
                        </p>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>

        <section className="flex min-h-[420px] flex-col rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
          {!active ? (
            <p className="m-auto text-sm text-[var(--muted)]">Pick a channel to read it.</p>
          ) : (
            <>
              <div className="flex items-center gap-2.5 border-b border-[var(--border)] pb-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--accent-soft)] text-[var(--accent)]">
                  {(() => {
                    const Icon = AUDIENCE_ICON[active.audience] ?? SendIcon;
                    return <Icon className="h-4 w-4" />;
                  })()}
                </span>
                <div className="min-w-0">
                  <p className="font-bold">{active.name}</p>
                  <p className="truncate text-xs text-[var(--muted)]">{active.description ?? active.audienceLabel}</p>
                </div>
              </div>

              <div className="flex-1 space-y-3 overflow-y-auto py-3">
                {messages.length === 0 ? (
                  <p className="py-10 text-center text-sm text-[var(--muted)]">No messages yet. Be the first.</p>
                ) : (
                  messages.map((m) => (
                    <div key={m.id}>
                      <p className="text-xs text-[var(--muted)]">
                        <span className="font-semibold text-[var(--foreground)]">{m.author?.name ?? "Someone"}</span>
                        {" · "}
                        {time(m.createdAt)}
                      </p>
                      <p className="mt-0.5 text-sm">{m.body}</p>
                    </div>
                  ))
                )}
              </div>

              <div className="flex gap-2 border-t border-[var(--border)] pt-3">
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void send();
                  }}
                  placeholder="Write a message…"
                  className="flex-1 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
                />
                <button
                  type="button"
                  onClick={() => void send()}
                  disabled={!draft.trim()}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--accent)] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                >
                  <SendIcon className="h-4 w-4" />
                  Send
                </button>
              </div>
              <p className="pt-1.5 text-xs text-[var(--muted)]">
                Everyone in {active.audienceLabel.toLowerCase()} gets this as a push notification.
              </p>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
