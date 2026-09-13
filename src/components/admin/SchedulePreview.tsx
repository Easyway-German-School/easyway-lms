"use client";

import { useEffect, useState } from "react";

type PreviewSession = { date: string; weekday: string; startTime: string; endTime: string; topic: string };
type Preview = { slotLabel: string; startTime: string; endTime: string; sessions: PreviewSession[] };

/**
 * "HERE IS THE TIMETABLE YOU ARE ABOUT TO PUT THEM ON."
 *
 * Read-only, and re-fetches whenever branch/level/session change — so moving a
 * student onto Weekend or the Online branch is a decision made looking at
 * their actual upcoming sessions, not a label picked from a dropdown. See
 * /api/admin/students/schedule-preview, which reuses the real rotation engine.
 *
 * Renders nothing until all three inputs are set, and nothing for a private
 * (one-to-one) student — private students follow no cohort timetable at all,
 * so a preview here would just be wrong.
 */
export default function SchedulePreview({
  branchId,
  level,
  sessionSlot,
  registeredAt,
  batch,
  classType,
}: {
  branchId: string;
  level: string;
  sessionSlot: string;
  registeredAt?: string | null;
  batch?: string | null;
  classType?: string;
}) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  const ready = Boolean(branchId && level && sessionSlot && classType !== "private");

  useEffect(() => {
    if (!ready) {
      setPreview(null);
      setFailed(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    const params = new URLSearchParams({ branchId, level, sessionSlot });
    if (registeredAt) params.set("registeredAt", registeredAt);
    if (batch) params.set("batch", batch);
    // Debounced — these three fields tend to change together as an admin
    // clicks through a few dropdowns, and each keystroke should not fire a
    // request of its own.
    const timer = window.setTimeout(() => {
      fetch(`/api/admin/students/schedule-preview?${params.toString()}`, { cache: "no-store" })
        .then((res) => (res.ok ? res.json() : Promise.reject(new Error("bad response"))))
        .then((data: Preview) => {
          if (!cancelled) setPreview(data);
        })
        .catch(() => {
          if (!cancelled) setFailed(true);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [ready, branchId, level, sessionSlot, registeredAt, batch]);

  if (!ready) return null;

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-alt)] p-4 sm:col-span-2">
      <p className="text-xs font-bold uppercase tracking-wide text-[var(--muted)]">Their timetable, with this change</p>
      {loading && !preview ? (
        <p className="mt-2 text-sm text-[var(--muted)]">Loading…</p>
      ) : failed ? (
        <p className="mt-2 text-sm text-[var(--muted)]">Could not load a preview right now.</p>
      ) : preview ? (
        <>
          <p className="mt-1 text-sm font-semibold text-[var(--foreground)]">
            {preview.slotLabel} · {preview.startTime}–{preview.endTime}
          </p>
          {preview.sessions.length ? (
            <ul className="mt-2 space-y-1 text-sm text-[var(--foreground-soft)]">
              {preview.sessions.map((session) => (
                <li key={session.date}>
                  {session.weekday},{" "}
                  {new Date(session.date).toLocaleDateString(undefined, { day: "numeric", month: "short" })} —{" "}
                  {session.topic}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-[var(--muted)]">No upcoming sessions found for this combination yet.</p>
          )}
        </>
      ) : null}
    </div>
  );
}
