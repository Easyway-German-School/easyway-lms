"use client";

import { useState } from "react";

type Snapshot =
  | { kind: "breaker"; name: string; state: "closed" | "open" | "half-open"; consecutiveFailures: number; rejected: number; lastError: string | null }
  | { kind: "bulkhead"; name: string; active: number; queued: number; maxConcurrent: number; maxQueue: number; rejected: number };

const card = "min-w-0 rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm";

type Status = "here" | "new" | "next";
const STATUS: Record<Status, { label: string; tone: string }> = {
  here: { label: "Already in EasyWay", tone: "bg-emerald-500/15 text-emerald-600" },
  new: { label: "Added with this console", tone: "bg-blue-500/15 text-blue-500" },
  next: { label: "Worth adding next", tone: "bg-amber-500/15 text-amber-600" },
};

/* ---------------------------------------------------------------------------
 * The five patterns. Each says the problem, the idea, where it lives in THIS
 * codebase (real paths — open them and read), and what is honestly still missing.
 * ------------------------------------------------------------------------- */

const PATTERNS: Array<{
  id: string;
  number: string;
  name: string;
  problem: string;
  idea: string;
  status: Status;
  where: Array<{ file: string; note: string }>;
  gap: string;
  live?: string;
}> = [
  {
    id: "gateway",
    number: "01",
    name: "API Gateway",
    problem: "Every route re-implementing sign-in checks, rate limits and security headers means one forgotten route is a hole.",
    idea: "One front door. Every request passes through it first; the cross-cutting rules (auth-adjacent gating, rate limits, headers, logging) live there once, so the routes behind stay focused on their own job.",
    status: "here",
    where: [
      { file: "src/proxy.ts", note: "Next's front door (it replaced middleware.ts in v16): security headers, the Content-Security-Policy, rate limiting, path matching." },
      { file: "src/lib/admin-roles.ts → requireCapability()", note: "The second gate, per route: who may do this. Sets up the request's tenant + audit context." },
    ],
    gap: "Rate limiting counts per server instance, and serverless runs many instances — so it is a speed bump, not a wall. A shared counter (Redis/Upstash) is what makes it a real limit.",
  },
  {
    id: "bff",
    number: "02",
    name: "Backend for Frontend",
    problem: "A phone screen, an admin console and a parent dashboard need different slices of the same data. One generic API either over-sends to all of them or makes each client stitch five calls together.",
    idea: "Each kind of client gets an endpoint shaped for it. It gathers, trims and reshapes; it does not own the business rules.",
    status: "here",
    where: [
      { file: "src/app/api/student/access/route.ts", note: "Built for the student shell: one call returns the lock verdict, the photo flag and the timestamp it needs — not four calls." },
      { file: "src/app/api/admin/students/[id]/remote/route.ts", note: "Built for the admin's Remote View: assembles a whole mirror screen from many tables." },
    ],
    gap: "The lesson is in your own history: the paywall-drift bug happened when BFF routes re-implemented the payment rule instead of calling the one place that owns it. A BFF should SHAPE data, never DECIDE — the rule lives in lib/student-access.ts and lib/portal-verdict.ts.",
  },
  {
    id: "breaker",
    number: "03",
    name: "Circuit Breaker",
    problem: "A dependency that is timing out costs every request its full timeout and a held connection. The failure spreads from one sick service to the whole app.",
    idea: "After a run of failures, stop calling it. Fail instantly for a while, then let ONE probe through; if it works, resume. Closed → Open → Half-open.",
    status: "new",
    where: [
      { file: "src/lib/resilience.ts", note: "createCircuitBreaker(): the pattern itself, ~60 lines, fully tested with a fake clock." },
      { file: "src/lib/incidents.ts", note: "Guards the incident recorder's database writes (breaker \"incident-db\")." },
      { file: "src/lib/capture-error.ts", note: "Guards the error-webhook forwarder (breaker \"error-webhook\") — a dead webhook used to cost every error 4 seconds." },
    ],
    gap: "Not yet around the calls that would benefit most: the AI providers, Paystack, LiveKit and the mail transport. Each is a one-line wrap once you have decided what \"down\" should mean for that feature.",
    live: "breaker",
  },
  {
    id: "retry",
    number: "04",
    name: "Retry with Backoff",
    problem: "Many failures are momentary — a cold database, a dropped connection. Failing the user for a blip is needless; retrying instantly, together with everyone else, makes the blip an outage.",
    idea: "Wait, retry, wait longer (1s, 2s, 4s…), add randomness so clients do not retry in lockstep, and stop after a limit. Only for operations that are safe to repeat.",
    status: "here",
    where: [
      { file: "src/lib/prisma-cold-start-retry.ts", note: "Neon suspends when idle; the first query can fail with P1001. Retrying is safe HERE because P1001 means the connection was never made — nothing reached the server, so a repeat cannot double-write. That is the idempotency condition on the slide." },
      { file: "src/lib/email-queue.ts · sms-queue.ts · webhooks.ts", note: "The queue-and-drain form of retry: a failed send stays queued and the cron tick tries again later." },
      { file: "src/lib/resilience.ts", note: "retryWithBackoff(): the general tool, with jitter — new, not yet used in a live path." },
    ],
    gap: "Never wrap a payment call in a blind retry. Charging twice is the classic failure; it needs an idempotency key first.",
  },
  {
    id: "bulkhead",
    number: "05",
    name: "Bulkhead",
    problem: "One overloaded workload uses every connection and thread, and everything else — including students signing in — starves with it.",
    idea: "Give each kind of work its own fixed share. When its compartment floods, the rest of the ship floats. When a compartment is full, turn work away instead of queueing without limit.",
    status: "new",
    where: [
      { file: "src/lib/resilience.ts", note: "createBulkhead(): a small concurrency limiter with a bounded queue." },
      { file: "src/lib/incidents.ts", note: "The incident recorder gets 2 concurrent writes and a queue of 20 (bulkhead \"incident-writes\"), so error handling can never eat the database connections real requests need." },
    ],
    gap: "Look at src/app/api/cron/tick/route.ts: 30-odd jobs run one after another in a single function. A slow job (a transcription, an AI call) delays every job behind it and shares that function's memory. Splitting the heavy jobs into their own compartments is the natural next bulkhead.",
    live: "bulkhead",
  },
];

const REQUEST_PATH: Array<{ step: string; file: string; detail: string }> = [
  { step: "Browser", file: "", detail: "A student taps something. The request leaves their phone." },
  { step: "Front door", file: "src/proxy.ts", detail: "The gateway: security headers, rate limit, which paths need what. Runs before any route code." },
  { step: "Route handler", file: "src/app/api/**/route.ts", detail: "The BFF for that screen. Calls requireAuthSession() / requireCapability(), which also sets up the tenant scope and the audit actor for the rest of the request (AsyncLocalStorage)." },
  { step: "Rules", file: "src/lib/*", detail: "Business rules live here, once — accessFromStudent(), portalVerdict(). Routes call them; they do not re-derive them." },
  { step: "Database client", file: "src/lib/prisma.ts", detail: "Not one thing but an onion of layers each query passes through: cold-start retry → guard (soft-delete, audit trail, refuses bulk deletes) → tenant filter (adds the school's tenantId) → the query." },
  { step: "Neon Postgres", file: "", detail: "The data. Pooled connections; suspends when idle, which is why the outermost layer retries." },
  { step: "When it fails", file: "src/instrumentation.ts → capture-error.ts → incidents.ts", detail: "Next reports the error; it is logged, recorded as a deduplicated Incident (behind a bulkhead and a breaker), and appears in Mission Control." },
];

function Live({ items }: { items: Snapshot[] }) {
  if (items.length === 0) return <p className="text-xs text-[var(--muted)]">Nothing registered on this server instance yet.</p>;
  return (
    <ul className="space-y-1.5">
      {items.map((item) =>
        item.kind === "breaker" ? (
          <li key={item.name} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <code className="rounded bg-black/5 px-1.5 py-0.5">{item.name}</code>
            <span
              className={`rounded-full px-2 py-0.5 font-bold uppercase tracking-wide ${
                item.state === "closed" ? "bg-emerald-500/15 text-emerald-600" : item.state === "open" ? "bg-red-500/15 text-red-500" : "bg-amber-500/15 text-amber-600"
              }`}
            >
              {item.state}
            </span>
            <span className="text-[var(--muted)]">{item.consecutiveFailures} failures in a row · {item.rejected} calls refused</span>
            {item.lastError && <span className="truncate text-[var(--muted)]">last: {item.lastError}</span>}
          </li>
        ) : (
          <li key={item.name} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <code className="rounded bg-black/5 px-1.5 py-0.5">{item.name}</code>
            <span className="tabular-nums">{item.active}/{item.maxConcurrent} running</span>
            <span className="tabular-nums text-[var(--muted)]">{item.queued}/{item.maxQueue} waiting · {item.rejected} turned away</span>
          </li>
        ),
      )}
    </ul>
  );
}

export default function PatternsPanel({ resilience }: { resilience: Snapshot[] }) {
  const [open, setOpen] = useState<string | null>("breaker");

  return (
    <div className="space-y-8">
      <section className={card}>
        <h2 className="text-lg font-bold">Build systems that survive reality</h2>
        <p className="mt-2 max-w-3xl text-sm text-[var(--muted)]">
          Scalability is not only handling more traffic — it is handling failure gracefully. Below are five patterns for that, the
          way they show up in <em>this</em> system: which are already here, which this console added, and the honest gaps. Open the
          files named next to each; reading real code beats reading about it.
        </p>
        <div className="mt-4 grid gap-3 text-xs sm:grid-cols-3">
          <div className="rounded-2xl border border-[var(--border)] p-3"><p className="font-bold">Retry</p><p className="mt-1 text-[var(--muted)]">for a <strong>momentary</strong> fault. &ldquo;Wait a moment and try again.&rdquo;</p></div>
          <div className="rounded-2xl border border-[var(--border)] p-3"><p className="font-bold">Circuit breaker</p><p className="mt-1 text-[var(--muted)]">for a <strong>sustained</strong> fault. &ldquo;It is not working — stop asking.&rdquo;</p></div>
          <div className="rounded-2xl border border-[var(--border)] p-3"><p className="font-bold">Bulkhead</p><p className="mt-1 text-[var(--muted)]">for a fault that must not <strong>spread</strong>. &ldquo;You only get your own share.&rdquo;</p></div>
        </div>
      </section>

      <section>
        <h3 className="mb-3 text-base font-bold">The life of one request</h3>
        <ol className="space-y-2">
          {REQUEST_PATH.map((row, index) => (
            <li key={row.step} className="flex gap-3">
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--accent)]/15 text-xs font-bold text-[var(--accent)]">{index + 1}</span>
              <div className="min-w-0">
                <p className="text-sm font-semibold">{row.step}{row.file && <code className="ml-2 rounded bg-black/5 px-1.5 py-0.5 text-[11px] font-normal">{row.file}</code>}</p>
                <p className="text-xs text-[var(--muted)]">{row.detail}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="space-y-3">
        {PATTERNS.map((p) => {
          const isOpen = open === p.id;
          const items = resilience.filter((r) => r.kind === p.live);
          return (
            <div key={p.id} className={card}>
              <button type="button" onClick={() => setOpen(isOpen ? null : p.id)} className="flex w-full items-start gap-4 text-left">
                <span className="font-mono text-xs font-bold text-[var(--accent)]">{p.number}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-base font-bold">{p.name}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${STATUS[p.status].tone}`}>{STATUS[p.status].label}</span>
                  </span>
                  <span className="mt-1 block text-xs text-[var(--muted)]">{p.idea}</span>
                </span>
                <span className="text-[var(--muted)]">{isOpen ? "−" : "+"}</span>
              </button>

              {isOpen && (
                <div className="mt-4 space-y-4 border-t border-[var(--border)] pt-4 text-sm">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--muted)]">The problem</p>
                    <p className="mt-1">{p.problem}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--muted)]">Where it lives here</p>
                    <ul className="mt-1 space-y-2">
                      {p.where.map((w) => (
                        <li key={w.file}>
                          <code className="rounded bg-black/5 px-1.5 py-0.5 text-[11px]">{w.file}</code>
                          <p className="mt-0.5 text-xs text-[var(--muted)]">{w.note}</p>
                        </li>
                      ))}
                    </ul>
                  </div>
                  {p.live && (
                    <div className="rounded-2xl border border-[var(--border)] p-3">
                      <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--muted)]">Live · this server instance only</p>
                      <Live items={items} />
                    </div>
                  )}
                  <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-3">
                    <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-amber-600">The honest gap</p>
                    <p className="mt-1 text-xs">{p.gap}</p>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </section>
    </div>
  );
}
