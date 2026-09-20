"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { joinDob, splitDob } from "@/lib/birthdate";
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
    // Only a real, plausible date survives the prefill — a free-typed legacy
    // value ("first of May 1990") would otherwise sit in state, count as
    // answered, and ride along on every save.
    dateOfBirth: (() => {
      const p = splitDob(prefill.dateOfBirth ?? "");
      return joinDob(p.day, p.month, p.year);
    })(),
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
  "w-full rounded-2xl border border-[var(--border)] bg-[var(--background)] px-4 py-3 text-base text-[var(--foreground)] outline-none focus:border-[var(--accent)]";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * Day · Month · Year, typed — not a calendar popup. Scrolling a date picker
 * back to 1965 one month at a time is the sort of thing that makes an older
 * learner close the page; typing "1965" is not.
 */
function BirthdateInput({ value, onChange }: { value: string; onChange: (iso: string) => void }) {
  const [parts, setParts] = useState(() => splitDob(value));
  const complete = parts.day !== "" && parts.month !== "" && parts.year.length === 4;
  const invalid = complete && !joinDob(parts.day, parts.month, parts.year);

  function update(patch: Partial<typeof parts>) {
    const next = { ...parts, ...patch };
    setParts(next);
    onChange(joinDob(next.day, next.month, next.year));
  }

  return (
    <div>
      <div className="grid grid-cols-[4.5rem_1fr_6rem] gap-2">
        <input
          inputMode="numeric"
          autoComplete="bday-day"
          maxLength={2}
          value={parts.day}
          onChange={(e) => update({ day: e.target.value.replace(/\D/g, "") })}
          placeholder="Day"
          aria-label="Day of birth"
          className={inputClass}
        />
        <select
          value={parts.month}
          onChange={(e) => update({ month: e.target.value })}
          aria-label="Month of birth"
          autoComplete="bday-month"
          className={inputClass}
        >
          <option value="">Month</option>
          {MONTHS.map((name, i) => (
            <option key={name} value={String(i + 1)}>
              {name}
            </option>
          ))}
        </select>
        <input
          inputMode="numeric"
          autoComplete="bday-year"
          maxLength={4}
          value={parts.year}
          onChange={(e) => update({ year: e.target.value.replace(/\D/g, "") })}
          placeholder="Year"
          aria-label="Year of birth"
          className={inputClass}
        />
      </div>
      {invalid ? (
        <p className="mt-1.5 text-xs font-semibold text-red-600">That date doesn&apos;t look right — please check it.</p>
      ) : (
        <p className="mt-1.5 text-xs text-[var(--muted)]">For example: 14 · June · 1988</p>
      )}
    </div>
  );
}

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
  const [failures, setFailures] = useState(0);
  /**
   * Saves run strictly one after another. Every save carries ALL the answers so
   * far, so the last one to land is always the complete picture — but two
   * requests in flight at once would both read the same stored row and the
   * slower one could overwrite the faster.
   */
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  const field = steps[index];
  const isLast = index === steps.length - 1;
  const set = (patch: Partial<Answers>) => setAnswers((prev) => ({ ...prev, ...patch }));

  /** One attempt. Never throws; says why when it fails, in words a student can act on. */
  async function post(kind: "next" | "done" | "skip-all"): Promise<{ ok: true } | { ok: false; message: string }> {
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

    try {
      const res = await fetch("/api/student/profile/backfill", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) return { ok: true };
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) return { ok: false, message: "Your session has ended — please sign in again." };
      return {
        ok: false,
        message:
          (typeof data?.error === "string" && data.error) ||
          "We could not save that just now. Your answers are kept — please try again.",
      };
    } catch {
      return { ok: false, message: "We can't reach the school right now. Check your internet and try again." };
    }
  }

  /** Queue a save behind whatever is already in flight. */
  function enqueue(kind: "next" | "done" | "skip-all") {
    const run = queue.current.then(() => post(kind));
    queue.current = run;
    return run;
  }

  async function finish() {
    setBusy(true);
    setError("");
    let result = await enqueue("done");
    // A dropped connection or a cold database is usually over in a second —
    // try once more on the student's behalf before ever showing them an error.
    if (!result.ok) {
      await new Promise((resolve) => setTimeout(resolve, 1200));
      result = await enqueue("done");
    }
    setBusy(false);
    if (result.ok) {
      onDone();
    } else {
      setFailures((n) => n + 1);
      setError(result.message);
    }
  }

  function advance() {
    if (isLast) {
      void finish();
      return;
    }
    // Move on at once. The answers are saved in the background and re-sent in
    // full by the final "Done", so a slow or failed request part-way through
    // can never hold the student on a question they have already answered.
    void enqueue("next");
    setError("");
    setIndex((i) => Math.min(i + 1, steps.length - 1));
  }

  async function skipAll() {
    setBusy(true);
    await enqueue("skip-all");
    setBusy(false);
    // Whether or not the snooze could be recorded, they asked to leave.
    onSkipAll();
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
          <BirthdateInput value={answers.dateOfBirth} onChange={(iso) => set({ dateOfBirth: iso })} />
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

      {error ? (
        <div role="alert" className="grid gap-1">
          <p className="text-sm font-semibold text-red-600">{error}</p>
          {failures >= 2 ? (
            <p className="text-xs text-[var(--muted)]">
              Still not going through. You can close this and finish later from your profile — nothing is lost.
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3 pt-1">
        {index > 0 ? (
          <button
            type="button"
            onClick={() => {
              setError("");
              setIndex((i) => Math.max(i - 1, 0));
            }}
            disabled={busy}
            className="rounded-full border border-[var(--border)] px-5 py-3 text-base font-bold text-[var(--foreground)] disabled:opacity-50"
          >
            Back
          </button>
        ) : null}

        <button
          type="button"
          onClick={advance}
          disabled={busy}
          className="rounded-full bg-[var(--accent)] px-7 py-3 text-base font-bold text-white disabled:opacity-50"
        >
          {busy ? "Saving…" : error && isLast ? "Try again" : isLast ? "Done" : answered ? "Next" : "Skip this one"}
        </button>

        <button
          type="button"
          onClick={() => (failures >= 2 ? onSkipAll() : void skipAll())}
          disabled={busy}
          className="ml-auto px-1 py-2 text-sm font-semibold text-[var(--muted)] hover:text-[var(--foreground)] disabled:opacity-50"
        >
          {failures >= 2 ? "Close for now" : "Skip for now"}
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
