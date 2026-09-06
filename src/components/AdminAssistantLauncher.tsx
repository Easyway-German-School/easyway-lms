"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import ActionProposal, { type Proposal } from "@/components/admin/ActionProposal";
import { AlertIcon, ArrowRightIcon, CrossIcon, PulseIcon, RobotIcon } from "@/components/icons";
import {
  askAssistant,
  loadAssistant,
  type AssistantStatus,
  type AssistantTurn,
} from "@/lib/assistant-stream";

/**
 * The office assistant, one tap away from anywhere in the admin portal.
 *
 * Built to match CommunityLauncher — a floating button that opens an inline
 * panel so nobody has to leave the page they are on. It talks to the same
 * /api/admin/assistant endpoint as the full page at /admin/assistant and
 * streams the same way (see lib/assistant-stream). What it deliberately leaves
 * out is the roster table: a cohort of four hundred rows does not belong in a
 * corner popover, so a lookup answer here ends at the sentence and "Open full
 * view" is one click away for the list. Actions, which are the point of asking
 * from the front desk, DO appear — the confirm card is small enough to fit and
 * important enough to keep.
 */

const SUGGESTIONS = [
  "How many students owe tuition right now?",
  "Who hasn't paid and hasn't been seen in 3 weeks?",
  "Students per branch, broken down by level",
  "Chase everyone in Lagos who still owes tuition",
];

export default function AdminAssistantLauncher() {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<AssistantStatus | null>(null);
  const [loadedOnce, setLoadedOnce] = useState(false);

  const [turns, setTurns] = useState<AssistantTurn[]>([]);
  const [question, setQuestion] = useState("");
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState("");
  const [tools, setTools] = useState<string[]>([]);
  const [proposal, setProposal] = useState<Proposal | null>(null);

  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Status is only worth fetching once the panel is actually opened — an admin
  // who never touches it should not pay for the round trip on every page.
  useEffect(() => {
    if (!open || loadedOnce) return;
    setLoadedOnce(true);
    void loadAssistant().then((data) => {
      if (data) setStatus(data.status);
    });
  }, [open, loadedOnce]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns, thinking, proposal]);

  // Escape closes the panel.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  async function ask(text: string) {
    const trimmed = text.trim();
    if (!trimmed || thinking) return;

    setError("");
    setQuestion("");
    setProposal(null);
    setTools([]);
    const history = turns.slice(-6);
    setTurns((current) => [...current, { role: "user", content: trimmed }]);
    setThinking(true);

    let opened = false;
    let streamed = false;
    const appendToLastTurn = (content: string) =>
      setTurns((current) => {
        const next = [...current];
        next[next.length - 1] = { role: "assistant", content };
        return next;
      });

    await askAssistant(trimmed, history, {
      onOpen: () => {
        opened = true;
        setTurns((current) => [...current, { role: "assistant", content: "" }]);
      },
      onDelta: (full) => {
        streamed = true;
        appendToLastTurn(full);
      },
      onTool: (name) => setTools((current) => [...current, name]),
      onProposal: (p) => setProposal(p),
      onDone: (result) => {
        appendToLastTurn(result.answer);
        setTools(result.toolsUsed.map((t) => t.name));
        if (result.proposal !== undefined) setProposal(result.proposal);
        if (result.degraded) setError(result.degraded);
      },
      onError: (message) => {
        setError(message);
        if (opened && !streamed) setTurns((current) => current.slice(0, -1));
      },
    });

    setThinking(false);
  }

  const offline = Boolean(status && !status.ready);

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-3 print:hidden">
      {open && (
        <div className="flex w-[min(92vw,26rem)] flex-col overflow-hidden rounded-3xl border border-[var(--border)] bg-[var(--surface)] shadow-[0_28px_80px_rgba(15,23,42,0.28)]">
          {/* Header */}
          <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
            <div className="flex items-center gap-2.5">
              <span className="grid h-8 w-8 place-items-center rounded-xl bg-[var(--accent)]/10 text-[var(--accent)]">
                <RobotIcon className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--accent)]">
                  Office assistant
                </p>
                <p className="truncate text-xs text-[var(--muted)]">
                  {status
                    ? status.ready
                      ? `${status.model}${status.canAct ? " · can act" : ""}`
                      : "Offline — summary only"
                    : "Connecting…"}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <Link
                href="/admin/assistant"
                className="rounded-full border border-[var(--border)] px-2.5 py-1 text-[11px] font-semibold hover:bg-[var(--surface-alt)]"
              >
                Open full view
              </Link>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close assistant"
                className="rounded-full p-1.5 text-[var(--muted)] transition hover:bg-[var(--surface-alt)]"
              >
                <CrossIcon className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Transcript */}
          <div className="max-h-[24rem] min-h-[12rem] overflow-y-auto p-4">
            {turns.length === 0 ? (
              <div className="py-2 text-center">
                <p className="text-xs font-semibold text-[var(--foreground-soft)]">
                  Ask about students and fees — every figure comes from a live lookup.
                </p>
                <div className="mt-3 flex flex-wrap justify-center gap-1.5">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => ask(s)}
                      disabled={thinking || offline}
                      className="rounded-full border border-[var(--border)] px-2.5 py-1.5 text-[11px] font-medium text-[var(--muted)] transition hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-40"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {turns.map((turn, index) => (
                  <div
                    key={index}
                    className={`flex gap-2 ${turn.role === "user" ? "justify-end" : "justify-start"}`}
                  >
                    {turn.role === "assistant" && (
                      <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-[var(--accent)]/10 text-[var(--accent)]">
                        <RobotIcon className="h-3.5 w-3.5" />
                      </span>
                    )}
                    <div
                      className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-[13px] leading-relaxed ${
                        turn.role === "user"
                          ? "bg-[var(--accent)] text-white"
                          : "bg-[var(--surface-alt)] text-[var(--foreground)]"
                      }`}
                    >
                      {turn.content || "…"}
                    </div>
                  </div>
                ))}

                {thinking && (
                  <div className="flex gap-2">
                    <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-[var(--accent)]/10 text-[var(--accent)]">
                      <RobotIcon className="h-3.5 w-3.5" />
                    </span>
                    <div className="flex items-center gap-1.5 rounded-2xl bg-[var(--surface-alt)] px-3 py-3">
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

                {tools.length > 0 && (
                  <p className="flex flex-wrap items-center gap-1 text-[10px] text-[var(--muted)]">
                    <PulseIcon className="h-3 w-3" />
                    Looked up:
                    {tools.map((name, i) => (
                      <span
                        key={`${name}-${i}`}
                        className="rounded-full bg-[var(--surface-alt)] px-1.5 py-0.5 font-semibold"
                      >
                        {name}
                      </span>
                    ))}
                  </p>
                )}

                {proposal && <ActionProposal proposal={proposal} />}

                <div ref={endRef} />
              </div>
            )}
          </div>

          {error && (
            <p className="flex items-center gap-2 border-t border-[var(--border)] bg-red-500/5 px-4 py-2.5 text-xs text-red-600">
              <AlertIcon className="h-3.5 w-3.5 shrink-0" />
              {error}
            </p>
          )}

          <form
            onSubmit={(event) => {
              event.preventDefault();
              void ask(question);
            }}
            className="flex items-center gap-2 border-t border-[var(--border)] p-2.5"
          >
            <input
              ref={inputRef}
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder={offline ? "Assistant is offline" : "Ask, or ask it to chase, mark, move…"}
              className="min-w-0 flex-1 rounded-xl bg-[var(--surface-alt)] px-3 py-2.5 text-[13px] outline-none transition focus:bg-[var(--surface)] focus:ring-2 focus:ring-[var(--accent)]/30"
            />
            <button
              type="submit"
              disabled={thinking || !question.trim()}
              aria-label="Ask"
              className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[var(--accent)] text-white transition hover:brightness-110 disabled:opacity-40"
            >
              <ArrowRightIcon className="h-4 w-4" />
            </button>
          </form>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-label={open ? "Close assistant" : "Open the office assistant"}
        className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--accent)] text-white shadow-[0_12px_34px_rgba(255,102,0,0.42)] transition hover:scale-105 active:scale-95"
      >
        {open ? <CrossIcon className="h-6 w-6" /> : <RobotIcon className="h-7 w-7" />}
      </button>
    </div>
  );
}
