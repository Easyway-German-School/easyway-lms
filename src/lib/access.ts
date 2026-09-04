import { DEPOSIT_RATE } from "@/lib/payment";
import { buildLedger, type LedgerChargeInput } from "@/lib/finance/ledger";

/**
 * Who can see what before tuition is paid.
 *
 * A student who has only paid the registration fee is in "onboarding mode":
 * the office has their record, but no class has been bought yet. They keep the
 * pages needed to *become* a paying student (see their bill, pay it, fix their
 * details, read what the office sends them) and lose everything that is a
 * delivered service.
 *
 * The list below is an ALLOWLIST rather than a blocklist on purpose. A new
 * student page added later is locked until someone decides it should be free,
 * which is the safe direction to fail for a paywall.
 */
export const TUITION_FREE_ROUTES = [
  "/notifications",
  "/profile",
  "/payments",
  // The tuition checkout itself — locking this would make the paywall a
  // dead end, since every "Pay tuition" call to action lands here.
  "/programs",
] as const;

export function isTuitionFreeRoute(pathname: string): boolean {
  return TUITION_FREE_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );
}

export function isTuitionGatedRoute(pathname: string): boolean {
  return !isTuitionFreeRoute(pathname);
}

/**
 * Whether a student's `admission` blob carries a real photo.
 *
 * The one source of truth for "has this student got a photo" — used by the
 * signup-gap self-heal nudge (`profile-photo-nudge.ts`), the portal's own
 * lock screen below, and anywhere else that needs to ask the same question
 * without redefining it slightly differently each time.
 */
export function hasProfilePhoto(admission: unknown): boolean {
  if (!admission || typeof admission !== "object") return false;
  const url = (admission as Record<string, unknown>).photoUrl;
  return typeof url === "string" && url.trim().length > 0;
}

/**
 * Pages a photoless student keeps while the portal is walled off — same
 * ALLOWLIST shape as TUITION_FREE_ROUTES and for the same reason: a new page
 * added later is locked by default rather than silently exempt.
 *
 * `/profile` is where the photo actually gets fixed; `/notifications` and
 * `/payments` stay open so a student is never cut off from seeing what they
 * are told or from paying what they owe just because of a missing photo.
 */
export const PHOTO_FREE_ROUTES = ["/profile", "/notifications", "/payments"] as const;

export function isPhotoGatedRoute(pathname: string): boolean {
  return !PHOTO_FREE_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );
}

/**
 * How a student attends, and therefore what the portal shows them.
 *
 *   physical  campus only — no live-class tab. Putting a video classroom in
 *             front of somebody who attends in person is not a harmless extra
 *             button: they click it, find an empty room, and conclude the
 *             portal is broken.
 *   hybrid    registered at a campus but may join that branch's class over
 *             video. Gets both.
 *   online    the Online branch. Video is the only way they attend.
 */
export type DeliveryMode = "physical" | "hybrid" | "online";

export function normaliseDeliveryMode(value: unknown): DeliveryMode {
  const mode = String(value ?? "").toLowerCase();
  return mode === "online" || mode === "hybrid" ? mode : "physical";
}

/** group | private — a private student books their tutor, not a seat. */
export type ClassType = "group" | "private";

export function normaliseClassType(value: unknown): ClassType {
  return String(value ?? "").toLowerCase() === "private" ? "private" : "group";
}

/**
 * Whether the live classroom means anything to this student.
 *
 * CLASS TYPE IS THE SECOND HALF OF THIS QUESTION, and leaving it out was a bug
 * with a very confusing shape. A private student takes their class wherever
 * their tutor books it, including over video, so `/api/live/session` and
 * `/api/live/state` have always granted them a room regardless of delivery
 * mode — each writing `!canAttendLive(mode) && classType !== "private"` by
 * hand. The portal did not: it asked this function with the mode alone, so a
 * private student registered at a campus had the Live class entry hidden from
 * the sidebar AND was shown "This is an online-class page" if they typed the
 * URL. The server would have let them in; the app would not take them there.
 *
 * Both halves now live here, and the two server call sites read the same rule
 * as the sidebar instead of re-deriving it.
 */
export function canAttendLive(mode: unknown, classType?: unknown): boolean {
  if (normaliseClassType(classType) === "private") return true;
  return normaliseDeliveryMode(mode) !== "physical";
}

/**
 * Student routes that exist only for people who attend over video.
 *
 * Hidden from the sidebar AND refused by the pages themselves — a hidden nav
 * entry is a cosmetic gate, and /live is still reachable by typing it.
 */
export const LIVE_ONLY_ROUTES = ["/live"] as const;

export function isLiveOnlyRoute(pathname: string): boolean {
  return LIVE_ONLY_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`));
}

/**
 * How long after classes start a part-payer keeps portal access while the
 * balance is unpaid. One month into the two-month session: reminders run
 * through it, the lock lands at the end (see runPaymentWarnings /
 * sendDueFeeReminders for the escalation, and PaymentLockScreen for the wall).
 */
export const PART_PAYMENT_LOCK_DAYS = 30;

const LOCK_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Why the portal is locked, when it is:
 *   unpaid_deposit     registration-only — never cleared the 60% to start
 *   unsettled_balance  paid the deposit, never cleared the balance, and the
 *                      30-day grace after classes started has run out
 */
export type PaymentLockReason = "unpaid_deposit" | "unsettled_balance" | null;

export type StudentAccess = {
  /** physical | hybrid | online — see DeliveryMode. */
  deliveryMode: DeliveryMode;
  /**
   * group | private. The portal needs this as well as the delivery mode to
   * decide whether the live classroom exists for this student — see
   * canAttendLive. It was already being read from the database to price the
   * tuition and then thrown away here, which is why the client could not.
   */
  classType: ClassType;
  /** False while a registration-only student still owes the deposit. */
  hasAccess: boolean;
  /** True once anything at all has been paid — the registration fee. */
  registrationPaid: boolean;
  totalPaid: number;
  tuitionFee: number;
  requiredDeposit: number;
  /** What is still owed before classes open. */
  outstanding: number;
  /** Against the FULL fee — what a part-payer must clear to lift the balance lock. */
  outstandingBalance: number;
  /** Progress towards the deposit (not the full fee) — that is the gate. */
  progressPercent: number;
  /** Progress towards the full fee — what the settle-your-balance screen shows. */
  feeProgressPercent: number;
  /** Set when hasAccess is false, so the lock screen can say why. */
  lockReason: PaymentLockReason;
  /** ISO date the balance lock lands (or landed). Null when it does not apply. */
  lockAt: string | null;
  /** ISO date an admin has granted grace until. Null when none. */
  graceUntil: string | null;
  currency: string;
};

function toDate(value: unknown): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Access opens at the DEPOSIT, not the full fee, matching how the school
 * actually enrols: pay 60% and you start class while the balance runs.
 *
 * It then CLOSES again for a part-payer who never clears the balance: 30 days
 * after classes start (see PART_PAYMENT_LOCK_DAYS) the portal locks until the
 * balance is settled, unless an admin has set `paymentGraceUntil`. A
 * fully-paid student is never touched by any of this.
 *
 * When `charges` is passed (the per-level tuition ledger — see
 * src/lib/finance/ledger.ts) the deposit gate and the balance lock read the
 * CURRENT level's charge and the GO-FORWARD outstanding, not the raw sum of
 * every payment against the current fee. That is what stops a student who was
 * promoted with a balance still open — whose lifetime payments happen to
 * exceed one level's fee — from walking into the next level for free. Legacy
 * arrears (levels passed before the ledger existed) are deliberately excluded
 * from the lock: they are chased, never walled.
 *
 * With no `charges` the behaviour is exactly as before.
 */
export function deriveStudentAccess({
  totalPaid,
  tuitionFee,
  requiredDeposit,
  deliveryMode,
  classType,
  level,
  charges,
  classesStartedAt,
  enrolledAt,
  paymentGraceUntil,
  paymentPlanOnTrack,
  now = new Date(),
}: {
  totalPaid: number;
  tuitionFee: number;
  requiredDeposit: number;
  deliveryMode?: unknown;
  classType?: unknown;
  /** Current level — needed to pick this student's own charge out of the ledger. */
  level?: string | null;
  /** The student's TuitionCharge rows. When present, the ledger drives the gate. */
  charges?: LedgerChargeInput[] | null;
  /** Confirmed first day of classes — the clock the lock runs on. */
  classesStartedAt?: unknown;
  /** Enrolment date — fallback anchor when the first day was never confirmed. */
  enrolledAt?: unknown;
  /** Admin override date; lock and balance reminders suppressed until it passes. */
  paymentGraceUntil?: unknown;
  /**
   * True when the student has an ACTIVE tuition payment plan they are keeping
   * to (src/lib/payment-plans.ts). Suppresses the balance lock exactly like a
   * grace date; a defaulted or absent plan is `false`/undefined.
   */
  paymentPlanOnTrack?: boolean;
  now?: Date;
}): StudentAccess {
  const paid = Math.max(0, Math.round(Number(totalPaid) || 0));
  const fee = Math.max(0, Math.round(Number(tuitionFee) || 0));
  const deposit = Math.max(0, Math.round(Number(requiredDeposit) || 0));

  const ledger = charges && charges.length ? buildLedger(charges, paid, now) : null;
  const currentLevelKey = String(level ?? "").trim().toUpperCase();
  const currentLine = ledger && currentLevelKey
    ? ledger.lines.find((line) => line.level.toUpperCase() === currentLevelKey) ?? null
    : null;

  // Has the student cleared the 60% deposit on the level they are IN right now?
  //   ledger: their current-level charge has its deposit portion allocated
  //   no ledger: the raw sum of payments reaches the current-level deposit
  const currentLevelDeposit = currentLine
    ? Math.round(currentLine.net * DEPOSIT_RATE)
    : deposit;
  const depositPaid = ledger
    ? currentLine
      ? currentLine.allocated >= currentLevelDeposit
      // Ledger exists but has no row for the current level (mid-rollout gap) —
      // fall back rather than lock everyone out.
      : deposit > 0 ? paid >= deposit : paid >= fee
    : deposit > 0
      ? paid >= deposit
      : paid >= fee;

  // What must be cleared to lift the balance lock. Legacy arrears are excluded.
  const outstandingBalance = ledger
    ? ledger.goForwardOutstanding
    : Math.max(0, fee - paid);
  const fullPaid = ledger ? outstandingBalance <= 0 : fee > 0 ? paid >= fee : depositPaid;

  // The balance lock only exists for a student who is past the deposit gate
  // but has not settled the fee.
  const graceDate = toDate(paymentGraceUntil);
  // A future grace date OR an on-track payment plan holds the lock back.
  const graceActive =
    Boolean(paymentPlanOnTrack) || (graceDate ? now.getTime() < graceDate.getTime() : false);

  let lockAt: Date | null = null;
  let balanceLocked = false;
  if (depositPaid && !fullPaid) {
    // With a ledger, run the clock from the oldest still-open GO-FORWARD charge
    // — a freshly promoted student gets a fresh 30-day window on the new level
    // rather than being locked the instant they move up.
    const anchor =
      (ledger ? toDate(ledger.oldestOpenGoForwardChargeAt) : null) ??
      toDate(classesStartedAt) ??
      toDate(enrolledAt);
    if (anchor) {
      lockAt = new Date(anchor.getTime() + PART_PAYMENT_LOCK_DAYS * LOCK_DAY_MS);
      balanceLocked = !graceActive && now.getTime() >= lockAt.getTime();
    }
  }

  const hasAccess = depositPaid && !balanceLocked;
  const lockReason: PaymentLockReason = hasAccess
    ? null
    : balanceLocked
      ? "unsettled_balance"
      : "unpaid_deposit";

  // Deposit-gate figures: against the CURRENT level's charge when the ledger is
  // driving, against the raw payment sum otherwise.
  const towardDeposit = currentLine ? currentLine.allocated : paid;
  const outstandingDeposit = Math.max(0, currentLevelDeposit - towardDeposit);
  const progressPercent = currentLevelDeposit > 0
    ? Math.min(100, Math.round((towardDeposit / currentLevelDeposit) * 100))
    : 0;

  // Settle-your-balance progress. With a ledger it is progress towards clearing
  // everything owed across the ladder; otherwise towards the single fee.
  const feeProgressPercent = ledger
    ? ledger.lifetimeCharged > 0
      ? Math.min(100, Math.round((ledger.lifetimeAllocated / ledger.lifetimeCharged) * 100))
      : 100
    : fee > 0
      ? Math.min(100, Math.round((paid / fee) * 100))
      : 0;

  return {
    deliveryMode: normaliseDeliveryMode(deliveryMode),
    classType: normaliseClassType(classType),
    hasAccess,
    registrationPaid: paid > 0,
    totalPaid: paid,
    tuitionFee: fee,
    requiredDeposit: currentLevelDeposit,
    outstanding: outstandingDeposit,
    outstandingBalance,
    progressPercent,
    feeProgressPercent,
    lockReason,
    lockAt: lockAt ? lockAt.toISOString() : null,
    graceUntil: graceDate ? graceDate.toISOString() : null,
    currency: "NGN",
  };
}
