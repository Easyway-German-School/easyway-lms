"use client";

export const dynamic = "force-dynamic";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import LecturerShell from "@/components/LecturerShell";

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
        <div className="grid h-screen place-items-center text-[var(--muted)]">Loading your messages…</div>
      </LecturerShell>
    );
  }

  return (
    <LecturerShell>
      <div className="h-screen overflow-y-auto">
        <div className="border-b border-[var(--border)] bg-gradient-to-r from-[var(--accent)]/20 to-transparent p-6">
          <div className="mx-auto max-w-5xl">
            <h1 className="text-3xl font-bold text-[var(--foreground)]">Messages 💬</h1>
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
