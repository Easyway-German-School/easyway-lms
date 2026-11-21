"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

/**
 * A standalone screen the office uses for one specific step: ÖSD hands
 * Easyway a candidate's own Panthexa registration link once their sitting is
 * confirmed, and the office pastes it in here so the candidate is emailed
 * immediately (see lib/journey.ts sendRegistrationLink). Kept apart from the
 * main /admin bookings screen on purpose — that page is mid-rework elsewhere
 * on this branch, and this tool has no dependency on it.
 */

type Booking = {
  id: string;
  referenceCode: string;
  fullName: string;
  email: string;
  source: string;
  examRegistrationLink: string | null;
  examRegistrationDeadline: string | null;
  registrationLinkSentAt: string | null;
  session: { title: string; level: string; startDate: string };
};

export default function RegistrationLinksPage() {
  const router = useRouter();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [form, setForm] = useState({ link: "", deadline: "" });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [onlyPending, setOnlyPending] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/bookings", { cache: "no-store" });
      if (res.status === 401) { router.push("/admin/login"); return; }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Unable to load bookings");
      setBookings(data.bookings ?? []);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load bookings");
    } finally {
      setLoaded(true);
    }
  }, [router]);

  useEffect(() => { load(); }, [load]);

  function startEntry(b: Booking) {
    setOpenId(b.id);
    setForm({
      link: b.examRegistrationLink ?? "",
      deadline: b.examRegistrationDeadline ? b.examRegistrationDeadline.slice(0, 10) : "",
    });
  }

  async function send(id: string) {
    setBusyId(id);
    setError("");
    try {
      const res = await fetch(`/api/admin/bookings/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ registrationLink: { link: form.link.trim(), deadline: form.deadline || undefined } }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not send that link");
      setOpenId(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send that link");
    } finally {
      setBusyId(null);
    }
  }

  if (!loaded) return <div className="p-8 text-sm text-[var(--ink-soft)]">Loading…</div>;

  const sorted = [...bookings].sort((a, b) => new Date(a.session.startDate).getTime() - new Date(b.session.startDate).getTime());
  const shown = onlyPending ? sorted.filter((b) => !b.registrationLinkSentAt) : sorted;

  return (
    <div className="min-h-screen bg-[var(--paper)] p-6">
      <div className="mx-auto max-w-3xl">
        <div className="flex items-center justify-between">
          <h1 className="font-serif-display text-2xl font-semibold text-[var(--navy)]">ÖSD registration links</h1>
          <Link href="/admin" className="rounded-sm border border-[var(--line)] px-4 py-2 text-sm font-semibold text-[var(--navy)]">← Bookings</Link>
        </div>
        <p className="mt-2 text-xs text-[var(--ink-soft)]">
          When ÖSD confirms a sitting and hands over a candidate&apos;s own Panthexa registration link, paste it
          in below — the candidate is emailed the link and its deadline immediately.
        </p>

        {error && <p className="mt-4 rounded-sm bg-[var(--red-soft)] px-4 py-3 text-sm text-[var(--red)]">{error}</p>}

        <div className="mt-4 flex gap-2">
          {([[true, "Not sent yet"], [false, "All"]] as const).map(([v, label]) => (
            <button
              key={label}
              onClick={() => setOnlyPending(v)}
              className={`rounded-sm px-4 py-2 text-sm font-semibold ${onlyPending === v ? "bg-[var(--navy)] text-white" : "border border-[var(--line)] text-[var(--ink-soft)]"}`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="mt-6 space-y-3">
          {shown.length === 0 && <p className="text-sm text-[var(--ink-soft)]">Nothing here.</p>}
          {shown.map((b) => (
            <div key={b.id} className="seal-border rounded-sm bg-white p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-semibold text-[var(--navy)]">
                    {b.fullName} <span className="font-normal text-[var(--ink-soft)]">({b.email})</span>
                  </p>
                  <p className="text-xs text-[var(--ink-soft)]">
                    {b.session.title} · {new Date(b.session.startDate).toLocaleDateString()} · <span className="font-mono">{b.referenceCode}</span>
                    {b.source === "panthexa" && <span className="ml-1 rounded-sm bg-[var(--gold-soft)] px-1.5 py-0.5 text-[10px] font-bold uppercase text-[var(--navy)]">Panthexa</span>}
                  </p>
                  {b.registrationLinkSentAt && (
                    <p className="mt-1 text-[11px] font-semibold text-[var(--green)]">
                      Sent {new Date(b.registrationLinkSentAt).toLocaleString()}
                      {b.examRegistrationDeadline && ` · deadline ${new Date(b.examRegistrationDeadline).toLocaleDateString()}`}
                    </p>
                  )}
                </div>
                {openId !== b.id && (
                  <button
                    onClick={() => startEntry(b)}
                    className="rounded-sm border border-[var(--line)] px-3 py-1.5 text-xs font-semibold text-[var(--ink-soft)] hover:border-[var(--navy)] hover:text-[var(--navy)]"
                  >
                    {b.registrationLinkSentAt ? "Resend / correct" : "Enter link"}
                  </button>
                )}
              </div>

              {openId === b.id && (
                <div className="mt-3 grid gap-2 border-t border-[var(--line)] pt-3 sm:grid-cols-[2fr_1fr]">
                  <label className="block">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--ink-soft)]">Registration link</span>
                    <input
                      type="url"
                      value={form.link}
                      placeholder="https://osd-examregistration.com/register/..."
                      onChange={(e) => setForm({ ...form, link: e.target.value })}
                      className="mt-0.5 w-full rounded-sm border border-[var(--line)] px-3 py-1.5 text-xs focus:border-[var(--navy)] focus:outline-none"
                    />
                  </label>
                  <label className="block">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--ink-soft)]">Deadline (optional)</span>
                    <input
                      type="date"
                      value={form.deadline}
                      onChange={(e) => setForm({ ...form, deadline: e.target.value })}
                      className="mt-0.5 w-full rounded-sm border border-[var(--line)] px-3 py-1.5 text-xs focus:border-[var(--navy)] focus:outline-none"
                    />
                  </label>
                  <div className="flex gap-2 sm:col-span-2">
                    <button
                      onClick={() => send(b.id)}
                      disabled={busyId === b.id || !form.link.trim()}
                      className="rounded-sm bg-[var(--navy)] px-4 py-2 text-xs font-semibold text-white disabled:opacity-40"
                    >
                      {busyId === b.id ? "Sending…" : "Save & email candidate"}
                    </button>
                    <button onClick={() => setOpenId(null)} className="rounded-sm border border-[var(--line)] px-4 py-2 text-xs font-semibold text-[var(--ink-soft)]">
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
