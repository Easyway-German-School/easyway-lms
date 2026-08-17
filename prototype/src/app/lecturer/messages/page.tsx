"use client";

export const dynamic = "force-dynamic";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import LecturerShell from "@/components/LecturerShell";
import { ArrowLeftIcon, InboxIcon, MailIcon, SendIcon } from "@/components/icons";
import BrandLoader from "@/components/BrandLoader";

type InboxTicket = {
  id: string;
  subject: string;
  status: string;
  unread: boolean;
  messageCount: number;
  studentName: string | null;
  level: string | null;
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

type SentMessage = {
  key: string;
  title: string;
  message: string;
  sentAt: string;
  recipients: number;
  readCount: number;
};

type Recipient = { id: string; name: string; email: string };

/**
 * Messages.
 *
 * Another sidebar link that led to a 404. Deliberately scoped to
 * announcements rather than a full two-way chat: a tutor's real need is "tell
 * my class something and know they saw it", and messages land in the
 * notifications students already check rather than in a second inbox nobody
 * would open.
 */
export default function LecturerMessagesPage() {
  const router = useRouter();
  const [sent, setSent] = useState<SentMessage[]>([]);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [cohortSize, setCohortSize] = useState(0);
  const [assigned, setAssigned] = useState(true);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [studentId, setStudentId] = useState("");

  // The "Ask my tutor" side — students writing IN, not the tutor broadcasting
  // out. A separate inbox from `sent` because it is a different conversation
  // shape: threaded and two-way, not fire-and-forget.
  const [inbox, setInbox] = useState<InboxTicket[]>([]);
  const [inboxUnread, setInboxUnread] = useState(0);
  const [activeTicket, setActiveTicket] = useState<string | null>(null);
  const [activeSubject, setActiveSubject] = useState("");
  const [thread, setThread] = useState<ThreadMessage[]>([]);
  const [reply, setReply] = useState("");
  const [threadBusy, setThreadBusy] = useState(false);

  const loadInbox = useCallback(async () => {
    try {
      const res = await fetch("/api/lecturer/inbox", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setInbox(data.tickets ?? []);
      setInboxUnread(data.unread ?? 0);
    } catch {
      // Same rule as the announcements list below: a failed poll leaves the
      // last known inbox on screen rather than clearing it out from under
      // someone mid-read.
    }
  }, []);

  const openThread = useCallback(async (id: string, subject: string) => {
    setActiveTicket(id);
    setActiveSubject(subject);
    setThread([]);
    try {
      const res = await fetch(`/api/support/tickets/${id}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setThread(data.messages ?? []);
      setInbox((current) => current.map((t) => (t.id === id ? { ...t, unread: false } : t)));
      setInboxUnread((n) => Math.max(0, n - 1));
    } catch {
      // The list is still there; the student can just click it again.
    }
  }, []);

  async function sendReply() {
    if (!reply.trim() || !activeTicket) return;
    setThreadBusy(true);
    try {
      const res = await fetch(`/api/support/tickets/${activeTicket}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: reply }),
      });
      if (res.ok) {
        setReply("");
        await openThread(activeTicket, activeSubject);
        await loadInbox();
      }
    } finally {
      setThreadBusy(false);
    }
  }

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/lecturer/messages", { cache: "no-store" });
      if (res.status === 401) {
        router.push("/auth/lecturer/signin");
        return;
      }
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(payload.error || "Could not load your messages");
        return;
      }
      setSent(payload.sent || []);
      setRecipients(payload.recipients || []);
      setCohortSize(payload.cohortSize || 0);
      setAssigned(Boolean(payload.assigned));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load your messages");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    loadInbox();
    const timer = window.setInterval(loadInbox, 90_000);
    return () => window.clearInterval(timer);
  }, [loadInbox]);

  /**
   * `?ticket=<id>` — where the "a student messaged you" notification lands.
   * Read off `window.location` rather than `useSearchParams`, same reasoning
   * as HelpLauncher: a query param used once should not opt this whole page
   * into client-side rendering behind a Suspense boundary.
   */
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("ticket");
    if (id) void openThread(id, "");
  }, [openThread]);

  async function send(event: React.FormEvent) {
    event.preventDefault();
    setSending(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/lecturer/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, message, studentId: studentId || undefined }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || "Could not send your message");

      setNotice(`Sent to ${payload.recipients} student${payload.recipients === 1 ? "" : "s"}.`);
      setTitle("");
      setMessage("");
      setStudentId("");
      await load();
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "Could not send your message");
    } finally {
      setSending(false);
    }
  }

  if (loading) {
    return (
      <LecturerShell>
        <BrandLoader fill size="lg" title="Einen Moment…" message="Loading your messages." />
      </LecturerShell>
    );
  }

  return (
    <LecturerShell>
      <div className="h-screen overflow-y-auto">
        <div className="border-b border-[var(--border)] bg-gradient-to-r from-[var(--accent)]/20 to-transparent p-6">
          <div className="mx-auto max-w-5xl">
            <h1 className="flex items-center gap-3 text-3xl font-bold text-[var(--foreground)]"><MailIcon className="h-7 w-7 text-[var(--accent)]" />Messages</h1>
            <p className="mt-2 text-[var(--muted)]">
              Send an announcement to your class. It lands in each student&apos;s notifications, and you can see who has read it.
            </p>
          </div>
        </div>

        <div className="mx-auto max-w-5xl space-y-6 p-6">
          {error ? <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div> : null}
          {notice ? (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">{notice}</div>
          ) : null}

          {!assigned ? (
            <div className="rounded-2xl border border-amber-300 bg-amber-50 p-5 text-sm text-amber-900">
              <p className="font-semibold">You have no class to message yet</p>
              <p className="mt-1">
                Set your branch, level and session first — messages go to the students in the class you teach.
              </p>
              <Link href="/lecturer/classes" className="mt-3 inline-flex rounded-full bg-[var(--accent)] px-5 py-2 text-xs font-semibold text-white">
                Customise my classes
              </Link>
            </div>
          ) : (
            <form onSubmit={send} className="space-y-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-lg font-bold text-[var(--foreground)]">New announcement</h2>
                <span className="rounded-full bg-[var(--accent-soft)] px-3 py-1 text-xs font-semibold text-[var(--accent)]">
                  {cohortSize} student{cohortSize === 1 ? "" : "s"} in your class
                </span>
              </div>

              <div>
                <label htmlFor="to" className="mb-2 block text-sm font-semibold text-[var(--foreground)]">Send to</label>
                <select
                  id="to"
                  value={studentId}
                  onChange={(event) => setStudentId(event.target.value)}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-4 py-2 text-[var(--foreground)]"
                >
                  <option value="">Everyone in my class ({cohortSize})</option>
                  {recipients.map((recipient) => (
                    <option key={recipient.id} value={recipient.id}>{recipient.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="subject" className="mb-2 block text-sm font-semibold text-[var(--foreground)]">Subject</label>
                <input
                  id="subject"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="e.g. No class this Friday"
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-4 py-2 text-[var(--foreground)] placeholder-[var(--muted)]"
                  required
                />
              </div>

              <div>
                <label htmlFor="body" className="mb-2 block text-sm font-semibold text-[var(--foreground)]">Message</label>
                <textarea
                  id="body"
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  placeholder="Write your announcement…"
                  className="min-h-[140px] w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-4 py-2 text-[var(--foreground)] placeholder-[var(--muted)]"
                  required
                />
                <p className="mt-1 text-xs text-[var(--muted)]">Your name is added automatically at the end.</p>
              </div>

              <button
                type="submit"
                disabled={sending || !title.trim() || !message.trim()}
                className="rounded-lg bg-[var(--accent)] px-6 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {sending ? "Sending…" : studentId ? "Send to this student" : `Send to all ${cohortSize}`}
              </button>
            </form>
          )}

          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6">
            {activeTicket ? (
              <>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setActiveTicket(null)}
                    aria-label="Back to your students' questions"
                    className="rounded-lg p-1 text-[var(--muted)] transition hover:text-[var(--foreground)]"
                  >
                    <ArrowLeftIcon className="h-4 w-4" />
                  </button>
                  <h2 className="min-w-0 flex-1 truncate text-lg font-bold text-[var(--foreground)]">
                    {activeSubject || "A student's question"}
                  </h2>
                </div>

                <div className="mt-4 max-h-[26rem] space-y-3 overflow-y-auto">
                  {thread.map((entry) => (
                    <div key={entry.id} className={`flex flex-col ${entry.mine ? "items-end" : "items-start"}`}>
                      <span className="px-1 text-[10px] font-medium text-[var(--muted)]">
                        {entry.mine ? "You" : entry.authorName ?? "Student"}
                      </span>
                      <div
                        className={`max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm ${
                          entry.mine
                            ? "bg-[var(--accent)] text-white"
                            : "bg-[var(--background)] text-[var(--foreground)]"
                        }`}
                      >
                        {entry.body}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-3 flex items-end gap-2">
                  <textarea
                    value={reply}
                    onChange={(event) => setReply(event.target.value.slice(0, 4000))}
                    rows={1}
                    placeholder="Reply…"
                    className="max-h-24 min-h-[2.5rem] flex-1 resize-none rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)]"
                  />
                  <button
                    onClick={sendReply}
                    disabled={threadBusy || !reply.trim()}
                    aria-label="Send reply"
                    className="shrink-0 rounded-xl bg-[var(--accent)] p-2.5 text-white transition hover:brightness-110 disabled:opacity-40"
                  >
                    <SendIcon className="h-4 w-4" />
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="flex items-center gap-2 text-lg font-bold text-[var(--foreground)]">
                    <InboxIcon className="h-5 w-5 text-[var(--accent)]" />
                    Your students&apos; questions
                  </h2>
                  {inboxUnread > 0 ? (
                    <span className="rounded-full bg-[var(--accent)] px-2.5 py-0.5 text-xs font-bold text-white">
                      {inboxUnread} new
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 text-sm text-[var(--muted)]">
                  When a student asks their tutor something directly, it lands here — not in the office queue.
                </p>

                {inbox.length === 0 ? (
                  <p className="mt-4 text-sm text-[var(--muted)]">No questions yet.</p>
                ) : (
                  <div className="mt-4 space-y-2">
                    {inbox.map((ticket) => (
                      <button
                        key={ticket.id}
                        onClick={() => openThread(ticket.id, ticket.subject)}
                        className="w-full rounded-xl border border-[var(--border)] bg-[var(--background)] p-3 text-left transition hover:border-[var(--border-strong)]"
                      >
                        <div className="flex items-start gap-2">
                          <span className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--foreground)]">
                            {ticket.studentName ?? "A student"} — {ticket.subject}
                          </span>
                          {ticket.unread ? (
                            <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-[var(--accent)]" />
                          ) : null}
                        </div>
                        <span className="mt-1 block text-xs text-[var(--muted)]">
                          {ticket.level ? `${ticket.level} · ` : ""}
                          {new Date(ticket.lastMessageAt).toLocaleString()}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6">
            <h2 className="text-lg font-bold text-[var(--foreground)]">Sent</h2>
            {sent.length === 0 ? (
              <p className="mt-3 text-sm text-[var(--muted)]">You have not sent any announcements yet.</p>
            ) : (
              <div className="mt-4 space-y-3">
                {sent.map((item) => (
                  <div key={item.key} className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <p className="font-semibold text-[var(--foreground)]">{item.title}</p>
                      <span className="rounded-full bg-[var(--surface)] px-3 py-1 text-xs font-medium text-[var(--muted)]">
                        {item.readCount}/{item.recipients} read
                      </span>
                    </div>
                    <p className="mt-2 whitespace-pre-line text-sm text-[var(--muted)]">{item.message}</p>
                    <p className="mt-2 text-xs text-[var(--muted)]">{new Date(item.sentAt).toLocaleString()}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </LecturerShell>
  );
}
