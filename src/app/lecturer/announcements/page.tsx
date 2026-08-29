"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import LecturerShell from "@/components/LecturerShell";
import {
  AlertIcon,
  BroadcastMessageIcon,
  CheckCircleIcon,
  EyeIcon,
  UsersIcon,
} from "@/components/icons";

/**
 * Where a tutor tells their class something.
 *
 * It lands in the student's bell and on their phone, which is the difference
 * between this and Messages — that is a conversation, this is an announcement
 * to everyone sitting the same exam.
 *
 * The audience is not editable beyond "my class" and "these students": the
 * route resolves who a tutor may reach from the tutor's own record, so there
 * would be nothing gained by offering a wider choice here that the server
 * would only narrow again.
 */

type Student = {
  id: string;
  name: string;
  level: string;
  sessionSlot: string;
  classType: string;
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

export default function LecturerAnnouncementsPage() {
  const [students, setStudents] = useState<Student[]>([]);
  const [cohortLabel, setCohortLabel] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [audience, setAudience] = useState<"cohort" | "student">("cohort");
  const [picked, setPicked] = useState<string[]>([]);
  const [urgent, setUrgent] = useState(false);
  const [sending, setSending] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  // The drafting aid keeps its own scratch field rather than writing into
  // `message` as you type. A tutor's own words are the input, and overwriting
  // them with the model's output before they have seen it would make the
  // feature destructive.
  const [notes, setNotes] = useState("");
  const [drafting, setDrafting] = useState(false);

  const load = useCallback(async () => {
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
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const recipientCount = audience === "cohort" ? students.length : picked.length;

  const canSend = useMemo(
    () => title.trim().length > 0 && message.trim().length > 0 && recipientCount > 0 && !sending,
    [title, message, recipientCount, sending],
  );

  /**
   * Ask Claude to write it up, and put the result in the real fields.
   *
   * It fills the form rather than sending, so the tutor reads and edits before
   * anything reaches a student. The notes are kept afterwards, not cleared: the
   * usual second action is "not quite — try again" and clearing the input would
   * make them retype it.
   */
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
      void load();
    } catch {
      setFeedback({ tone: "error", text: "Network problem — nothing was sent." });
    } finally {
      setSending(false);
    }
  }

  return (
    <LecturerShell>
      <main className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
        <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
          <header className="flex items-start gap-4">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-[var(--accent)]/10 text-[var(--accent)]">
              <BroadcastMessageIcon className="h-6 w-6" />
            </span>
            <div className="min-w-0">
              <h1 className="text-2xl font-semibold sm:text-3xl">Announcements</h1>
              <p className="mt-1 text-sm text-[var(--muted)]">
                {cohortLabel
                  ? `Goes to ${cohortLabel} — in the portal and on their phone.`
                  : "Set your branch, level and session under Customise my classes first."}
              </p>
            </div>
          </header>

          <section className="mt-8 rounded-[28px] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--shadow)] sm:p-7">
            <div className="flex flex-wrap gap-2">
              {(
                [
                  { value: "cohort", label: `My whole class (${students.length})` },
                  { value: "student", label: "Pick students" },
                ] as const
              ).map((option) => (
                <button
                  key={option.value}
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
              <div className="mt-4 max-h-56 overflow-y-auto rounded-2xl border border-[var(--border)] p-2">
                {isLoading ? (
                  <p className="p-3 text-sm text-[var(--muted)]">Loading your students…</p>
                ) : students.length === 0 ? (
                  <p className="p-3 text-sm text-[var(--muted)]">No students assigned to you yet.</p>
                ) : (
                  students.map((student) => {
                    const checked = picked.includes(student.id);
                    return (
                      <label
                        key={student.id}
                        className="flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2 text-sm transition hover:bg-[var(--background)]"
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
                          {student.level}
                          {student.classType === "private" ? " · private" : ""}
                        </span>
                      </label>
                    );
                  })
                )}
              </div>
            )}

            <div className="mt-5 space-y-4">
              {/*
                Sits ABOVE the real fields, and is optional.

                A tutor who already knows what to say scrolls past it and types
                into Title and Message as before. The one who has thirty seconds
                between classes writes "no class thursday, moved to friday same
                time, bring kapitel 4" and gets something their students will
                actually read. Both paths end at the same two fields, which is
                what keeps this an aid rather than a workflow.
              */}
              <div className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--background)] p-4">
                <label htmlFor="announcement-notes" className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                  Write it for me — optional
                </label>
                <textarea
                  id="announcement-notes"
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
                <label htmlFor="announcement-title" className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                  Title
                </label>
                <input
                  id="announcement-title"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  maxLength={120}
                  placeholder="No class on Thursday"
                  className="mt-1.5 w-full rounded-2xl border border-[var(--border)] bg-[var(--background)] px-4 py-3 text-sm outline-none transition focus:border-[var(--accent)]"
                />
              </div>

              <div>
                <label htmlFor="announcement-body" className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                  Message
                </label>
                <textarea
                  id="announcement-body"
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  rows={4}
                  placeholder="We move to Friday at the same time. Bring your Kapitel 4 workbook."
                  className="mt-1.5 w-full resize-y rounded-2xl border border-[var(--border)] bg-[var(--background)] px-4 py-3 text-sm outline-none transition focus:border-[var(--accent)]"
                />
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
            </div>

            {feedback && (
              <p
                className={`mt-4 flex items-center gap-2 rounded-2xl px-4 py-3 text-sm font-medium ${
                  feedback.tone === "ok"
                    ? "bg-emerald-500/10 text-emerald-600"
                    : "bg-red-500/10 text-red-600"
                }`}
              >
                {feedback.tone === "ok" ? <CheckCircleIcon className="h-4 w-4" /> : <AlertIcon className="h-4 w-4" />}
                {feedback.text}
              </p>
            )}

            <div className="mt-5 flex flex-wrap items-center gap-3">
              <button
                onClick={send}
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
          </section>

          <section className="mt-8">
            <h2 className="text-lg font-semibold">What you have sent</h2>
            {history.length === 0 ? (
              <p className="mt-3 rounded-3xl border border-dashed border-[var(--border)] px-6 py-10 text-center text-sm text-[var(--muted)]">
                Nothing yet. Anything you send shows here with how many students opened it.
              </p>
            ) : (
              <div className="mt-3 space-y-3">
                {history.map((entry) => (
                  <div
                    key={entry.batchId}
                    className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm"
                  >
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
                      {new Date(entry.createdAt).toLocaleString(undefined, {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </main>
    </LecturerShell>
  );
}
