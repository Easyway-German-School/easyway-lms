"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";

type Landing = {
  title: string;
  description: string | null;
  startAt: string;
  endAt: string | null;
  timezone: string;
  status: string;
  landing: { headline?: string; speakers?: { name: string; bio?: string }[]; agenda?: string[] } | null;
  registrationOpen: boolean;
  seatsLeft: number | null;
};

export default function WebinarLanding() {
  const { slug } = useParams<{ slug: string }>();
  const [data, setData] = useState<Landing | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/public/webinar/${slug}`, { cache: "no-store" });
    if (res.status === 404) {
      setNotFound(true);
      return;
    }
    if (res.ok) setData(await res.json());
  }, [slug]);

  useEffect(() => {
    load();
  }, [load]);

  async function register() {
    if (!email.trim()) return;
    setState("sending");
    setMsg(null);
    const res = await fetch(`/api/public/webinar/${slug}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email }),
    });
    const json = await res.json().catch(() => null);
    if (res.ok) {
      setState("done");
    } else {
      setState("error");
      setMsg(json?.error || "Something went wrong. Please try again.");
    }
  }

  if (notFound) {
    return (
      <main className="mx-auto flex min-h-screen max-w-lg items-center justify-center p-6 text-center">
        <p className="text-[var(--muted)]">This webinar link is not valid.</p>
      </main>
    );
  }
  if (!data) {
    return <main className="mx-auto max-w-lg p-6 text-[var(--muted)]">Loading…</main>;
  }

  const when = new Date(data.startAt).toLocaleString("en-GB", { dateStyle: "full", timeStyle: "short" });

  return (
    <main className="mx-auto max-w-2xl px-5 py-12">
      <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6 sm:p-8">
        {data.status === "live" && (
          <span className="mb-3 inline-flex items-center gap-1 rounded-full bg-rose-100 px-2.5 py-0.5 text-xs font-bold text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
            ● LIVE NOW
          </span>
        )}
        <h1 className="text-2xl font-bold text-[var(--foreground)]">{data.landing?.headline || data.title}</h1>
        <p className="mt-2 text-sm font-medium text-[var(--accent)]">
          {when} · {data.timezone}
        </p>
        {data.description && (
          <p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-[var(--foreground-soft)]">{data.description}</p>
        )}

        {data.landing?.agenda && data.landing.agenda.length > 0 && (
          <div className="mt-5">
            <h2 className="text-sm font-bold text-[var(--foreground)]">Agenda</h2>
            <ul className="mt-2 list-inside list-disc text-sm text-[var(--foreground-soft)]">
              {data.landing.agenda.map((a, i) => (
                <li key={i}>{a}</li>
              ))}
            </ul>
          </div>
        )}

        {data.landing?.speakers && data.landing.speakers.length > 0 && (
          <div className="mt-5">
            <h2 className="text-sm font-bold text-[var(--foreground)]">Speakers</h2>
            <ul className="mt-2 space-y-2">
              {data.landing.speakers.map((s, i) => (
                <li key={i} className="text-sm">
                  <span className="font-semibold text-[var(--foreground)]">{s.name}</span>
                  {s.bio && <span className="text-[var(--muted)]"> — {s.bio}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-8 border-t border-[var(--border)] pt-6">
          {state === "done" ? (
            <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">
              You&rsquo;re registered. Check your inbox for the confirmation — a joining link follows before it starts.
            </p>
          ) : !data.registrationOpen ? (
            <p className="text-sm text-[var(--muted)]">Registration is closed for this webinar.</p>
          ) : (
            <div className="space-y-3">
              <h2 className="text-sm font-bold text-[var(--foreground)]">
                Register{data.seatsLeft != null ? ` · ${data.seatsLeft} seats left` : ""}
              </h2>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-alt)] px-3 py-2.5 text-sm text-[var(--foreground)] outline-none focus:border-[var(--accent)]"
              />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-alt)] px-3 py-2.5 text-sm text-[var(--foreground)] outline-none focus:border-[var(--accent)]"
              />
              {msg && <p className="text-sm text-rose-600 dark:text-rose-400">{msg}</p>}
              <button
                onClick={register}
                disabled={state === "sending" || !email.trim()}
                className="w-full rounded-full bg-[var(--accent)] px-5 py-3 text-sm font-bold text-white transition hover:brightness-110 disabled:opacity-50"
              >
                {state === "sending" ? "Registering…" : "Register"}
              </button>
              <p className="text-[11px] text-[var(--muted)]">
                We&rsquo;ll only use your email for this webinar and the recording.
              </p>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
