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
  "/settings",
  // The tuition checkout itself — locking this would make the paywall a
  // dead end, since every "Pay tuition" call to action lands here.
  "/programs",
] as const;

export function isTuitionFreeRoute(pathname: string): boolean {
  return TUITION_FREE_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );
}

/** The inverse, for readability at call sites that gate rather than allow. */
export function isTuitionGatedRoute(pathname: string): boolean {
  return !isTuitionFreeRoute(pathname);
}

export type StudentAccess = {
  /** False while a registration-only student still owes the deposit. */
  hasAccess: boolean;
  /** True once anything at all has been paid — the registration fee. */
  registrationPaid: boolean;
  totalPaid: number;
  tuitionFee: number;
  requiredDeposit: number;
  /** What is still owed before classes open. */
  outstanding: number;
  /** Progress towards the deposit (not the full fee) — that is the gate. */
  progressPercent: number;
  currency: string;
};

/**
 * Access opens at the DEPOSIT, not the full fee, matching how the school
 * actually enrols: pay 60% and you start class while the balance runs.
 */
export function deriveStudentAccess({
  totalPaid,
  tuitionFee,
  requiredDeposit,
}: {
  totalPaid: number;
  tuitionFee: number;
  requiredDeposit: number;
}): StudentAccess {
  const paid = Math.max(0, Math.round(Number(totalPaid) || 0));
  const fee = Math.max(0, Math.round(Number(tuitionFee) || 0));
  const deposit = Math.max(0, Math.round(Number(requiredDeposit) || 0));

  return {
    hasAccess: deposit > 0 ? paid >= deposit : paid >= fee,
    registrationPaid: paid > 0,
    totalPaid: paid,
    tuitionFee: fee,
    requiredDeposit: deposit,
    outstanding: Math.max(0, deposit - paid),
    progressPercent: deposit > 0 ? Math.min(100, Math.round((paid / deposit) * 100)) : 0,
    currency: "NGN",
  };
}
