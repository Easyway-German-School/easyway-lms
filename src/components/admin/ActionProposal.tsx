"use client";

import { useEffect, useState } from "react";
import {
  AlertIcon,
  CheckCircleIcon,
  CheckIcon,
  ClockIcon,
  CrossIcon,
  UsersIcon,
} from "@/components/icons";

/**
 * The card that stands between what the assistant suggested and what the school
 * did.
 *
 * ---------------------------------------------------------------------------
 * THIS IS A READING SURFACE FIRST AND A BUTTON SECOND
 *
 * The whole safety argument for letting a language model act is that a person
 * checks the plan, so the card is laid out for someone who is about to be
 * responsible for it rather than for someone who wants to get on with their
 * day. The COUNT is the biggest thing on it, because the count is what catches
 * the mistake that actually happens: a model that misread "unpaid" as "not
 * fully paid" produces a card saying 214 where the reader expected thirty, and
 * 214 in large type is impossible to skim past.
 *
 * Under it sit the exact words that will be sent, four of the real people it
 * will reach, and anything odd about the plan in amber. The named people matter
 * more than they look — they turn "trust the number" into "recognise the
 * names", which is a thing a front-desk worker can actually do.
 *
 * ---------------------------------------------------------------------------
 * THE CONFIRM BUTTON IS DELIBERATELY NOT THE EASIEST THING TO PRESS
 *
 * It is not focused, it does not sit under the cursor, and for an irreversible
 * action it is rose rather than green — green reads as "safe to proceed", which
 * is exactly the wrong reflex to build for a send that cannot be recalled. The
 * countdown is honest rather than pressuring: it says the list may drift, not
 * that the offer expires.
 *
 * Once run, the card becomes a receipt. It does not disappear, because the one
 * thing an admin wants ten seconds after confirming is to check what they just
 * did.
 */

export type Proposal = {
  id: string;
  kind: string;
  summary: string;
  reversible: boolean;
  expiresAt: string;
  preview: {
    summary: string;
    affected: number;
    lines: string[];
    warnings: string[];
    sample: Array<{ name: string; detail: string }>;
    reversible: boolean;
  };
};

/** Human labels, so the card never shows a snake_case tool name. */
const KIND_LABELS: Record<string, string> = {
  message_students: "Message students",
  send_fee_reminders: "Fee reminders",
  mark_attendance: "Attendance register",
  promote_students: "Level promotion",
  postpone_class: "Class change",
  invite_leads: "Enrolment invites",
};

function useCountdown(iso: string): { minutes: number; expired: boolean } {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    // Ten seconds, not one: this drives a minutes display, and a per-second
    // timer would re-render the card sixty times to change nothing.
    const timer = window.setInterval(() => setNow(Date.now()), 10_000);
    return () => window.clearInterval(timer);
  }, []);

  const remaining = new Date(iso).getTime() - now;
  return { minutes: Math.max(0, Math.ceil(remaining / 60_000)), expired: remaining <= 0 };
}

export default function ActionProposal({
  proposal,
  onDone,
}: {
  proposal: Proposal;
  /** Told when the plan ran, so the page can refresh the figures above. */
  onDone?: (summary: string) => void;
}) {
  const [state, setState] = useState<"pending" | "running" | "done" | "cancelled">("pending");
  const [result, setResult] = useState("");
  const [error, setError] = useState("");
  const { minutes, expired } = useCountdown(proposal.expiresAt);

  const { preview } = proposal;
  const label = KIND_LABELS[proposal.kind] ?? proposal.kind.replace(/_/g, " ");

  // A new proposal reuses this component, and a stale "done" banner on a fresh
  // plan would tell somebody their action ran when it has not been offered yet.
  useEffect(() => {
    setState("pending");
    setResult("");
    setError("");
  }, [proposal.id]);

  async function run(cancel: boolean) {
    setError("");
    setState("running");
    try {
      const response = await fetch("/api/admin/assistant/act", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId: proposal.id, cancel }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(data.error ?? "That did not go through.");
        setState("pending");
        return;
      }

      if (cancel) {
        setState("cancelled");
        return;
      }

      setResult(data.summary ?? "Done.");
      setState("done");
      onDone?.(data.summary ?? "Done.");
    } catch {
      setError("Could not reach the server.");
      setState("pending");
    }
  }

  if (state === "cancelled") {
    return (
      <section className="mt-4 flex items-center gap-2 rounded-2xl border border-[var(--border)] bg-[var(--surface-alt)] px-4 py-3 text-sm text-[var(--muted)]">
        <CrossIcon className="h-4 w-4 shrink-0" />
        Discarded — nothing was sent.
      </section>
    );
  }

  if (state === "done") {
    return (
      <section className="mt-4 rounded-3xl border border-emerald-200 bg-emerald-50 p-5">
        <p className="flex items-center gap-2 text-sm font-bold text-emerald-800">
          <CheckCircleIcon className="h-5 w-5 shrink-0" />
          {result}
        </p>
        <p className="mt-1.5 pl-7 text-xs text-emerald-700">
          {label} · recorded against your account.
        </p>
      </section>
    );
  }

  const irreversible = !proposal.reversible;

  return (
    <section
      className={`mt-4 overflow-hidden rounded-3xl border-2 bg-[var(--surface)] ${
        irreversible ? "border-rose-200" : "border-[var(--accent)]/40"
      }`}
    >
      <header
        className={`flex flex-wrap items-center justify-between gap-2 px-5 py-3 ${
          irreversible ? "bg-rose-50" : "bg-[var(--accent)]/5"
        }`}
      >
        <span
          className={`text-[11px] font-bold uppercase tracking-[0.18em] ${
            irreversible ? "text-rose-700" : "text-[var(--accent)]"
          }`}
        >
          Waiting for you · {label}
        </span>
        <span className="flex items-center gap-1.5 text-[11px] font-semibold text-[var(--muted)]">
          <ClockIcon className="h-3.5 w-3.5" />
          {expired ? "List may have changed" : `Checked ${minutes} min ago at most`}
        </span>
      </header>

      <div className="p-5">
        {/* The count, in the largest type on the card. This is the number that
            catches a mis-read filter before it reaches anybody's phone. */}
        <div className="flex items-baseline gap-3">
          <span className="text-4xl font-black leading-none text-[var(--foreground)]">{preview.affected}</span>
          <span className="flex items-center gap-1.5 text-sm font-semibold text-[var(--muted)]">
            <UsersIcon className="h-4 w-4" />
            {preview.affected === 1 ? "person" : "people"} affected
          </span>
        </div>

        <p className="mt-2 text-base font-bold text-[var(--foreground)]">{preview.summary}</p>

        <ul className="mt-3 space-y-1.5">
          {preview.lines.map((line, index) => (
            <li key={index} className="flex gap-2 text-sm leading-relaxed text-[var(--foreground-soft)]">
              <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-slate-300" />
              <span className="whitespace-pre-wrap">{line}</span>
            </li>
          ))}
        </ul>

        {preview.sample.length > 0 && (
          <div className="mt-4 rounded-2xl bg-[var(--surface-alt)] p-3">
            <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--muted)]">
              Including
            </p>
            <div className="mt-1.5 space-y-1">
              {preview.sample.map((person) => (
                <p key={person.name} className="flex flex-wrap gap-x-2 text-xs text-[var(--foreground-soft)]">
                  <span className="font-semibold">{person.name}</span>
                  <span className="text-[var(--muted)]">{person.detail}</span>
                </p>
              ))}
              {preview.affected > preview.sample.length && (
                <p className="text-xs text-[var(--muted)]">
                  and {preview.affected - preview.sample.length} more
                </p>
              )}
            </div>
          </div>
        )}

        {preview.warnings.length > 0 && (
          <div className="mt-3 space-y-1.5 rounded-2xl border border-amber-200 bg-amber-50 p-3">
            {preview.warnings.map((warning, index) => (
              <p key={index} className="flex gap-2 text-xs leading-relaxed text-amber-900">
                <AlertIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {warning}
              </p>
            ))}
          </div>
        )}

        {error && (
          <p className="mt-3 flex items-center gap-2 rounded-xl bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
            <AlertIcon className="h-4 w-4 shrink-0" />
            {error}
          </p>
        )}

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => run(false)}
            disabled={state === "running"}
            className={`flex items-center gap-2 rounded-full px-5 py-3 text-sm font-bold text-white transition hover:brightness-110 disabled:opacity-50 ${
              irreversible ? "bg-rose-600" : "bg-[var(--accent)]"
            }`}
          >
            <CheckIcon className="h-4 w-4" strokeWidth={3} />
            {state === "running" ? "Carrying it out…" : `Yes — ${label.toLowerCase()}`}
          </button>
          <button
            type="button"
            onClick={() => run(true)}
            disabled={state === "running"}
            className="rounded-full border border-[var(--border)] px-4 py-3 text-sm font-bold text-[var(--muted)] transition hover:bg-[var(--surface-alt)] disabled:opacity-50"
          >
            Discard
          </button>
          <span className="text-[11px] text-[var(--muted)]">
            {irreversible
              ? "This cannot be undone from the portal."
              : "This can be changed afterwards on its own page."}
          </span>
        </div>
      </div>
    </section>
  );
}
