import { LEVELS } from "@/lib/levels";

/**
 * THE ONE PLACE PAYMENTS ARE RECONCILED AGAINST CHARGES.
 *
 * `TuitionCharge` rows are the debit side of tuition — one per level a student
 * passes through, fee frozen at creation (see the block comment on the model in
 * prisma/schema.prisma). `Payment` rows are the credit side. This module puts
 * the two together: it allocates a student's total received payments across
 * their open charges OLDEST FIRST (FIFO), and reports what that leaves
 * outstanding.
 *
 * FIFO is not a preference, it is the accounting rule: a payment always pays
 * down the oldest debt first. A student on B1 who pays "for B1" clears any
 * leftover A2 balance before a naira of it counts toward B1. The next-level
 * checkout shows that split openly so it is never a surprise — see
 * src/app/api/paystack/initialize/route.ts.
 *
 * Nothing is stored per allocation. Like the rest of the finance layer
 * (receivables.ts, access.ts, certificates.ts) the answer is recomputed on
 * every read from (charges ordered, total paid), which is deterministic. This
 * file is PURE — no Prisma, no `now` it did not receive — so it unit-tests
 * cleanly and is safe to pull into client code.
 *
 * MONEY IS WHOLE NAIRA throughout, same as `Payment.amount` / `tuitionFeeFor`.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Ladder position, for tie-breaking charges created in the same instant (the
 *  backfill raises several at once). Unknown levels sort last. */
function ladderIndex(level: string): number {
  const i = (LEVELS as readonly string[]).indexOf(String(level ?? "").trim().toUpperCase());
  return i === -1 ? LEVELS.length : i;
}

function toDate(value: unknown): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function toWholeNaira(value: unknown): number {
  return Math.max(0, Math.round(Number(value) || 0));
}

/**
 * The shape this module needs off a `TuitionCharge`. Maps 1:1 to a Prisma
 * `select`, so a caller can pass rows straight through. `settledAt` is accepted
 * but ignored in the maths — "is it settled" is recomputed here, not trusted
 * from the column.
 */
export type LedgerChargeInput = {
  id: string;
  level: string;
  amount: number;
  waivedAmount?: number | null;
  legacyArrears?: boolean | null;
  createdAt: Date | string;
  settledAt?: Date | string | null;
};

export type LedgerLine = {
  chargeId: string;
  level: string;
  /** Gross fee frozen on the charge. */
  amount: number;
  /** Written off (scholarship / negotiated). */
  waived: number;
  /** What the student is actually expected to pay for this level: amount − waived. */
  net: number;
  /** How much of the student's paid money FIFO assigns to this charge. */
  allocated: number;
  /** net − allocated. */
  outstanding: number;
  settled: boolean;
  legacyArrears: boolean;
  createdAt: string;
  /** Whole days since the charge was raised; 0 if it is future-dated. */
  ageDays: number;
};

export type Ledger = {
  /** FIFO order — oldest charge first. */
  lines: LedgerLine[];

  /** Σ net across all charges — the total the student was ever expected to pay. */
  lifetimeCharged: number;
  /** Received payments handed in (clamped ≥ 0). */
  lifetimePaid: number;
  /** Σ allocated — payments that landed against a charge (= min(paid, charged)). */
  lifetimeAllocated: number;
  /** Paid beyond every charge. Real when a student overpays or pays ahead. */
  creditBalance: number;

  /** Σ outstanding — the headline "what the school is still owed". */
  lifetimeOutstanding: number;
  /** Outstanding on charges the normal machinery acts on (locks, promotion gate). */
  goForwardOutstanding: number;
  /** Outstanding on pre-ledger levels backfilled at cutover — chased, never walled. */
  legacyOutstanding: number;

  /** Oldest charge with anything still outstanding (any kind). Ageing anchor. */
  oldestOpenLevel: string | null;
  oldestOpenAgeDays: number | null;
  /** Same, restricted to go-forward charges — the clock the portal lock runs on. */
  oldestOpenGoForwardLevel: string | null;
  oldestOpenGoForwardAgeDays: number | null;
};

/**
 * Reconcile `totalPaid` against `charges`, oldest first.
 *
 * `charges` may arrive in any order and may include soft-deleted rows filtered
 * out by the caller's `where`; this sorts what it is given by `createdAt` (then
 * ladder position) and walks it greedily.
 */
export function buildLedger(
  charges: LedgerChargeInput[],
  totalPaid: number,
  now: Date = new Date(),
): Ledger {
  const nowMs = now.getTime();

  const ordered = [...charges].sort((a, b) => {
    const at = toDate(a.createdAt)?.getTime() ?? 0;
    const bt = toDate(b.createdAt)?.getTime() ?? 0;
    if (at !== bt) return at - bt;
    return ladderIndex(a.level) - ladderIndex(b.level);
  });

  let remaining = toWholeNaira(totalPaid);
  const paid = remaining;

  const lines: LedgerLine[] = ordered.map((charge) => {
    const amount = toWholeNaira(charge.amount);
    const waived = Math.min(amount, toWholeNaira(charge.waivedAmount));
    const net = Math.max(0, amount - waived);
    const allocated = Math.min(remaining, net);
    remaining -= allocated;
    const outstanding = net - allocated;
    const created = toDate(charge.createdAt);
    const ageDays = created ? Math.max(0, Math.floor((nowMs - created.getTime()) / DAY_MS)) : 0;

    return {
      chargeId: charge.id,
      level: charge.level,
      amount,
      waived,
      net,
      allocated,
      outstanding,
      settled: outstanding === 0,
      legacyArrears: Boolean(charge.legacyArrears),
      createdAt: created ? created.toISOString() : new Date(0).toISOString(),
      ageDays,
    };
  });

  const lifetimeCharged = lines.reduce((sum, line) => sum + line.net, 0);
  const lifetimeAllocated = lines.reduce((sum, line) => sum + line.allocated, 0);
  const lifetimeOutstanding = lines.reduce((sum, line) => sum + line.outstanding, 0);
  const goForwardOutstanding = lines
    .filter((line) => !line.legacyArrears)
    .reduce((sum, line) => sum + line.outstanding, 0);
  const legacyOutstanding = lifetimeOutstanding - goForwardOutstanding;

  const firstOpen = lines.find((line) => line.outstanding > 0) ?? null;
  const firstOpenGoForward = lines.find((line) => line.outstanding > 0 && !line.legacyArrears) ?? null;

  return {
    lines,
    lifetimeCharged,
    lifetimePaid: paid,
    lifetimeAllocated,
    creditBalance: remaining,
    lifetimeOutstanding,
    goForwardOutstanding,
    legacyOutstanding,
    oldestOpenLevel: firstOpen?.level ?? null,
    oldestOpenAgeDays: firstOpen?.ageDays ?? null,
    oldestOpenGoForwardLevel: firstOpenGoForward?.level ?? null,
    oldestOpenGoForwardAgeDays: firstOpenGoForward?.ageDays ?? null,
  };
}

/**
 * An empty ledger — for a student who has no `TuitionCharge` rows yet (mid
 * rollout, before the backfill, or a brand-new record between signup and the
 * first `ensureChargeForLevel`). Callers can treat this as "the ledger says
 * nothing, fall back to the per-level figure".
 */
export function emptyLedger(totalPaid = 0): Ledger {
  return buildLedger([], totalPaid);
}

/** Whether the ledger has anything to say — i.e. at least one charge exists. */
export function ledgerIsPopulated(ledger: Ledger): boolean {
  return ledger.lines.length > 0;
}
