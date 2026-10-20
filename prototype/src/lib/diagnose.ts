/**
 * THE DIAGNOSIS ENGINE — "a student complained; find out what is actually wrong."
 *
 * No AI. A rule engine: a list of small, named rules, each a PURE function from a
 * bundle of facts about one student to either nothing ("this is fine") or a
 * finding ("this is wrong, here is the evidence, here is what would fix it").
 *
 * WHY RULES, NOT A MODEL. A support tool that guesses is a support tool that is
 * confidently wrong at 2 a.m. Every rule here encodes a cause we KNOW exists
 * because it has already happened in this codebase — a missed payment webhook, a
 * student created without a code, a row with no tenant — and it shows its evidence,
 * so a person can check the reasoning instead of trusting it. It also means the
 * rules are unit-testable: give it facts, assert on findings. That is the whole
 * reason this file does no I/O.
 *
 * THE SHAPE OF SELF-HEALING (this is the general pattern, worth being able to say):
 *
 *   detect  →  diagnose  →  propose  →  approve  →  repair  →  VERIFY  →  audit
 *
 * This file is the first three. lib/diagnose-server.ts is the rest, and the rules
 * for what it will and will not do are the important part:
 *
 *   - It only repairs DATA and STATE, never code. A bug in the code needs a deploy;
 *     a panel button cannot and should not patch production logic.
 *   - Every repair is on a short whitelist, idempotent (running it twice is the same
 *     as once), and shows a plain-language preview before it runs.
 *   - A person clicks. Nothing here repairs anything on its own.
 *   - Before acting, the server re-derives the finding: if the problem is already
 *     gone (someone else fixed it, or the click is stale) it does nothing.
 *   - After acting, it re-runs the same rule to VERIFY the problem is gone, and says
 *     so honestly if it is not.
 *   - Money-touching repairs are recorded in the audit trail with who and why.
 *
 * Findings with no offered repair are deliberate: some things need a person's
 * judgement (which school owns an orphaned account?) and a tool that "fixes" them
 * by guessing is how a cross-tenant leak is made.
 */

import type { PortalVerdict } from "@/lib/portal-verdict";
import type { Capability } from "@/lib/admin-roles";
// The ONE definition of "this payment counts as received money". Re-deriving it here is exactly
// how the paywall drifted apart in thirteen places.
import { isReceivedPayment } from "@/lib/payment";
import { studentMayJoinBatch } from "@/lib/class-batch";

// ---------------------------------------------------------------------------
// Facts — everything the rules may look at. Plain data; no Prisma, no fetch.
// ---------------------------------------------------------------------------

export type PaymentFact = {
  id: string;
  amount: number;
  status: string;
  method: string;
  /** Paystack reference — stored in Payment.stripeSessionId (and paymentIntentId once settled). */
  references: string[];
  createdAt: string;
};

/** One transaction as Paystack describes it, reduced to what matching needs. */
export type PaystackTx = {
  reference: string;
  status: string;
  /** In KOBO, as Paystack sends it. */
  amountKobo: number;
  currency: string;
  paidAt: string | null;
  email: string | null;
  metaUserId: string | null;
  metaStudentId: string | null;
};

export type Facts = {
  student: {
    id: string;
    studentCode: string | null;
    tenantId: string | null;
    level: string;
    status?: string;
    branchId?: string | null;
    tutorId?: string | null;
    sessionSlot?: string;
    hybridOnlineSlot?: string | null;
    classType?: string;
    deliveryMode?: string;
    createdAt?: string;
    classesStartedAt?: string | null;
    admission?: unknown;
  };
  classSetup?: {
    hybridOnlineSlot: string | null;
    tutors: Array<{ id: string; status: string; role: "primary" | "online" | "other" }>;
    upcomingPrivateClasses: Array<{
      id: string;
      lecturerId: string | null;
      scheduledAt: string;
      durationMinutes: number;
      deliveryMode: string | null;
    }>;
    liveSessions: Array<{
      id: string;
      kind: string;
      title: string;
      level: string | null;
      sessionSlot: string | null;
      batch: string | null;
      lecturerId: string | null;
      privateClassId: string | null;
    }>;
  };
  user: { id: string; email: string; name: string | null; tenantId: string | null };
  access: {
    hasAccess: boolean;
    lockReason: string | null;
    totalPaid: number;
    /**
     * What the ledger actually credits to the CURRENT level (see
     * StudentAccess.currentLevelPaid) — optional only so older call sites /
     * fixtures that predate this field still type-check; every real caller
     * now supplies it.
     */
    currentLevelPaid?: number;
    tuitionFee: number;
    requiredDeposit: number;
    outstanding: number;
    currentLevelOutstanding?: number;
    graceUntil: string | null;
    batchLabel: string | null;
  };
  levelAlignment?: {
    currentLevelChargeExists: boolean;
    currentChargeId: string | null;
    currentChargeAmount: number | null;
    currentChargeWaivedAmount?: number | null;
    currentChargeAllocated?: number;
    expectedCurrentChargeAmount?: number | null;
    ongoingEnrolment: {
      id: string;
      level: string;
      tuitionChargeId: string | null;
      feeSnapshot: number | null;
      batchMonth: string | null;
      batchYear: number | null;
    } | null;
    expectedBatchMonth: string | null;
    expectedBatchYear: number | null;
  };
  hasPhoto: boolean;
  verdict: PortalVerdict;
  payments: PaymentFact[];
  /** Confirmed open tuition on earlier levels, which can hold portal access. */
  priorLevelArrears: Array<{ chargeId: string; level: string; outstanding: number }>;
  registrationFeePayments?: Array<{ amount: number; description: string }>;
  /** Inferred backfill charges that need a staff decision before collection. */
  unreviewedPriorLevels?: Array<{ level: string; potentialOutstanding: number }>;
  /** What the student's own browser last reported (Phase 2's witness), if it ever has. */
  snapshot: { verdictKey: string; changedAt: string; lastWitnessAt: string | null; lastWitnessRendered: string | null } | null;
  /** Present only when the deep check (which asks Paystack) was run. */
  paystack: { checked: true; emailChecked: string; transactions: PaystackTx[] } | { checked: false; error?: string } | null;
};

// ---------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------

export type Severity = "problem" | "warning" | "info";

export type RepairId =
  | "record_paystack_payment"
  | "assign_student_code"
  | "sync_tuition_charge"
  | "reprice_current_tuition";

export type RepairOffer = {
  id: RepairId;
  label: string;
  /** Plain-language description of exactly what will happen. Shown before the click. */
  preview: string;
  /** The capability the person clicking must hold, on top of access to this console. */
  needs: Capability;
  /** What this repair is about — the server uses it to re-confirm the finding is still true. */
  params: Record<string, string>;
};

export type Finding = {
  /** Stable rule id, e.g. "paid-not-recorded". */
  rule: string;
  severity: Severity;
  title: string;
  detail: string;
  /** The facts the rule used — shown so a person can check the reasoning. */
  evidence: Array<{ label: string; value: string }>;
  offers: RepairOffer[];
};

export type Rule = { id: string; run: (facts: Facts) => Finding | null };

export type Diagnosis = {
  findings: Finding[];
  rulesRun: number;
  /** A rule that threw. Reported, never allowed to hide the other rules' findings. */
  ruleErrors: Array<{ rule: string; error: string }>;
};

export const naira = (n: number) => `₦${Math.round(n).toLocaleString("en-NG")}`;
const kobo = (n: number) => naira(n / 100);
const when = (iso: string | null) => (iso ? new Date(iso).toISOString().slice(0, 16).replace("T", " ") + " UTC" : "never");

// ---------------------------------------------------------------------------
// Paystack matching — the algorithm behind "I paid and it is not showing"
// ---------------------------------------------------------------------------

/**
 * Does this Paystack transaction belong to this student?
 *
 * The metadata WE attached at checkout is the authority when it is there: a
 * transaction that names a different student is somebody else's, even if the email
 * happens to match (a parent paying for two children from one address). Email is
 * only the fallback for a transaction that carries no identity of ours at all.
 */
export function belongsToStudent(tx: PaystackTx, who: { userId: string; studentId: string; email: string }): boolean {
  if (tx.metaStudentId || tx.metaUserId) {
    return tx.metaStudentId === who.studentId || tx.metaUserId === who.userId;
  }
  return Boolean(tx.email) && tx.email!.toLowerCase() === who.email.toLowerCase();
}

/**
 * Successful Paystack transactions that belong to this student and are NOT
 * recorded as received money here: either no Payment row carries the reference at
 * all (a missed webhook and a callback that never ran), or a row exists but was
 * never settled.
 */
export function unrecordedTransactions(
  transactions: PaystackTx[],
  payments: PaymentFact[],
  who: { userId: string; studentId: string; email: string },
  isReceived: (status: string) => boolean,
): Array<{ tx: PaystackTx; reason: "no-row" | "not-settled" }> {
  const out: Array<{ tx: PaystackTx; reason: "no-row" | "not-settled" }> = [];
  const seen = new Set<string>();
  for (const tx of transactions) {
    if (tx.status !== "success" || seen.has(tx.reference)) continue;
    seen.add(tx.reference);
    if (!belongsToStudent(tx, who)) continue;
    const rows = payments.filter((p) => p.references.includes(tx.reference));
    if (rows.length === 0) out.push({ tx, reason: "no-row" });
    else if (!rows.some((p) => isReceived(p.status))) out.push({ tx, reason: "not-settled" });
  }
  return out;
}

// ---------------------------------------------------------------------------
// The rules
// ---------------------------------------------------------------------------

const ruleUnrecordedPayment: Rule = {
  id: "paid-not-recorded",
  run(facts) {
    const p = facts.paystack;
    if (!p || !p.checked) return null;
    const missing = unrecordedTransactions(
      p.transactions,
      facts.payments,
      { userId: facts.user.id, studentId: facts.student.id, email: facts.user.email },
      isReceivedPayment,
    );
    if (missing.length === 0) return null;
    return {
      rule: "paid-not-recorded",
      severity: "problem",
      title: `Paystack has ${missing.length} payment${missing.length === 1 ? "" : "s"} from this student that ${missing.length === 1 ? "is" : "are"} not recorded here`,
      detail:
        "The student really paid — Paystack confirms it — but the payment never reached the database, usually because the " +
        "confirmation callback or webhook did not run. Their access is being calculated without this money. " +
        "Recording it is safe to repeat: it is keyed on the Paystack reference, so it cannot be recorded twice.",
      evidence: missing.flatMap(({ tx, reason }) => [
        { label: `Reference ${tx.reference}`, value: `${kobo(tx.amountKobo)} paid ${when(tx.paidAt)}` },
        { label: "  here", value: reason === "no-row" ? "no payment row at all" : "a row exists but was never settled" },
      ]),
      offers: missing.map(({ tx }) => ({
        id: "record_paystack_payment" as const,
        label: `Record ${kobo(tx.amountKobo)} (${tx.reference})`,
        preview:
          `Ask Paystack to confirm reference ${tx.reference} again, and — only if it confirms — record ${kobo(tx.amountKobo)} ` +
          `against ${facts.user.name ?? facts.user.email}. Nothing is charged; this only writes down a payment that already happened.`,
        needs: "payments" as Capability,
        params: { reference: tx.reference },
      })),
    };
  },
};

const rulePortalLocked: Rule = {
  id: "portal-locked",
  run(facts) {
    const { verdict, access } = facts;
    if (verdict.open) return null;
    const onlyPhoto = verdict.locks.length === 1 && verdict.locks[0].code === "photo_missing";
    const evidence = [
      { label: "Paid so far", value: naira(access.totalPaid) },
      { label: "Deposit required", value: naira(access.requiredDeposit) },
      { label: "Tuition fee", value: naira(access.tuitionFee) },
      { label: "Still to unlock", value: naira(access.outstanding) },
      { label: "Grace until", value: access.graceUntil ? when(access.graceUntil) : "none" },
      { label: "Profile photo", value: facts.hasPhoto ? "on file" : "MISSING" },
      ...(access.batchLabel ? [{ label: "Intake", value: access.batchLabel }] : []),
    ];
    return {
      rule: "portal-locked",
      severity: onlyPhoto ? "warning" : "info",
      title: onlyPhoto
        ? "Payment is fine — the portal is held only by a missing profile photo"
        : `The portal is locked: ${verdict.locks.map((l) => l.label.toLowerCase()).join(" + ")}`,
      detail: [
        onlyPhoto ? "Nothing is wrong with their payment. The one thing holding the portal shut is the photo wall." : "This is the portal working as designed, not a fault — here is exactly why.",
        ...verdict.locks.map((l) => `• ${l.label} — ${l.fix}`),
      ].join("\n"),
      evidence,
      offers: [],
    };
  },
};

/**
 * THE "PAID IN FULL BUT LOCKED" DRIFT.
 *
 * A student's CURRENT level has no TuitionCharge the ledger can match — most
 * often because `Student.level` was changed somewhere that never calls
 * `ensureChargeForLevel` (an ad-hoc level correction, a returning student
 * re-added by hand). The ledger then has nowhere to allocate their money for
 * this level: it reads as 0 paid toward it, however much they actually sent,
 * and src/lib/finance/ledger.ts's FIFO logic faithfully reports the fee as
 * outstanding. The portal locks them out; the checkout screen (once it also
 * reads the ledger — see access.ts's `currentLevelPaid`) stops lying about
 * being settled, but nobody is actually better off until the missing charge
 * is raised. That is this repair: it does not move any money, it only makes
 * sure the debit side of the ledger exists so the credit side (their real
 * payments) has somewhere to land.
 */
const ruleMissingLevelCharge: Rule = {
  id: "missing-level-charge",
  run(facts) {
    const { access } = facts;
    if (access.currentLevelPaid === undefined) return null;
    if (access.tuitionFee <= 0) return null;
    if (facts.levelAlignment?.currentLevelChargeExists === true) return null;
    if (facts.levelAlignment === undefined) {
      // Compatibility for older test fixtures/callers without charge facts.
      if (access.totalPaid < access.tuitionFee || access.currentLevelPaid >= access.tuitionFee) return null;
    }

    return {
      rule: "missing-level-charge",
      severity: "problem",
      title: `${facts.student.level} has no current tuition charge`,
      detail:
        `The student's current level is ${facts.student.level}, but there is no TuitionCharge for that level. ` +
        `The ledger therefore cannot reliably track this level's ${naira(access.tuitionFee)} fee or allocate ` +
        `payments against it. This commonly follows a level change that did not finish syncing its finance records.`,
      evidence: [
        { label: "Current level", value: facts.student.level },
        { label: "Paid in total", value: naira(access.totalPaid) },
        { label: `Credited to ${facts.student.level}`, value: naira(access.currentLevelPaid) },
        { label: `${facts.student.level} tuition fee`, value: naira(access.tuitionFee) },
        { label: "Current-level charge", value: "missing" },
        { label: "Portal", value: access.hasAccess ? "open" : `locked (${access.lockReason ?? "unknown"})` },
      ],
      offers: [
        {
          id: "sync_tuition_charge",
          label: `Sync ${facts.student.level} tuition records`,
          preview:
            `Create the missing ${facts.student.level} charge and align the ongoing enrolment's level and fee snapshot. ` +
            "No payment is created or changed.",
          needs: "payments" as Capability,
          params: {},
        },
      ],
    };
  },
};

const ruleCurrentEnrolmentMismatch: Rule = {
  id: "current-enrolment-mismatch",
  run(facts) {
    const alignment = facts.levelAlignment;
    if (!alignment || facts.student.status !== "active") return null;
    const enrolment = alignment.ongoingEnrolment;
    const mismatches = [
      !enrolment ? "no ongoing enrolment" : null,
      enrolment && enrolment.level.trim().toUpperCase() !== facts.student.level.trim().toUpperCase()
        ? `enrolment level is ${enrolment.level}`
        : null,
      enrolment &&
      alignment.currentLevelChargeExists &&
      (enrolment.tuitionChargeId !== alignment.currentChargeId ||
        enrolment.feeSnapshot !== alignment.currentChargeAmount)
        ? "enrolment fee snapshot does not match the current tuition charge"
        : null,
      enrolment &&
      alignment.expectedBatchMonth !== null &&
      (enrolment.batchMonth !== alignment.expectedBatchMonth ||
        enrolment.batchYear !== alignment.expectedBatchYear)
        ? "enrolment batch does not match the student's current batch"
        : null,
    ].filter((issue): issue is string => issue !== null);
    if (mismatches.length === 0) return null;

    return {
      rule: "current-enrolment-mismatch",
      severity: "problem",
      title: "Current level, batch and enrolment records do not match",
      detail:
        `The student record says ${facts.student.level}, but the ongoing enrolment or its saved fee/batch details ` +
        `are out of sync (${mismatches.join("; ")}). This can make the roster, payment desk and student portal ` +
        "show different current-level information.",
      evidence: [
        { label: "Student record level", value: facts.student.level },
        { label: "Ongoing enrolment level", value: enrolment?.level ?? "missing" },
        {
          label: "Ongoing enrolment fee snapshot",
          value: enrolment?.feeSnapshot === null || enrolment?.feeSnapshot === undefined
            ? "missing"
            : naira(enrolment.feeSnapshot),
        },
        {
          label: "Current tuition charge",
          value: alignment.currentLevelChargeExists
            ? naira(alignment.currentChargeAmount ?? 0)
            : "missing",
        },
        {
          label: "Current batch",
          value: alignment.expectedBatchMonth
            ? `${alignment.expectedBatchMonth}${alignment.expectedBatchYear ? ` ${alignment.expectedBatchYear}` : ""}`
            : "not set",
        },
      ],
      offers: [
        {
          id: "sync_tuition_charge",
          label: "Sync current level and enrolment records",
          preview:
            "Align the current tuition charge and ongoing enrolment with the student's saved level and batch. " +
            "No payment is created or changed.",
          needs: "payments",
          params: {},
        },
      ],
    };
  },
};

const ruleCurrentTuitionUnderpricedByRegistrationFee: Rule = {
  id: "current-tuition-underpriced-by-registration-fee",
  run(facts) {
    const alignment = facts.levelAlignment;
    const expected = alignment?.expectedCurrentChargeAmount;
    const actual = alignment?.currentChargeAmount;
    if (
      !alignment?.currentLevelChargeExists ||
      expected === null ||
      expected === undefined ||
      actual === null ||
      actual === undefined ||
      alignment.currentChargeAllocated !== 0 ||
      (alignment.currentChargeWaivedAmount ?? 0) !== 0 ||
      expected - actual !== 5_000
    ) {
      return null;
    }

    return {
      rule: "current-tuition-underpriced-by-registration-fee",
      severity: "problem",
      title: `${facts.student.level} tuition is ₦5,000 below the current price`,
      detail:
        `The unpaid ${facts.student.level} charge is ${naira(actual)}, exactly ₦5,000 below the current ` +
        `price of ${naira(expected)}. A registration fee must never be deducted from returning-student tuition.`,
      evidence: [
        { label: "Current level", value: facts.student.level },
        { label: "Saved tuition charge", value: naira(actual) },
        { label: "Current price-book tuition", value: naira(expected) },
        { label: "Applied to this charge", value: naira(alignment.currentChargeAllocated ?? 0) },
      ],
      offers: [
        {
          id: "reprice_current_tuition",
          label: `Correct ${facts.student.level} tuition to ${naira(expected)}`,
          preview:
            `Correct the unpaid ${facts.student.level} charge from ${naira(actual)} to ${naira(expected)} ` +
            "and sync the current enrolment. No payment or registration fee will be changed.",
          needs: "payments",
          params: {},
        },
      ],
    };
  },
};

const ruleRegistrationFeeCountedTowardTuition: Rule = {
  id: "registration-fee-counted-toward-tuition",
  run(facts) {
    const fee = Math.max(0, Math.round(facts.access.tuitionFee));
    const outstanding = facts.access.currentLevelOutstanding;
    if (
      outstanding === undefined ||
      fee <= outstanding ||
      (facts.levelAlignment?.currentChargeWaivedAmount ?? 0) > 0
    ) {
      return null;
    }
    const apparentCredit = fee - outstanding;
    const registrationCredit = (facts.registrationFeePayments ?? [])
      .filter((payment) => payment.amount > 0)
      .reduce((sum, payment) => sum + payment.amount, 0);
    if (apparentCredit !== registrationCredit || registrationCredit === 0) return null;

    return {
      rule: "registration-fee-counted-toward-tuition",
      severity: "problem",
      title: "A registration fee appears to have reduced the tuition balance",
      detail:
        `The ${facts.student.level} balance is ${naira(apparentCredit)} below its ${naira(fee)} tuition fee, ` +
        "matching registration-fee payments. Registration fees are separate and must not count toward tuition.",
      evidence: [
        { label: "Tuition fee", value: naira(fee) },
        { label: "Current-level balance", value: naira(outstanding) },
        { label: "Registration-fee payments", value: naira(registrationCredit) },
      ],
      offers: [],
    };
  },
};

const rulePriorLevelBalance: Rule = {
  id: "prior-level-balance",
  run(facts) {
    if (facts.access.lockReason !== "previous_level_balance") return null;
    if (facts.priorLevelArrears.length === 0) return null;
    const total = facts.priorLevelArrears.reduce((sum, c) => sum + c.outstanding, 0);
    const levels = [...new Set(facts.priorLevelArrears.map((c) => c.level))].join(", ");
    return {
      rule: "prior-level-balance",
      severity: "problem",
      title: `Access is held by a confirmed ${naira(total)} balance on an earlier level (${levels})`,
      detail:
        "The earlier-level balance is classified as confirmed owing, so the debt-first access rule is applying. " +
        "If the student did not take that level here or already paid, use Prior-level history review below to correct the record; " +
        "do not mark a genuine balance as settled just to unlock the portal.",
      evidence: facts.priorLevelArrears.map((c) => ({ label: c.level, value: naira(c.outstanding) })),
      offers: [],
    };
  },
};

const ruleUnreviewedPriorLevelHistory: Rule = {
  id: "unreviewed-prior-level-history",
  run(facts) {
    const levels = facts.unreviewedPriorLevels ?? [];
    if (levels.length === 0) return null;
    return {
      rule: "unreviewed-prior-level-history",
      severity: "warning",
      title: `Staff history review needed for ${levels.map((row) => row.level).join(", ")}`,
      detail:
        "These lower-level charges were inferred during ledger backfill, not verified from this student's actual enrolment history. " +
        "They are excluded from collectible debt and portal locks until a staff member records whether the level was completed and paid, " +
        "is genuinely owing, or was not taken at this school.",
      evidence: levels.map((row) => ({
        label: row.level,
        value: row.potentialOutstanding > 0
          ? `${naira(row.potentialOutstanding)} potential balance · not collectible`
          : "No confirmed balance · history still needs review",
      })),
      offers: [],
    };
  },
};

const ruleMissingCode: Rule = {
  id: "missing-student-code",
  run(facts) {
    if (facts.student.studentCode && facts.student.studentCode.trim()) return null;
    return {
      rule: "missing-student-code",
      severity: "warning",
      title: "This student has no student ID",
      detail:
        "Code assignment at signup is deliberately best-effort so a hiccup never costs someone their account, which means a " +
        "miss leaves the ID blank until something notices. The daily job fixes it eventually; this does it now.",
      evidence: [
        { label: "Student ID", value: "none" },
        { label: "Level", value: facts.student.level },
      ],
      offers: [
        {
          id: "assign_student_code",
          label: "Issue a student ID now",
          preview:
            "Generate the next free ID for this student's branch, level and intake, the same way signup does. " +
            "It retries on a collision and never changes an ID that already exists.",
          needs: "students",
          params: {},
        },
      ],
    };
  },
};

const ruleTenantMismatch: Rule = {
  id: "tenant-mismatch",
  run(facts) {
    const s = facts.student.tenantId;
    const u = facts.user.tenantId;
    if (s && u && s === u) return null;
    return {
      rule: "tenant-mismatch",
      severity: "problem",
      title: !s || !u ? "This account is missing its school (tenant) link" : "The student and their login belong to different schools",
      detail:
        "A row with no tenant is invisible to its own school's screens, and a student whose login and record disagree can be " +
        "bounced out of the portal or shown someone else's data. There is deliberately NO one-click repair: deciding which school " +
        "owns an account is a judgement about who can see what, and guessing wrong is how data leaks between schools.",
      evidence: [
        { label: "Student record tenant", value: s ?? "NONE" },
        { label: "Login (user) tenant", value: u ?? "NONE" },
      ],
      offers: [],
    };
  },
};

const ruleStaleScreen: Rule = {
  id: "screen-out-of-sync",
  run(facts) {
    const snap = facts.snapshot;
    if (!snap || !facts.verdict.open) return null;
    const rendered = snap.lastWitnessRendered;
    if (!rendered || rendered === "none") return null;
    return {
      rule: "screen-out-of-sync",
      severity: "problem",
      title: "Their screen last showed a lock that the database says is open",
      detail:
        "The database says this student's portal is open, but the last time their phone reported in it was showing a lock screen. " +
        "That is almost always a stale copy of the app or a cached answer on their device, not a data problem. Locked screens re-check " +
        "every 30 seconds, so it usually clears by itself; if it does not, ask them to close and reopen the app.",
      evidence: [
        { label: "Database says", value: "open" },
        { label: "Their screen showed", value: `${rendered} lock` },
        { label: "Reported at", value: when(snap.lastWitnessAt) },
      ],
      offers: [],
    };
  },
};

const VALID_PHYSICAL_SLOTS = new Set(["morning", "afternoon", "evening", "weekend"]);
const VALID_ONLINE_SLOTS = new Set(["morning", "evening"]);

const ruleClassScheduleSetup: Rule = {
  id: "class-schedule-setup",
  run(facts) {
    const setup = facts.classSetup;
    if (facts.student.status !== "active" || !setup) return null;

    const problems: string[] = [];
    if (
      facts.student.deliveryMode === "hybrid" &&
      (!setup.hybridOnlineSlot || !VALID_ONLINE_SLOTS.has(setup.hybridOnlineSlot.toLowerCase()))
    ) {
      problems.push(
        setup.hybridOnlineSlot
          ? `online sitting "${setup.hybridOnlineSlot}" is not a supported hybrid sitting`
          : "online sitting has not been chosen",
      );
    }
    if (
      facts.student.classType !== "private" &&
      !VALID_PHYSICAL_SLOTS.has(String(facts.student.sessionSlot ?? "").toLowerCase())
    ) {
      problems.push(`class sitting "${facts.student.sessionSlot ?? ""}" is not recognised`);
    }
    if (problems.length === 0) return null;

    return {
      rule: "class-schedule-setup",
      severity: "problem",
      title: "The student's class sitting is missing or invalid",
      detail:
        `The saved class schedule cannot reliably identify this student's ${facts.student.deliveryMode ?? "class"} ` +
        `seat (${problems.join("; ")}). This can leave the portal showing the wrong sitting or make the right live class hard to find. ` +
        "Correct the student's schedule in the student record, then refresh the diagnosis.",
      evidence: [
        { label: "Class type", value: facts.student.classType ?? "unknown" },
        { label: "Delivery mode", value: facts.student.deliveryMode ?? "unknown" },
        { label: "Campus/primary sitting", value: facts.student.sessionSlot ?? "missing" },
        { label: "Hybrid online sitting", value: setup.hybridOnlineSlot ?? "missing" },
      ],
      offers: [],
    };
  },
};

const ruleTutorAssignmentHealth: Rule = {
  id: "class-tutor-assignment",
  run(facts) {
    const setup = facts.classSetup;
    if (facts.student.status !== "active" || !setup) return null;

    const activeTutors = setup.tutors.filter((tutor) => tutor.status === "active" || tutor.status === "probation");
    const hasUpcomingPrivateTutor = setup.upcomingPrivateClasses.some((session) => session.lecturerId);
    const needsNamedTutor =
      facts.student.classType === "private" ||
      facts.student.deliveryMode === "online" ||
      facts.student.deliveryMode === "hybrid";
    if (!needsNamedTutor || activeTutors.length > 0 || (facts.student.classType === "private" && hasUpcomingPrivateTutor)) {
      return null;
    }

    const inactive = setup.tutors.length > 0;
    return {
      rule: "class-tutor-assignment",
      severity: "problem",
      title: inactive ? "The assigned class tutor is inactive" : "No active tutor is assigned to this class",
      detail: inactive
        ? "Every tutor linked to this student's online/private class is marked inactive. Reassign an active tutor before relying on live-class access."
        : "This student's online or private class has no named active tutor. The roster and live-class routing use tutor assignments to identify the correct class.",
      evidence: [
        { label: "Class type", value: facts.student.classType ?? "unknown" },
        { label: "Delivery mode", value: facts.student.deliveryMode ?? "unknown" },
        {
          label: "Assigned tutors",
          value: setup.tutors.length
            ? setup.tutors.map((tutor) => `${tutor.id} (${tutor.status})`).join(", ")
            : "none",
        },
        {
          label: "Private sessions with a named tutor",
          value: String(setup.upcomingPrivateClasses.filter((session) => session.lecturerId).length),
        },
      ],
      offers: [],
    };
  },
};

const rulePrivateClassCoverage: Rule = {
  id: "private-class-coverage",
  run(facts) {
    const setup = facts.classSetup;
    if (facts.student.status !== "active" || facts.student.classType !== "private" || !setup) return null;

    const now = Date.now();
    const scheduled = setup.upcomingPrivateClasses.filter((session) => new Date(session.scheduledAt).getTime() >= now);
    if (scheduled.length === 0) {
      return {
        rule: "private-class-coverage",
        severity: "warning",
        title: "No upcoming private session is booked",
        detail:
          "This student is marked as private, but there is no future scheduled one-to-one session. Their private-class calendar and live notifications depend on a booking being present.",
        evidence: [
          { label: "Class type", value: "private" },
          { label: "Upcoming scheduled sessions", value: "0" },
          { label: "Assigned tutor", value: setup.tutors.find((tutor) => tutor.role === "primary")?.id ?? "none" },
        ],
        offers: [],
      };
    }

    const primaryTutorId = setup.tutors.find((tutor) => tutor.role === "primary")?.id;
    const conflicts = scheduled.filter(
      (session) => primaryTutorId && session.lecturerId && session.lecturerId !== primaryTutorId,
    );
    if (conflicts.length === 0) return null;

    return {
      rule: "private-class-coverage",
      severity: "warning",
      title: "A private booking uses a different tutor than the student record",
      detail:
        "The booking has its own tutor, which can be an intentional one-session override. Confirm the difference is expected so the tutor roster, live-room host and student notification all point to the intended person.",
      evidence: conflicts.map((session) => ({
        label: `Booking ${session.id} · ${new Date(session.scheduledAt).toLocaleDateString()}`,
        value: `booking tutor ${session.lecturerId}; student tutor ${primaryTutorId}`,
      })),
      offers: [],
    };
  },
};

const rulePrivateLiveSessionMissing: Rule = {
  id: "private-live-session-missing",
  run(facts) {
    const setup = facts.classSetup;
    if (!setup || facts.student.classType !== "private" || facts.student.status !== "active") return null;

    const now = Date.now();
    const onlineAppointments = setup.upcomingPrivateClasses.filter((session) => {
      const startsAt = new Date(session.scheduledAt).getTime();
      const isOnline = ["online", "hybrid"].includes(
        String(session.deliveryMode ?? facts.student.deliveryMode ?? "").toLowerCase(),
      );
      return isOnline && startsAt <= now && startsAt + session.durationMinutes * 60_000 > now;
    });
    const missingRooms = onlineAppointments.filter(
      (booking) => !setup.liveSessions.some((session) => session.privateClassId === booking.id),
    );
    if (missingRooms.length === 0) return null;

    return {
      rule: "private-live-session-missing",
      severity: "warning",
      title: "An online private appointment is in progress without an active live room",
      detail:
        "The booking is within its scheduled time, but Mission Control cannot find an active live session attached to it. Check that the tutor started the correct private booking and that the session heartbeat is current.",
      evidence: missingRooms.map((booking) => ({
        label: `Private booking ${booking.id}`,
        value: `${new Date(booking.scheduledAt).toLocaleString()} · ${booking.deliveryMode ?? facts.student.deliveryMode ?? "online"}`,
      })),
      offers: [],
    };
  },
};

const ruleLiveTutorRoomMismatch: Rule = {
  id: "live-tutor-room-mismatch",
  run(facts) {
    const setup = facts.classSetup;
    if (
      !setup ||
      setup.liveSessions.length === 0 ||
      facts.student.classType === "private" ||
      facts.student.status !== "active"
    ) {
      return null;
    }

    const liveTutorIds = new Set(setup.liveSessions.map((session) => session.lecturerId).filter(Boolean));
    const assignedLiveTutors = setup.tutors.filter((tutor) => liveTutorIds.has(tutor.id));
    if (assignedLiveTutors.length === 0) return null;

    const sameLevelSessions = setup.liveSessions.filter(
      (session) =>
        session.kind === "cohort" &&
        session.level?.trim().toLowerCase() === facts.student.level.trim().toLowerCase(),
    );
    if (sameLevelSessions.length === 0) return null;

    const expectedSlots = new Set(
      assignedLiveTutors
        .map((tutor) =>
          tutor.role === "online" && facts.student.deliveryMode === "hybrid"
            ? setup.hybridOnlineSlot
            : facts.student.sessionSlot,
        )
        .filter((slot): slot is string => Boolean(slot))
        .map((slot) => slot.toLowerCase()),
    );
    const hasMatchingRoom = sameLevelSessions.some(
      (session) =>
        Boolean(session.sessionSlot) &&
        expectedSlots.has(session.sessionSlot?.toLowerCase() ?? "") &&
        studentMayJoinBatch(session.batch, facts.student.admission),
    );
    if (hasMatchingRoom) return null;

    return {
      rule: "live-tutor-room-mismatch",
      severity: "warning",
      title: "The assigned tutor is live, but not in this student's sitting or intake",
      detail:
        "A live session for this student's level is running under one of their assigned tutors, but its sitting or batch does not match this student's saved class details. It may be another group; confirm the tutor started the intended class before asking the student to join.",
      evidence: sameLevelSessions.map((session) => ({
        label: session.title,
        value: `sitting ${session.sessionSlot ?? "not set"} · intake ${session.batch ?? "not pinned"} · room ${session.id}`,
      })),
      offers: [],
    };
  },
};

/** The order is the order findings are computed in; severity decides display order. */
export const RULES: Rule[] = [
  ruleUnrecordedPayment,
  ruleUnreviewedPriorLevelHistory,
  rulePriorLevelBalance,
  ruleTenantMismatch,
  ruleClassScheduleSetup,
  ruleTutorAssignmentHealth,
  rulePrivateClassCoverage,
  rulePrivateLiveSessionMissing,
  ruleLiveTutorRoomMismatch,
  ruleStaleScreen,
  ruleMissingLevelCharge,
  ruleCurrentEnrolmentMismatch,
  ruleCurrentTuitionUnderpricedByRegistrationFee,
  ruleRegistrationFeeCountedTowardTuition,
  ruleMissingCode,
  rulePortalLocked,
];

const SEVERITY_RANK: Record<Severity, number> = { problem: 0, warning: 1, info: 2 };

export function diagnose(facts: Facts, rules: Rule[] = RULES): Diagnosis {
  const findings: Finding[] = [];
  const ruleErrors: Diagnosis["ruleErrors"] = [];
  for (const rule of rules) {
    try {
      const finding = rule.run(facts);
      if (finding) findings.push(finding);
    } catch (error) {
      // One broken rule must never hide what the others found.
      ruleErrors.push({ rule: rule.id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  findings.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
  return { findings, rulesRun: rules.length, ruleErrors };
}

/**
 * Paystack's raw transaction JSON → the few fields matching needs.
 *
 * `metadata` is the awkward one: an object when we set it at checkout, an EMPTY
 * STRING when nobody did, occasionally a JSON string. Anything unreadable becomes
 * "no identity", which sends matching to the email fallback rather than crashing.
 */
export function toPaystackTx(raw: unknown): PaystackTx | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const reference = typeof r.reference === "string" ? r.reference : "";
  if (!reference) return null;

  let meta: Record<string, unknown> = {};
  if (r.metadata && typeof r.metadata === "object") meta = r.metadata as Record<string, unknown>;
  else if (typeof r.metadata === "string" && r.metadata.trim().startsWith("{")) {
    try {
      meta = JSON.parse(r.metadata);
    } catch {
      meta = {};
    }
  }
  const text = (value: unknown) => (typeof value === "string" && value ? value : null);
  const customer = r.customer && typeof r.customer === "object" ? (r.customer as Record<string, unknown>) : {};

  return {
    reference,
    status: typeof r.status === "string" ? r.status : "unknown",
    amountKobo: Number(r.amount) || 0,
    currency: typeof r.currency === "string" ? r.currency : "NGN",
    paidAt: text(r.paid_at) ?? text(r.paidAt),
    email: text(customer.email),
    metaUserId: text(meta.userId),
    metaStudentId: text(meta.studentId),
  };
}
