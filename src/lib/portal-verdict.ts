/**
 * WHAT A STUDENT'S PORTAL IS DOING TO THEM — every reason, in one place.
 *
 * A student's portal can be walled for more than one reason: the tuition gate
 * (deposit, balance, an intake that has not begun) and the photo wall. They are
 * separate gates with separate screens, but "is this student locked out?" is one
 * question, and until this file the answer was assembled twice: the student's
 * shell combined `hasAccess` with `hasPhoto`, while the admin Remote View read
 * `hasAccess` alone. So a paid student with no photo saw a lock screen while the
 * office's mirror said "open" — the office reassuring somebody that a page was
 * fine while it was padlocked in front of them.
 *
 * Anything that reports on, or reacts to, whether a student is locked should
 * take its answer from `portalVerdict()` rather than from `hasAccess` on its
 * own. It is pure, so the same student data gives the same verdict everywhere.
 *
 * THE WITNESS. The verdict is what the server believes. What the student
 * actually sees is a different fact, produced by a browser that may be running
 * old code, an old cached response, or its own gating logic. The shell reports
 * what it rendered (`usePortalWitness`) and `judgeWitness()` decides whether
 * that and the server's current belief are the same story.
 */

import type { PaymentLockReason } from "@/lib/access";

export type PortalLockCode =
  | "unpaid_deposit"
  | "unsettled_balance"
  | "upcoming_batch"
  | "photo_missing";

export type PortalLock = {
  code: PortalLockCode;
  /** One line an admin can read out loud to a student. */
  label: string;
  /** What actually lifts it. */
  fix: string;
};

export type PortalVerdict = {
  /** True only when NOTHING is holding the portal back. */
  open: boolean;
  locks: PortalLock[];
  /** Stable identity of the verdict: "open" or the sorted lock codes. */
  key: string;
};

const LOCKS: Record<PortalLockCode, Omit<PortalLock, "code">> = {
  unpaid_deposit: {
    label: "Deposit not yet paid",
    fix: "Payment covering the required deposit, or an admin grace period.",
  },
  unsettled_balance: {
    label: "Tuition balance overdue",
    fix: "Settle the outstanding balance, an on-track payment plan, or an admin grace period.",
  },
  upcoming_batch: {
    label: "Their intake has not started yet",
    fix: "Nothing to fix — it opens on the batch start date.",
  },
  photo_missing: {
    label: "No profile photo",
    fix: "The student taps the camera on their /profile page and saves a photo.",
  },
};

/**
 * `access` is the payment/batch half (`StudentAccess`); `hasPhoto` the photo
 * wall. Both are needed — passing only the first is the bug this file exists to
 * remove.
 */
export function portalVerdict(
  access: { hasAccess: boolean; lockReason: PaymentLockReason },
  hasPhoto: boolean,
): PortalVerdict {
  const codes: PortalLockCode[] = [];
  if (!access.hasAccess) codes.push(access.lockReason ?? "unpaid_deposit");
  if (!hasPhoto) codes.push("photo_missing");
  codes.sort();
  return {
    open: codes.length === 0,
    locks: codes.map((code) => ({ code, ...LOCKS[code] })),
    key: codes.length ? codes.join("+") : "open",
  };
}

// ---------------------------------------------------------------------------
// What the student's screen actually showed
// ---------------------------------------------------------------------------

/** The lock screen a browser rendered, or "none" for real content. */
export type RenderedLock = "none" | "payment" | "batch" | "photo";

export const RENDERED_LOCKS: readonly RenderedLock[] = ["none", "payment", "batch", "photo"];

/**
 * Which lock screen the shell puts up, from the flags it already computes.
 * Mirrors the shell's own precedence: the tuition/batch screen is shown before
 * the photo screen when both apply.
 */
export function renderedLockOf(input: {
  routeLocked: boolean;
  photoLocked: boolean;
  lockReason: PaymentLockReason;
}): RenderedLock {
  if (input.routeLocked) return input.lockReason === "upcoming_batch" ? "batch" : "payment";
  if (input.photoLocked) return "photo";
  return "none";
}

/** The codes that justify a given rendered lock. "none" needs no justification. */
function justifies(rendered: RenderedLock): PortalLockCode[] {
  switch (rendered) {
    case "payment":
      return ["unpaid_deposit", "unsettled_balance"];
    case "batch":
      return ["upcoming_batch"];
    case "photo":
      return ["photo_missing"];
    default:
      return [];
  }
}

/**
 * A client is shown data older than this before a difference from the server's
 * current answer counts as drift. Below it, a payment or a photo landing a
 * moment ago is an ordinary race, not a fault.
 */
export const STALE_AFTER_MS = 90_000;

export type WitnessReport = {
  /** The lock codes the client was TOLD (from its /api/student/access response). */
  receivedLocks: string[];
  /** What it then rendered. */
  rendered: RenderedLock;
  /** Server clock when that response was produced (ms since epoch). */
  computedAt: number;
};

export type WitnessJudgement =
  | { kind: "ok" }
  | { kind: "render"; detail: string }
  | { kind: "stale"; detail: string; ageSeconds: number };

/**
 * Compare what a student's screen showed with what the server believes now.
 *
 *  - render: the browser put up a lock its OWN data did not justify. Both facts
 *    come from the same response, so there is no race to excuse it — the gating
 *    logic in that browser disagrees with the server's, typically old cached JS.
 *  - stale: the browser is acting on a verdict that no longer matches the
 *    database, and has been for longer than a race explains. Typically a service
 *    worker or proxy serving an old /api/student/access.
 */
export function judgeWitness(
  report: WitnessReport,
  fresh: PortalVerdict,
  now: number,
): WitnessJudgement {
  const needed = justifies(report.rendered);
  if (needed.length && !needed.some((code) => report.receivedLocks.includes(code))) {
    return {
      kind: "render",
      detail:
        `The portal showed a "${report.rendered}" lock screen, but the verdict it had been given ` +
        `(${report.receivedLocks.join("+") || "open"}) contained no reason for it.`,
    };
  }

  const receivedKey = report.receivedLocks.length ? [...report.receivedLocks].sort().join("+") : "open";
  const ageMs = now - report.computedAt;
  if (receivedKey !== fresh.key && ageMs > STALE_AFTER_MS) {
    return {
      kind: "stale",
      ageSeconds: Math.round(ageMs / 1000),
      detail:
        `The student's screen is acting on "${receivedKey}" but the database now says "${fresh.key}", ` +
        `and the data it is using is ${Math.round(ageMs / 1000)}s old.`,
    };
  }

  return { kind: "ok" };
}
