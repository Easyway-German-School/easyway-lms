"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePushNotifications } from "@/lib/use-push";

/**
 * Discord-style channel rail + Reddit-style threads.
 *
 * Rendered both full-page (/community) and inside the floating launcher panel,
 * so it takes a `compact` flag rather than duplicating the UI.
 */

type Channel = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  kind: string;
  unreadCount: number;
  _count: { threads: number };
};

type Space = {
  id: string;
  name: string;
  level: string;
  description: string | null;
  branch: { id: string; name: string };
  channels: Channel[];
};

type Author = { id: string; name: string | null; role: string };

type Thread = {
  id: string;
  title: string;
  body: string;
  pinned: boolean;
  createdAt: string;
  lastActivityAt: string;
  author: Author;
  _count: { comments: number };
  optimistic?: boolean;
};

type CommentNode = {
  id: string;
  body: string;
  createdAt: string;
  author: Author;
  children: CommentNode[];
  optimistic?: boolean;
};

function initials(name: string | null) {
  if (!name) return "?";
  return name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("");
}

function timeAgo(iso: string) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}

function RoleBadge({ role }: { role: string }) {
  const r = String(role || "").toLowerCase();
  if (r !== "lecturer" && r !== "admin") return null;
  return (
    <span className="rounded-full bg-[var(--accent-soft)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--accent)]">
      {r === "admin" ? "Staff" : "Tutor"}
    </span>
  );
}

function Avatar({ name, size = 32 }: { name: string | null; size?: number }) {
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full bg-[var(--accent-strong)] font-semibold text-white"
      style={{ width: size, height: size, fontSize: size * 0.36 }}
      aria-hidden="true"
    >
      {initials(name)}
    </div>
  );
}

function Skeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="space-y-3" aria-hidden="true">
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="animate-pulse rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <div className="h-3 w-1/3 rounded bg-[var(--surface-alt)]" />
          <div className="mt-3 h-3 w-4/5 rounded bg-[var(--surface-alt)]" />
        </div>
      ))}
    </div>
  );
}

function CommentThread({
  nodes,
  depth = 0,
  onReply,
  replyingTo,
  replyText,
  setReplyText,
  submitReply,
  busy,
}: {
  nodes: CommentNode[];
  depth?: number;
  onReply: (id: string | null) => void;
  replyingTo: string | null;
  replyText: string;
  setReplyText: (v: string) => void;
  submitReply: (parentId: string | null) => void;
  busy: boolean;
}) {
  return (
    <div className={depth > 0 ? "mt-3 space-y-3 border-l-2 border-[var(--border)] pl-4" : "space-y-3"}>
      {nodes.map((node) => (
        <div key={node.id} className={node.optimistic ? "opacity-60" : ""}>
          <div className="flex gap-3">
            <Avatar name={node.author.name} size={28} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold">{node.author.name ?? "Member"}</span>
                <RoleBadge role={node.author.role} />
                <span className="text-xs text-[var(--muted)]">{timeAgo(node.createdAt)}</span>
              </div>
              <p className="mt-1 whitespace-pre-wrap text-sm leading-6">{node.body}</p>
              {depth < 4 && (
                <button
                  onClick={() => onReply(replyingTo === node.id ? null : node.id)}
                  className="mt-1 text-xs font-semibold text-[var(--accent)] hover:underline"
                >
                  {replyingTo === node.id ? "Cancel" : "Reply"}
                </button>
              )}

              {replyingTo === node.id && (
                <div className="mt-2 flex gap-2">
                  <input
                    autoFocus
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submitReply(node.id); } }}
                    placeholder="Write a reply…"
                    className="flex-1 rounded-full border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm outline-none focus:border-[var(--accent)]"
                  />
                  <button
                    onClick={() => submitReply(node.id)}
                    disabled={busy || !replyText.trim()}
                    className="rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    Send
                  </button>
                </div>
              )}
            </div>
          </div>
          {node.children.length > 0 && (
            <CommentThread
              nodes={node.children}
              depth={depth + 1}
              onReply={onReply}
              replyingTo={replyingTo}
              replyText={replyText}
              setReplyText={setReplyText}
              submitReply={submitReply}
              busy={busy}
            />
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * Opt-in for lock-screen notifications. Sits at the foot of the channel rail
 * rather than interrupting on load — permission is only ever asked for on a
 * deliberate tap, because a reflexive "Block" cannot be undone from the app.
 */
function NotifyToggle({ compact }: { compact: boolean }) {
  const { supported, enabled, busy, enable, disable, error } = usePushNotifications();
  if (!supported) return null;

  return (
    <div className="mt-3 border-t border-[var(--border)] px-2 pt-3">
      <button
        type="button"
        onClick={enabled ? disable : enable}
        disabled={busy}
        className={`flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left text-xs font-semibold transition disabled:opacity-50 ${
          enabled ? "text-[var(--accent)]" : "text-[var(--muted)] hover:bg-[var(--surface)]"
        }`}
      >
        <span aria-hidden="true">{enabled ? "🔔" : "🔕"}</span>
        <span className="truncate">
          {busy ? "One moment…" : enabled ? "Notifications on" : compact ? "Notify me" : "Turn on notifications"}
        </span>
      </button>
      {error && <p className="px-2 pb-1 text-[10px] leading-4 text-red-500">{error}</p>}
    </div>
  );
}

export default function CommunityHub({ compact = false }: { compact?: boolean }) {
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [isStaff, setIsStaff] = useState(false);
  const [scopeNote, setScopeNote] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [spaceId, setSpaceId] = useState<string | null>(null);
  const [channelId, setChannelId] = useState<string | null>(null);

  const [threads, setThreads] = useState<Thread[]>([]);
  const [threadsLoading, setThreadsLoading] = useState(false);
  const [openThreadId, setOpenThreadId] = useState<string | null>(null);
  const [comments, setComments] = useState<CommentNode[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  const [composerOpen, setComposerOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newBody, setNewBody] = useState("");
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [rootReply, setRootReply] = useState("");
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  // Load the spaces this member is allowed to see.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/community/spaces", { cache: "no-store" });
        if (!res.ok) throw new Error("Unable to load your community");
        const data = await res.json();
        if (cancelled) return;

        setSpaces(data.spaces ?? []);
        setIsStaff(Boolean(data.isStaff));
        if ((data.spaces ?? []).length === 0) {
          setScopeNote(
            data.scope?.branchId
              ? "No community has been set up for your level yet."
              : "Your branch hasn't been set, so we can't place you in a community yet. Please contact your branch coordinator.",
          );
        }
        const first = (data.spaces ?? [])[0];
        if (first) {
          setSpaceId(first.id);
          setChannelId(first.channels[0]?.id ?? null);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Something went wrong");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const activeSpace = useMemo(() => spaces.find((s) => s.id === spaceId) ?? null, [spaces, spaceId]);
  const activeChannel = useMemo(
    () => activeSpace?.channels.find((c) => c.id === channelId) ?? null,
    [activeSpace, channelId],
  );

  const loadThreads = useCallback(async (id: string) => {
    setThreadsLoading(true);
    setOpenThreadId(null);
    try {
      const res = await fetch(`/api/community/threads?channelId=${encodeURIComponent(id)}`, {
        cache: "no-store",
      });
      const data = await res.json();
      setThreads(res.ok ? data.threads ?? [] : []);
      if (!res.ok) setError(data.error ?? "Unable to load this channel");
      else setError(null);
    } catch {
      setError("Unable to load this channel");
    } finally {
      setThreadsLoading(false);
    }
  }, []);

  useEffect(() => { if (channelId) loadThreads(channelId); }, [channelId, loadThreads]);

  // Mirror of `spaces` for effects that need to read it without depending on
  // it — depending on it directly would re-run them on every badge update.
  const spacesRef = useRef(spaces);
  useEffect(() => { spacesRef.current = spaces; }, [spaces]);

  // Opening a channel clears its badge. Zeroed locally first so the red dot
  // vanishes on tap rather than after a round-trip; the server call just makes
  // it stick. The event tells the floating launcher to refresh its own count.
  useEffect(() => {
    if (!channelId) return;

    // Nothing unread means nothing to clear. Skipping the write matters: every
    // POST here touches the SQLite file, and simply viewing a channel should
    // not be a database write.
    const current = spacesRef.current
      .flatMap((space) => space.channels)
      .find((c) => c.id === channelId);
    if (!current || current.unreadCount === 0) return;

    setSpaces((prev) =>
      prev.map((space) => ({
        ...space,
        channels: space.channels.map((c) => (c.id === channelId ? { ...c, unreadCount: 0 } : c)),
      })),
    );

    fetch("/api/community/read", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ channelId }),
    })
      .then(() => window.dispatchEvent(new Event("easyway:unread-changed")))
      .catch(() => {
        /* Badge state is not worth surfacing an error for. */
      });
  }, [channelId]);

  async function openThread(id: string) {
    setOpenThreadId(id);
    setDetailLoading(true);
    setComments([]);
    try {
      const res = await fetch(`/api/community/threads/${id}`);
      const data = await res.json();
      if (res.ok) setComments(data.comments ?? []);
    } finally {
      setDetailLoading(false);
    }
  }

  async function createThread() {
    if (!channelId || !newTitle.trim() || !newBody.trim()) return;
    setBusy(true);

    // Optimistic: show it immediately, reconcile when the server answers.
    const temp: Thread = {
      id: `temp-${Date.now()}`,
      title: newTitle.trim(),
      body: newBody.trim(),
      pinned: false,
      createdAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString(),
      author: { id: "me", name: "You", role: "student" },
      _count: { comments: 0 },
      optimistic: true,
    };
    setThreads((prev) => [temp, ...prev]);
    const titleSent = newTitle, bodySent = newBody;
    setNewTitle(""); setNewBody(""); setComposerOpen(false);
    listRef.current?.scrollTo({ top: 0, behavior: "smooth" });

    try {
      const res = await fetch("/api/community/threads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ channelId, title: titleSent, body: bodySent }),
      });
      const data = await res.json();
      if (res.ok) {
        setThreads((prev) => prev.map((t) => (t.id === temp.id ? data.thread : t)));
      } else {
        setThreads((prev) => prev.filter((t) => t.id !== temp.id));
        setError(data.error ?? "Could not post your thread");
      }
    } catch {
      setThreads((prev) => prev.filter((t) => t.id !== temp.id));
      setError("Could not post your thread");
    } finally {
      setBusy(false);
    }
  }

  async function submitReply(parentId: string | null) {
    const text = parentId ? replyText : rootReply;
    if (!openThreadId || !text.trim()) return;
    setBusy(true);

    const temp: CommentNode = {
      id: `temp-${Date.now()}`,
      body: text.trim(),
      createdAt: new Date().toISOString(),
      author: { id: "me", name: "You", role: "student" },
      children: [],
      optimistic: true,
    };

    const graft = (nodes: CommentNode[]): CommentNode[] =>
      nodes.map((n) =>
        n.id === parentId ? { ...n, children: [...n.children, temp] } : { ...n, children: graft(n.children) },
      );
    setComments((prev) => (parentId ? graft(prev) : [...prev, temp]));
    if (parentId) { setReplyText(""); setReplyingTo(null); } else setRootReply("");

    try {
      const res = await fetch("/api/community/comments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ threadId: openThreadId, body: temp.body, parentId }),
      });
      if (res.ok) {
        await openThread(openThreadId);
        setThreads((prev) =>
          prev.map((t) => (t.id === openThreadId ? { ...t, _count: { comments: t._count.comments + 1 } } : t)),
        );
      }
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <div className={compact ? "p-4" : "p-8"}><Skeleton lines={4} /></div>;
  }

  if (spaces.length === 0) {
    return (
      <div className={`${compact ? "p-6" : "p-10"} text-center`}>
        <div className="text-4xl">🏫</div>
        <h3 className="mt-3 text-lg font-semibold">No community yet</h3>
        <p className="mt-2 text-sm text-[var(--muted)]">{scopeNote ?? error ?? "Nothing to show."}</p>
      </div>
    );
  }

  const openThreadData = threads.find((t) => t.id === openThreadId) ?? null;

  // Mirrors the server rule in /api/community/threads: announcement channels
  // are broadcast-only, so students get no composer there.
  const canPost = !(activeChannel?.kind === "announcement" && !isStaff);

  return (
    // In compact mode the hub floats over a page, so it has to stay inside the
    // viewport on a laptop or a phone rather than running off the top.
    <div className={`flex ${compact ? "h-[min(32rem,60vh)]" : "h-[calc(100vh-13rem)] min-h-[34rem]"} overflow-hidden rounded-3xl border border-[var(--border)] bg-[var(--surface)]`}>
      {/* Channel rail */}
      <aside className={`${compact ? "w-40" : "w-64"} shrink-0 overflow-y-auto border-r border-[var(--border)] bg-[var(--surface-alt)] p-3`}>
        {isStaff && spaces.length > 1 && (
          <select
            value={spaceId ?? ""}
            onChange={(e) => {
              const s = spaces.find((x) => x.id === e.target.value);
              setSpaceId(e.target.value);
              setChannelId(s?.channels[0]?.id ?? null);
            }}
            className="mb-3 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-2 py-2 text-xs font-semibold outline-none"
          >
            {spaces.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}

        <div className="px-2 pb-2">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--accent)]">
            {activeSpace?.branch.name}
          </p>
          <p className="text-sm font-bold leading-tight">{activeSpace?.level} community</p>
        </div>

        <nav className="mt-2 space-y-1">
          {activeSpace?.channels.map((c) => {
            const active = c.id === channelId;
            return (
              <button
                key={c.id}
                onClick={() => setChannelId(c.id)}
                className={`flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left text-sm transition ${
                  active ? "bg-[var(--accent)] font-semibold text-white" : "hover:bg-[var(--surface)]"
                }`}
              >
                <span className={`truncate ${!active && c.unreadCount > 0 ? "font-bold" : ""}`}>
                  <span className={active ? "text-white/70" : "text-[var(--muted)]"}>#</span> {c.name}
                </span>
                {/* Unread wins the slot: a red count is the thing that pulls
                    someone back in, the plain thread total is just context. */}
                {c.unreadCount > 0 && !active ? (
                  <span className="shrink-0 rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
                    {c.unreadCount > 99 ? "99+" : c.unreadCount}
                  </span>
                ) : c._count.threads > 0 ? (
                  <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${active ? "bg-white/25 text-white" : "bg-[var(--surface)] text-[var(--muted)]"}`}>
                    {c._count.threads}
                  </span>
                ) : null}
              </button>
            );
          })}
        </nav>

        <NotifyToggle compact={compact} />
      </aside>

      {/* Content */}
      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-5 py-3">
          <div className="min-w-0">
            <h2 className="truncate text-base font-bold">
              <span className="text-[var(--muted)]">#</span> {activeChannel?.name ?? "Select a channel"}
            </h2>
            {activeChannel?.description && !compact && (
              <p className="truncate text-xs text-[var(--muted)]">{activeChannel.description}</p>
            )}
          </div>
          {openThreadId ? (
            <button onClick={() => setOpenThreadId(null)} className="shrink-0 rounded-full border border-[var(--border)] px-3 py-1.5 text-xs font-semibold hover:bg-[var(--surface-alt)]">
              ← Back
            </button>
          ) : canPost ? (
            <button onClick={() => setComposerOpen((v) => !v)} className="shrink-0 rounded-full bg-[var(--accent)] px-3 py-1.5 text-xs font-semibold text-white">
              {composerOpen ? "Cancel" : "New post"}
            </button>
          ) : (
            <span className="shrink-0 rounded-full border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--muted)]">
              Tutors only
            </span>
          )}
        </header>

        <div ref={listRef} className="flex-1 overflow-y-auto p-4">
          {/* Composer */}
          {composerOpen && !openThreadId && (
            <div className="mb-4 rounded-2xl border border-[var(--border)] bg-[var(--surface-alt)] p-4">
              <input
                autoFocus
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="Title — what's your question?"
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm font-semibold outline-none focus:border-[var(--accent)]"
              />
              <textarea
                value={newBody}
                onChange={(e) => setNewBody(e.target.value)}
                rows={3}
                placeholder="Add some detail…"
                className="mt-2 w-full resize-none rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
              />
              <button
                onClick={createThread}
                disabled={busy || !newTitle.trim() || !newBody.trim()}
                className="mt-2 rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                Post
              </button>
            </div>
          )}

          {/* Thread detail */}
          {openThreadId && openThreadData ? (
            <div>
              <article className="rounded-2xl border border-[var(--border)] bg-[var(--surface-alt)] p-4">
                <div className="flex items-center gap-2">
                  <Avatar name={openThreadData.author.name} size={30} />
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold">{openThreadData.author.name ?? "Member"}</span>
                      <RoleBadge role={openThreadData.author.role} />
                    </div>
                    <span className="text-xs text-[var(--muted)]">{timeAgo(openThreadData.createdAt)}</span>
                  </div>
                </div>
                <h3 className="mt-3 text-lg font-bold">{openThreadData.title}</h3>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6">{openThreadData.body}</p>
              </article>

              <div className="mt-4 flex gap-2">
                <input
                  value={rootReply}
                  onChange={(e) => setRootReply(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submitReply(null); } }}
                  placeholder="Write a reply…"
                  className="flex-1 rounded-full border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm outline-none focus:border-[var(--accent)]"
                />
                <button
                  onClick={() => submitReply(null)}
                  disabled={busy || !rootReply.trim()}
                  className="rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                >
                  Send
                </button>
              </div>

              <div className="mt-5">
                {detailLoading ? <Skeleton lines={2} /> : comments.length === 0 ? (
                  <p className="py-6 text-center text-sm text-[var(--muted)]">No replies yet — be the first.</p>
                ) : (
                  <CommentThread
                    nodes={comments}
                    onReply={setReplyingTo}
                    replyingTo={replyingTo}
                    replyText={replyText}
                    setReplyText={setReplyText}
                    submitReply={submitReply}
                    busy={busy}
                  />
                )}
              </div>
            </div>
          ) : threadsLoading ? (
            <Skeleton lines={3} />
          ) : threads.length === 0 ? (
            <div className="py-14 text-center">
              <div className="text-3xl">💬</div>
              <p className="mt-3 text-sm font-semibold">Nothing here yet</p>
              <p className="mt-1 text-sm text-[var(--muted)]">
                {canPost
                  ? `Start the first conversation in #${activeChannel?.name}.`
                  : "Your tutors will post class news here."}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {threads.map((t) => (
                <button
                  key={t.id}
                  onClick={() => !t.optimistic && openThread(t.id)}
                  className={`block w-full rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 text-left transition hover:border-[var(--accent)] ${t.optimistic ? "opacity-60" : ""}`}
                >
                  <div className="flex items-start gap-3">
                    <Avatar name={t.author.name} size={32} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        {t.pinned && <span className="text-xs">📌</span>}
                        <span className="truncate text-sm font-bold">{t.title}</span>
                        <RoleBadge role={t.author.role} />
                      </div>
                      <p className="mt-1 line-clamp-2 text-sm text-[var(--muted)]">{t.body}</p>
                      <div className="mt-2 flex items-center gap-3 text-xs text-[var(--muted)]">
                        <span>{t.author.name ?? "Member"}</span>
                        <span>{timeAgo(t.lastActivityAt)}</span>
                        <span className="font-semibold text-[var(--accent)]">
                          {t._count.comments} {t._count.comments === 1 ? "reply" : "replies"}
                        </span>
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
