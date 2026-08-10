"use client";

export const dynamic = "force-dynamic";

/**
 * THE HELP DESK, from the office's side.
 *
 * Two panes rather than a table: a queue on the left, the conversation on the
 * right. A support request is not a row of fields — it is somebody talking —
 * and the previous shape of this idea in the product (a list you click through
 * to a detail page and back) makes answering six of them a navigation exercise.
 * The whole point is that a secretary can sit here for ten minutes and clear
 * the queue without the page ever changing.
 *
 * The `?ticket=` parameter is what the notification links to, so the office
 * clicking a bell lands on the exact conversation, already open and marked
 * read.
 */

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import AdminShell from "@/components/AdminShell";
import BrandLoader from "@/components/BrandLoader";
import {
  CheckCircleIcon,
  InboxIcon,
  RefreshIcon,
  SendIcon,
  TicketIcon,
  UserIcon,
} from "@/components/icons";
import {
  TICKET_STATUS_LABELS,
  TICKET_TOPIC_LABELS,
  type TicketStatus,
  type TicketTopic,
} from "@/lib/support-copy";

type Ticket = {
  id: string;
  subject: string;
  topic: string;
  status: string;
  fromPath: string | null;
  unread: boolean;
  messageCount: number;
  askerName: string | null;
  askerEmail: string;
  studentId: string | null;
  level: string | null;
  branchName: string | null;
  assignedTo: string | null;
  lastMessageAt: string;
  createdAt: string;
};

type ThreadMessage = {
  id: string;
  body: string;
  authorRole: string;
  authorName: string | null;
  mine: boolean;
  createdAt: string;
};

type Thread = {
  id: string;
  subject: string;
  topic: string;
  status: string;
  fromPath: string | null;
  createdAt: string;
  asker: {
    name: string | null;
    email: string;
    studentId: string | null;
    level: string | null;
    branchName: string | null;
  } | null;
  messages: ThreadMessage[];
};

const STATUS_TONE: Record<string, string> = {
  open: "bg-amber-100 text-amber-700",
  pending: "bg-emerald-100 text-emerald-700",
  resolved: "bg-slate-100 text-slate-600",
};

const FILTERS: Array<{ value: string; label: string }> = [
  { value: "open", label: "Needs an answer" },
  { value: "pending", label: "Waiting on student" },
  { value: "resolved", label: "Resolved" },
  { value: "all", label: "Everything" },
];

function timeAgo(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function EnquiriesInner() {
  const searchParams = useSearchParams();
  const requested = searchParams.get("ticket");

  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [filter, setFilter] = useState("open");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(requested);
  const [thread, setThread] = useState<Thread | null>(null);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ status: filter });
      if (search.trim()) params.set("q", search.trim());
      const res = await fetch(`/api/admin/enquiries?${params}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setTickets(data.tickets ?? []);
      setCounts(data.counts ?? {});
    } finally {
      setLoading(false);
    }
  }, [filter, search]);

  useEffect(() => {
    load();
  }, [load]);

  const openThread = useCallback(async (id: string) => {
    setSelected(id);
    setThread(null);
    // The SAME thread endpoint the student uses. It decides what to return and
    // which unread flag to clear from the caller's role — see the route.
    const res = await fetch(`/api/support/tickets/${id}`, { cache: "no-store" });
    if (!res.ok) return;
    setThread((await res.json()) as Thread);
    // The row's dot goes out immediately: the server cleared the flag on that
    // same request, and waiting for a refetch to agree makes it look sticky.
    setTickets((current) => current.map((t) => (t.id === id ? { ...t, unread: false } : t)));
  }, []);

  // Deep link from the bell. Runs once, on whatever the notification named.
  useEffect(() => {
    if (requested) void openThread(requested);
  }, [requested, openThread]);

  async function act(action: "reply" | "resolve" | "reopen") {
    if (!selected) return;
    if (action === "reply" && !reply.trim()) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/support/tickets/${selected}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action === "reply" ? { body: reply } : { action }),
      });
      if (res.ok) {
        setReply("");
        await openThread(selected);
        await load();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">Enquiries</h1>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600">
          Every &ldquo;need help?&rdquo; a student or tutor sends from the portal lands here. Answering in this
          window notifies them in-app and on their phone, and the whole conversation stays on the student&rsquo;s
          record — which is what it never did while this happened on WhatsApp.
        </p>
        <p className="mt-2 text-xs text-slate-500">
          Looking for people who have not enrolled yet? That is the{" "}
          <Link href="/admin/leads" className="font-semibold text-[var(--accent)] hover:underline">
            lead funnel
          </Link>
          .
        </p>
      </motion.div>

      <div className="grid gap-4 sm:grid-cols-3">
        {(["open", "pending", "resolved"] as TicketStatus[]).map((status) => (
          <div key={status} className="rounded-2xl border border-slate-200 bg-white p-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {TICKET_STATUS_LABELS[status]}
            </p>
            <p className="mt-1 text-3xl font-bold text-slate-900">{counts[status] ?? 0}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[22rem_1fr]">
        {/* The queue */}
        <div className="flex min-h-0 flex-col rounded-3xl border border-slate-200 bg-white">
          <div className="space-y-2 border-b border-slate-200 p-3">
            <div className="flex flex-wrap gap-1">
              {FILTERS.map((option) => (
                <button
                  key={option.value}
                  onClick={() => setFilter(option.value)}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                    filter === option.value
                      ? "bg-[var(--accent)] text-white"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Name, email or subject"
                className="min-w-0 flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm"
              />
              <button
                onClick={load}
                aria-label="Refresh"
                className="shrink-0 rounded-xl border border-slate-200 p-2 text-slate-500 transition hover:bg-slate-50"
              >
                <RefreshIcon className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="max-h-[32rem] min-h-0 flex-1 overflow-y-auto p-2">
            {loading ? (
              <p className="p-6 text-center text-sm text-slate-500">Loading…</p>
            ) : tickets.length === 0 ? (
              <div className="p-8 text-center">
                <InboxIcon className="mx-auto h-8 w-8 text-slate-300" />
                <p className="mt-2 text-sm text-slate-500">
                  {filter === "open" ? "Nothing waiting on the office." : "Nothing here."}
                </p>
              </div>
            ) : (
              <div className="space-y-1">
                {tickets.map((ticket) => (
                  <button
                    key={ticket.id}
                    onClick={() => openThread(ticket.id)}
                    className={`w-full rounded-2xl p-3 text-left transition ${
                      selected === ticket.id ? "bg-[var(--accent-soft)]" : "hover:bg-slate-50"
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-900">
                        {ticket.subject}
                      </span>
                      {ticket.unread ? (
                        <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[var(--accent)]" />
                      ) : null}
                    </div>
                    <p className="mt-0.5 truncate text-xs text-slate-500">
                      {ticket.askerName ?? ticket.askerEmail}
                      {ticket.level ? ` · ${ticket.level}` : ""}
                      {ticket.branchName ? ` · ${ticket.branchName}` : ""}
                    </p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_TONE[ticket.status] ?? STATUS_TONE.open}`}>
                        {TICKET_STATUS_LABELS[ticket.status as TicketStatus] ?? ticket.status}
                      </span>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">
                        {TICKET_TOPIC_LABELS[ticket.topic as TicketTopic] ?? ticket.topic}
                      </span>
                      <span className="text-[10px] text-slate-400">{timeAgo(ticket.lastMessageAt)}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* The conversation */}
        <div className="flex min-h-[24rem] flex-col rounded-3xl border border-slate-200 bg-white">
          {!thread ? (
            <div className="grid flex-1 place-items-center p-10 text-center">
              <div>
                <TicketIcon className="mx-auto h-10 w-10 text-slate-300" />
                <p className="mt-3 text-sm text-slate-500">Pick a request to read and answer it.</p>
              </div>
            </div>
          ) : (
            <>
              <div className="border-b border-slate-200 p-4">
                <h2 className="text-lg font-semibold text-slate-900">{thread.subject}</h2>
                <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  <span className="inline-flex items-center gap-1">
                    <UserIcon className="h-3.5 w-3.5" />
                    {thread.asker?.name ?? thread.asker?.email}
                  </span>
                  {thread.asker?.level ? <span>· {thread.asker.level}</span> : null}
                  {thread.asker?.branchName ? <span>· {thread.asker.branchName}</span> : null}
                  {/* The page they were standing on. This is the single most
                      useful field on the whole ticket and it is captured
                      automatically, because a frustrated person never includes it. */}
                  {thread.fromPath ? (
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-600">
                      sent from {thread.fromPath}
                    </span>
                  ) : null}
                  {thread.asker?.studentId ? (
                    <Link
                      href={`/admin/students/${thread.asker.studentId}`}
                      className="font-semibold text-[var(--accent)] hover:underline"
                    >
                      Open their file
                    </Link>
                  ) : null}
                </div>
              </div>

              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
                {thread.messages.map((message) => {
                  const fromOffice = message.authorRole === "admin";
                  return (
                    <div key={message.id} className={`flex flex-col ${fromOffice ? "items-end" : "items-start"}`}>
                      <span className="px-1 text-[10px] font-medium text-slate-400">
                        {fromOffice ? message.authorName ?? "The office" : message.authorName ?? "Student"} ·{" "}
                        {timeAgo(message.createdAt)}
                      </span>
                      <div
                        className={`max-w-[80%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2.5 text-sm ${
                          fromOffice ? "bg-[var(--accent)] text-white" : "bg-slate-100 text-slate-800"
                        }`}
                      >
                        {message.body}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="space-y-2 border-t border-slate-200 p-3">
                <textarea
                  value={reply}
                  onChange={(event) => setReply(event.target.value.slice(0, 4000))}
                  rows={3}
                  placeholder="Answer them…"
                  className="w-full resize-none rounded-xl border border-slate-200 px-3 py-2 text-sm"
                />
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => act("reply")}
                    disabled={busy || !reply.trim()}
                    className="inline-flex items-center gap-2 rounded-full bg-[var(--accent)] px-5 py-2.5 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
                  >
                    <SendIcon className="h-4 w-4" />
                    Send reply
                  </button>
                  {thread.status === "resolved" ? (
                    <button
                      onClick={() => act("reopen")}
                      disabled={busy}
                      className="rounded-full border border-slate-200 px-5 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                    >
                      Reopen
                    </button>
                  ) : (
                    <button
                      onClick={() => act("resolve")}
                      disabled={busy}
                      className="inline-flex items-center gap-2 rounded-full border border-slate-200 px-5 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                    >
                      <CheckCircleIcon className="h-4 w-4" />
                      Mark resolved
                    </button>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function AdminEnquiriesPage() {
  return (
    <AdminShell>
      <Suspense fallback={<BrandLoader fill size="lg" message="Opening the help desk." />}>
        <EnquiriesInner />
      </Suspense>
    </AdminShell>
  );
}
