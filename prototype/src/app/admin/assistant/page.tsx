"use client";

export const dynamic = "force-dynamic";

import { useCallback, useEffect, useRef, useState } from "react";
import AdminShell from "@/components/AdminShell";
import CohortResult, { type Cohort } from "@/components/admin/CohortResult";
import ActionProposal, { type Proposal } from "@/components/admin/ActionProposal";
import {
  AlertIcon,
  ArrowRightIcon,
  PulseIcon,
  RobotIcon,
  ToolboxIcon,
  UsersIcon,
  WalletIcon,
} from "@/components/icons";

/**
 * The office's assistant.
 *
 * Three things share this page, and the order is the argument. The BRIEFING at
 * the top is computed from the database and is always right. The CHAT below it
 * is a language model reading that briefing out loud. The PROPOSAL under that
 * is the model asking permission to do something — never the model reporting
 * that it has.
 *
 * When no brain is available at all the briefing is still there and still
 * useful: the page degrades to a live dashboard rather than to an error.
 *
 * The model is never asked to count, and it is never allowed to act. Everything
 * it may state comes from a tool result, and everything it may DO arrives here
 * as a card with a number on it and a button underneath — because a fee chased
 * from a hallucinated balance is bad, and two hundred fees chased from one is
 * worse.
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
  provider: "claude" | "groq" | "ollama";
  model: string;
  ready: boolean;
  canAct: boolean;
  note: string;
  reason?: string;
};

type Turn = { role: "user" | "assistant"; content: string };

const naira = (value: number) => `NGN ${value.toLocaleString()}`;

/**
 * What to try first, split by what it costs you to be wrong.
 *
 * The lookup prompts teach that filters stack; the action prompts teach the
 * thing people do not believe until they see it, which is that you can ask this
 * to DO the work rather than to tell you how. They are only offered when the
 * brain can actually act — suggesting "chase the unpaid students" to an
 * assistant that will then explain how to do it by hand is worse than
 * suggesting nothing.
 */
const LOOKUP_SUGGESTIONS = [
  "Which students haven't paid and haven't been seen in 3 weeks?",
  "List everyone at B1 who still hasn't started classes.",
  "How many students do we have per branch, broken down by level?",
  "Who registered in the last 14 days and is going for an Ausbildung?",
];

const ACTION_SUGGESTIONS = [
  "Chase everyone in Lagos who still owes tuition.",
  "Mark the Lagos A1 morning class present today.",
  "Move the A1 students who finished this batch up to A2.",
  "Send enrolment links to everyone who enquired this month.",
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
  /** The rows the last lookup returned. Replaced, not appended: the table
      always shows the cohort belonging to the question on screen. */
  const [cohort, setCohort] = useState<Cohort | null>(null);
  const [toolsUsed, setToolsUsed] = useState<Array<{ name: string }>>([]);
  const [capabilities, setCapabilities] = useState<string[]>([]);
  /** The action awaiting confirmation, if the last answer proposed one. */
  const [proposal, setProposal] = useState<Proposal | null>(null);

  const endRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/assistant", { cache: "no-store" });
      if (!response.ok) return;
      const data = await response.json();
      setStatus(data.status ?? null);
      setBriefing(data.briefing ?? null);
      setCapabilities(data.capabilities ?? []);
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
    // Cleared before the request, not after it. A card left on screen while the
    // next answer streams in belongs to the previous question, and a Confirm
    // button under the wrong question is the one mistake this whole design
    // exists to prevent.
    setProposal(null);
    const history = turns.slice(-6);
    setTurns((current) => [...current, { role: "user", content: trimmed }]);
    setThinking(true);

    try {
      const response = await fetch("/api/admin/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: trimmed, history }),
      });

      // Auth and validation still fail as honest status codes, because they
      // happen before the stream opens. Everything after arrives as frames.
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(data.error ?? "The assistant could not answer.");
        return;
      }
      if (!response.body) {
        setError("The assistant returned nothing.");
        return;
      }

      /**
       * The answer arrives a few words at a time.
       *
       * An empty assistant turn is pushed first and then grown in place, so
       * the admin reads the reply as the model writes it instead of watching a
       * spinner for half a minute. `streamed` is the source of truth for the
       * text; React state is only ever caught up to it.
       */
      let streamed = "";
      let opened = false;
      const appendToLastTurn = (content: string) =>
        setTurns((current) => {
          const next = [...current];
          next[next.length - 1] = { role: "assistant", content };
          return next;
        });

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let failed = "";

      const handle = (line: string) => {
        const trimmedLine = line.trim();
        if (!trimmedLine) return;
        let frame: {
          type?: string;
          text?: string;
          name?: string;
          error?: string;
          answer?: string;
          briefing?: Briefing;
          cohort?: Cohort | null;
          toolsUsed?: Array<{ name: string }>;
          proposal?: Proposal | null;
          degraded?: string;
        };
        try {
          frame = JSON.parse(trimmedLine);
        } catch {
          return;
        }

        if (frame.type === "delta" && frame.text) {
          if (!opened) {
            opened = true;
            setTurns((current) => [...current, { role: "assistant", content: "" }]);
          }
          streamed += frame.text;
          appendToLastTurn(streamed);
        } else if (frame.type === "tool") {
          // The lookup stretch is silent by nature — the model emits no words
          // while it is deciding. Naming the tool turns that gap into visible
          // progress rather than an application that appears to have frozen.
          setToolsUsed((current) => [...current, { name: frame.name ?? "lookup" }]);
        } else if (frame.type === "proposal") {
          // Shown the moment it is planned rather than at the end, so the card
          // is already there to read while the model writes its sentence about
          // it. On a slow answer that is several seconds of head start.
          if (frame.proposal) setProposal(frame.proposal);
        } else if (frame.type === "error") {
          failed = frame.error ?? "The assistant could not answer.";
        } else if (frame.type === "done") {
          // The streamed text is authoritative; `answer` is the same string and
          // is used only when nothing streamed at all.
          const finalText = streamed || frame.answer || "";
          if (!opened) setTurns((current) => [...current, { role: "assistant", content: "" }]);
          appendToLastTurn(finalText || "(the model returned nothing)");
          if (frame.briefing) setBriefing(frame.briefing);
          // Null clears the table on a question that looked nothing up, so a
          // cohort from two questions ago can never be mistaken for this one's.
          setCohort(frame.cohort ?? null);
          setToolsUsed(frame.toolsUsed ?? []);
          // Only overwrite from `done` when it carries one: the proposal frame
          // arrived earlier in the same stream, and a done frame without the
          // field would otherwise wipe a card the admin is already reading.
          if (frame.proposal !== undefined) setProposal(frame.proposal);
          if (frame.degraded) setError(frame.degraded);
        }
      };

      // Ollama's frames are newline-delimited JSON and a network read can
      // split one down the middle, so the tail waits for its newline.
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) handle(line);
      }
      handle(buffer);

      if (failed) {
        setError(failed);
        // A failure part-way through leaves a stub turn behind; drop it so the
        // transcript does not keep an empty bubble the admin cannot act on.
        if (opened && !streamed) setTurns((current) => current.slice(0, -1));
      }
    } catch {
      setError("Could not reach the server.");
    } finally {
      setThinking(false);
    }
  }

  const offline = Boolean(status && !status.ready);
  const canAct = Boolean(status?.canAct);

  return (
    <AdminShell>
      <div>
        <div className="mb-6 flex flex-wrap items-start gap-4">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-[var(--accent)]/10 text-[var(--accent)]">
            <RobotIcon className="h-6 w-6" />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-bold sm:text-3xl">Assistant</h1>
            {/* The privacy posture is a sentence, not an inference. Which brain
                is running decides whether student names leave the building, and
                that is not something an admin should have to work out from a
                model name in a badge. */}
            <p className="mt-1 text-sm text-slate-500">
              {status?.note ?? "Checking which assistant is available…"}
            </p>
          </div>
          {status && (
            <div className="flex flex-wrap items-center gap-2">
              {canAct && (
                <span className="flex items-center gap-1.5 rounded-full bg-[var(--accent)]/10 px-3 py-1.5 text-xs font-semibold text-[var(--accent)]">
                  <ToolboxIcon className="h-3.5 w-3.5" />
                  Can act, with your confirmation
                </span>
              )}
              <span
                className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold ${
                  status.ready ? "bg-emerald-500/10 text-emerald-600" : "bg-amber-500/10 text-amber-600"
                }`}
              >
                <span
                  className={`h-2 w-2 rounded-full ${status.ready ? "bg-emerald-500" : "bg-amber-500"}`}
                />
                {status.ready ? status.model : "Assistant offline"}
              </span>
            </div>
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

        {offline && (
          <div className="mt-5 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="min-w-0">
              <p className="font-semibold">The assistant is not running</p>
              <p className="mt-1">{status?.reason}</p>
              {status?.provider === "ollama" && (
                <>
                  <pre className="mt-2 overflow-x-auto rounded-lg bg-amber-100/70 p-3 font-mono text-xs">
                    {`# once, to install: https://ollama.com/download\nollama serve\nollama pull ${status.model}`}
                  </pre>
                  <p className="mt-2 text-xs">
                    Or set ANTHROPIC_API_KEY to use the hosted assistant, which answers in seconds and
                    can carry out actions you confirm.
                  </p>
                </>
              )}
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
                <p className="text-sm font-semibold text-slate-700">
                  {canAct ? "Ask about the school, or ask it to do something" : "Ask about the school"}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Every figure it gives you comes from a live lookup, not from the model.
                  {canAct ? " Anything it would change, it shows you first." : ""}
                </p>

                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  {LOOKUP_SUGGESTIONS.map((suggestion) => (
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

                {canAct && (
                  <>
                    <p className="mt-5 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">
                      Or hand it the job
                    </p>
                    <div className="mt-2.5 flex flex-wrap justify-center gap-2">
                      {ACTION_SUGGESTIONS.map((suggestion) => (
                        <button
                          key={suggestion}
                          onClick={() => ask(suggestion)}
                          disabled={thinking}
                          className="rounded-full border border-[var(--accent)]/30 bg-[var(--accent)]/5 px-3.5 py-2 text-xs font-semibold text-[var(--accent)] transition hover:bg-[var(--accent)]/10 disabled:opacity-40"
                        >
                          {suggestion}
                        </button>
                      ))}
                    </div>
                  </>
                )}
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
              placeholder={
                offline
                  ? "The assistant is offline"
                  : canAct
                    ? "Ask about students and fees — or ask it to chase, mark, move…"
                    : "Ask about students, fees, attendance…"
              }
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

        {/* What it actually looked up. Shown because an assistant that queries
            your student records in the background without saying which query it
            ran is one nobody should trust — and because seeing "find_students:
            branch Lagos, level B1, unpaid" is how an admin learns what else
            they can ask for. */}
        {toolsUsed.length > 0 && (
          <p className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
            <PulseIcon className="h-3.5 w-3.5" />
            Looked up:
            {toolsUsed.map((tool, index) => (
              <span
                key={`${tool.name}-${index}`}
                className="rounded-full bg-slate-100 px-2 py-0.5 font-semibold text-slate-600"
              >
                {tool.name}
              </span>
            ))}
          </p>
        )}

        {/* The proposal sits ABOVE the cohort table on purpose. It is the only
            thing on this page with consequences attached, and burying it under
            five hundred rows of register would be a design that hopes nobody
            scrolls. */}
        {proposal && (
          <ActionProposal
            proposal={proposal}
            // The figures at the top of the page are now stale — the action
            // just changed the thing they describe.
            onDone={() => void load()}
          />
        )}

        {/* The rows themselves, straight from the query — never the model's
            retelling of them. See CohortResult. */}
        {cohort && cohort.rows.length > 0 && (
          <CohortResult cohort={cohort} canMessage={capabilities.includes("emails")} />
        )}
      </div>
    </AdminShell>
  );
}
