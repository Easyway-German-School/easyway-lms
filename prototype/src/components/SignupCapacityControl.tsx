"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { availableBatchOptions } from "@/lib/intake";
import { MONTH_NAMES } from "@/lib/batch";
import { OFFERED_LEVELS } from "@/lib/levels";
import { parseClosedSignupSlots, type ClosedSignupSlot } from "@/lib/signup-availability";
import { TIME_SLOTS, slotLabel } from "@/lib/class-times";

type Props = {
  compact?: boolean;
};

async function fetchClosedSlots(): Promise<ClosedSignupSlot[]> {
  const response = await fetch("/api/admin/settings/signup-availability", { cache: "no-store" });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error((data as { error?: string } | null)?.error || "Could not load closed signup slots.");
  }
  const slots = (data as { closedSlots?: unknown } | null)?.closedSlots;
  if (!Array.isArray(slots)) throw new Error("The signup availability response was invalid.");
  return parseClosedSignupSlots(slots);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Could not load closed signup slots.";
}

export default function SignupCapacityControl({ compact = false }: Props) {
  const batches = useMemo(() => availableBatchOptions(), []);
  const [batchKey, setBatchKey] = useState(
    () => `${batches[0]?.value ?? MONTH_NAMES[new Date().getMonth()]}|${batches[0]?.year ?? new Date().getFullYear()}`,
  );
  const [level, setLevel] = useState("A1");
  const [sessionSlot, setSessionSlot] = useState<(typeof TIME_SLOTS)[number]>("morning");
  const [closedSlots, setClosedSlots] = useState<ClosedSignupSlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const selectedBatch = batches.find((option) => `${option.value}|${option.year}` === batchKey) ?? batches[0];

  const load = useCallback(async () => {
    try {
      setClosedSlots(await fetchClosedSlots());
      setMessage(null);
    } catch (error) {
      setMessage({
        tone: "error",
        text: errorMessage(error),
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchClosedSlots()
      .then((slots) => {
        if (!cancelled) {
          setClosedSlots(slots);
          setMessage(null);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) setMessage({ tone: "error", text: errorMessage(error) });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const updateClosedSlots = useCallback(
    async (nextSlots: ClosedSignupSlot[], key: string, confirmation: string) => {
      if (!window.confirm(confirmation)) return;
      setBusyKey(key);
      setMessage(null);
      try {
        const response = await fetch("/api/admin/settings/signup-availability", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ closedSlots: nextSlots }),
        });
        const data = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error((data as { error?: string } | null)?.error || "Could not update signup availability.");
        }
        const slots = (data as { closedSlots?: unknown } | null)?.closedSlots;
        if (!Array.isArray(slots)) throw new Error("The saved signup availability response was invalid.");
        setClosedSlots(parseClosedSignupSlots(slots));
        setMessage({ tone: "ok", text: "Signup availability updated." });
      } catch (error) {
        setMessage({
          tone: "error",
          text: error instanceof Error ? error.message : "Could not update signup availability.",
        });
      } finally {
        setBusyKey(null);
      }
    },
    [],
  );

  const slotKey = (slot: ClosedSignupSlot) =>
    `${slot.batch}|${slot.year}|${slot.level}|${slot.sessionSlot}`;
  const selection: ClosedSignupSlot | null = selectedBatch
    ? { batch: selectedBatch.value, year: selectedBatch.year, level, sessionSlot }
    : null;
  const selectionKey = selection ? slotKey(selection) : "";
  const selectionIsClosed = closedSlots.some((slot) => slotKey(slot) === selectionKey);

  return (
    <section className={`rounded-3xl border border-[var(--border)] bg-[var(--surface)] shadow-sm ${compact ? "p-4 sm:p-5" : "p-6"}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-[var(--foreground)]">Signup slot capacity</h2>
          <p className="mt-1 max-w-3xl text-sm text-[var(--muted)]">
            Close only the selected batch, year, level, and session to new group signups. Existing learners are not changed.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setLoading(true);
            void load();
          }}
          disabled={loading}
          className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-semibold text-[var(--foreground)] disabled:opacity-50"
        >
          {loading ? "Loading..." : "Refresh"}
        </button>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-sm font-medium text-[var(--foreground)]">
          Batch
          <select
            value={batchKey}
            onChange={(event) => setBatchKey(event.target.value)}
            className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2"
          >
            {batches.map((option) => (
              <option key={`${option.value}|${option.year}`} value={`${option.value}|${option.year}`}>{option.label}</option>
            ))}
          </select>
        </label>
        <label className="text-sm font-medium text-[var(--foreground)]">
          Level
          <select
            value={level}
            onChange={(event) => setLevel(event.target.value)}
            className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2"
          >
            {OFFERED_LEVELS.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
        <label className="text-sm font-medium text-[var(--foreground)]">
          Session
          <select
            value={sessionSlot}
            onChange={(event) => setSessionSlot(event.target.value as (typeof TIME_SLOTS)[number])}
            className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2"
          >
            {TIME_SLOTS.map((slot) => <option key={slot} value={slot}>{slotLabel(slot)}</option>)}
          </select>
        </label>
        <div className="flex items-end">
          <button
            type="button"
            onClick={() => {
              if (!selection || selectionIsClosed) return;
              void updateClosedSlots(
                [...closedSlots, selection],
                selectionKey,
                `Mark ${selection.batch} ${selection.year} ${selection.level} ${selection.sessionSlot} full for new group signups? Existing students will not be affected.`,
              );
            }}
            disabled={loading || !selection || selectionIsClosed || busyKey !== null}
            className="w-full rounded-lg bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {selectionIsClosed ? "Already marked full" : busyKey === selectionKey ? "Saving..." : "Mark slot full"}
          </button>
        </div>
      </div>

      {message && (
        <p role={message.tone === "error" ? "alert" : "status"} className={`mt-3 text-sm font-medium ${message.tone === "ok" ? "text-emerald-700" : "text-red-700"}`}>
          {message.text}
        </p>
      )}

      <div className="mt-5 border-t border-[var(--border)] pt-4">
        <h3 className="text-sm font-bold text-[var(--foreground)]">Currently full signup slots</h3>
        {closedSlots.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--muted)]">{loading ? "Loading..." : "No signup slots are marked full."}</p>
        ) : (
          <ul className="mt-2 divide-y divide-[var(--border)]">
            {closedSlots.map((slot) => {
              const key = slotKey(slot);
              return (
                <li key={key} className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm">
                  <span className="font-medium text-[var(--foreground)]">
                    {slot.batch} {slot.year} · {slot.level} · {slotLabel(slot.sessionSlot)}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      void updateClosedSlots(
                        closedSlots.filter((item) => slotKey(item) !== key),
                        key,
                        `Reopen ${slot.batch} ${slot.year} ${slot.level} ${slot.sessionSlot} for new signups?`,
                      )
                    }
                    disabled={busyKey !== null}
                    className="rounded-lg border border-[var(--border)] px-3 py-1.5 font-semibold text-[var(--foreground)] disabled:opacity-50"
                  >
                    {busyKey === key ? "Saving..." : "Reopen"}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
