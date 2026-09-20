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
  };
  user: { id: string; email: string; name: string | null; tenantId: string | null };
  access: {
    hasAccess: boolean;
    lockReason: string | null;
    totalPaid: number;
    tuitionFee: number;
    requiredDeposit: number;
    outstanding: number;
    graceUntil: string | null;
    batchLabel: string | null;
  };
  hasPhoto: boolean;
  verdict: PortalVerdict;
  payments: PaymentFact[];
  /** What the student's own browser last reported (Phase 2's witness), if it ever has. */
  snapshot: { verdictKey: string; changedAt: string; lastWitnessAt: string | null; lastWitnessRendered: string | null } | null;
  /** Present only when the deep check (which asks Paystack) was run. */
  paystack: { checked: true; emailChecked: string; transactions: PaystackTx[] } | { checked: false; error?: string } | null;
};

// ---------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------

export type Severity = "problem" | "warning" | "info";

export type RepairId = "record_paystack_payment" | "assign_student_code";

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

const naira = (n: number) => `₦${Math.round(n).toLocaleString("en-NG")}`;
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

/** The order is the order findings are computed in; severity decides display order. */
export const RULES: Rule[] = [ruleUnrecordedPayment, ruleTenantMismatch, ruleStaleScreen, ruleMissingCode, rulePortalLocked];

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
