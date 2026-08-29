"use client";

import { useState } from "react";

/**
 * The one interactive thing on the EduPrime site: a school owner asking to be
 * onboarded.
 *
 * The platform has no self-service signup by design — an operator creates every
 * tenant by hand — so this does not create an account. It posts to
 * `/api/platform/enquiry`, which logs the request and, if a webhook is
 * configured, pings it. The form always shows success as long as the request
 * was accepted: whether the operator's inbox is wired up is not the
 * enquirer's problem to see.
 */

type State = "idle" | "sending" | "sent" | "error";

export default function DemoRequestForm() {
  const [state, setState] = useState<State>("idle");
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    email: "",
    school: "",
    role: "",
    students: "",
    message: "",
  });

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || !form.email.trim() || !form.school.trim()) {
      setError("Your name, a work email and the school's name — the rest is optional.");
      setState("error");
      return;
    }
    setState("sending");
    setError(null);
    try {
      const res = await fetch("/api/platform/enquiry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Failed with ${res.status}`);
      setState("sent");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send that. Try again in a moment.");
      setState("error");
    }
  }

  if (state === "sent") {
    return (
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-8 text-center">
        <div
          className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full text-white"
          style={{ background: "var(--eduprime-mint, #10B981)" }}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <h3 className="text-lg font-semibold">Got it.</h3>
        <p className="mx-auto mt-2 max-w-sm text-sm text-[var(--muted)]">
          An operator will be in touch to walk through your school&apos;s setup — domain, branding,
          which features you want live, and pricing against your real usage.
        </p>
      </div>
    );
  }

  const field =
    "w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2.5 text-sm outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[color-mix(in_srgb,var(--primary)_35%,transparent)]";

  return (
    <form onSubmit={submit} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 sm:p-8">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-1.5">
          <span className="text-xs font-semibold text-[var(--muted)]">Your name</span>
          <input className={field} value={form.name} onChange={(e) => set("name", e.target.value)} />
        </label>
        <label className="space-y-1.5">
          <span className="text-xs font-semibold text-[var(--muted)]">Work email</span>
          <input className={field} type="email" value={form.email} onChange={(e) => set("email", e.target.value)} />
        </label>
        <label className="space-y-1.5">
          <span className="text-xs font-semibold text-[var(--muted)]">School / organisation</span>
          <input className={field} value={form.school} onChange={(e) => set("school", e.target.value)} />
        </label>
        <label className="space-y-1.5">
          <span className="text-xs font-semibold text-[var(--muted)]">Your role</span>
          <input
            className={field}
            placeholder="Founder, director, head of ops…"
            value={form.role}
            onChange={(e) => set("role", e.target.value)}
          />
        </label>
        <label className="space-y-1.5 sm:col-span-2">
          <span className="text-xs font-semibold text-[var(--muted)]">Roughly how many students?</span>
          <input
            className={field}
            placeholder="e.g. 120 active, growing"
            value={form.students}
            onChange={(e) => set("students", e.target.value)}
          />
        </label>
        <label className="space-y-1.5 sm:col-span-2">
          <span className="text-xs font-semibold text-[var(--muted)]">Anything you want us to know</span>
          <textarea
            className={`${field} min-h-[92px] resize-y`}
            value={form.message}
            onChange={(e) => set("message", e.target.value)}
          />
        </label>
      </div>

      {state === "error" && error && (
        <p className="mt-3 text-sm text-[var(--danger)]">{error}</p>
      )}

      <button
        type="submit"
        disabled={state === "sending"}
        className="eduprime-cta mt-5 inline-flex items-center gap-2 rounded-xl px-6 py-3 text-sm font-semibold disabled:opacity-60"
      >
        {state === "sending" ? "Sending…" : "Request onboarding"}
      </button>
      <p className="mt-3 text-xs text-[var(--muted)]">
        No account is created from this form. A person reads it.
      </p>
    </form>
  );
}
