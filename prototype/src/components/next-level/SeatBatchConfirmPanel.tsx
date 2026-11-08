"use client";

import { useEffect, useState } from "react";
import Mascot from "@/components/Mascot";

type Pending = {
  level: string;
  held: { month: string; year: number };
  open: { month: string; year: number };
};

/**
 * Becca's "did you really mean this?" check, sitting above the next-level
 * journey. Only renders when there is an unusually far-out held batch
 * waiting on an answer — see lib/seat-batch-confirm.ts for why this exists
 * (a seat held a full year out, which the portal lock could not see until
 * it was written with its year attached).
 */
export default function SeatBatchConfirmPanel() {
  const [pending, setPending] = useState<Pending | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<null | "confirmed" | "mistake">(null);
  const [done, setDone] = useState<"confirmed" | "mistake" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/student/seat-confirm", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return;
        setPending(data?.pending ?? null);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!loaded || (!pending && !done)) return null;

  async function answer(decision: "confirmed" | "mistake") {
    setBusy(decision);
    setError(null);
    try {
      const res = await fetch("/api/student/seat-confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      if (!res.ok) throw new Error();
      setDone(decision);
    } catch {
      setError("Could not save that just now — please try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mb-6 overflow-hidden rounded-[28px] border border-[var(--accent)]/30 bg-[var(--accent-soft)] p-6 sm:p-7">
      <div className="flex items-start gap-4">
        <Mascot mood={done ? "cheerful" : "thinking"} className="h-16 w-16 shrink-0" />
        <div className="min-w-0 flex-1">
          {done ? (
            <>
              <h2 className="text-lg font-bold text-[var(--foreground)]">
                {done === "confirmed" ? "Seat held — thank you!" : "All sorted!"}
              </h2>
              <p className="mt-2 text-sm leading-6 text-[var(--foreground-soft)]">
                {done === "confirmed"
                  ? `Your ${pending?.level ?? ""} seat is locked in for that batch — your portal will open right on time.`
                  : `You're moved onto the batch that's running now — your portal is open.`}
              </p>
            </>
          ) : pending ? (
            <>
              <h2 className="text-lg font-bold text-[var(--foreground)]">Quick check on your seat</h2>
              <p className="mt-2 text-sm leading-6 text-[var(--foreground-soft)]">
                You asked to keep your seat in <strong>{pending.level}</strong> for the{" "}
                <strong>
                  {pending.held.month} {pending.held.year}
                </strong>{" "}
                batch — that's quite a way off, so I want to check it's really what you meant before I lock it in.
              </p>
              <p className="mt-2 text-sm leading-6 text-[var(--foreground-soft)]">
                If that's right, I'll hold it exactly as you said. If it was a mix-up, I can move you straight into
                the <strong>{pending.open.month} {pending.open.year}</strong> batch instead, which is open right
                now.
              </p>
              {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => answer("confirmed")}
                  className="rounded-full bg-[var(--accent)] px-5 py-2 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-60"
                >
                  {busy === "confirmed" ? "Holding it…" : `Yes, keep ${pending.held.month} ${pending.held.year}`}
                </button>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => answer("mistake")}
                  className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-5 py-2 text-sm font-semibold text-[var(--foreground)] transition hover:bg-[var(--surface-soft)] disabled:opacity-60"
                >
                  {busy === "mistake"
                    ? "Moving you…"
                    : `No — move me to ${pending.open.month} ${pending.open.year}`}
                </button>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
