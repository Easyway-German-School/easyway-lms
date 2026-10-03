"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { MoveUpPreview } from "@/lib/next-level-manual-server";

/**
 * What the Graduate button on the Students table opens.
 *
 * Three steps so a mis-click can never move anyone: EDIT the next-level details,
 * REVIEW a plain list of exactly what will happen, then CONFIRM. Nothing is sent
 * to the server until the last button. Closing at any point changes nothing.
 *
 * What is edited here is written to the student's own record, which the tutor's
 * roster, the timetable, the dossier and the student's portal all read.
 */

type Mode = "invite" | "move";
type Result = { moved: boolean; certificate: string; notified: boolean; targetLevel: string; note: string | null };

const SLOTS = ["morning", "afternoon", "evening", "weekend"];
const MODES = [
  ["physical", "On campus"],
  ["online", "Online"],
  ["hybrid", "Hybrid"],
] as const;

const naira = (n: number) => `₦${Math.max(0, Math.round(n)).toLocaleString("en-NG")}`;

export default function NextLevelDialog({
  studentId,
  onClose,
  onDone,
}: {
  studentId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [preview, setPreview] = useState<MoveUpPreview | null>(null);
  const [error, setError] = useState("");
  const [step, setStep] = useState<"edit" | "review" | "done">("edit");
  const [mode, setMode] = useState<Mode>("move");
  const [notifyStudent, setNotifyStudent] = useState(true);
  const [form, setForm] = useState({ sessionSlot: "morning", deliveryMode: "physical", phone: "", parentPhone: "", note: "" });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/admin/students/${studentId}/next-level`, { cache: "no-store" });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error || "Could not load this student");
        if (cancelled) return;
        const p: MoveUpPreview = json.preview;
        setPreview(p);
        setForm({ ...p.current });
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load this student");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [studentId]);

  async function confirm() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/students/${studentId}/next-level`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, notify: notifyStudent, details: form }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Could not complete that");
      setResult(json);
      setStep("done");
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not complete that");
      setStep("edit");
    } finally {
      setBusy(false);
    }
  }

  if (typeof document === "undefined") return null;

  const target = preview?.targetLevel ?? null;
  const input = "w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)]";
  const label = "mb-1 block text-xs font-semibold uppercase tracking-wide text-[var(--muted)]";

  return createPortal(
    <div className="fixed inset-0 z-[200] grid place-items-center overflow-y-auto bg-black/60 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-lg rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-2xl">
        {!preview && !error && <p className="text-sm text-[var(--muted)]">Loading…</p>}
        {error && !preview && (
          <>
            <p className="text-sm text-rose-600">{error}</p>
            <button onClick={onClose} className="mt-4 rounded-lg border border-[var(--border)] px-4 py-2 text-sm">
              Close
            </button>
          </>
        )}

        {preview && !target && (
          <>
            <h2 className="text-lg font-bold text-[var(--foreground)]">{preview.name}</h2>
            <p className="mt-2 text-sm text-[var(--muted)]">{preview.level} is the top of the ladder — there is no next level to move them to.</p>
            <button onClick={onClose} className="mt-4 rounded-lg border border-[var(--border)] px-4 py-2 text-sm">
              Close
            </button>
          </>
        )}

        {preview && target && step === "edit" && (
          <>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--accent)]">Next level</p>
            <h2 className="mt-1 text-xl font-bold text-[var(--foreground)]">
              {preview.name}: {preview.level} → {target}
            </h2>
            <p className="mt-1 text-sm text-[var(--muted)]">
              Edit their {target} details. Nothing changes until you confirm on the next screen.
            </p>

            {error && <p className="mt-3 rounded-lg border border-rose-300 bg-rose-50 p-2.5 text-sm text-rose-800">{error}</p>}

            <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-alt)] p-3">
                <p className="text-xs text-[var(--muted)]">{target} tuition</p>
                <p className="font-bold text-[var(--foreground)]">{naira(preview.tuitionFee)}</p>
              </div>
              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-alt)] p-3">
                <p className="text-xs text-[var(--muted)]">Deposit to start</p>
                <p className="font-bold text-[var(--foreground)]">{naira(preview.requiredDeposit)}</p>
              </div>
            </div>
            {preview.opensLabel && (
              <p className="mt-2 text-sm text-[var(--muted)]">
                {target} opens <strong className="text-[var(--foreground)]">{preview.opensLabel}</strong>.
              </p>
            )}
            {preview.priorOwed > 0 && (
              <p className="mt-2 rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-sm text-amber-900">
                Still owes {naira(preview.priorOwed)} on {preview.level}. A move-up will be refused until that is settled; you can still invite them.
              </p>
            )}

            <div className="mt-4 space-y-3">
              <div>
                <span className={label}>What should happen</span>
                <div className="space-y-2">
                  <label className="flex cursor-pointer items-start gap-2 text-sm text-[var(--foreground)]">
                    <input type="radio" checked={mode === "move"} onChange={() => setMode("move")} className="mt-1" />
                    <span>
                      <strong>Move them up to {target} now</strong> — signs off {preview.level}, issues the certificate and places them in the
                      next intake.
                    </span>
                  </label>
                  <label className="flex cursor-pointer items-start gap-2 text-sm text-[var(--foreground)]">
                    <input type="radio" checked={mode === "invite"} onChange={() => setMode("invite")} className="mt-1" />
                    <span>
                      <strong>Only invite them</strong> — they see Becca&apos;s {target} plan and can keep a seat; their level stays {preview.level}.
                    </span>
                  </label>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <span className={label}>Sitting</span>
                  <select className={input} value={form.sessionSlot} onChange={(e) => setForm({ ...form, sessionSlot: e.target.value })}>
                    {SLOTS.map((s) => (
                      <option key={s} value={s}>
                        {s[0].toUpperCase() + s.slice(1)}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <span className={label}>Attends</span>
                  <select className={input} value={form.deliveryMode} onChange={(e) => setForm({ ...form, deliveryMode: e.target.value })}>
                    {MODES.map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <span className={label}>Phone</span>
                  <input className={input} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} inputMode="tel" />
                </div>
                <div>
                  <span className={label}>Parent phone</span>
                  <input className={input} value={form.parentPhone} onChange={(e) => setForm({ ...form, parentPhone: e.target.value })} inputMode="tel" />
                </div>
              </div>
              <div>
                <span className={label}>Note for the file</span>
                <textarea className={input} rows={2} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
              </div>

              <label className="flex cursor-pointer items-start gap-2 text-sm text-[var(--foreground)]">
                <input type="checkbox" checked={notifyStudent} onChange={(e) => setNotifyStudent(e.target.checked)} className="mt-1" />
                <span>Send Becca&apos;s congratulations — pop on their dashboard, bell, push and a designed email.</span>
              </label>
            </div>

            <div className="mt-5 flex justify-end gap-3">
              <button onClick={onClose} className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm">
                Cancel
              </button>
              <button onClick={() => setStep("review")} className="rounded-lg bg-[var(--accent)] px-5 py-2 text-sm font-bold text-white">
                Review
              </button>
            </div>
          </>
        )}

        {preview && target && step === "review" && (
          <>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--accent)]">Check before you confirm</p>
            <h2 className="mt-1 text-xl font-bold text-[var(--foreground)]">{preview.name}</h2>
            <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm text-[var(--foreground)]">
              {mode === "move" ? (
                <>
                  <li>
                    {preview.level} is <strong>signed off</strong> and their certificate is issued.
                  </li>
                  <li>
                    They move up to <strong>{target}</strong>, into the next intake
                    {preview.opensLabel ? ` (${preview.opensLabel})` : ""}. Their {target} fee ({naira(preview.tuitionFee)}) is raised, and their portal
                    waits on the deposit.
                  </li>
                </>
              ) : (
                <li>
                  They are <strong>invited to {target}</strong>. Their level stays {preview.level} and nothing is signed off.
                </li>
              )}
              <li>
                Sitting <strong>{form.sessionSlot}</strong>, attending <strong>{form.deliveryMode}</strong>
                {form.phone ? `, phone ${form.phone}` : ""}
                {form.parentPhone ? `, parent ${form.parentPhone}` : ""} — saved to their record, so tutors and the timetable see it.
              </li>
              <li>
                {notifyStudent
                  ? "Becca's congratulations goes out now: pop on their dashboard, bell, push and email."
                  : "No message is sent. They still see the pop the next time they open their portal."}
              </li>
            </ul>
            <p className="mt-3 text-xs text-[var(--muted)]">
              {mode === "move" ? "This changes their level and fees. It is not an undo-able click." : "This can be changed again from this same button."}
            </p>
            <div className="mt-5 flex justify-end gap-3">
              <button onClick={() => setStep("edit")} disabled={busy} className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm">
                Back
              </button>
              <button
                onClick={confirm}
                disabled={busy}
                className="rounded-lg bg-[var(--accent)] px-5 py-2 text-sm font-bold text-white disabled:opacity-60"
              >
                {busy ? "Working…" : mode === "move" ? `Yes, move up to ${target}` : `Yes, invite to ${target}`}
              </button>
            </div>
          </>
        )}

        {step === "done" && result && (
          <>
            <h2 className="text-xl font-bold text-[var(--foreground)]">Done</h2>
            <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm text-[var(--foreground)]">
              <li>{result.moved ? `Moved up to ${result.targetLevel}.` : `Invited to ${result.targetLevel}.`}</li>
              {result.certificate === "issued" && <li>Certificate issued.</li>}
              {result.note && <li>{result.note}</li>}
              <li>{result.notified ? "Becca's message was sent (bell, push, email)." : "No message sent."}</li>
            </ul>
            <div className="mt-5 flex justify-end">
              <button onClick={onClose} className="rounded-lg bg-[var(--accent)] px-5 py-2 text-sm font-bold text-white">
                Close
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
