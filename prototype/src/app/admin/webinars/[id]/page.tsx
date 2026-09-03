"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import AdminShell from "@/components/AdminShell";
import LiveKitClassroom from "@/components/live/LiveKitClassroom";
import { ArrowLeftIcon, CheckCircleIcon, SignalIcon } from "@/components/icons";

type Reg = { id: string; name: string | null; email: string | null; response: string; role: string; checkedIn: boolean; source: string | null };
type Q = { id: string; body: string; upvotes: number; status: string; askerName: string | null; answerText: string | null; votedByMe: boolean; createdAt: string };

export default function WebinarConsole() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<any>(null);
  const [regs, setRegs] = useState<Reg[]>([]);
  const [questions, setQuestions] = useState<Q[]>([]);
  const [live, setLive] = useState<{ token: string; url: string; room: string; role: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/work-drive/webinars/${id}`, { cache: "no-store" });
    if (res.ok) {
      const json = await res.json();
      setData(json.webinar);
      setRegs(json.registrations ?? []);
    }
    const qres = await fetch(`/api/admin/work-drive/webinars/${id}/questions`, { cache: "no-store" });
    if (qres.ok) setQuestions((await qres.json()).questions ?? []);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function goLive() {
    setErr(null);
    await fetch(`/api/admin/work-drive/webinars/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "start" }),
    });
    const res = await fetch(`/api/admin/work-drive/webinars/${id}/token`, { method: "POST" });
    const json = await res.json();
    if (!res.ok) {
      setErr(json?.error || "Could not start the room.");
      return;
    }
    setLive(json);
    load();
  }

  async function endWebinar() {
    if (!window.confirm("End this webinar for everyone?")) return;
    await fetch(`/api/admin/work-drive/webinars/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "end" }),
    });
    setLive(null);
    load();
  }

  async function checkIn(regId: string) {
    await fetch(`/api/admin/work-drive/webinars/${id}/attendees`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ attendeeId: regId, checkIn: true }),
    });
    load();
  }

  async function moderate(qid: string, status: string) {
    const answerText = status === "answered" ? window.prompt("Answer (optional, shown to the asker):") || "" : "";
    await fetch(`/api/admin/work-drive/webinars/${id}/questions`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ questionId: qid, status, answerText }),
    });
    load();
  }
  async function vote(qid: string) {
    await fetch(`/api/admin/work-drive/webinars/${id}/questions/${qid}/vote`, { method: "POST" });
    load();
  }

  if (live) {
    return (
      <div className="fixed inset-0 z-[60] bg-black">
        <LiveKitClassroom
          url={live.url}
          token={live.token}
          roomName={live.room}
          displayName="Host"
          role={live.role === "host" ? "tutor" : "student"}
          initialQuality="medium"
          onLeave={() => setLive(null)}
        />
      </div>
    );
  }

  const w = data;

  return (
    <AdminShell>
      <div className="space-y-5">
        <Link href="/admin/webinars" className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--muted)] hover:text-[var(--accent)]">
          <ArrowLeftIcon className="h-4 w-4" />
          All webinars
        </Link>

        {err && <div className="rounded-2xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">{err}</div>}

        {w && (
          <>
            <header className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h1 className="text-xl font-bold text-[var(--foreground)]">{w.event.title}</h1>
                <p className="mt-1 text-sm text-[var(--muted)]">
                  {new Date(w.event.startAt).toLocaleString(undefined, { dateStyle: "full", timeStyle: "short" })} · {w.event.timezone} · {w.audience}
                  {w.landingSlug && (
                    <>
                      {" · "}
                      <a href={`/w/${w.landingSlug}`} target="_blank" className="font-semibold text-[var(--accent)]" rel="noreferrer">
                        /w/{w.landingSlug}
                      </a>
                    </>
                  )}
                </p>
              </div>
              {w.canManage && (
                <div className="flex gap-2">
                  {w.event.status === "ended" ? (
                    <span className="rounded-full border border-[var(--border)] px-4 py-2 text-sm font-semibold text-[var(--muted)]">Ended</span>
                  ) : (
                    <>
                      <button onClick={goLive} className="inline-flex items-center gap-1.5 rounded-full bg-rose-600 px-4 py-2 text-sm font-bold text-white transition hover:brightness-110">
                        <SignalIcon className="h-4 w-4" />
                        {w.startedAt ? "Rejoin" : "Go live"}
                      </button>
                      {w.startedAt && (
                        <button onClick={endWebinar} className="rounded-full border border-[var(--border)] px-4 py-2 text-sm font-semibold text-[var(--foreground-soft)] transition hover:bg-[var(--surface-alt)]">
                          End
                        </button>
                      )}
                    </>
                  )}
                </div>
              )}
            </header>

            <div className="grid gap-5 lg:grid-cols-2">
              {/* Registrants */}
              <section className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-4">
                <h2 className="text-sm font-bold text-[var(--foreground)]">Registered ({regs.length})</h2>
                {regs.length === 0 ? (
                  <p className="mt-2 text-sm text-[var(--muted)]">Nobody yet.</p>
                ) : (
                  <ul className="mt-3 divide-y divide-[var(--border)]">
                    {regs.map((r) => (
                      <li key={r.id} className="flex items-center gap-2 py-2 text-sm">
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium text-[var(--foreground)]">{r.name ?? r.email}</p>
                          <p className="text-xs text-[var(--muted)]">
                            {r.role} · {r.response}
                            {r.source ? ` · ${r.source}` : ""}
                          </p>
                        </div>
                        {r.checkedIn ? (
                          <CheckCircleIcon className="h-4 w-4 text-emerald-500" />
                        ) : (
                          w.canManage && (
                            <button onClick={() => checkIn(r.id)} className="text-xs font-semibold text-[var(--accent)] hover:underline">
                              Check in
                            </button>
                          )
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {/* Q&A */}
              <section className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-4">
                <h2 className="text-sm font-bold text-[var(--foreground)]">Questions ({questions.length})</h2>
                {questions.length === 0 ? (
                  <p className="mt-2 text-sm text-[var(--muted)]">No questions.</p>
                ) : (
                  <ul className="mt-3 space-y-2">
                    {questions.map((q) => (
                      <li key={q.id} className={`rounded-xl border border-[var(--border)] p-3 ${q.status !== "pending" ? "opacity-60" : ""}`}>
                        <div className="flex items-start gap-2">
                          <button
                            onClick={() => vote(q.id)}
                            className={`flex flex-col items-center rounded-lg border px-2 py-1 text-xs ${
                              q.votedByMe ? "border-[var(--accent)] text-[var(--accent)]" : "border-[var(--border)] text-[var(--muted)]"
                            }`}
                          >
                            ▲<span className="font-bold">{q.upvotes}</span>
                          </button>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm text-[var(--foreground)]">{q.body}</p>
                            <p className="text-[10px] text-[var(--muted)]">{q.askerName ?? "Someone"}</p>
                            {q.answerText && <p className="mt-1 text-xs italic text-[var(--foreground-soft)]">↳ {q.answerText}</p>}
                          </div>
                        </div>
                        {w.canManage && q.status === "pending" && (
                          <div className="mt-2 flex gap-2">
                            <button onClick={() => moderate(q.id, "answered")} className="text-xs font-semibold text-emerald-600 hover:underline dark:text-emerald-400">
                              Mark answered
                            </button>
                            <button onClick={() => moderate(q.id, "dismissed")} className="text-xs font-semibold text-[var(--muted)] hover:underline">
                              Dismiss
                            </button>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          </>
        )}
      </div>
    </AdminShell>
  );
}
