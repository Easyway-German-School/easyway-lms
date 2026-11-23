import { CheckIcon, PassportIcon, CardIcon, SeatIcon, ShieldCheckIcon } from "@/components/icons";

/**
 * The booking wizard's progress — a flight path, not a grey bar.
 *
 * This site's whole visual language is already "airline meets embassy"
 * (boarding passes, seat numbers, a plane icon over Lagos→DACH) — see
 * NextSittingCard. A bare "Step 1 of 4" ignored that language entirely, so
 * candidates got the one part of the form that should feel the most like
 * Easyway's actual promise ("your seat is reserved automatically") instead
 * delivered the flattest, most form-like moment in the whole page.
 *
 * Deliberately no mascot, no points, no per-field confetti: this is a real,
 * non-refundable exam registration, and SignupJourney (the LMS's own
 * equivalent) explicitly rejected that tone for the same reason. The one
 * genuinely earned celebration — the booking actually going through — lives
 * on the confirmation page via <Confetti />, not in here.
 */

const STEPS = [
  { title: "Choose sitting", short: "Sitting", Icon: SeatIcon },
  { title: "Your details", short: "Details", Icon: PassportIcon },
  { title: "Modules & fee", short: "Fee", Icon: CardIcon },
  { title: "Review", short: "Review", Icon: ShieldCheckIcon },
] as const;

const ENCOURAGEMENT = [
  "Thousands of candidates have flown this exact route before you.",
  "Almost halfway — your seat is held while you finish these details.",
  "Nearly there — just the fare to confirm.",
  "Final boarding call. Check it over, then lock in your seat.",
];

export default function BookingJourney({ step }: { step: number }) {
  const total: number = STEPS.length;
  const pct = total === 1 ? 100 : (step / (total - 1)) * 100;

  return (
    <div className="rounded-2xl bg-white px-5 py-5 shadow-xl shadow-[var(--navy)]/15 ring-1 ring-black/5 sm:px-6">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-[var(--ink-soft)]">
          Step {step + 1} of {total}
        </p>
        <p className="font-mono text-[11px] font-bold uppercase tracking-wide text-[var(--gold)]">
          {Math.round(pct)}% there
        </p>
      </div>

      {/* The road */}
      <div className="relative mt-5 h-px">
        <div className="absolute inset-x-0 top-0 h-1.5 -translate-y-1/2 rounded-full bg-[var(--paper)] ring-1 ring-[var(--line)]" />
        <div
          className="absolute left-0 top-0 h-1.5 -translate-y-1/2 rounded-full bg-gradient-to-r from-[var(--gold)] to-[var(--gold-bright)] transition-[width] duration-500 ease-out"
          style={{ width: `${pct}%` }}
        />
        {STEPS.map((s, i) => {
          const markerAt = total === 1 ? 50 : (i / (total - 1)) * 100;
          const done = i < step;
          const here = i === step;
          return (
            <div
              key={s.title}
              className="absolute top-0 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center"
              style={{ left: `${markerAt}%` }}
            >
              <span
                className={`grid h-7 w-7 shrink-0 place-items-center rounded-full ring-4 ring-white transition-all duration-300 ${
                  done
                    ? "bg-[var(--navy)] text-white"
                    : here
                      ? "scale-110 bg-[var(--gold)] text-white shadow-lg shadow-[var(--gold)]/40"
                      : "bg-[var(--paper)] text-[var(--ink-soft)] ring-1 ring-[var(--line)]"
                }`}
              >
                {done ? <CheckIcon className="h-3.5 w-3.5" /> : <s.Icon className="h-3.5 w-3.5" />}
              </span>
            </div>
          );
        })}
      </div>

      {/* Labels — own row, not centred under each marker (the outer two
          would collide with the card edge at 375px otherwise). */}
      <div className="mt-5 flex items-start justify-between gap-2">
        {STEPS.map((s, i) => (
          <span
            key={s.title}
            className={`min-w-0 flex-1 truncate text-[10px] font-bold uppercase tracking-[0.06em] ${
              i === step ? "text-[var(--navy)]" : i < step ? "text-[var(--gold)]" : "text-[var(--ink-soft)]"
            } ${i === 0 ? "text-left" : i === STEPS.length - 1 ? "text-right" : "text-center"}`}
          >
            {s.short}
          </span>
        ))}
      </div>

      {/* The encouraging line — keyed on the step so it re-animates instead
          of the text silently swapping underneath the reader. */}
      <p key={step} className="fade-up mt-4 rounded-lg bg-[var(--paper)] px-3 py-2.5 text-xs font-medium text-[var(--navy)]">
        {ENCOURAGEMENT[step] ?? ENCOURAGEMENT[ENCOURAGEMENT.length - 1]}
      </p>
    </div>
  );
}
