"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { usePushNotifications } from "@/lib/use-push";
import { uploadFile } from "@/lib/upload";
import { ALLOWED_REACTIONS, type ReactionSummary } from "@/lib/community-reactions";
import { STICKERS, StickerArt, stickerById } from "@/lib/community-stickers";
import {
  ArrowLeftIcon,
  BellIcon,
  BellOffIcon,
  BranchIcon,
  CommunityIcon,
  ImageIcon,
  SendIcon,
} from "@/components/icons";

/**
 * THE COHORT'S GROUP CHAT.
 *
 * This replaced a Discord-style channel rail wrapped around Reddit-style
 * threads, and the reason is that almost nobody posted. A forum asks you to
 * choose a title and a place before it lets you speak, and that single demand is
 * enough to stop a nervous student asking whether there was homework. Every one
 * of these students already runs a group chat on their phone all day. So the
 * room is now a running conversation in time order, and the only thing between
 * a student and saying something is a text box.
 *
 * Three decisions worth keeping:
 *
 *   - The channel rail survives, because a cohort genuinely has more than one
 *     conversation and burying the tutor's announcements under chat would be
 *     worse than the forum was. Announcements is read-only for students.
 *   - Sending is OPTIMISTIC. On the connections this school actually runs on,
 *     waiting for a round trip before your own words appear makes the app feel
 *     broken, and people press send twice.
 *   - New messages arrive by POLLING while the room is open. Not elegant; see
 *     the note in /api/portal/updates for why a held-open stream is the wrong
 *     shape on Vercel. It backs off hard when the tab is hidden, which is what
 *     keeps it cheap.
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
  _count: { messages: number };
};

type Space = {
  id: string;
  name: string;
  level: string;
  sessionSlot: string;
  description: string | null;
  branch: { id: string; name: string };
  channels: Channel[];
};

type ChatMessage = {
  id: string;
  body: string;
  hidden: boolean;
  hiddenReason: string | null;
  mine: boolean;
  createdAt: string;
  editedAt: string | null;
  attachment: { url: string; type: string | null; name: string | null } | null;
  author: { id: string; name: string; role: string };
  replyTo: { id: string; author: string; body: string; hidden: boolean } | null;
  /** Folded one-per-emoji, with whether this reader is in the count. */
  reactions?: ReactionSummary[];
  /** A sticker from the school's set, sent instead of text. */
  stickerId?: string | null;
  /** Staff have held this at the top of the room. */
  pinned?: boolean;
  /** Set on a bubble we have drawn but the server has not confirmed. */
  pending?: boolean;
  failed?: boolean;
};

/** How often an open room asks for new messages. */
const POLL_ACTIVE_MS = 4_000;
/** And how often when the tab is in the background. */
const POLL_HIDDEN_MS = 30_000;

/** The sticker-tray button: a peeling sticker corner. */
function StickerGlyph({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
      <path
        d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5V14l-6 6H5.5A1.5 1.5 0 0 1 4 18.5z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M20 14h-4.5a1.5 1.5 0 0 0-1.5 1.5V20" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <circle cx="9" cy="10" r="1.2" fill="currentColor" />
      <circle cx="14" cy="10" r="1.2" fill="currentColor" />
    </svg>
  );
}

function initials(name: string | null) {
  if (!name) return "?";
  return name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("");
}

/**
 * A colour per person, derived from their id.
 *
 * The point is not decoration. In a group chat the thing you do fifty times a
 * minute is work out who is talking, and a stable colour does that faster than
 * reading a name — which is exactly why every messaging app does it.
 */
const NAME_COLOURS = [
  "text-rose-500",
  "text-amber-600",
  "text-emerald-600",
  "text-sky-600",
  "text-violet-600",
  "text-fuchsia-600",
  "text-teal-600",
];

function colourFor(id: string) {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return NAME_COLOURS[hash % NAME_COLOURS.length];
}

function timeOf(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** "Today" / "Yesterday" / a date — the separator every chat has. */
function dayLabel(iso: string) {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86_400_000);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (same(date, today)) return "Today";
  if (same(date, yesterday)) return "Yesterday";
  return date.toLocaleDateString([], { day: "numeric", month: "long", year: "numeric" });
}

const SLOT_LABEL: Record<string, string> = {
  morning: "Morning",
  afternoon: "Afternoon",
  evening: "Evening",
};

/**
 * The Suspense boundary is required, not decorative: `useSearchParams` opts the
 * tree into client rendering and Next refuses to infer the boundary. This
 * component is mounted from the floating launcher inside all three portal
 * shells as well as from /community, so putting it here means no caller has to
 * remember.
 */
export default function CommunityHub({ compact = false }: { compact?: boolean }) {
  return (
    <Suspense
      fallback={
        <div className="grid h-64 place-items-center rounded-2xl border border-[var(--border)] bg-[var(--surface)] text-sm text-[var(--muted)]">
          Opening your class group…
        </div>
      }
    >
      <CommunityHubInner compact={compact} />
    </Suspense>
  );
}

function CommunityHubInner({ compact = false }: { compact?: boolean }) {
  const searchParams = useSearchParams();
  const deepLinkChannel = searchParams?.get("channel") ?? null;

  const [spaces, setSpaces] = useState<Space[]>([]);
  const [isStaff, setIsStaff] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [canPost, setCanPost] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [loadingRoom, setLoadingRoom] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [draft, setDraft] = useState("");
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [attachment, setAttachment] = useState<{ url: string; type: string | null; name: string | null } | null>(null);
  const [uploading, setUploading] = useState(false);
  /** Id of the message being corrected, and the text in its box. */
  const [editing, setEditing] = useState<string | null>(null);
  /** Which message currently has the emoji row open. One at a time. */
  const [reactingTo, setReactingTo] = useState<string | null>(null);
  /** The sticker tray above the composer. */
  const [stickerTrayOpen, setStickerTrayOpen] = useState(false);
  const [editDraft, setEditDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showRail, setShowRail] = useState(!compact);

  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  /** Newest confirmed message id — the cursor the poll asks from. */
  const cursorRef = useRef<string | null>(null);

  const push = usePushNotifications();

  const channels = useMemo(() => spaces.flatMap((space) => space.channels), [spaces]);
  const active = useMemo(() => channels.find((c) => c.id === activeId) ?? null, [channels, activeId]);
  const activeSpace = useMemo(
    () => spaces.find((space) => space.channels.some((c) => c.id === activeId)) ?? null,
    [spaces, activeId],
  );

  /* ---------------------------------------------------------------- spaces */

  const loadSpaces = useCallback(async () => {
    try {
      const res = await fetch("/api/community/spaces", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not load your community");

      const list: Space[] = data.spaces ?? [];
      setSpaces(list);
      setIsStaff(Boolean(data.isStaff));

      setActiveId((current) => {
        if (current) return current;
        const all = list.flatMap((space) => space.channels);
        // A notification opens the room it came from; otherwise land in the
        // room people actually talk in rather than the announcement board.
        const wanted = deepLinkChannel ? all.find((c) => c.id === deepLinkChannel) : undefined;
        return (wanted ?? all.find((c) => c.slug === "general") ?? all[0])?.id ?? null;
      });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load your community");
    }
  }, [deepLinkChannel]);

  useEffect(() => {
    void loadSpaces();
  }, [loadSpaces]);

  /* -------------------------------------------------------------- messages */

  const markRead = useCallback(async (channelId: string) => {
    await fetch("/api/community/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channelId }),
    }).catch(() => {});
    setSpaces((current) =>
      current.map((space) => ({
        ...space,
        channels: space.channels.map((c) => (c.id === channelId ? { ...c, unreadCount: 0 } : c)),
      })),
    );
  }, []);

  // Opening a room: newest page, jump to the bottom, clear the badge.
  useEffect(() => {
    if (!activeId) return;
    let cancelled = false;

    setLoadingRoom(true);
    setMessages([]);
    setReplyTo(null);
    cursorRef.current = null;

    (async () => {
      try {
        const res = await fetch(`/api/community/messages?channelId=${activeId}`, { cache: "no-store" });
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) throw new Error(data.error || "Could not open this room");

        const list: ChatMessage[] = data.messages ?? [];
        setMessages(list);
        setCanPost(data.canPost !== false);
        setHasMore(Boolean(data.hasMore));
        cursorRef.current = list.length ? list[list.length - 1].id : null;
        void markRead(activeId);
      } catch (roomError) {
        if (!cancelled) setError(roomError instanceof Error ? roomError.message : "Could not open this room");
      } finally {
        if (!cancelled) setLoadingRoom(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeId, markRead]);

  /**
   * The poll.
   *
   * Asks only for what arrived after the newest message we hold, so the answer
   * is an empty array almost every time. It reschedules itself rather than
   * running on a fixed interval, which stops a slow response stacking requests
   * on a bad connection — the exact condition under which stacking hurts most.
   */
  useEffect(() => {
    if (!activeId) return;
    let cancelled = false;
    let timer: number | undefined;

    async function tick() {
      if (cancelled) return;
      try {
        const cursor = cursorRef.current;
        const query = cursor ? `&after=${encodeURIComponent(cursor)}` : "";
        const res = await fetch(`/api/community/messages?channelId=${activeId}${query}`, { cache: "no-store" });
        const data = await res.json();

        if (!cancelled && res.ok && (data.messages?.length ?? 0) > 0) {
          const incoming: ChatMessage[] = data.messages;
          setMessages((current) => {
            // The server's copy of our own optimistic bubble arrives here too.
            const known = new Set(current.map((m) => m.id));
            const fresh = incoming.filter((m) => !known.has(m.id));
            return fresh.length ? [...current, ...fresh] : current;
          });
          cursorRef.current = incoming[incoming.length - 1].id;
          if (document.visibilityState === "visible") void markRead(activeId!);
        }
      } catch {
        // A failed poll is a blip. The next one is four seconds away.
      } finally {
        if (!cancelled) {
          timer = window.setTimeout(
            tick,
            document.visibilityState === "visible" ? POLL_ACTIVE_MS : POLL_HIDDEN_MS,
          );
        }
      }
    }

    timer = window.setTimeout(tick, POLL_ACTIVE_MS);
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [activeId, markRead]);

  /**
   * Follow the conversation, but only if the reader was already at the bottom.
   *
   * Yanking somebody down to a new message while they are reading back through
   * yesterday is the single most irritating thing a chat can do.
   */
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 160;
    if (nearBottom) bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  const loadOlder = useCallback(async () => {
    if (!activeId || !messages.length || loadingOlder) return;
    setLoadingOlder(true);
    const el = scrollRef.current;
    const previousHeight = el?.scrollHeight ?? 0;

    try {
      const res = await fetch(
        `/api/community/messages?channelId=${activeId}&before=${encodeURIComponent(messages[0].id)}`,
        { cache: "no-store" },
      );
      const data = await res.json();
      if (res.ok) {
        setMessages((current) => [...(data.messages ?? []), ...current]);
        setHasMore(Boolean(data.hasMore));
        // Hold the reader's place: without this, prepending jumps them to the top.
        requestAnimationFrame(() => {
          if (el) el.scrollTop = el.scrollHeight - previousHeight;
        });
      }
    } catch {
      // Nothing to say — the button is still there to try again.
    } finally {
      setLoadingOlder(false);
    }
  }, [activeId, messages, loadingOlder]);

  /* ----------------------------------------------------------------- send */

  /**
   * Attach a picture.
   *
   * The file goes to storage BEFORE the message is sent, not with it — the
   * shared uploader presigns and puts straight to the bucket, which is what
   * keeps a phone photo off Vercel's 4.5 MB request-body ceiling. So by the
   * time Send is pressed there is only a URL to post, and the slow part has
   * already happened while the student was still typing their caption.
   */
  const attach = useCallback(async (file: File) => {
    if (!file.type.startsWith("image/")) {
      setError("Pictures only, for now.");
      return;
    }
    // Generous for a phone photo, mean enough to stop somebody posting a video
    // frame-grab that every classmate then downloads on mobile data.
    if (file.size > 8 * 1024 * 1024) {
      setError("That picture is too large — 8 MB is the limit.");
      return;
    }

    setUploading(true);
    setError(null);
    try {
      const uploaded = await uploadFile(file, "files");
      setAttachment({ url: uploaded.url, type: uploaded.contentType, name: uploaded.filename });
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Could not upload that picture");
    } finally {
      setUploading(false);
    }
  }, []);

  /**
   * `sticker` is passed in rather than held in state, because sending one is a
   * single tap with nothing to compose first — the tray calls this directly.
   */
  const send = useCallback(async (sticker?: string) => {
    const text = draft.trim();
    // A picture or a sticker on its own is a message; the server agrees.
    if ((!text && !attachment && !sticker) || !activeId) return;

    const tempId = `pending-${Date.now()}`;
    const quoted = replyTo;
    const picture = attachment;

    setMessages((current) => [
      ...current,
      {
        id: tempId,
        body: text,
        hidden: false,
        hiddenReason: null,
        mine: true,
        createdAt: new Date().toISOString(),
        editedAt: null,
        attachment: picture,
        stickerId: sticker ?? null,
        author: { id: "me", name: "You", role: "student" },
        replyTo: quoted
          ? { id: quoted.id, author: quoted.author.name, body: quoted.body.slice(0, 180), hidden: false }
          : null,
        pending: true,
      },
    ]);
    setDraft("");
    setReplyTo(null);
    setAttachment(null);
    setStickerTrayOpen(false);

    try {
      const res = await fetch("/api/community/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channelId: activeId,
          body: text,
          replyToId: quoted?.id ?? null,
          attachmentUrl: picture?.url ?? null,
          attachmentType: picture?.type ?? null,
          attachmentName: picture?.name ?? null,
          stickerId: sticker ?? null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Message not sent");

      // Swap the placeholder for the real row, which carries the id the poll
      // needs as its cursor.
      setMessages((current) => current.map((m) => (m.id === tempId ? data.message : m)));
      cursorRef.current = data.message.id;
    } catch (sendError) {
      /**
       * A failed message stays on screen, marked, with the text recoverable.
       * Silently dropping it is how somebody discovers an hour later that the
       * question they asked was never asked.
       */
      setMessages((current) => current.map((m) => (m.id === tempId ? { ...m, pending: false, failed: true } : m)));
      setError(sendError instanceof Error ? sendError.message : "Message not sent");
    }
  }, [draft, activeId, replyTo, attachment]);

  /**
   * Editing, and why it is optimistic in one direction only.
   *
   * The new text is shown immediately because that is what makes a correction
   * feel like a correction rather than a request. But if the server refuses —
   * the message was hidden while the box was open, most likely — the ORIGINAL
   * comes back, not the attempt. Leaving the failed edit on screen would let
   * somebody believe they had fixed a wrong room number when they had not.
   */
  const saveEdit = useCallback(async () => {
    const target = editing;
    const text = editDraft.trim();
    if (!target || !text) return;

    const original = messages.find((m) => m.id === target)?.body ?? "";
    setMessages((current) =>
      current.map((m) => (m.id === target ? { ...m, body: text, editedAt: new Date().toISOString() } : m)),
    );
    setEditing(null);
    setEditDraft("");

    try {
      const res = await fetch(`/api/community/messages/${target}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: text }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Could not save that edit");
    } catch (editError) {
      setMessages((current) => current.map((m) => (m.id === target ? { ...m, body: original } : m)));
      setError(editError instanceof Error ? editError.message : "Could not save that edit");
    }
  }, [editing, editDraft, messages]);

  const remove = useCallback(async (message: ChatMessage) => {
    if (!confirm(message.mine ? "Delete your message?" : "Remove this message for everyone?")) return;
    const res = await fetch(`/api/community/messages/${message.id}`, { method: "DELETE" });
    if (res.ok) {
      setMessages((current) =>
        current.map((m) =>
          m.id === message.id
            ? { ...m, hidden: true, body: isStaff ? m.body : "", hiddenReason: "Removed" }
            : m,
        ),
      );
    }
  }, [isStaff]);

  /** Hold a message at the top of the room, or let it go again. */
  const togglePin = useCallback(async (message: ChatMessage) => {
    const next = !message.pinned;
    setMessages((current) => current.map((m) => (m.id === message.id ? { ...m, pinned: next } : m)));
    const res = await fetch("/api/community/moderate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: next ? "pin" : "unpin", messageId: message.id }),
    }).catch(() => null);
    if (!res?.ok) {
      setMessages((current) => current.map((m) => (m.id === message.id ? { ...m, pinned: !next } : m)));
      setError("Could not change the pin.");
    }
  }, []);

  /**
   * Stop somebody posting for a while.
   *
   * Confirmed, and the duration is asked for rather than assumed — a mute is
   * the one action here that a student feels as a punishment, so it should
   * take a moment of deliberation rather than a stray tap on a phone.
   */
  const muteAuthor = useCallback(async (message: ChatMessage) => {
    const choice = prompt(
      `Mute ${message.author.name}? Type 1h, 24h or 7d.\n\nThey can still read the room and get announcements — they just cannot post.`,
      "24h",
    );
    if (!choice) return;
    const duration = choice.trim().toLowerCase();

    const reason = prompt("Reason (shown to them, optional):", "") ?? "";

    const res = await fetch("/api/community/moderate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "mute", userId: message.author.id, duration, reason }),
    }).catch(() => null);

    const data = await res?.json().catch(() => ({}));
    if (!res?.ok) {
      setError(data?.error || "Could not mute that member.");
      return;
    }
    setError(`${message.author.name} is muted until ${new Date(data.mutedUntil).toLocaleString("en-GB")}.`);
  }, []);

  /**
   * Reacting, drawn before the server is asked.
   *
   * A reaction has to feel like the tap caused it, which means the pill moves
   * on the same frame — anything else reads as lag on a phone. The server is
   * the authority on the final count, so its answer replaces the guess when it
   * lands; a failure puts the guess back rather than leaving a pill that says
   * something the database does not.
   */
  const toggleReaction = useCallback(async (messageId: string, emoji: string) => {
    setReactingTo(null);

    const guess = (list: ReactionSummary[] = []): ReactionSummary[] => {
      const existing = list.find((r) => r.emoji === emoji);
      if (!existing) return [...list, { emoji, count: 1, mine: true }];
      if (existing.mine) {
        // Taking mine back: drop the pill entirely if I was the only one.
        return existing.count <= 1
          ? list.filter((r) => r.emoji !== emoji)
          : list.map((r) => (r.emoji === emoji ? { ...r, count: r.count - 1, mine: false } : r));
      }
      return list.map((r) => (r.emoji === emoji ? { ...r, count: r.count + 1, mine: true } : r));
    };

    let before: ReactionSummary[] = [];
    setMessages((current) =>
      current.map((m) => {
        if (m.id !== messageId) return m;
        before = m.reactions ?? [];
        return { ...m, reactions: guess(m.reactions) };
      }),
    );

    try {
      const res = await fetch("/api/community/reactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId, emoji }),
      });
      if (!res.ok) throw new Error("rejected");
      const data = await res.json();
      setMessages((current) =>
        current.map((m) => (m.id === messageId ? { ...m, reactions: data.reactions ?? [] } : m)),
      );
    } catch {
      setMessages((current) =>
        current.map((m) => (m.id === messageId ? { ...m, reactions: before } : m)),
      );
    }
  }, []);

  /* ----------------------------------------------------------------- view */

  if (error && !spaces.length) {
    return (
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-8 text-center">
        <CommunityIcon className="mx-auto h-8 w-8 text-[var(--muted)]" />
        <p className="mt-3 text-sm font-semibold text-[var(--foreground)]">{error}</p>
      </div>
    );
  }

  if (!spaces.length) {
    return (
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-8 text-center">
        <CommunityIcon className="mx-auto h-8 w-8 text-[var(--muted)]" />
        <p className="mt-3 text-sm font-semibold text-[var(--foreground)]">Your class group is being set up</p>
        <p className="mx-auto mt-1.5 max-w-sm text-sm text-[var(--muted)]">
          Once the office has confirmed your branch, level and class time, your group opens here automatically.
        </p>
      </div>
    );
  }

  return (
    <div
      className={`flex overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] ${
        compact ? "h-[30rem]" : "h-[calc(100vh-16rem)] min-h-[32rem]"
      }`}
    >
      {/* ------------------------------------------------------- channel rail */}
      <aside
        className={`${
          showRail ? "flex" : "hidden"
        } w-full shrink-0 flex-col border-r border-[var(--border)] bg-[var(--surface-alt)] sm:flex sm:w-64`}
      >
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {spaces.map((space) => (
            <div key={space.id} className="mb-3">
              <div className="px-2 py-1.5">
                <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-[var(--muted)]">
                  <BranchIcon className="h-3 w-3" />
                  {space.branch?.name}
                </p>
                {/*
                  The sitting is on the label, not implied. Three A1 rooms that
                  differ only in the time of day are indistinguishable without
                  it — which is the confusion this whole change exists to end.
                */}
                <p className="mt-0.5 text-sm font-semibold text-[var(--foreground)]">
                  {space.level} · {SLOT_LABEL[space.sessionSlot] ?? space.sessionSlot}
                </p>
              </div>

              {space.channels.map((channel) => {
                const selected = channel.id === activeId;
                return (
                  <button
                    key={channel.id}
                    onClick={() => {
                      setActiveId(channel.id);
                      // Picking a room takes you INTO it on a narrow screen.
                      // This used to fire only in the compact embed, so on the
                      // full page a phone tapped a channel and stayed staring
                      // at the list.
                      setShowRail(false);
                    }}
                    className={`flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-sm transition ${
                      selected
                        ? "bg-[var(--accent)] font-semibold text-white"
                        : "text-[var(--foreground)] hover:bg-[var(--surface)]"
                    }`}
                  >
                    <span className={selected ? "text-white/70" : "text-[var(--muted)]"}>#</span>
                    <span className="min-w-0 flex-1 truncate">{channel.name}</span>
                    {channel.unreadCount > 0 && !selected ? (
                      <span className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-[var(--accent)] px-1 text-[10px] font-bold text-white">
                        {channel.unreadCount > 99 ? "99+" : channel.unreadCount}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        <button
          onClick={push.enabled ? push.disable : push.enable}
          disabled={!push.supported || push.busy}
          className="m-2 flex items-center justify-center gap-2 rounded-xl border border-[var(--border)] px-3 py-2 text-xs font-semibold text-[var(--foreground)] transition hover:bg-[var(--surface)] disabled:opacity-40"
        >
          {push.enabled ? <BellOffIcon className="h-3.5 w-3.5" /> : <BellIcon className="h-3.5 w-3.5" />}
          {push.enabled ? "Mute this device" : "Notify me on this device"}
        </button>
      </aside>

      {/* -------------------------------------------------------------- room
          ONE PANE AT A TIME BELOW `sm`, both from `sm` up.

          This condition used to be `showRail && compact`, which meant the
          swap only happened in the compact embed. On the full page at phone
          width the rail rendered `flex w-full` AND the room rendered `flex`
          beside it, so the list ate the entire viewport and the conversation
          was pushed off the right-hand edge — the chat was unreachable on a
          phone, which is where most of this school reads it.
      */}
      <section className={`${showRail ? "hidden" : "flex"} min-w-0 flex-1 flex-col sm:flex`}>
        <header className="flex items-center gap-2 border-b border-[var(--border)] px-4 py-3">
          <button
            onClick={() => setShowRail(true)}
            aria-label="All channels"
            className="rounded-lg p-1.5 text-[var(--muted)] transition hover:bg-[var(--surface-alt)] sm:hidden"
          >
            <ArrowLeftIcon className="h-4 w-4" />
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-[var(--foreground)]">
              # {active?.name ?? "Community"}
            </p>
            <p className="truncate text-xs text-[var(--muted)]">
              {activeSpace
                ? `${activeSpace.branch?.name} · ${activeSpace.level} · ${
                    SLOT_LABEL[activeSpace.sessionSlot] ?? activeSpace.sessionSlot
                  }`
                : active?.description}
            </p>
          </div>
        </header>

        <div ref={scrollRef} className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 py-4">
          {hasMore ? (
            <div className="pb-2 text-center">
              <button
                onClick={loadOlder}
                disabled={loadingOlder}
                className="rounded-full border border-[var(--border)] px-4 py-1.5 text-xs font-semibold text-[var(--muted)] transition hover:bg-[var(--surface-alt)] disabled:opacity-40"
              >
                {loadingOlder ? "Loading…" : "Load earlier messages"}
              </button>
            </div>
          ) : null}

          {loadingRoom ? (
            <p className="py-10 text-center text-sm text-[var(--muted)]">Opening the room…</p>
          ) : messages.length === 0 ? (
            <div className="py-12 text-center">
              <CommunityIcon className="mx-auto h-8 w-8 text-[var(--muted)]" />
              <p className="mt-3 text-sm font-semibold text-[var(--foreground)]">No messages yet</p>
              <p className="mt-1 text-sm text-[var(--muted)]">
                {canPost ? "Say hallo — be the first one in." : "Your tutor will post class news here."}
              </p>
            </div>
          ) : (
            messages.map((message, index) => {
              const previous = messages[index - 1];
              const newDay = !previous || dayLabel(previous.createdAt) !== dayLabel(message.createdAt);
              /**
               * Consecutive messages from one person lose the repeated name and
               * avatar. It is what turns a list of records into a conversation,
               * and it buys back a lot of vertical space on a phone.
               */
              const grouped =
                !newDay &&
                previous?.author.id === message.author.id &&
                new Date(message.createdAt).getTime() - new Date(previous.createdAt).getTime() < 5 * 60_000;

              return (
                <div key={message.id}>
                  {newDay ? (
                    <div className="my-4 flex items-center gap-3">
                      <span className="h-px flex-1 bg-[var(--border)]" />
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">
                        {dayLabel(message.createdAt)}
                      </span>
                      <span className="h-px flex-1 bg-[var(--border)]" />
                    </div>
                  ) : null}

                  <div className={`group flex gap-2 ${message.mine ? "flex-row-reverse" : ""}`}>
                    {!message.mine ? (
                      <div className="w-8 shrink-0">
                        {!grouped ? (
                          <span className="grid h-8 w-8 place-items-center rounded-full bg-[var(--accent-soft)] text-[11px] font-bold text-[var(--accent)]">
                            {initials(message.author.name)}
                          </span>
                        ) : null}
                      </div>
                    ) : null}

                    <div className={`max-w-[78%] min-w-0 ${message.mine ? "items-end" : ""}`}>
                      {!grouped && !message.mine ? (
                        <p className="mb-0.5 flex items-center gap-1.5 text-xs font-semibold">
                          <span className={colourFor(message.author.id)}>{message.author.name}</span>
                          {message.author.role === "lecturer" || message.author.role === "admin" ? (
                            <span className="rounded-full bg-[var(--accent)] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white">
                              {message.author.role === "admin" ? "Office" : "Tutor"}
                            </span>
                          ) : null}
                        </p>
                      ) : null}

                      {(() => {
                        /*
                          A sticker floats; it does not sit on a coloured
                          bubble. Painting the accent behind it would put a
                          pale illustration on an orange slab and lose the
                          edges of the artwork — every messaging app draws
                          stickers bare for the same reason.
                        */
                        const isSticker = Boolean(message.stickerId && stickerById(message.stickerId));
                        return (
                      <div
                        className={`text-sm leading-6 ${
                          isSticker && !message.hidden
                            ? "bg-transparent p-0"
                            : `rounded-2xl px-3 py-2 ${
                                message.hidden
                                  ? "border border-dashed border-[var(--border)] bg-transparent italic text-[var(--muted)]"
                                  : message.mine
                                    ? "bg-[var(--accent)] text-white"
                                    : "bg-[var(--surface-alt)] text-[var(--foreground)]"
                              }`
                        } ${message.failed ? "ring-1 ring-rose-400" : ""} ${message.pending ? "opacity-60" : ""}`}
                      >
                        {message.replyTo ? (
                          <div
                            className={`mb-1.5 rounded-lg border-l-2 px-2 py-1 text-xs ${
                              message.mine
                                ? "border-white/60 bg-white/15 text-white/85"
                                : "border-[var(--accent)] bg-[var(--surface)] text-[var(--muted)]"
                            }`}
                          >
                            <p className="font-semibold">{message.replyTo.author}</p>
                            <p className="truncate">
                              {message.replyTo.hidden ? "Message removed" : message.replyTo.body}
                            </p>
                          </div>
                        ) : null}

                        {message.hidden ? (
                          <p>{message.hiddenReason || "This message was removed"}</p>
                        ) : editing === message.id ? (
                          /*
                            The correction happens in place, inside the bubble
                            it belongs to. Moving the text down to the composer
                            would put it a long way from the thing being fixed
                            and leave the reader unsure which message they were
                            editing once two look alike.
                          */
                          <div className="space-y-1.5">
                            <textarea
                              autoFocus
                              value={editDraft}
                              onChange={(event) => setEditDraft(event.target.value)}
                              onKeyDown={(event) => {
                                if (event.key === "Escape") setEditing(null);
                                if (event.key === "Enter" && !event.shiftKey) {
                                  event.preventDefault();
                                  void saveEdit();
                                }
                              }}
                              rows={2}
                              className="w-full resize-none rounded-lg bg-black/20 px-2 py-1.5 text-sm text-inherit outline-none ring-1 ring-white/30"
                            />
                            <div className="flex gap-2 text-[11px] font-semibold">
                              <button onClick={() => void saveEdit()} className="underline">Save</button>
                              <button onClick={() => setEditing(null)} className="opacity-70">Cancel</button>
                            </div>
                          </div>
                        ) : message.stickerId && stickerById(message.stickerId) ? (
                          /*
                            A sticker fills the bubble instead of sitting in it.
                            An unknown id — one retired from the set — falls
                            through to the text branch and renders whatever body
                            there was, rather than leaving a torn tile behind.
                          */
                          <StickerArt sticker={stickerById(message.stickerId)!} size={116} />
                        ) : (
                          <p className="whitespace-pre-wrap break-words">{message.body}</p>
                        )}

                        {message.attachment ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={message.attachment.url}
                            alt={message.attachment.name ?? "Attachment"}
                            className="mt-2 max-h-64 rounded-xl object-cover"
                          />
                        ) : null}

                        <p
                          className={`mt-1 text-[10px] ${
                            message.mine && !message.hidden ? "text-white/70" : "text-[var(--muted)]"
                          }`}
                        >
                          {timeOf(message.createdAt)}
                          {message.editedAt ? " · edited" : ""}
                          {message.pending ? " · sending…" : ""}
                          {message.failed ? " · not sent" : ""}
                        </p>
                      </div>
                        );
                      })()}

                      {/*
                        REACTIONS, under the bubble they belong to.

                        Always rendered when there are any — a reaction that
                        only appears on hover is invisible to the half of this
                        school reading on a phone, which is the half that
                        reacts. A pill the reader is part of is filled rather
                        than outlined, so "did I already react" is answerable
                        without counting.
                      */}
                      {message.reactions && message.reactions.length > 0 ? (
                        <div className={`mt-1 flex flex-wrap gap-1 ${message.mine ? "justify-end" : ""}`}>
                          {message.reactions.map((reaction) => (
                            <button
                              key={reaction.emoji}
                              onClick={() => void toggleReaction(message.id, reaction.emoji)}
                              aria-pressed={reaction.mine}
                              aria-label={`${reaction.emoji} ${reaction.count}${reaction.mine ? ", including you" : ""}`}
                              className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition active:scale-95 ${
                                reaction.mine
                                  ? "border-[var(--accent)] bg-[var(--accent)]/15 font-semibold text-[var(--accent)]"
                                  : "border-[var(--border)] bg-[var(--surface)] text-[var(--muted)] hover:border-[var(--accent)]"
                              }`}
                            >
                              <span className="text-sm leading-none">{reaction.emoji}</span>
                              <span className="tabular-nums">{reaction.count}</span>
                            </button>
                          ))}
                        </div>
                      ) : null}

                      {/* The picker, open for one message at a time. */}
                      {reactingTo === message.id ? (
                        <div className={`mt-1 flex flex-wrap gap-1 ${message.mine ? "justify-end" : ""}`}>
                          {ALLOWED_REACTIONS.map((emoji) => (
                            <button
                              key={emoji}
                              onClick={() => void toggleReaction(message.id, emoji)}
                              aria-label={`React with ${emoji}`}
                              className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-base leading-none shadow-sm transition hover:scale-110 active:scale-95"
                            >
                              {emoji}
                            </button>
                          ))}
                        </div>
                      ) : null}

                      {!message.hidden && !message.pending ? (
                        /*
                          VISIBLE ON TOUCH, revealed on hover only where hover
                          exists. `opacity-0 group-hover:opacity-100` alone
                          meant Reply, Edit and Delete could not be reached at
                          all on a phone — there is no hover to trigger them —
                          so the actions were desktop-only by accident.
                        */
                        <div
                          className={`mt-0.5 flex gap-2 opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100 ${
                            reactingTo === message.id ? "sm:opacity-100" : ""
                          } ${message.mine ? "justify-end" : ""}`}
                        >
                          <button
                            onClick={() => setReactingTo((current) => (current === message.id ? null : message.id))}
                            aria-expanded={reactingTo === message.id}
                            className="text-[11px] font-semibold text-[var(--muted)] hover:text-[var(--accent)]"
                          >
                            React
                          </button>
                          <button
                            onClick={() => {
                              setReplyTo(message);
                              composerRef.current?.focus();
                            }}
                            className="text-[11px] font-semibold text-[var(--muted)] hover:text-[var(--accent)]"
                          >
                            Reply
                          </button>
                          {/*
                            Only the author, and never staff. A moderator who
                            could rewrite a student's words would make every
                            transcript here worthless at the exact moment one
                            matters — so removal is the only power staff get.
                          */}
                          {message.mine ? (
                            <button
                              onClick={() => {
                                setEditing(message.id);
                                setEditDraft(message.body);
                              }}
                              className="text-[11px] font-semibold text-[var(--muted)] hover:text-[var(--accent)]"
                            >
                              Edit
                            </button>
                          ) : null}
                          {message.mine || isStaff ? (
                            <button
                              onClick={() => void remove(message)}
                              className="text-[11px] font-semibold text-[var(--muted)] hover:text-rose-500"
                            >
                              {message.mine ? "Delete" : "Remove"}
                            </button>
                          ) : null}
                          {/*
                            Staff only, and separate from removal on purpose:
                            one takes a message away, the other holds it up.
                          */}
                          {isStaff ? (
                            <button
                              onClick={() => void togglePin(message)}
                              className="text-[11px] font-semibold text-[var(--muted)] hover:text-[var(--accent)]"
                            >
                              {message.pinned ? "Unpin" : "Pin"}
                            </button>
                          ) : null}
                          {isStaff && !message.mine ? (
                            <button
                              onClick={() => void muteAuthor(message)}
                              className="text-[11px] font-semibold text-[var(--muted)] hover:text-amber-600"
                            >
                              Mute
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })
          )}
          <div ref={bottomRef} />
        </div>

        {/* ------------------------------------------------------- composer */}
        {canPost ? (
          <div className="border-t border-[var(--border)] p-3">
            {replyTo ? (
              <div className="mb-2 flex items-start gap-2 rounded-xl border-l-2 border-[var(--accent)] bg-[var(--surface-alt)] px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-[var(--accent)]">Replying to {replyTo.author.name}</p>
                  <p className="truncate text-xs text-[var(--muted)]">{replyTo.body}</p>
                </div>
                <button
                  onClick={() => setReplyTo(null)}
                  aria-label="Cancel reply"
                  className="shrink-0 text-sm text-[var(--muted)] hover:text-[var(--foreground)]"
                >
                  ✕
                </button>
              </div>
            ) : null}

            {/*
              The picture is shown BEFORE it is sent, with a way to take it off
              again. A student photographing homework on a phone gets the wrong
              shot often enough that committing on selection would be cruel.
            */}
            {attachment ? (
              <div className="mb-2 flex items-center gap-3 rounded-xl bg-[var(--surface-alt)] p-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={attachment.url} alt="" className="h-14 w-14 shrink-0 rounded-lg object-cover" />
                <p className="min-w-0 flex-1 truncate text-xs text-[var(--muted)]">
                  {attachment.name ?? "Picture"} · ready to send
                </p>
                <button
                  onClick={() => setAttachment(null)}
                  aria-label="Remove picture"
                  className="shrink-0 rounded-lg px-2 py-1 text-sm text-[var(--muted)] hover:text-[var(--foreground)]"
                >
                  ✕
                </button>
              </div>
            ) : null}

            {error ? (
              <p className="mb-2 flex items-center gap-2 text-xs text-rose-500">
                {error}
                <button onClick={() => setError(null)} className="underline">dismiss</button>
              </p>
            ) : null}

            {/*
              THE STICKER TRAY.

              Sits above the composer rather than in a popover, because on a
              phone a popover anchored to a button next to the keyboard is
              either under the thumb or off the screen. A horizontal scroller
              is the shape every messaging app already uses here, and it needs
              no positioning logic to survive a keyboard opening.
            */}
            {stickerTrayOpen ? (
              <div className="mb-2 rounded-2xl bg-[var(--surface-alt)] p-2">
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {STICKERS.map((sticker) => (
                    <button
                      key={sticker.id}
                      onClick={() => void send(sticker.id)}
                      title={sticker.meaning}
                      className="shrink-0 rounded-2xl transition hover:scale-105 active:scale-95"
                    >
                      <StickerArt sticker={sticker} size={72} />
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="flex items-end gap-2">
              {/*
                `capture` is deliberately absent. On a phone this offers both the
                camera and the gallery; forcing the camera would block the very
                common case of sending a photo taken five minutes earlier.
              */}
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  // Reset first, so picking the same file twice still fires.
                  event.target.value = "";
                  if (file) void attach(file);
                }}
              />
              <button
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                aria-label="Attach a picture"
                title="Attach a picture"
                className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-[var(--muted)] transition hover:bg-[var(--surface-alt)] hover:text-[var(--accent)] disabled:opacity-40"
              >
                <ImageIcon className="h-5 w-5" />
              </button>
              <button
                onClick={() => setStickerTrayOpen((open) => !open)}
                aria-label="Send a sticker"
                aria-expanded={stickerTrayOpen}
                title="Send a sticker"
                className={`grid h-10 w-10 shrink-0 place-items-center rounded-full text-lg transition hover:bg-[var(--surface-alt)] ${
                  stickerTrayOpen ? "bg-[var(--surface-alt)] text-[var(--accent)]" : "text-[var(--muted)]"
                }`}
              >
                <StickerGlyph className="h-5 w-5" />
              </button>
              <textarea
                ref={composerRef}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  // Enter sends, Shift+Enter breaks the line — the convention
                  // everybody already has in their fingers. Not on a phone,
                  // where Enter is the only way to get a new line at all.
                  if (event.key === "Enter" && !event.shiftKey && window.innerWidth >= 640) {
                    event.preventDefault();
                    void send();
                  }
                }}
                rows={1}
                placeholder={uploading ? "Uploading your picture…" : `Message #${active?.name ?? ""}`}
                className="max-h-32 min-h-[2.5rem] flex-1 resize-none rounded-2xl border border-[var(--border)] bg-[var(--surface-alt)] px-4 py-2.5 text-sm text-[var(--foreground)] outline-none transition focus:border-[var(--accent)]"
              />
              <button
                onClick={() => void send()}
                // A picture with no caption is a perfectly good message, so the
                // button lives off either one. It stays down while the upload
                // is in flight, because sending then would post the caption
                // without the photograph it was written about.
                disabled={uploading || (!draft.trim() && !attachment)}
                aria-label="Send"
                className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[var(--accent)] text-white transition hover:brightness-110 disabled:opacity-30"
              >
                <SendIcon className="h-4 w-4" />
              </button>
            </div>
          </div>
        ) : (
          <p className="border-t border-[var(--border)] px-4 py-3 text-center text-xs text-[var(--muted)]">
            Only your tutor and the branch office post in this channel.
          </p>
        )}
      </section>
    </div>
  );
}
