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
 * WHY THE BADGE IS ON THE BUTTON
 * ---------------------------------------------------------------------------
 * An answer nobody reads is the same as no answer. The bell already carries the
 * notification, but a student who asked a question comes back looking for the
 * place they asked it — so the reply is also flagged where the question was
 * typed. One poll, on an interval slow enough to be free.
 */

import { AnimatePresence, motion } from "framer-motion";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeftIcon,
  CheckCircleIcon,
  CrossIcon,
  HelpIcon,
  SendIcon,
} from "@/components/icons";
import {
  TICKET_TOPICS,
  TICKET_TOPIC_LABELS,
  type TicketTopic,
} from "@/lib/support-copy";

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
};

const POLL_MS = 90_000;

const STATUS_COPY: Record<string, { label: string; className: string }> = {
  open: { label: "Waiting on the office", className: "bg-amber-500/15 text-amber-600" },
  pending: { label: "Answered", className: "bg-emerald-500/15 text-emerald-600" },
  resolved: { label: "Resolved", className: "bg-slate-500/15 text-[var(--muted)]" },
};

export default function HelpLauncher() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [tickets, setTickets] = useState<TicketSummary[]>([]);
  const [unread, setUnread] = useState(0);
  const [view, setView] = useState<"list" | "new" | "thread">("list");
  const [threadId, setThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [threadSubject, setThreadSubject] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const [subject, setSubject] = useState("");
  const [topic, setTopic] = useState<TicketTopic>("classes");
  const [body, setBody] = useState("");
  const [reply, setReply] = useState("");

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
    return () => window.clearInterval(timer);
  }, [loadTickets]);


  const openThread = useCallback(async (id: string, subjectLine: string) => {
    setThreadId(id);
    setThreadSubject(subjectLine);
    setView("thread");
    setMessages([]);
    try {
      const res = await fetch(`/api/support/tickets/${id}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setMessages(data.messages ?? []);
      // Opening it is reading it, and the server has just said so. Reflect it
      // here rather than waiting ninety seconds for the poll to agree.
      setTickets((current) => current.map((t) => (t.id === id ? { ...t, unread: false } : t)));
      setUnread((n) => Math.max(0, n - 1));
    } catch {
      setError("Could not open that conversation.");
    }
  }, []);

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

  async function submitNew() {
    if (!subject.trim() || !body.trim()) {
      setError("A subject and a description, and the office can help.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/support/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject, topic, body, fromPath: pathname }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Could not send that.");
        return;
      }
      setSubject("");
      setBody("");
      setSent(true);
      await loadTickets();
      setView("list");
      window.setTimeout(() => setSent(false), 6000);
    } finally {
      setBusy(false);
    }
  }

  async function submitReply() {
    if (!reply.trim() || !threadId) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/support/tickets/${threadId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: reply }),
      });
      if (res.ok) {
        setReply("");
        await openThread(threadId, threadSubject);
        await loadTickets();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {/*
        Bottom RIGHT. The community launcher owns bottom-right on the student
        portal already — so this sits above it rather than beside it, because
        two round buttons of the same size side by side read as a pair of
        equals, and one of them is "chat to your class" while the other is "I
        am stuck". They are not equals.
      */}
      <button
        onClick={() => setOpen((value) => !value)}
        aria-label={open ? "Close help" : "Need help?"}
        title="Need help?"
        className="fixed bottom-24 right-5 z-40 grid h-11 w-11 place-items-center rounded-full border border-[var(--border)] bg-[var(--surface)] text-[var(--foreground-soft)] shadow-[var(--shadow)] transition hover:text-[var(--accent)] sm:bottom-6 sm:right-24"
      >
        {open ? <CrossIcon className="h-5 w-5" /> : <HelpIcon className="h-5 w-5" />}
        {!open && unread > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 flex h-3 w-3">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--accent)]" />
            <span className="relative inline-flex h-3 w-3 rounded-full bg-[var(--accent)] ring-2 ring-[var(--surface)]" />
          </span>
        ) : null}
      </button>

      <AnimatePresence>
        {open ? (
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.97 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="fixed bottom-40 right-4 z-40 flex max-h-[70vh] w-[min(22rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-3xl border border-[var(--border)] bg-[var(--surface)] shadow-[0_24px_60px_rgba(15,23,42,0.18)] sm:bottom-20 sm:right-24"
          >
            <div className="flex items-center gap-2 border-b border-[var(--border)] px-4 py-3">
              {view !== "list" ? (
                <button
                  onClick={() => setView("list")}
                  aria-label="Back"
                  className="rounded-lg p-1 text-[var(--muted)] transition hover:text-[var(--foreground)]"
                >
                  <ArrowLeftIcon className="h-4 w-4" />
                </button>
              ) : (
                <HelpIcon className="h-4 w-4 text-[var(--accent)]" />
              )}
              <p className="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--foreground)]">
                {view === "new" ? "Ask the office" : view === "thread" ? threadSubject : "Need help?"}
              </p>
              <button
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="rounded-lg p-1 text-[var(--muted)] transition hover:text-[var(--foreground)]"
              >
                <CrossIcon className="h-4 w-4" />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {view === "list" ? (
                <>
                  {sent ? (
                    <div className="mb-3 flex items-start gap-2 rounded-2xl bg-emerald-500/10 px-3 py-2.5 text-xs leading-5 text-emerald-700">
                      <CheckCircleIcon className="mt-0.5 h-4 w-4 shrink-0" />
                      <span>
                        Sent. The office sees it now — you will get a notification here and on your phone when
                        they answer.
                      </span>
                    </div>
                  ) : null}

                  <p className="text-xs leading-5 text-[var(--muted)]">
                    Anything at all — your classes, a payment, something on the site that will not work. A real
                    person at the branch office reads these.
                  </p>

                  <button
                    onClick={() => {
                      setView("new");
                      setError(null);
                    }}
                    className="mt-3 w-full rounded-2xl bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-110"
                  >
                    Ask a question
                  </button>

                  {tickets.length > 0 ? (
                    <div className="mt-5 space-y-2">
                      <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[var(--muted)]">
                        Your questions
                      </p>
                      {tickets.map((ticket) => {
                        const status = STATUS_COPY[ticket.status] ?? STATUS_COPY.open;
                        return (
                          <button
                            key={ticket.id}
                            onClick={() => openThread(ticket.id, ticket.subject)}
                            className="w-full rounded-2xl border border-[var(--border)] bg-[var(--surface-alt)] p-3 text-left transition hover:border-[var(--border-strong)]"
                          >
                            <div className="flex items-start gap-2">
                              <span className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--foreground)]">
                                {ticket.subject}
                              </span>
                              {ticket.unread ? (
                                <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-[var(--accent)]" />
                              ) : null}
                            </div>
                            <span
                              className={`mt-1.5 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${status.className}`}
                            >
                              {status.label}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                </>
              ) : view === "new" ? (
                <div className="space-y-3">
                  <div>
                    <label className="text-xs font-semibold text-[var(--foreground-soft)]">What is it about?</label>
                    <select
                      value={topic}
                      onChange={(event) => setTopic(event.target.value as TicketTopic)}
                      className="mt-1 w-full rounded-xl border border-[var(--border)] bg-[var(--surface-alt)] px-3 py-2 text-sm text-[var(--foreground)]"
                    >
                      {TICKET_TOPICS.map((value) => (
                        <option key={value} value={value}>
                          {TICKET_TOPIC_LABELS[value]}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-[var(--foreground-soft)]">In one line</label>
                    <input
                      value={subject}
                      onChange={(event) => setSubject(event.target.value.slice(0, 140))}
                      placeholder="e.g. My payment went through but I am still locked out"
                      className="mt-1 w-full rounded-xl border border-[var(--border)] bg-[var(--surface-alt)] px-3 py-2 text-sm text-[var(--foreground)] placeholder:text-[var(--muted)]"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-[var(--foreground-soft)]">Tell us more</label>
                    <textarea
                      value={body}
                      onChange={(event) => setBody(event.target.value.slice(0, 4000))}
                      rows={5}
                      placeholder="What happened, and what you expected instead."
                      className="mt-1 w-full resize-none rounded-xl border border-[var(--border)] bg-[var(--surface-alt)] px-3 py-2 text-sm text-[var(--foreground)] placeholder:text-[var(--muted)]"
                    />
                  </div>

                  {error ? <p className="text-xs font-medium text-rose-500">{error}</p> : null}

                  <p className="text-[11px] leading-4 text-[var(--muted)]">
                    We send the page you are on ({pathname}) so the office does not have to ask.
                  </p>

                  <button
                    onClick={submitNew}
                    disabled={busy}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
                  >
                    <SendIcon className="h-4 w-4" />
                    {busy ? "Sending…" : "Send to the office"}
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  {messages.map((message) => (
                    <div key={message.id} className={`flex flex-col ${message.mine ? "items-end" : "items-start"}`}>
                      <span className="px-1 text-[10px] font-medium text-[var(--muted)]">
                        {message.mine ? "You" : message.authorName ?? "The office"}
                      </span>
                      <div
                        className={`max-w-[88%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm ${
                          message.mine
                            ? "bg-[var(--accent)] text-white"
                            : "bg-[var(--surface-alt)] text-[var(--foreground)]"
                        }`}
                      >
                        {message.body}
                      </div>
                    </div>
                  ))}

                  <div className="flex items-end gap-2 pt-1">
                    <textarea
                      value={reply}
                      onChange={(event) => setReply(event.target.value.slice(0, 4000))}
                      rows={1}
                      placeholder="Add to this…"
                      className="max-h-24 min-h-[2.5rem] flex-1 resize-none rounded-xl border border-[var(--border)] bg-[var(--surface-alt)] px-3 py-2 text-sm text-[var(--foreground)]"
                    />
                    <button
                      onClick={submitReply}
                      disabled={busy || !reply.trim()}
                      aria-label="Send reply"
                      className="shrink-0 rounded-xl bg-[var(--accent)] p-2.5 text-white transition hover:brightness-110 disabled:opacity-40"
                    >
                      <SendIcon className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </>
  );
}
