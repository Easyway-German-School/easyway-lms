"use client";

import { useState } from "react";

/**
 * "Need help? — send message to the office" — a plain contact form, not the
 * nurture drip's prep-class upsell link. Embeddable anywhere: prefilled with
 * a bookingId/name/email on the booking page, bare in the site footer for a
 * question from someone who hasn't registered yet.
 */
export default function NeedHelp({
  bookingReference,
  defaultName,
  defaultEmail,
}: {
  bookingReference?: string;
  defaultName?: string;
  defaultEmail?: string;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(defaultName ?? "");
  const [email, setEmail] = useState(defaultEmail ?? "");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  async function send() {
    setSending(true);
    setError("");
    try {
      const res = await fetch("/api/support", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ bookingReference, name, email, message }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not send that");
      setSent(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send that");
    } finally {
      setSending(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-sm font-semibold text-[var(--navy)] underline underline-offset-4"
      >
        Need help?
      </button>
    );
  }

  if (sent) {
    return (
      <p className="rounded-sm bg-[var(--green-soft)] px-4 py-3 text-sm font-semibold text-[var(--green)]">
        Message sent — the office will get back to you at {email}.
      </p>
    );
  }

  return (
    <div className="seal-border rounded-sm bg-[var(--paper-raised)] p-4 text-left">
      <p className="text-xs font-bold uppercase tracking-wide text-[var(--ink-soft)]">Send a message to the office</p>
      {error && <p className="mt-2 text-xs text-[var(--red)]">{error}</p>}
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name"
          className="rounded-sm border border-[var(--line)] px-3 py-2 text-xs"
        />
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Your email"
          className="rounded-sm border border-[var(--line)] px-3 py-2 text-xs"
        />
      </div>
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="What do you need help with?"
        rows={3}
        className="mt-2 w-full rounded-sm border border-[var(--line)] px-3 py-2 text-xs"
      />
      <div className="mt-2 flex gap-2">
        <button
          onClick={send}
          disabled={!name.trim() || !email.trim() || !message.trim() || sending}
          className="rounded-sm bg-[var(--navy)] px-4 py-2 text-xs font-semibold text-white disabled:opacity-40"
        >
          {sending ? "Sending…" : "Send"}
        </button>
        <button onClick={() => setOpen(false)} className="rounded-sm border border-[var(--line)] px-4 py-2 text-xs font-semibold text-[var(--ink-soft)]">
          Cancel
        </button>
      </div>
    </div>
  );
}
