"use client";

export const dynamic = "force-dynamic";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import LecturerShell from "@/components/LecturerShell";
import { deliveryModeLabel, groupByClass } from "@/lib/lecturer-class-groups";
import {
  AlertIcon,
  BroadcastMessageIcon,
  CheckCircleIcon,
  EyeIcon,
  InboxIcon,
  MailIcon,
  UsersIcon,
} from "@/components/icons";
import { MessageAttachments } from "@/components/support/TicketAttachments";
import {
  ChatBubbleRow,
  ChatComposer,
  ChatHeader,
  ChatScroller,
  ChatStamp,
  ChatTypingRow,
  needsStamp,
  stampLabel,
} from "@/components/support/ChatKit";
import { TypingDots } from "@/components/typing/TypingUI";
import { useTicketLive, useTicketTypingMap } from "@/lib/client/use-ticket-live";
import { useTypingSender } from "@/lib/client/use-typing-sender";
import { describeTypers } from "@/lib/typing";
import type { TicketAttachment } from "@/lib/support-copy";

/**
 * Messages.
 *
 * Used to be two pages — Messages and Announcements — both a form that sends
 * a broadcast to the class with a read count underneath it, reachable from
 * two different sidebar rows. This is the merge: one compose box (with the
 * urgent flag and the AI drafting aid Announcements had), one history, one
 * sidebar entry. Sending goes through the announcements endpoint, which
 * already does everything the old Messages send did plus push delivery and
 * severity.
 *
 * The inbox below it — a student's direct question to their own tutor — is a
 * different, two-way conversation and stays exactly as it was.
 */

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
  attachments?: TicketAttachment[];
};

type Student = {
  id: string;
  name: string;
  level: string;
  sessionSlot: string;
  classType: string;
  deliveryMode: string | null;
  batch: string | null;
};

type HistoryEntry = {
  batchId: string;
  title: string;
  message: string;
  severity: string;
  createdAt: string;
  sentTo: number;
  readBy: number;
};

export default function LecturerMessagesPage() {
  /* ---------------------------------------------------------- compose ---- */
  const [students, setStudents] = useState<Student[]>([]);
  const [cohortLabel, setCohortLabel] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [composeLoading, setComposeLoading] = useState(true);

  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [audience, setAudience] = useState<"cohort" | "student">("cohort");
  const [picked, setPicked] = useState<string[]>([]);
  // Set when the tutor arrived here from a "Message this group" button on the
  // roster — a note above the picker so they know why it opened pre-filled.
  const [groupLabel, setGroupLabel] = useState<string | null>(null);
  const [urgent, setUrgent] = useState(false);
  const [sending, setSending] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  // The drafting aid keeps its own scratch field rather than writing into
  // `message` as you type — a tutor's own words are the input, and
  // overwriting them with the model's output before they have seen it would
  // make the feature destructive.
  const [notes, setNotes] = useState("");
  const [drafting, setDrafting] = useState(false);

  const loadCompose = useCallback(async () => {
    try {
      const response = await fetch("/api/lecturer/announcements", { cache: "no-store" });
      if (!response.ok) return;
      const data = await response.json();
      setStudents(data.students ?? []);
      setCohortLabel(data.cohortLabel ?? null);
      setHistory(data.history ?? []);
    } catch {
      /* Leave the form usable; sending will report its own failure. */
    } finally {
      setComposeLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCompose();
  }, [loadCompose]);

  // "Message this group" on the roster deep-links here with the class's
  // student ids and a label. Read straight off the URL rather than
  // useSearchParams, which would need a Suspense boundary.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const ids = (params.get("students") || "").split(",").map((id) => id.trim()).filter(Boolean);
    if (ids.length === 0) return;
    setAudience("student");
    setPicked(ids);
    setGroupLabel(params.get("label"));
  }, []);

  const recipientCount = audience === "cohort" ? students.length : picked.length;

  const canSend = useMemo(
    () => title.trim().length > 0 && message.trim().length > 0 && recipientCount > 0 && !sending,
    [title, message, recipientCount, sending],
  );

  async function draft() {
    if (notes.trim().length < 5 || drafting) return;
    setDrafting(true);
    setFeedback(null);
    try {
      const response = await fetch("/api/lecturer/announcements/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: notes.trim(), urgent }),
      });
      const data = await response.json();
      if (!response.ok) {
        setFeedback({ tone: "error", text: data.error ?? "Could not draft that." });
        return;
      }
      setTitle(data.draft.title);
      setMessage(data.draft.message);
      setFeedback({ tone: "ok", text: "Draft ready — read it over and edit anything before you send." });
    } catch {
      setFeedback({ tone: "error", text: "Network problem — your notes are still here." });
    } finally {
      setDrafting(false);
    }
  }

  async function send() {
    if (!canSend) return;
    setSending(true);
    setFeedback(null);
    try {
      const response = await fetch("/api/lecturer/announcements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          message: message.trim(),
          audience,
          urgent,
          studentIds: picked,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setFeedback({ tone: "error", text: data.error ?? "Could not send that." });
        return;
      }
      setFeedback({
        tone: "ok",
        text: `Sent to ${data.sentTo} student${data.sentTo === 1 ? "" : "s"}${
          data.pushed > 0 ? ` · ${data.pushed} phone${data.pushed === 1 ? "" : "s"} buzzed` : ""
        }.`,
      });
      setTitle("");
      setMessage("");
      setPicked([]);
      setUrgent(false);
      void loadCompose();
    } catch {
      setFeedback({ tone: "error", text: "Network problem — nothing was sent." });
    } finally {
      setSending(false);
    }
  }

  /* ------------------------------------------------------------ inbox ---- */
  const [inbox, setInbox] = useState<InboxTicket[]>([]);
  const [inboxUnread, setInboxUnread] = useState(0);
  const [activeTicket, setActiveTicket] = useState<string | null>(null);
  const [activeSubject, setActiveSubject] = useState("");
  const [thread, setThread] = useState<ThreadMessage[]>([]);
  const [reply, setReply] = useState("");
  const [replyFiles, setReplyFiles] = useState<TicketAttachment[]>([]);
  const [threadBusy, setThreadBusy] = useState(false);
  const [threadStatus, setThreadStatus] = useState("open");
  const [threadLoaded, setThreadLoaded] = useState(false);

  const loadInbox = useCallback(async () => {
    try {
      const res = await fetch("/api/lecturer/inbox", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setInbox(data.tickets ?? []);
      setInboxUnread(data.unread ?? 0);
    } catch {
      // A failed poll leaves the last known inbox on screen rather than
      // clearing it out from under someone mid-read.
    }
  }, []);

  const refreshThread = useCallback(async (id: string) => {
    const res = await fetch(`/api/support/tickets/${id}`, { cache: "no-store" });
    if (!res.ok) return null;
    const data = await res.json();
    setThread(data.messages ?? []);
    if (data.status) setThreadStatus(data.status);
    setThreadLoaded(true);
    return data;
  }, []);

  const openThread = useCallback(
    async (id: string, subject: string) => {
      setActiveTicket(id);
      setActiveSubject(subject);
      setThread([]);
      setThreadLoaded(false);
      try {
        const data = await refreshThread(id);
        if (!data) return;
        setInbox((current) => current.map((t) => (t.id === id ? { ...t, unread: false } : t)));
        setInboxUnread((n) => Math.max(0, n - 1));
      } catch {
        // The list is still there; the student can just click it again.
      }
    },
    [refreshThread],
  );

  const typingByTicket = useTicketTypingMap(true);
  const live = useTicketLive({
    ticketId: activeTicket,
    known: threadLoaded ? { count: thread.length, status: threadStatus } : null,
    onStale: () => (activeTicket ? refreshThread(activeTicket) : undefined),
  });
  const { onDraftChange: onTypingDraftChange, stop: stopTyping } = useTypingSender(activeTicket, (typing) =>
    fetch("/api/support/typing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticketId: activeTicket, typing }),
      keepalive: true,
    }),
  );

  useEffect(() => {
    if (!activeTicket || window.innerWidth >= 640) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [activeTicket]);

  async function sendReply() {
    if ((!reply.trim() && replyFiles.length === 0) || !activeTicket) return;
    setThreadBusy(true);
    try {
      const res = await fetch(`/api/support/tickets/${activeTicket}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: reply, attachments: replyFiles }),
      });
      if (res.ok) {
        setReply("");
        setReplyFiles([]);
        stopTyping();
        await refreshThread(activeTicket);
        await loadInbox();
      }
    } finally {
      setThreadBusy(false);
    }
  }

  useEffect(() => {
    loadInbox();
    const timer = window.setInterval(loadInbox, 90_000);
    return () => window.clearInterval(timer);
  }, [loadInbox]);

  // `?ticket=<id>` — where the "a student messaged you" notification lands.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("ticket");
    if (id) void openThread(id, "");
  }, [openThread]);

  return (
    <LecturerShell>
      <main className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
        <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
          <header className="flex items-start gap-4">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-[var(--accent)]/10 text-[var(--accent)]">
              <MailIcon className="h-6 w-6" />
            </span>
            <div className="min-w-0">
              <h1 className="text-2xl font-semibold sm:text-3xl">Messages</h1>
              <p className="mt-1 text-sm text-[var(--muted)]">
                {cohortLabel
                  ? `Broadcast to ${cohortLabel} — in the portal and on their phone — and answer what students ask you directly.`
                  : "Set your branch, level and session under Customise my classes first."}
              </p>
            </div>
          </header>

          {activeTicket ? (
            <div className="mt-8 fixed inset-0 z-[65] flex h-[100dvh] flex-col overflow-hidden bg-[var(--surface)] sm:static sm:z-auto sm:h-[34rem] sm:rounded-[28px] sm:border sm:border-[var(--border)]">
              <ChatHeader
                fullScreen
                onBack={() => setActiveTicket(null)}
                title={activeSubject || "A student's question"}
                subtitle={
                  <span className="truncate text-[11px] text-[var(--muted)]">
                    {thread.find((entry) => !entry.mine)?.authorName ?? "Student"}
                  </span>
                }
              />
              <ChatScroller resetKey={activeTicket} watch={`${thread.length}:${live.typers.length}`}>
                <div className="space-y-3">
                  {thread.map((entry, index) => {
                    const previous = thread[index - 1];
                    const firstOfRun = !previous || previous.mine !== entry.mine;
                    return (
                      <div key={entry.id} className="space-y-3">
                        {needsStamp(previous?.createdAt, entry.createdAt) ? (
                          <ChatStamp>{stampLabel(entry.createdAt)}</ChatStamp>
                        ) : null}
                        <ChatBubbleRow
                          mine={entry.mine}
                          authorName={entry.mine ? "You" : (entry.authorName ?? "Student").split(/\s+/)[0]}
                          staff={entry.mine}
                          showAvatar={firstOfRun}
                          showName={firstOfRun}
                          body={entry.body}
                          extras={
                            <MessageAttachments attachments={entry.attachments} align={entry.mine ? "end" : "start"} />
                          }
                        />
                      </div>
                    );
                  })}
                  <ChatTypingRow typers={live.typers} />
                </div>
              </ChatScroller>
              <ChatComposer
                value={reply}
                onChange={(next) => {
                  setReply(next);
                  onTypingDraftChange(next);
                }}
                onSend={sendReply}
                busy={threadBusy}
                files={replyFiles}
                onFilesChange={setReplyFiles}
                placeholder="Reply…"
              />
            </div>
          ) : (
            <>
              {/* ---------------------------------------------- inbox ---- */}
              <section className="mt-8 rounded-[28px] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--shadow)] sm:p-7">
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
                    {inbox.map((ticket) => {
                      const typers = typingByTicket[ticket.id] ?? [];
                      return (
                        <button
                          key={ticket.id}
                          onClick={() => openThread(ticket.id, ticket.subject)}
                          className="w-full rounded-xl border border-[var(--border)] bg-[var(--background)] p-3 text-left transition hover:border-[var(--border-strong)] active:scale-[0.99]"
                        >
                          <div className="flex items-start gap-2">
                            <span className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--foreground)]">
                              {ticket.studentName ?? "A student"} — {ticket.subject}
                            </span>
                            {ticket.unread ? (
                              <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-[var(--accent)]" />
                            ) : null}
                          </div>
                          {typers.length > 0 ? (
                            <span className="mt-1 flex items-center gap-1.5 text-xs font-semibold text-[var(--accent)]">
                              <TypingDots />
                              {describeTypers(typers.map((t) => t.name))}
                            </span>
                          ) : (
                            <span className="mt-1 block text-xs text-[var(--muted)]">
                              {ticket.level ? `${ticket.level} · ` : ""}
                              {new Date(ticket.lastMessageAt).toLocaleString()}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </section>

              {/* -------------------------------------------- compose ---- */}
              <section className="mt-8 rounded-[28px] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--shadow)] sm:p-7">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="flex items-center gap-2 text-lg font-bold text-[var(--foreground)]">
                    <BroadcastMessageIcon className="h-5 w-5 text-[var(--accent)]" />
                    New message
                  </h2>
                  <span className="rounded-full bg-[var(--accent-soft)] px-3 py-1 text-xs font-semibold text-[var(--accent)]">
                    {composeLoading ? "…" : `${students.length} student${students.length === 1 ? "" : "s"} in your class`}
                  </span>
                </div>

                {!composeLoading && students.length === 0 ? (
                  <div className="mt-4 rounded-2xl border border-amber-300 bg-amber-50 p-5 text-sm text-amber-900">
                    <p className="font-semibold">You have no class to message yet</p>
                    <p className="mt-1">Set your branch, level and session first — messages go to the students in the class you teach.</p>
                    <Link href="/lecturer/classes" className="mt-3 inline-flex rounded-full bg-[var(--accent)] px-5 py-2 text-xs font-semibold text-white">
                      Customise my classes
                    </Link>
                  </div>
                ) : (
                  <div className="mt-4 space-y-4">
                    <div className="flex flex-wrap gap-2">
                      {(
                        [
                          { value: "cohort", label: `My whole class (${students.length})` },
                          { value: "student", label: "Pick students" },
                        ] as const
                      ).map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => setAudience(option.value)}
                          className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                            audience === option.value
                              ? "bg-[var(--accent)] text-white shadow-lg shadow-[var(--accent)]/20"
                              : "border border-[var(--border)] text-[var(--muted)] hover:text-[var(--foreground)]"
                          }`}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>

                    {audience === "student" && (
                      <div className="space-y-3">
                        {groupLabel ? (
                          <p className="rounded-xl bg-[var(--accent-soft)] px-3 py-2 text-xs font-medium text-[var(--accent)]">
                            Pre-selected the <strong>{groupLabel}</strong> group from your roster. Add or remove anyone below.
                          </p>
                        ) : null}
                        <div className="max-h-72 overflow-y-auto rounded-2xl border border-[var(--border)] p-2">
                          {students.length === 0 ? (
                            <p className="p-3 text-sm text-[var(--muted)]">No students assigned to you yet.</p>
                          ) : (
                            groupByClass(students).map((group) => {
                              const ids = group.members.map((member) => member.id);
                              const allChecked = ids.every((id) => picked.includes(id));
                              return (
                                <div key={group.key} className="mb-2 last:mb-0">
                                  <label className="flex cursor-pointer items-center gap-3 rounded-xl bg-[var(--surface-alt)] px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                                    <input
                                      type="checkbox"
                                      checked={allChecked}
                                      onChange={() =>
                                        setPicked((current) =>
                                          allChecked
                                            ? current.filter((id) => !ids.includes(id))
                                            : [...new Set([...current, ...ids])],
                                        )
                                      }
                                      className="h-4 w-4 accent-[var(--accent)]"
                                    />
                                    <span className="flex-1">{group.label}</span>
                                    <span className="font-medium normal-case">
                                      {deliveryModeLabel(group.mode)} · {group.members.length}
                                    </span>
                                  </label>
                                  {group.members.map((student) => {
                                    const checked = picked.includes(student.id);
                                    return (
                                      <label
                                        key={student.id}
                                        className="flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2 pl-8 text-sm transition hover:bg-[var(--background)]"
                                      >
                                        <input
                                          type="checkbox"
                                          checked={checked}
                                          onChange={() =>
                                            setPicked((current) =>
                                              checked ? current.filter((id) => id !== student.id) : [...current, student.id],
                                            )
                                          }
                                          className="h-4 w-4 accent-[var(--accent)]"
                                        />
                                        <span className="flex-1 font-medium">{student.name}</span>
                                        <span className="text-xs text-[var(--muted)]">
                                          {student.classType === "private" ? "private" : student.batch || ""}
                                        </span>
                                      </label>
                                    );
                                  })}
                                </div>
                              );
                            })
                          )}
                        </div>
                      </div>
                    )}

                    {/* Optional AI drafting aid, folded in from Announcements.
                        Sits above the real fields and stays out of the way of
                        a tutor who already knows what to say. */}
                    <div className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--background)] p-4">
                      <label htmlFor="message-notes" className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                        Write it for me — optional
                      </label>
                      <textarea
                        id="message-notes"
                        value={notes}
                        onChange={(event) => setNotes(event.target.value)}
                        rows={2}
                        placeholder="no class thursday, moved to friday same time, bring kapitel 4"
                        className="mt-1.5 w-full resize-y rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm outline-none transition focus:border-[var(--accent)]"
                      />
                      <div className="mt-2 flex flex-wrap items-center gap-3">
                        <button
                          type="button"
                          onClick={() => void draft()}
                          disabled={notes.trim().length < 5 || drafting}
                          className="rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {drafting ? "Writing…" : "Draft this for me"}
                        </button>
                        <p className="text-xs text-[var(--muted)]">
                          Fills in the title and message below. Nothing is sent until you press send.
                        </p>
                      </div>
                    </div>

                    <div>
                      <label htmlFor="message-title" className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                        Subject
                      </label>
                      <input
                        id="message-title"
                        value={title}
                        onChange={(event) => setTitle(event.target.value)}
                        maxLength={120}
                        placeholder="No class on Thursday"
                        className="mt-1.5 w-full rounded-2xl border border-[var(--border)] bg-[var(--background)] px-4 py-3 text-sm outline-none transition focus:border-[var(--accent)]"
                      />
                    </div>

                    <div>
                      <label htmlFor="message-body" className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                        Message
                      </label>
                      <textarea
                        id="message-body"
                        value={message}
                        onChange={(event) => setMessage(event.target.value)}
                        rows={4}
                        placeholder="We move to Friday at the same time. Bring your Kapitel 4 workbook."
                        className="mt-1.5 w-full resize-y rounded-2xl border border-[var(--border)] bg-[var(--background)] px-4 py-3 text-sm outline-none transition focus:border-[var(--accent)]"
                      />
                      <p className="mt-1 text-xs text-[var(--muted)]">Your name is added automatically at the end.</p>
                    </div>

                    <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-[var(--border)] p-3.5">
                      <input
                        type="checkbox"
                        checked={urgent}
                        onChange={(event) => setUrgent(event.target.checked)}
                        className="mt-0.5 h-4 w-4 accent-[var(--accent)]"
                      />
                      <span className="text-sm">
                        <span className="font-semibold">Mark as urgent</span>
                        <span className="mt-0.5 block text-xs text-[var(--muted)]">
                          Shows in amber and stands out in their list. Use it for a cancelled class, not a reading reminder.
                        </span>
                      </span>
                    </label>

                    {feedback && (
                      <p
                        className={`flex items-center gap-2 rounded-2xl px-4 py-3 text-sm font-medium ${
                          feedback.tone === "ok" ? "bg-emerald-500/10 text-emerald-600" : "bg-red-500/10 text-red-600"
                        }`}
                      >
                        {feedback.tone === "ok" ? <CheckCircleIcon className="h-4 w-4" /> : <AlertIcon className="h-4 w-4" />}
                        {feedback.text}
                      </p>
                    )}

                    <div className="flex flex-wrap items-center gap-3">
                      <button
                        onClick={() => void send()}
                        disabled={!canSend}
                        className="inline-flex items-center gap-2 rounded-full bg-[var(--accent)] px-6 py-3 text-sm font-bold text-white shadow-lg shadow-[var(--accent)]/20 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <BroadcastMessageIcon className="h-4 w-4" />
                        {sending ? "Sending…" : `Send to ${recipientCount} student${recipientCount === 1 ? "" : "s"}`}
                      </button>
                      <span className="flex items-center gap-1.5 text-xs text-[var(--muted)]">
                        <UsersIcon className="h-3.5 w-3.5" />
                        {cohortLabel ?? "No class assigned"}
                      </span>
                    </div>
                  </div>
                )}
              </section>

              {/* --------------------------------------------- history ---- */}
              <section className="mt-8">
                <h2 className="text-lg font-semibold">What you have sent</h2>
                {history.length === 0 ? (
                  <p className="mt-3 rounded-3xl border border-dashed border-[var(--border)] px-6 py-10 text-center text-sm text-[var(--muted)]">
                    Nothing yet. Anything you send shows here with how many students opened it.
                  </p>
                ) : (
                  <div className="mt-3 space-y-3">
                    {history.map((entry) => (
                      <div key={entry.batchId} className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0">
                            <h3 className="font-semibold">{entry.title}</h3>
                            <p className="mt-1 text-sm text-[var(--muted)]">{entry.message}</p>
                          </div>
                          <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-[var(--background)] px-3 py-1.5 text-xs font-semibold text-[var(--muted)]">
                            <EyeIcon className="h-3.5 w-3.5" />
                            {entry.readBy} of {entry.sentTo} read
                          </span>
                        </div>
                        <p className="mt-3 text-xs text-[var(--muted)]">
                          {new Date(entry.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      </main>
    </LecturerShell>
  );
}
