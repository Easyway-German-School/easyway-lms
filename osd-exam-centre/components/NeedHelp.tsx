"use client";

import { useState } from "react";
import { MailIcon } from "@/components/icons";
import { OFFICE } from "@/lib/config";

/**
 * "Need help? — send message to the office" — a plain contact form, not the
 * nurture drip's prep-class upsell link. Embeddable anywhere: prefilled with
 * a bookingId/name/email on the booking page, bare in the site footer for a
 * question from someone who hasn't registered yet.
 *
 * The trigger used to be a bare underlined "Need help?" text link — easy to
 * miss, and candidates who did notice it had no way to tell it actually
 * reached anyone before clicking. Now it's a proper button with a mail icon,
 * and the real office address sits next to it in plain text the whole time
 * — a guaranteed-works fallback for anyone who doesn't trust the in-app form.
 */
export default function NeedHelp({
  bookingReference,
  defaultName,
  defaultEmail,
  tone = "light",
}: {
  bookingReference?: string;
  defaultName?: string;
  defaultEmail?: string;
  /** "dark" for use on the navy footer, where the default navy link would vanish. */
  tone?: "light" | "dark";
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(defaultName ?? "");
  const [email, setEmail] = useState(defaultEmail ?? "");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [website, setWebsite] = useState(""); // honeypot

  async function send() {
    setSending(true);
    setError("");
    try {
      const res = await fetch("/api/support", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ bookingReference, name, email, message, website }),
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
      <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 ${tone === "dark" ? "" : "text-xs"}`}>
        <button
          onClick={() => setOpen(true)}
          className={
            tone === "dark"
              ? "inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-5 py-2 text-sm font-semibold text-white backdrop-blur transition hover:bg-white/20"
              : "inline-flex items-center gap-1.5 rounded-full border border-[var(--line)] bg-[var(--paper-raised)] px-3 py-1.5 font-semibold text-[var(--navy)] transition hover:border-[var(--gold)] hover:bg-[var(--gold-soft)]/30"
          }
        >
          <MailIcon className="h-4 w-4" />
          Email support
        </button>
        <a
          href={`mailto:${OFFICE.email}`}
          className={tone === "dark" ? "text-sm text-white/70 underline underline-offset-4 hover:text-white" : "text-[var(--ink-soft)] underline underline-offset-4 hover:text-[var(--navy)]"}
        >
          or write to {OFFICE.email} directly
        </a>
      </div>
    );
  }

  if (sent) {
    return (
      <p className="rounded-lg bg-[var(--green-soft)] px-4 py-3 text-sm font-semibold text-[var(--green)]">
        Message sent — the office will get back to you at {email}.
      </p>
    );
  }

  return (
    <div className="seal-border rounded-lg bg-[var(--paper-raised)] p-4 text-left">
      <p className="text-xs font-bold uppercase tracking-wide text-[var(--ink-soft)]">Send a message to the office</p>
      {error && <p className="mt-2 text-xs text-[var(--red)]">{error}</p>}
      <input
        type="text"
        value={website}
        onChange={(e) => setWebsite(e.target.value)}
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        style={{ position: "absolute", left: "-9999px", width: 1, height: 1, opacity: 0 }}
      />
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name"
          className="rounded-lg border border-[var(--line)] px-3 py-2 text-xs"
        />
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Your email"
          className="rounded-lg border border-[var(--line)] px-3 py-2 text-xs"
        />
      </div>
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="What do you need help with?"
        rows={3}
        className="mt-2 w-full rounded-lg border border-[var(--line)] px-3 py-2 text-xs"
      />
      <div className="mt-2 flex gap-2">
        <button
          onClick={send}
          disabled={!name.trim() || !email.trim() || !message.trim() || sending}
          className="rounded-lg bg-[var(--navy)] px-4 py-2 text-xs font-semibold text-white disabled:opacity-40"
        >
          {sending ? "Sending…" : "Send"}
        </button>
        <button onClick={() => setOpen(false)} className="rounded-lg border border-[var(--line)] px-4 py-2 text-xs font-semibold text-[var(--ink-soft)]">
          Cancel
        </button>
      </div>
    </div>
  );
}
