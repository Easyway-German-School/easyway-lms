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
  deliveryMode,
  classType,
}: {
  totalPaid: number;
  tuitionFee: number;
  requiredDeposit: number;
  deliveryMode?: unknown;
  classType?: unknown;
}): StudentAccess {
  const paid = Math.max(0, Math.round(Number(totalPaid) || 0));
  const fee = Math.max(0, Math.round(Number(tuitionFee) || 0));
  const deposit = Math.max(0, Math.round(Number(requiredDeposit) || 0));

  return {
    deliveryMode: normaliseDeliveryMode(deliveryMode),
    classType: normaliseClassType(classType),
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
