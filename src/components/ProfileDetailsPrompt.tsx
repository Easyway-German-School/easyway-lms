"use client";

import { useEffect, useMemo, useState } from "react";
import { PencilIcon } from "@/components/icons";
import { countries, nigerianStates } from "@/app/auth/signup/options";
import type { BackfillField, BackfillPrefill } from "@/lib/profile-backfill";
import { BACKFILL_FIELD_LABELS } from "@/lib/profile-backfill";

/**
 * BECCA, RECREATING THE SIGN-UP FORM — the important parts only.
 *
 * Shown to a student the office onboarded by hand, who never filled the long
 * public admission form. One question per screen, each pre-filled from
 * anything we already hold, every one skippable. See src/lib/profile-backfill.ts
 * for which questions and why these six.
 *
 * This file exports the shared stepper (`ProfileDetailsWizard`) and the
 * /profile card that wraps it (`ProfileDetailsCard`). The dashboard moment
 * (components/moment/ProfileDetailsMoment.tsx) reuses the same stepper inside
 * a modal.
 */

type Prefill = BackfillPrefill;

type Answers = {
  whatsapp: string;
  dateOfBirth: string;
  city: string;
  stateRegion: string;
  country: string;
  emergencyName: string;
  emergencyPhone: string;
  occupation: string;
  goal: string;
};

const GOAL_CHIPS = [
  "Work in Germany",
  "Study / university",
  "Ausbildung",
  "Nursing career",
  "Join family",
  "Personal interest",
];

function answersFromPrefill(prefill: Prefill): Answers {
  return {
    whatsapp: prefill.whatsapp ?? "",
    dateOfBirth: prefill.dateOfBirth ?? "",
    city: prefill.city ?? "",
    stateRegion: prefill.stateRegion ?? "",
    country: prefill.country || "Nigeria",
    emergencyName: prefill.emergencyName ?? "",
    emergencyPhone: prefill.emergencyPhone ?? "",
    occupation: prefill.occupation ?? "",
    goal: prefill.goal ?? "",
  };
}

/** Which answer keys a given step needs the student to have touched to "count". */
function stepAnswered(field: BackfillField, a: Answers): boolean {
  switch (field) {
    case "whatsapp":
      return a.whatsapp.trim().length >= 6;
    case "dateOfBirth":
      return Boolean(a.dateOfBirth.trim());
    case "location":
      return Boolean(a.country.trim()) && Boolean((a.country === "Nigeria" ? a.stateRegion : a.city).trim());
    case "emergency":
      return a.emergencyName.trim().length > 1 && a.emergencyPhone.trim().length >= 6;
    case "occupation":
      return a.occupation.trim().length > 1;
    case "goal":
      return a.goal.trim().length > 1;
    default:
      return false;
  }
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--muted)]">{label}</span>
      <div className="mt-2">{children}</div>
    </label>
  );
}

const inputClass =
  "w-full rounded-2xl border border-[var(--border)] bg-[var(--background)] px-4 py-3 text-sm text-[var(--foreground)] outline-none focus:border-[var(--accent)]";

export function ProfileDetailsWizard({
  missing,
  prefill,
  studentName,
  onDone,
  onSkipAll,
  tone = "card",
}: {
  missing: BackfillField[];
  prefill: Prefill;
  studentName: string;
  /** Called after a successful save that finished (or had nothing left). */
  onDone: () => void;
  /** Called after "skip for now" (a dismiss was recorded). */
  onSkipAll: () => void;
  tone?: "card" | "modal";
}) {
  const steps = useMemo(
    () => (missing.length ? missing : (["goal"] as BackfillField[])),
    [missing],
  );
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Answers>(() => answersFromPrefill(prefill));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const field = steps[index];
  const isLast = index === steps.length - 1;
  const set = (patch: Partial<Answers>) => setAnswers((prev) => ({ ...prev, ...patch }));

  async function save(kind: "next" | "done" | "skip-all") {
    setBusy(true);
    setError("");
    try {
      const payload: Record<string, unknown> = {
        whatsapp: answers.whatsapp,
        dateOfBirth: answers.dateOfBirth,
        city: answers.country === "Nigeria" ? "" : answers.city,
        stateRegion: answers.country === "Nigeria" ? answers.stateRegion : "",
        country: answers.country,
        emergencyName: answers.emergencyName,
        emergencyPhone: answers.emergencyPhone,
        occupation: answers.occupation,
        goal: answers.goal,
      };
      if (kind === "done") payload.complete = true;
      if (kind === "skip-all") payload.dismiss = true;

      const res = await fetch("/api/student/profile/backfill", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || "Could not save that.");
      }
      if (kind === "skip-all") onSkipAll();
      else if (kind === "done") onDone();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save that.");
    } finally {
      setBusy(false);
    }
  }

  function advance() {
    if (isLast) {
      void save("done");
    } else {
      // Persist progress as we go, so a student who closes the tab halfway
      // keeps what they have answered. Fire-and-forget; the final save is the
      // one that marks completion.
      void save("next");
      setIndex((i) => Math.min(i + 1, steps.length - 1));
    }
  }

  const answered = stepAnswered(field, answers);

  return (
    <div className={tone === "modal" ? "text-left" : "grid gap-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5"}>
      {/* progress dots */}
      <div className="flex items-center gap-1.5">
        {steps.map((s, i) => (
          <span
            key={s}
            className={`h-1.5 flex-1 rounded-full transition ${
              i < index ? "bg-[var(--accent)]" : i === index ? "bg-[var(--accent)]/60" : "bg-[var(--border)]"
            }`}
          />
        ))}
      </div>

      <p className="text-sm font-semibold text-[var(--foreground)]">
        {BACKFILL_FIELD_LABELS[field]}
        <span className="ml-2 text-xs font-normal text-[var(--muted)]">
          {index + 1} of {steps.length}
        </span>
      </p>

      {field === "whatsapp" && (
        <Field label="WhatsApp number">
          <input
            type="tel"
            inputMode="tel"
            value={answers.whatsapp}
            onChange={(e) => set({ whatsapp: e.target.value })}
            placeholder="e.g. 0803 123 4567"
            className={inputClass}
          />
          <p className="mt-1.5 text-xs text-[var(--muted)]">This is the line the school uses to reach you about class.</p>
        </Field>
      )}

      {field === "dateOfBirth" && (
        <Field label="Date of birth">
          <input
            type="date"
            value={answers.dateOfBirth}
            onChange={(e) => set({ dateOfBirth: e.target.value })}
            className={inputClass}
          />
        </Field>
      )}

      {field === "location" && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Country">
            <select
              value={answers.country}
              onChange={(e) => set({ country: e.target.value, stateRegion: "", city: "" })}
              className={inputClass}
            >
              {countries.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </Field>
          {answers.country === "Nigeria" ? (
            <Field label="State">
              <select
                value={answers.stateRegion}
                onChange={(e) => set({ stateRegion: e.target.value })}
                className={inputClass}
              >
                <option value="">Choose your state…</option>
                {nigerianStates.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </Field>
          ) : (
            <Field label="City / region">
              <input
                value={answers.city}
                onChange={(e) => set({ city: e.target.value })}
                placeholder="e.g. Berlin"
                className={inputClass}
              />
            </Field>
          )}
        </div>
      )}

      {field === "emergency" && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Contact name">
            <input
              value={answers.emergencyName}
              onChange={(e) => set({ emergencyName: e.target.value })}
              placeholder="Full name"
              className={inputClass}
            />
          </Field>
          <Field label="Their phone number">
            <input
              type="tel"
              inputMode="tel"
              value={answers.emergencyPhone}
              onChange={(e) => set({ emergencyPhone: e.target.value })}
              placeholder="Phone number"
              className={inputClass}
            />
          </Field>
          <p className="text-xs text-[var(--muted)] sm:col-span-2">
            Someone we can call if we ever can&apos;t reach you.
          </p>
        </div>
      )}

      {field === "occupation" && (
        <Field label="What you do">
          <input
            value={answers.occupation}
            onChange={(e) => set({ occupation: e.target.value })}
            placeholder="e.g. Nurse, Student, Software developer"
            className={inputClass}
          />
        </Field>
      )}

      {field === "goal" && (
        <Field label="Why are you learning German?">
          <div className="mb-2 flex flex-wrap gap-2">
            {GOAL_CHIPS.map((chip) => (
              <button
                key={chip}
                type="button"
                onClick={() => set({ goal: chip })}
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                  answers.goal === chip
                    ? "border-[var(--accent)] bg-[var(--accent)] text-white"
                    : "border-[var(--border)] text-[var(--foreground-soft)] hover:text-[var(--foreground)]"
                }`}
              >
                {chip}
              </button>
            ))}
          </div>
          <textarea
            value={answers.goal}
            onChange={(e) => set({ goal: e.target.value })}
            rows={2}
            placeholder="A line is plenty — it helps us shape your plan."
            className={inputClass}
          />
        </Field>
      )}

      {error ? <p className="text-sm font-semibold text-red-600">{error}</p> : null}

      <div className="flex flex-wrap items-center gap-3 pt-1">
        {index > 0 ? (
          <button
            type="button"
            onClick={() => setIndex((i) => Math.max(i - 1, 0))}
            disabled={busy}
            className="rounded-full border border-[var(--border)] px-4 py-2.5 text-sm font-bold text-[var(--foreground)] disabled:opacity-50"
          >
            Back
          </button>
        ) : null}

        <button
          type="button"
          onClick={advance}
          disabled={busy}
          className="rounded-full bg-[var(--accent)] px-6 py-2.5 text-sm font-bold text-white disabled:opacity-50"
        >
          {busy ? "Saving…" : isLast ? "Done" : answered ? "Next" : "Skip this one"}
        </button>

        <button
          type="button"
          onClick={() => save("skip-all")}
          disabled={busy}
          className="ml-auto text-xs font-semibold text-[var(--muted)] hover:text-[var(--foreground)] disabled:opacity-50"
        >
          Skip for now
        </button>
      </div>

      <p className="text-xs text-[var(--muted)]">
        Thanks, {studentName.split(" ")[0] || "there"} — you can always finish this later from your profile.
      </p>
    </div>
  );
}

type BackfillState = {
  due: boolean;
  missing: BackfillField[];
  prefill: Prefill;
  studentName: string;
};

/**
 * The /profile amber section. Same footprint as BranchSetupCard — shows only
 * when the student is genuinely due, opens on its own when linked to with
 * `?setup=details`.
 */
export function ProfileDetailsCard({ autoOpen = false }: { autoOpen?: boolean }) {
  const [state, setState] = useState<BackfillState | null>(null);
  const [open, setOpen] = useState(autoOpen);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (autoOpen) setOpen(true);
  }, [autoOpen]);

  useEffect(() => {
    let active = true;
    fetch("/api/student/profile/backfill")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (active && data) {
          setState({
            due: Boolean(data.due),
            missing: Array.isArray(data.missing) ? data.missing : [],
            prefill: data.prefill,
            studentName: data.studentName ?? "there",
          });
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  if (!state || !state.due || dismissed) return null;

  return (
    <section className="mx-auto mt-6 w-full max-w-5xl rounded-3xl border border-amber-300 bg-amber-50 p-5 sm:p-7 dark:border-amber-500/40 dark:bg-amber-500/10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl">
          <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.22em] text-amber-700 dark:text-amber-300">
            <PencilIcon className="h-4 w-4" /> Finish your profile
          </p>
          <h2 className="mt-2 text-2xl font-black text-[var(--foreground)]">A few details we&apos;re still missing</h2>
          <p className="mt-2 text-sm text-[var(--muted)]">
            The office set your account up by hand, so some of the usual sign-up questions never got asked. It&apos;s{" "}
            {state.missing.length} short {state.missing.length === 1 ? "question" : "questions"}, most already filled in
            for you, and you can skip any of them.
          </p>
        </div>
        {!open ? (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="rounded-full bg-[var(--accent)] px-5 py-2.5 text-sm font-bold text-white"
          >
            Fill them in
          </button>
        ) : null}
      </div>

      {open ? (
        <div className="mt-5">
          <ProfileDetailsWizard
            missing={state.missing}
            prefill={state.prefill}
            studentName={state.studentName}
            onDone={() => setDismissed(true)}
            onSkipAll={() => setDismissed(true)}
          />
        </div>
      ) : null}
    </section>
  );
}
