"use client";

export const dynamic = "force-dynamic";

import { useCallback, useEffect, useRef, useState } from "react";
import AdminShell from "@/components/AdminShell";
import {
  AlertIcon,
  ArrowRightIcon,
  PulseIcon,
  RobotIcon,
  UsersIcon,
  WalletIcon,
} from "@/components/icons";

/**
 * The office's assistant, running on Ollama on the office's own machine.
 *
 * Two things share this page, and the order matters. The BRIEFING at the top
 * is computed from the database and is always right; the CHAT below it is a
 * language model reading that briefing out loud. When Ollama is not installed
 * the briefing is still there and still useful — the page degrades to a live
 * dashboard rather than to an error.
 *
 * The model is never asked to count. Everything it is allowed to state is in
 * the briefing the route hands it, because a fee chased from a hallucinated
 * balance is worse than no assistant at all.
 */

type Briefing = {
  generatedAt: string;
  students?: {
    total: number;
    active: number;
    byLevel: Record<string, number>;
    byBranch: Record<string, number>;
    newThisWeek: number;
    newThisMonth: number;
  };
  money?: {
    collectedAllTime: number;
    collectedThisMonth: number;
    outstandingTotal: number;
    studentsOwing: number;
    fullyPaid: number;
    biggestBalances: Array<{ name: string; level: string; branch: string | null; owed: number }>;
  };
  enquiries?: { open: number; newThisWeek: number };
  exams?: { upcoming: number; registrationsUnpaid: number };
  attendance?: { sessionsLast7Days: number; averagePresentPercent: number | null };
};

type Status = {
  reachable: boolean;
  url: string;
  model: string;
  installedModels: string[];
  modelReady: boolean;
  reason?: string;
};

type Turn = { role: "user" | "assistant"; content: string };

const naira = (value: number) => `NGN ${value.toLocaleString()}`;

const SUGGESTIONS = [
  "What should the office deal with first today?",
  "Which students are furthest behind on their fees?",
  "Draft a WhatsApp message chasing outstanding tuition, warm but clear.",
  "How did enrolment this month compare with the level spread we already have?",
];

function Stat({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex items-center gap-2 text-slate-500">
        <span className="text-[var(--accent)]">{icon}</span>
        <span className="text-xs font-semibold uppercase tracking-wide">{label}</span>
      </div>
      <p className="mt-2 text-2xl font-bold text-slate-900">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

export default function AdminAssistantPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [loading, setLoading] = useState(true);

  const [turns, setTurns] = useState<Turn[]>([]);
  const [question, setQuestion] = useState("");
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState("");

  const endRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/assistant", { cache: "no-store" });
      if (!response.ok) return;
      const data = await response.json();
      setStatus(data.status ?? null);
      setBriefing(data.briefing ?? null);
    } catch {
      /* The chat will report its own failure if it comes to it. */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns, thinking]);

  async function ask(text: string) {
    const trimmed = text.trim();
    if (!trimmed || thinking) return;

    setError("");
    setQuestion("");
    const history = turns.slice(-6);
    setTurns((current) => [...current, { role: "user", content: trimmed }]);
    setThinking(true);

    try {
      const response = await fetch("/api/admin/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: trimmed, history }),
      });
      const data = await response.json();

      if (!response.ok) {
        setError(data.error ?? "The assistant could not answer.");
        return;
      }

      setTurns((current) => [...current, { role: "assistant", content: data.answer }]);
      if (data.briefing) setBriefing(data.briefing);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setThinking(false);
    }
  }

  const offline = status && !status.reachable;
  const modelMissing = status?.reachable && !status.modelReady;

  return (
    <AdminShell>
      <div>
        <div className="mb-6 flex flex-wrap items-start gap-4">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-[var(--accent)]/10 text-[var(--accent)]">
            <RobotIcon className="h-6 w-6" />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-bold sm:text-3xl">Assistant</h1>
            <p className="mt-1 text-sm text-slate-500">
              Runs on this machine. Student names, balances and attendance never leave the building.
            </p>
          </div>
          {status && (
            <span
              className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold ${
                status.reachable && status.modelReady
                  ? "bg-emerald-500/10 text-emerald-600"
                  : "bg-amber-500/10 text-amber-600"
              }`}
            >
              <span
                className={`h-2 w-2 rounded-full ${
                  status.reachable && status.modelReady ? "bg-emerald-500" : "bg-amber-500"
                }`}
              />
              {status.reachable && status.modelReady ? status.model : "Assistant offline"}
            </span>
          )}
        </div>

        {/* The briefing. Always correct, always present, model or no model. */}
        {loading ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-24 animate-pulse rounded-2xl bg-slate-100" />
            ))}
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {briefing?.students && (
              <>
                <Stat
                  icon={<UsersIcon className="h-4 w-4" />}
                  label="Active students"
                  value={String(briefing.students.active)}
                  hint={`${briefing.students.newThisMonth} joined this month`}
                />
                <Stat
                  icon={<PulseIcon className="h-4 w-4" />}
                  label="New this week"
                  value={String(briefing.students.newThisWeek)}
                  hint={Object.entries(briefing.students.byLevel)
                    .map(([level, count]) => `${level} ${count}`)
                    .join(" · ")}
                />
              </>
            )}
            {briefing?.money && (
              <>
                <Stat
                  icon={<WalletIcon className="h-4 w-4" />}
                  label="Outstanding"
                  value={naira(briefing.money.outstandingTotal)}
                  hint={`${briefing.money.studentsOwing} owing · ${briefing.money.fullyPaid} paid up`}
                />
                <Stat
                  icon={<WalletIcon className="h-4 w-4" />}
                  label="Collected this month"
                  value={naira(briefing.money.collectedThisMonth)}
                  hint={`${naira(briefing.money.collectedAllTime)} all time`}
                />
              </>
            )}
            {briefing?.enquiries && (
              <Stat
                icon={<PulseIcon className="h-4 w-4" />}
                label="Open enquiries"
                value={String(briefing.enquiries.open)}
                hint={`${briefing.enquiries.newThisWeek} came in this week`}
              />
            )}
            {briefing?.exams && (
              <Stat
                icon={<PulseIcon className="h-4 w-4" />}
                label="Upcoming exams"
                value={String(briefing.exams.upcoming)}
                hint={`${briefing.exams.registrationsUnpaid} seats unpaid`}
              />
            )}
            {briefing?.attendance && (
              <Stat
                icon={<PulseIcon className="h-4 w-4" />}
                label="Attendance, 7 days"
                value={
                  briefing.attendance.averagePresentPercent === null
                    ? "—"
                    : `${briefing.attendance.averagePresentPercent}%`
                }
                hint={`${briefing.attendance.sessionsLast7Days} marks recorded`}
              />
            )}
          </div>
        )}

        {(offline || modelMissing) && (
          <div className="mt-5 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-semibold">
                {offline ? "The assistant is not running" : `The model ${status?.model} is not pulled yet`}
              </p>
              <p className="mt-1">{status?.reason}</p>
              <pre className="mt-2 overflow-x-auto rounded-lg bg-amber-100/70 p-3 font-mono text-xs">
                {offline
                  ? `# once, to install: https://ollama.com/download\nollama serve\nollama pull ${status?.model ?? "llama3.1"}`
                  : `ollama pull ${status?.model}`}
              </pre>
              <p className="mt-2 text-xs">
                Everything above this box is read straight from the database and is correct either way.
              </p>
            </div>
          </div>
        )}

        {briefing?.money && briefing.money.biggestBalances.length > 0 && (
          <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5">
            <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">Largest balances</h2>
            <div className="mt-3 divide-y divide-slate-100">
              {briefing.money.biggestBalances.map((row) => (
                <div key={`${row.name}-${row.owed}`} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-800">{row.name}</p>
                    <p className="text-xs text-slate-500">
                      {row.level}
                      {row.branch ? ` · ${row.branch}` : ""}
                    </p>
                  </div>
                  <span className="shrink-0 text-sm font-bold text-slate-900">{naira(row.owed)}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* The chat. */}
        <section className="mt-6 overflow-hidden rounded-[28px] border border-slate-200 bg-white">
          <div className="max-h-[26rem] overflow-y-auto p-5">
            {turns.length === 0 ? (
              <div className="py-6 text-center">
                <p className="text-sm font-semibold text-slate-700">Ask about the school</p>
                <p className="mt-1 text-xs text-slate-500">
                  Every figure it gives you comes from the numbers above, not from the model.
                </p>
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  {SUGGESTIONS.map((suggestion) => (
                    <button
                      key={suggestion}
                      onClick={() => ask(suggestion)}
                      disabled={thinking}
                      className="rounded-full border border-slate-200 px-3.5 py-2 text-xs font-medium text-slate-600 transition hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-40"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {turns.map((turn, index) => (
                  <div
                    key={index}
                    className={`flex gap-3 ${turn.role === "user" ? "justify-end" : "justify-start"}`}
                  >
                    {turn.role === "assistant" && (
                      <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-[var(--accent)]/10 text-[var(--accent)]">
                        <RobotIcon className="h-4 w-4" />
                      </span>
                    )}
                    <div
                      className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                        turn.role === "user"
                          ? "bg-[var(--accent)] text-white"
                          : "bg-slate-50 text-slate-800"
                      }`}
                    >
                      {turn.content}
                    </div>
                  </div>
                ))}

                {thinking && (
                  <div className="flex gap-3">
                    <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-[var(--accent)]/10 text-[var(--accent)]">
                      <RobotIcon className="h-4 w-4" />
                    </span>
                    <div className="flex items-center gap-1.5 rounded-2xl bg-slate-50 px-4 py-3.5">
                      {[0, 1, 2].map((dot) => (
                        <span
                          key={dot}
                          className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400"
                          style={{ animationDelay: `${dot * 0.15}s` }}
                        />
                      ))}
                    </div>
                  </div>
                )}

                <div ref={endRef} />
              </div>
            )}
          </div>

          {error && (
            <p className="flex items-center gap-2 border-t border-slate-100 bg-red-500/5 px-5 py-3 text-sm text-red-600">
              <AlertIcon className="h-4 w-4 shrink-0" />
              {error}
            </p>
          )}

          <form
            onSubmit={(event) => {
              event.preventDefault();
              void ask(question);
            }}
            className="flex items-center gap-2 border-t border-slate-100 p-3"
          >
            <input
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder={offline ? "Start Ollama to ask questions" : "Ask about students, fees, attendance…"}
              className="min-w-0 flex-1 rounded-xl bg-slate-50 px-4 py-3 text-sm outline-none transition focus:bg-white focus:ring-2 focus:ring-[var(--accent)]/30"
            />
            <button
              type="submit"
              disabled={thinking || !question.trim()}
              aria-label="Ask"
              className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[var(--accent)] text-white transition hover:brightness-110 disabled:opacity-40"
            >
              <ArrowRightIcon className="h-5 w-5" />
            </button>
          </form>
        </section>
      </div>
    </AdminShell>
  );
}
