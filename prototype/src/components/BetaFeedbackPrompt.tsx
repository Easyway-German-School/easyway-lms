"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Mascot from "@/components/Mascot";

const SEEN_KEY = "easyway-beta-feedback-seen";
const FIRST_SEEN_KEY = "easyway-portal-first-seen";
// Give people a few real sessions before asking how it's going — a check-in
// on day one reads as needy, and it lands before they've formed an opinion.
const CHECK_IN_DELAY_MS = 3 * 24 * 3_600_000;
const kinds = [
  ["improve", "What needs improving?"],
  ["bug", "I found a bug"],
  ["love", "What is working well?"],
  ["idea", "I have an idea"],
] as const;

export default function BetaFeedbackPrompt() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [kind, setKind] = useState<(typeof kinds)[number][0]>("improve");
  const [analyticsEnabled, setAnalyticsEnabled] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    let active = true;
    fetch("/api/beta/feedback", { cache: "no-store" })
      .then((response) => response.json())
      .then((data) => {
        if (!active) return;
        setAnalyticsEnabled(Boolean(data.analyticsEnabled));
        if (typeof window === "undefined" || localStorage.getItem(SEEN_KEY)) return;

        const firstSeenRaw = localStorage.getItem(FIRST_SEEN_KEY);
        if (!firstSeenRaw) {
          // First visit ever — just start the clock, don't ask anything yet.
          localStorage.setItem(FIRST_SEEN_KEY, String(Date.now()));
          return;
        }
        if (Date.now() - Number(firstSeenRaw) >= CHECK_IN_DELAY_MS) setOpen(true);
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!message.trim() || sending) return;
    setSending(true);
    const response = await fetch("/api/beta/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, kind, path: pathname, analyticsEnabled }),
    });
    setSending(false);
    if (!response.ok) return;
    localStorage.setItem(SEEN_KEY, new Date().toISOString());
    setSent(true);
    window.setTimeout(() => setOpen(false), 1600);
  }

  if (!open) return null;
  return (
    <div className="fixed bottom-5 left-5 z-[70] w-[min(92vw,380px)] rounded-3xl border border-[var(--border-strong)] bg-[var(--surface)] p-5 shadow-2xl">
      <button type="button" aria-label="Close beta feedback" onClick={() => { localStorage.setItem(SEEN_KEY, new Date().toISOString()); setOpen(false); }} className="absolute right-3 top-3 text-xl text-[var(--muted)]">×</button>
      <div className="flex items-center gap-3 pr-6">
        <Mascot mood="curious" className="h-16 w-16 shrink-0" />
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--accent)]">Becca checking in</p>
          <h2 className="mt-1 text-lg font-bold text-[var(--foreground)]">How's it going so far?</h2>
        </div>
      </div>
      {sent ? <p className="mt-5 rounded-2xl bg-[var(--accent-soft)] px-4 py-3 text-sm font-semibold text-[var(--foreground)]">Thanks so much — your note just landed with the team.</p> : (
        <form onSubmit={submit} className="mt-4 space-y-3">
          <p className="text-xs leading-5 text-[var(--muted)]">You've been around a few days now — anything working great, or anything driving you crazy? We're listening.</p>
          <div className="grid grid-cols-2 gap-2">
            {kinds.map(([value, label]) => <button key={value} type="button" onClick={() => setKind(value)} className={`rounded-xl border px-2 py-2 text-left text-xs font-semibold ${kind === value ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]" : "border-[var(--border)] text-[var(--muted)]"}`}>{label}</button>)}
          </div>
          <textarea value={message} onChange={(event) => setMessage(event.target.value)} maxLength={2000} rows={4} placeholder="Tell Becca what's on your mind…" className="w-full resize-none rounded-2xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--accent)]" />
          <label className="flex gap-2 text-xs leading-5 text-[var(--muted)]"><input type="checkbox" checked={analyticsEnabled} onChange={(event) => setAnalyticsEnabled(event.target.checked)} className="mt-1" />Allow anonymous feature-level usage analytics so we can see what is useful. No messages, keystrokes, or page content are collected.</label>
          <button type="submit" disabled={!message.trim() || sending} className="w-full rounded-2xl bg-[var(--accent-strong)] px-4 py-3 text-sm font-bold text-white disabled:opacity-50">{sending ? "Sending…" : "Send to the team"}</button>
        </form>
      )}
    </div>
  );
}
