"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import type { CohortSummary } from "@/lib/look-cohorts";
import type { LookWave } from "@/lib/youth-look";

type Payload = { saved: LookWave; preview: LookWave; counts: CohortSummary };

function Count({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <div className="rounded-xl bg-[var(--surface-alt)] p-3">
      <p className="text-xl font-black tabular-nums text-[var(--foreground)]">{value}</p>
      <p className="text-xs font-semibold text-[var(--foreground-soft)]">{label}</p>
      {hint ? <p className="mt-0.5 text-[11px] text-[var(--muted)]">{hint}</p> : null}
    </div>
  );
}

/**
 * WHO GETS THE NEW STUDENT LOOK — the school's dial.
 *
 * The student always has the last word (their profile switch beats everything
 * here), so this only sets the DEFAULT: which students are moved onto the new
 * look with Becca's announcement. Everyone else is offered it once. Every
 * change is previewed with real counts before it is saved, so nobody finds out
 * how many people they just moved after the fact. Counts only — see
 * lib/look-cohorts.ts.
 */
export default function LookRolloutCard() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState("");
  const [maxAge, setMaxAge] = useState(24);
  const [includeUnknown, setIncludeUnknown] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const loaded = useRef(false);

  // Initial load, then a debounced preview every time a control moves.
  useEffect(() => {
    let active = true;
    const query = loaded.current ? `?maxAge=${maxAge}&includeUnknownAge=${includeUnknown}` : "";
    const timer = window.setTimeout(
      () => {
        fetch(`/api/admin/look-wave${query}`, { cache: "no-store" })
          .then(async (res) => {
            const body = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(body?.error || "Could not load the rollout.");
            return body as Payload;
          })
          .then((body) => {
            if (!active) return;
            setData(body);
            if (!loaded.current) {
              loaded.current = true;
              setMaxAge(body.saved.maxAge);
              setIncludeUnknown(body.saved.includeUnknownAge);
            }
            setError("");
          })
          .catch((e) => active && setError(e instanceof Error ? e.message : "Could not load the rollout."));
      },
      loaded.current ? 350 : 0,
    );
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [maxAge, includeUnknown]);

  const changed = data !== null && (maxAge !== data.saved.maxAge || includeUnknown !== data.saved.includeUnknownAge);

  async function save() {
    if (!data) return;
    setSaving(true);
    setMessage("");
    try {
      const res = await fetch("/api/admin/look-wave", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ maxAge, includeUnknownAge: includeUnknown }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || "Could not save.");
      setData({ ...data, saved: body.wave });
      setMessage("Saved. Students see the change the next time they open the portal.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  const c = data?.counts;

  return (
    <section className="mt-6 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-6">
      <h2 className="text-lg font-bold text-[var(--foreground)]">New student look — who gets it</h2>
      <p className="mt-1 text-xs text-[var(--muted)]">
        A phone-style menu, and avatars in the chat. Students up to the age below get it by
        default, with a one-time note from Becca. Everyone older is <em>offered</em> it once and keeps their familiar
        portal (with a WhatsApp/Facebook-style community) unless they say yes. Anyone can switch either way from their
        profile, and that always wins.{" "}
        <Link href="/admin/community" className="font-semibold text-[var(--accent)] underline">
          Community → Insights and People
        </Link>
        .
      </p>

      {error ? <p className="mt-3 text-sm font-semibold text-red-600">{error}</p> : null}

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="font-semibold text-[var(--foreground)]">Gets it by default up to age</span>
          <input
            type="number"
            min={0}
            max={120}
            value={maxAge}
            onChange={(e) => setMaxAge(Math.max(0, Math.min(120, Number(e.target.value) || 0)))}
            className="mt-1 w-full rounded-xl border border-[var(--border)] bg-[var(--surface-alt)] px-3 py-2"
          />
        </label>
      </div>
      <label className="mt-3 flex items-center gap-2 text-sm text-[var(--foreground-soft)]">
        <input type="checkbox" checked={includeUnknown} onChange={(e) => setIncludeUnknown(e.target.checked)} />
        Include students with no birth date on file in the default group
      </label>

      {c ? (
        <>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Count label="Get it by default" value={c.wave} hint="with Becca's note" />
            <Count label="Offered it once" value={c.invited} hint="everyone older, or no birth date" />
            <Count label="Seeing it now" value={`${c.seeingNew} / ${c.total}`} hint="choices included" />
            <Count label="Saw Becca's note" value={c.prompted} />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Count label="Went back to classic" value={c.waveWentBack} hint="of the default group" />
            <Count label="Offered who tried it" value={c.invitedTookIt} />
            <Count label="Opted in themselves" value={c.chose.youth} />
          </div>
        </>
      ) : (
        <p className="mt-4 text-sm text-[var(--muted)]">Loading…</p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={!changed || saving}
          className="rounded-full bg-[var(--accent)] px-5 py-2.5 text-sm font-bold text-white transition disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save rollout"}
        </button>
        {changed ? <span className="text-xs text-[var(--muted)]">Counts above are a preview of your change.</span> : null}
        {message ? <span className="text-xs font-semibold text-[var(--foreground-soft)]">{message}</span> : null}
      </div>
    </section>
  );
}
