"use client";

/**
 * "NEED HELP?" — the question mark in the corner of the portal.
 *
 * ---------------------------------------------------------------------------
 * WHY A PANEL AND NOT A PAGE
 * ---------------------------------------------------------------------------
 * The moment a student needs help is the moment they are already stuck on some
 * other page, and sending them to /support means losing the thing they were
 * looking at — which is invariably the thing they wanted to describe. So the
 * panel opens over whatever they were doing, and the page they were on is
 * captured automatically and sent with the ticket. Half of all support messages
 * are a version of "this is not working" and the single most useful fact, which
 * page, is the one a frustrated person never thinks to include.
 *
 * ---------------------------------------------------------------------------
 * WHY IT IS A CHAT, AND FULL-SCREEN ON A PHONE
 * ---------------------------------------------------------------------------
 * Most of this school reads on a phone, where a 22rem floating card is a cramped
 * window onto a conversation. Below `sm` the panel is the whole screen, with a
 * back arrow and a keyboard-friendly bar at the bottom, exactly like the support
 * chats students already use in shopping and banking apps. On a desktop it stays
 * a floating card. The thread uses the shared chat kit (components/support/
 * ChatKit.tsx), and both sides see live typing — see lib/typing.ts.
 *
 * ---------------------------------------------------------------------------
 * WHY THE BADGE IS ON THE BUTTON
 * ---------------------------------------------------------------------------
 * An answer nobody reads is the same as no answer. The bell already carries the
 * notification, but a student who asked a question comes back looking for the
 * place they asked it — so the reply is also flagged where the question was
 * typed, and when the office starts typing the button itself shows the dots.
 */

import { AnimatePresence, motion } from "framer-motion";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircleIcon, CrossIcon, HelpIcon, SendIcon, ChevronRightIcon } from "@/components/icons";
import {
  TICKET_TOPICS,
  TICKET_TOPIC_LABELS,
  type TicketAttachment,
  type TicketTopic,
} from "@/lib/support-copy";
import { AttachmentPicker, MessageAttachments } from "@/components/support/TicketAttachments";
import {
  ChatBubbleRow,
  ChatComposer,
  ChatHeader,
  ChatNotice,
  ChatScroller,
  ChatStamp,
  ChatTypingRow,
  OfficialPill,
  SupportAvatar,
  needsStamp,
  stampLabel,
} from "@/components/support/ChatKit";
import { TypingDots } from "@/components/typing/TypingUI";
import { useTicketLive, useTicketTypingMap } from "@/lib/client/use-ticket-live";
import { useTypingSender } from "@/lib/client/use-typing-sender";
import { describeTypers } from "@/lib/typing";

type TicketSummary = {
  id: string;
  subject: string;
  topic: string;
  status: string;
  unread: boolean;
  messageCount: number;
  lastMessageAt: string;
};

type ThreadMessage = {
  id: string;
  body: string;
  authorRole: string;
  authorName: string | null;
  mine: boolean;
  createdAt: string;
  edited?: boolean;
  attachments?: TicketAttachment[];
};

const POLL_MS = 90_000;

const STATUS_COPY: Record<string, { label: string; className: string }> = {
  open: { label: "Waiting on the office", className: "text-amber-600" },
  pending: { label: "Answered", className: "text-emerald-600" },
  resolved: { label: "Resolved", className: "text-[var(--muted)]" },
};

function timeAgo(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

/** Same rule as the office's queue: only a real person's name goes on the bubble. */
function firstNameOf(name: string | null | undefined, fallback: string) {
  return (name ?? "").trim().split(/\s+/)[0] || fallback;
}

export default function HelpLauncher() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [tickets, setTickets] = useState<TicketSummary[]>([]);
  const [unread, setUnread] = useState(0);
  const [view, setView] = useState<"list" | "new" | "thread">("list");
  const [threadId, setThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [threadSubject, setThreadSubject] = useState("");
  const [threadTopic, setThreadTopic] = useState("other");
  const [threadStatus, setThreadStatus] = useState("open");
  const [threadLoaded, setThreadLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const [subject, setSubject] = useState("");
  const [topic, setTopic] = useState<TicketTopic>("classes");
  const [body, setBody] = useState("");
  const [newFiles, setNewFiles] = useState<TicketAttachment[]>([]);
  const [reply, setReply] = useState("");
  const [replyFiles, setReplyFiles] = useState<TicketAttachment[]>([]);

  const loadTickets = useCallback(async () => {
    try {
      const res = await fetch("/api/support/tickets", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setTickets(data.tickets ?? []);
      setUnread(data.unread ?? 0);
    } catch {
      // A help button that throws is worse than one that quietly shows no
      // badge. The panel still opens and a new question still sends.
    }
  }, []);

  useEffect(() => {
    loadTickets();
    const timer = window.setInterval(loadTickets, POLL_MS);
    // Coming back to the tab is the moment a stale badge is most obvious —
    // refresh straight away rather than on the next 90-second tick.
    const onVisible = () => {
      if (document.visibilityState === "visible") void loadTickets();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [loadTickets]);

  /**
   * Who on the office's side is typing in any of my enquiries. Runs only while I
   * have an unresolved question (otherwise there is nothing to type into) — it
   * drives the dots on the Help button and on the rows of the list.
   */
  const hasLiveTicket = useMemo(() => tickets.some((t) => t.status !== "resolved"), [tickets]);
  const typingByTicket = useTicketTypingMap(hasLiveTicket);
  const anyoneTyping = Object.keys(typingByTicket).length > 0;

  /** Fetch the open thread and fold it into state without touching the reply box. */
  const refreshThread = useCallback(async (id: string) => {
    const res = await fetch(`/api/support/tickets/${id}`, { cache: "no-store" });
    if (!res.ok) return null;
    const data = await res.json();
    const fresh: ThreadMessage[] = data.messages ?? [];
    setMessages((current) =>
      current.length === fresh.length &&
      current[current.length - 1]?.id === fresh[fresh.length - 1]?.id &&
      current.every((m, i) => m.body === fresh[i]?.body)
        ? current
        : fresh,
    );
    if (data.status) setThreadStatus(data.status);
    if (data.topic) setThreadTopic(data.topic);
    setThreadLoaded(true);
    return data;
  }, []);

  /**
   * While a conversation is open: a tiny poll every 3s says who is typing and
   * whether anything new arrived, and only a change refetches the thread — so an
   * office reply lands within seconds, not the next 15s tick, at a fraction of
   * the cost. See lib/client/use-ticket-live.ts.
   */
  const live = useTicketLive({
    ticketId: open && view === "thread" ? threadId : null,
    known: threadLoaded ? { count: messages.length, status: threadStatus } : null,
    onStale: () => (threadId ? refreshThread(threadId) : undefined),
  });

  const { onDraftChange: onTypingDraftChange, stop: stopTyping } = useTypingSender(
    open && view === "thread" ? threadId : null,
    (typing) =>
      fetch("/api/support/typing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticketId: threadId, typing }),
        keepalive: true,
      }),
  );

  const openThread = useCallback(
    async (id: string, subjectLine: string) => {
      setThreadId(id);
      setThreadSubject(subjectLine);
      setView("thread");
      setMessages([]);
      setThreadLoaded(false);
      setReply("");
      setReplyFiles([]);
      try {
        const data = await refreshThread(id);
        if (!data) return;
        if (data.subject) setThreadSubject(data.subject);
        // Opening it is reading it, and the server has just said so. Reflect it
        // here rather than waiting ninety seconds for the poll to agree.
        setTickets((current) => current.map((t) => (t.id === id ? { ...t, unread: false } : t)));
        setUnread((n) => Math.max(0, n - 1));
      } catch {
        setError("Could not open that conversation.");
      }
    },
    [refreshThread],
  );

  /**
   * `?help=<id>` — where the office's reply notification lands.
   *
   * Read off `window.location` rather than through `useSearchParams`, which
   * would opt every page rendering this shell into client-side rendering and
   * demand a Suspense boundary around the whole portal for a query parameter
   * used once. Declared AFTER `openThread` deliberately: a dependency array is
   * evaluated during render, so an effect placed above it would read a `const`
   * that does not exist yet and throw on first paint.
   */
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("help");
    if (!id) return;
    setOpen(true);
    void openThread(id, "Your question");
  }, [openThread]);

  /**
   * `easyway:open-help` — anything in the portal can throw this to bring up a
   * fresh support message. The photo-unlock guide uses it as its one non-photo
   * way out for a student whose upload keeps failing.
   */
  useEffect(() => {
    const onOpen = () => {
      setOpen(true);
      setView("new");
    };
    window.addEventListener("easyway:open-help", onOpen);
    return () => window.removeEventListener("easyway:open-help", onOpen);
  }, []);

  // A full-screen sheet on a phone must not let the page behind it scroll.
  useEffect(() => {
    if (!open || window.innerWidth >= 640) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  async function submitNew() {
    if (!subject.trim() || (!body.trim() && newFiles.length === 0)) {
      setError("A subject and a description — or a screenshot — and the office can help.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/support/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject, topic, body, fromPath: pathname, attachments: newFiles }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Could not send that.");
        return;
      }
      setSubject("");
      setBody("");
      setNewFiles([]);
      setSent(true);
      await loadTickets();
      setView("list");
      window.setTimeout(() => setSent(false), 6000);
    } finally {
      setBusy(false);
    }
  }

  async function submitReply() {
    if ((!reply.trim() && replyFiles.length === 0) || !threadId) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/support/tickets/${threadId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: reply, attachments: replyFiles }),
      });
      if (res.ok) {
        setReply("");
        setReplyFiles([]);
        stopTyping();
        await refreshThread(threadId);
        await loadTickets();
      }
    } finally {
      setBusy(false);
    }
  }

  /** "Sorted itself out" — the student can close their own thread. */
  async function resolveThread() {
    if (!threadId) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/support/tickets/${threadId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "resolve" }),
      });
      if (res.ok) {
        setThreadStatus("resolved");
        await loadTickets();
      }
    } finally {
      setBusy(false);
    }
  }

  const officeName = useMemo(() => {
    const lastStaff = [...messages].reverse().find((m) => !m.mine);
    if (threadTopic === "tutor") return firstNameOf(lastStaff?.authorName, "Your tutor");
    return firstNameOf(lastStaff?.authorName, "EasyWay Support");
  }, [messages, threadTopic]);

  const headerTitle =
    view === "new" ? "Ask the office" : view === "thread" ? officeName : "Need help?";

  return (
    <>
      {/*
        Bottom RIGHT. The community launcher owns bottom-right on the student
        portal already — so this sits above it rather than beside it. It is a
        LABELLED PILL, not a matching circle: a lone "?" was read by too few
        people as "get help", and a pill that says so in words cannot be
        mistaken for the round "chat to your class" button next to it.
        While the office is typing back it turns into the dots, which is the
        whole point of a typing indicator: a reason to come and look.
      */}
      <button
        onClick={() => setOpen((value) => !value)}
        aria-label={open ? "Close help" : anyoneTyping ? "The office is typing a reply" : "Need help?"}
        title="Need help?"
        className={`fixed bottom-40 right-4 z-40 inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-sm font-semibold text-[var(--foreground-soft)] shadow-[var(--shadow)] transition hover:text-[var(--accent)] sm:bottom-6 sm:right-24 ${
          open ? "max-sm:hidden" : ""
        }`}
      >
        {open ? <CrossIcon className="h-4 w-4" /> : <HelpIcon className="h-4 w-4" />}
        {!open && anyoneTyping ? (
          <span className="inline-flex items-center gap-2 text-[var(--accent)]">
            Office is typing <TypingDots />
          </span>
        ) : (
          <span>{open ? "Close" : "Need help?"}</span>
        )}
        {!open && unread > 0 ? (
          // A counted pill, not a bare dot: "1" is a message the student can
          // read from across the screen; a 2px dot is one they have to already
          // suspect is there.
          <span className="absolute -right-1.5 -top-1.5 flex h-[1.15rem] min-w-[1.15rem] items-center justify-center">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--accent)] opacity-60" />
            <span className="relative inline-flex h-full min-w-[1.15rem] items-center justify-center rounded-full bg-[var(--accent)] px-1 text-[10px] font-bold leading-none text-white ring-2 ring-[var(--surface)]">
              {unread > 9 ? "9+" : unread}
            </span>
          </span>
        ) : null}
      </button>

      <AnimatePresence>
        {open ? (
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 24 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            // Whole screen below `sm` (100dvh, so the mobile URL bar never hides
            // the composer); a floating card from `sm` up.
            className="fixed inset-0 z-[65] flex h-[100dvh] flex-col overflow-hidden bg-[var(--surface)] sm:inset-auto sm:bottom-20 sm:right-24 sm:z-40 sm:h-[34rem] sm:max-h-[75vh] sm:w-[24rem] sm:rounded-3xl sm:border sm:border-[var(--border)] sm:shadow-[0_24px_60px_rgba(15,23,42,0.18)]"
          >
            <ChatHeader
              fullScreen
              onBack={view !== "list" ? () => setView("list") : () => setOpen(false)}
              title={headerTitle}
              subtitle={
                view === "thread" ? (
                  <OfficialPill label={threadTopic === "tutor" ? "Your tutor" : "Official support"} />
                ) : view === "list" ? (
                  <span className="text-[11px] text-[var(--muted)]">A real person reads every message</span>
                ) : null
              }
              right={
                view === "thread" ? (
                  threadStatus !== "resolved" ? (
                    <button
                      onClick={resolveThread}
                      disabled={busy}
                      className="rounded-full px-2.5 py-1.5 text-xs font-semibold text-[var(--accent)] transition hover:bg-[var(--accent-soft)] disabled:opacity-50"
                    >
                      Resolved?
                    </button>
                  ) : null
                ) : (
                  <button
                    onClick={() => setOpen(false)}
                    aria-label="Close"
                    className="grid h-10 w-10 place-items-center rounded-full text-[var(--muted)] transition hover:bg-[var(--surface-alt)] hover:text-[var(--foreground)]"
                  >
                    <CrossIcon className="h-5 w-5" />
                  </button>
                )
              }
            />

            {view === "list" ? (
              <div className="min-h-0 flex-1 overflow-y-auto bg-[var(--surface-alt)] px-3 py-4">
                {sent ? (
                  <div className="mb-3 flex items-start gap-2 rounded-2xl bg-emerald-500/10 px-3 py-2.5 text-xs leading-5 text-emerald-700">
                    <CheckCircleIcon className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>
                      Sent. The office sees it now — you will get a notification here and on your phone when
                      they answer.
                    </span>
                  </div>
                ) : null}

                <p className="px-1 text-xs leading-5 text-[var(--muted)]">
                  Anything at all — your classes, a payment, something on the site that will not work.
                </p>

                <button
                  onClick={() => {
                    setView("new");
                    setError(null);
                  }}
                  className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl bg-[var(--accent)] px-4 py-3 text-[15px] font-semibold text-white shadow-sm transition active:scale-[0.98]"
                >
                  <SendIcon className="h-4 w-4" />
                  Ask a question
                </button>

                {tickets.length > 0 ? (
                  <div className="mt-5">
                    <p className="px-1 pb-2 text-[11px] font-bold uppercase tracking-[0.2em] text-[var(--muted)]">
                      Your questions
                    </p>
                    <div className="overflow-hidden rounded-2xl bg-[var(--surface)] ring-1 ring-[var(--border)]">
                      {tickets.map((ticket, index) => {
                        const status = STATUS_COPY[ticket.status] ?? STATUS_COPY.open;
                        const typers = typingByTicket[ticket.id] ?? [];
                        return (
                          <button
                            key={ticket.id}
                            onClick={() => openThread(ticket.id, ticket.subject)}
                            className={`flex w-full items-center gap-3 px-3 py-3 text-left transition hover:bg-[var(--surface-alt)] active:bg-[var(--surface-alt)] ${
                              index > 0 ? "border-t border-[var(--border)]" : ""
                            }`}
                          >
                            <SupportAvatar
                              name={ticket.topic === "tutor" ? "Tutor" : "Office"}
                              staff
                              size={42}
                            />
                            <span className="min-w-0 flex-1">
                              <span
                                className={`block truncate text-[15px] text-[var(--foreground)] ${
                                  ticket.unread ? "font-bold" : "font-medium"
                                }`}
                              >
                                {ticket.subject}
                              </span>
                              <span className="mt-0.5 flex items-center gap-1.5 text-xs">
                                {typers.length > 0 ? (
                                  <span className="flex items-center gap-1.5 font-semibold text-[var(--accent)]">
                                    <TypingDots />
                                    {describeTypers(typers.map((t) => t.name))}
                                  </span>
                                ) : (
                                  <span className={`font-medium ${status.className}`}>{status.label}</span>
                                )}
                              </span>
                            </span>
                            <span className="flex shrink-0 flex-col items-end gap-1.5">
                              <span className="text-[11px] text-[var(--muted)]">{timeAgo(ticket.lastMessageAt)}</span>
                              {ticket.unread ? (
                                <span className="h-2.5 w-2.5 rounded-full bg-[var(--accent)]" />
                              ) : (
                                <ChevronRightIcon className="h-3.5 w-3.5 text-[var(--muted)]" />
                              )}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : view === "new" ? (
              <>
                <div className="min-h-0 flex-1 space-y-4 overflow-y-auto bg-[var(--surface-alt)] px-4 py-4">
                  <div>
                    <label className="text-xs font-semibold text-[var(--foreground-soft)]">What is it about?</label>
                    <select
                      value={topic}
                      onChange={(event) => setTopic(event.target.value as TicketTopic)}
                      className="mt-1.5 w-full rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-3.5 py-3 text-base text-[var(--foreground)] sm:text-sm"
                    >
                      {TICKET_TOPICS.map((value) => (
                        <option key={value} value={value}>
                          {TICKET_TOPIC_LABELS[value]}
                        </option>
                      ))}
                    </select>
                    {topic === "tutor" ? (
                      <p className="mt-1.5 text-[11px] leading-4 text-[var(--muted)]">
                        This goes straight to your tutor, not the office.
                      </p>
                    ) : null}
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-[var(--foreground-soft)]">In one line</label>
                    <input
                      value={subject}
                      onChange={(event) => setSubject(event.target.value.slice(0, 140))}
                      placeholder="e.g. My payment went through but I am still locked out"
                      className="mt-1.5 w-full rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-3.5 py-3 text-base text-[var(--foreground)] placeholder:text-[var(--muted)] sm:text-sm"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-[var(--foreground-soft)]">Tell us more</label>
                    <textarea
                      value={body}
                      onChange={(event) => setBody(event.target.value.slice(0, 4000))}
                      rows={5}
                      placeholder="What happened, and what you expected instead."
                      className="mt-1.5 w-full resize-none rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-3.5 py-3 text-base text-[var(--foreground)] placeholder:text-[var(--muted)] sm:text-sm"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-[var(--foreground-soft)]">A screenshot helps</label>
                    <div className="mt-1.5">
                      <AttachmentPicker value={newFiles} onChange={setNewFiles} disabled={busy} />
                    </div>
                  </div>

                  {error ? <p className="text-xs font-medium text-rose-500">{error}</p> : null}

                  <p className="text-[11px] leading-4 text-[var(--muted)]">
                    We send the page you are on ({pathname}) so the office does not have to ask.
                  </p>
                </div>

                <div className="shrink-0 border-t border-[var(--border)] bg-[var(--surface)] px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
                  <button
                    onClick={submitNew}
                    disabled={busy}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-[var(--accent)] px-4 py-3 text-[15px] font-semibold text-white transition active:scale-[0.98] disabled:opacity-50"
                  >
                    <SendIcon className="h-4 w-4" />
                    {busy ? "Sending…" : "Send to the office"}
                  </button>
                </div>
              </>
            ) : (
              <>
                <ChatScroller resetKey={threadId} watch={`${messages.length}:${live.typers.length}`}>
                  <div className="space-y-3">
                    <ChatNotice>{threadSubject}</ChatNotice>
                    {messages.map((message, index) => {
                      const previous = messages[index - 1];
                      const firstOfRun = !previous || previous.mine !== message.mine;
                      return (
                        <div key={message.id} className="space-y-3">
                          {needsStamp(previous?.createdAt, message.createdAt) ? (
                            <ChatStamp>{stampLabel(message.createdAt)}</ChatStamp>
                          ) : null}
                          <ChatBubbleRow
                            mine={message.mine}
                            authorName={message.mine ? "You" : firstNameOf(message.authorName, "The office")}
                            staff={!message.mine}
                            showAvatar={firstOfRun}
                            showName={firstOfRun}
                            edited={message.edited}
                            body={message.body}
                            extras={
                              <MessageAttachments
                                attachments={message.attachments}
                                align={message.mine ? "end" : "start"}
                              />
                            }
                          />
                        </div>
                      );
                    })}
                    <ChatTypingRow typers={live.typers} />
                    {threadStatus === "resolved" ? (
                      <ChatNotice>Marked resolved. Write below if you still need help — it reopens.</ChatNotice>
                    ) : null}
                  </div>
                </ChatScroller>

                <ChatComposer
                  value={reply}
                  onChange={(next) => {
                    setReply(next);
                    onTypingDraftChange(next);
                  }}
                  onSend={submitReply}
                  busy={busy}
                  files={replyFiles}
                  onFilesChange={setReplyFiles}
                />
              </>
            )}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </>
  );
}
