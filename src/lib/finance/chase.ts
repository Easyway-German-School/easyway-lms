import {
  CHASE_LABELS,
  CHASE_PRIORITY_LABELS,
  chaseCategoryOf,
  chasePriorityOf,
  naira,
  type ChaseCategory,
  type StudentFinance,
} from "@/lib/finance/receivables";
import { phoneForSheet, studentPhoneRaw } from "@/lib/phone-display";

/**
 * THE CALL SHEET AND THE WORDS OF THE REMINDER.
 *
 * Both are things the office produces from the chase list, and both must agree
 * with it — so both read the category and the figures from `receivables.ts`
 * rather than working out "who owes what" a second time. Pure on purpose: the
 * export route, the mass-reminder route and the tests all call the same code.
 */

/* -------------------------------------------------------------------------- */
/* The reminder wording                                                       */
/* -------------------------------------------------------------------------- */

export type ChaseMessage = { title: string; message: string };

type MessageFinance = Pick<
  StudentFinance,
  | "owed"
  | "owedOnDeposit"
  | "tuitionFee"
  | "paid"
  | "lockAt"
  | "lockActive"
  | "awaitingBatch"
  | "batchLabel"
  | "legacyOutstanding"
  | "goForwardOutstanding"
  | "ledgerPopulated"
>;

/**
 * The note an admin may add sits ABOVE nothing and below everything: it is
 * appended after the figures, so the sentence that carries the amount is always
 * the school's own. It may not contain a number — a figure typed by hand into
 * copy that goes to two hundred people is one wrong sentence, two hundred times.
 * See `noteHasAmount`.
 */
export const CHASE_NOTE_MAX = 400;

export function noteHasAmount(note: string): boolean {
  return /\d[\d,.]{2,}/.test(note);
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-NG", { day: "numeric", month: "long" });
}

export function chaseMessage(input: {
  firstName: string;
  category: ChaseCategory;
  finance: MessageFinance;
  note?: string;
}): ChaseMessage {
  const { finance, category } = input;
  const hi = input.firstName ? `Hi ${input.firstName}, ` : "";
  const tail = "Pay from your Payments page, or call the office and we will help.";
  let title: string;
  let body: string;

  switch (category) {
    case "nothing": {
      if (finance.awaitingBatch) {
        const batch = finance.batchLabel ?? "upcoming";
        title = `Confirm your ${batch} seat`;
        body =
          `${hi}you are registered with EasyWay German School, but no tuition has been paid yet, so your ${batch} seat is not confirmed. ` +
          `${naira(finance.owedOnDeposit)} confirms it before classes open (full tuition is ${naira(finance.tuitionFee)}). ${tail}`;
      } else {
        title = "Your seat is waiting";
        body =
          `${hi}you are registered with EasyWay German School, but no tuition has been paid yet, so your classes have not opened. ` +
          `${naira(finance.owedOnDeposit)} opens them (full tuition is ${naira(finance.tuitionFee)}). ${tail}`;
      }
      break;
    }
    case "under_deposit": {
      title = "Almost there — finish your deposit";
      body =
        `${hi}thank you for the ${naira(finance.paid)} you have paid so far. ` +
        `${naira(finance.owedOnDeposit)} more opens your classes (full tuition is ${naira(finance.tuitionFee)}). ${tail}`;
      break;
    }
    case "balance": {
      const balance = finance.ledgerPopulated ? finance.goForwardOutstanding : finance.owed;
      if (finance.lockActive) {
        title = "Your access is on hold";
        body =
          `${hi}your access is on hold until your ${naira(balance)} tuition balance is settled. ` +
          `Pay from your Payments page and it reopens straight away, or call the office.`;
      } else if (finance.lockAt) {
        title = "Tuition balance outstanding";
        body =
          `${hi}${naira(balance)} of your tuition is still outstanding. ` +
          `Please settle it by ${shortDate(finance.lockAt)}, when access pauses until the balance is cleared. ${tail}`;
      } else {
        title = "Tuition balance outstanding";
        body = `${hi}${naira(balance)} of your tuition is still outstanding. ${tail}`;
      }
      break;
    }
    case "legacy": {
      title = "An earlier balance is on your account";
      body =
        `${hi}our records show ${naira(finance.legacyOutstanding)} still outstanding from an earlier level. ` +
        `Nothing is restricted — please settle it from your Payments page or arrange a plan with the office when you can.`;
      break;
    }
  }

  const note = input.note?.trim();
  return { title, message: note ? `${body}\n\n${note}` : body };
}

/* -------------------------------------------------------------------------- */
/* The call sheet                                                             */
/* -------------------------------------------------------------------------- */

/** The slice of a roster row the sheet reads. Structural, so it needs no Prisma types. */
export type ChaseSheetStudent = {
  studentCode?: string | null;
  status?: string | null;
  level: string;
  classType?: string | null;
  sessionSlot?: string | null;
  deliveryMode?: string | null;
  createdAt: Date;
  classesStartedAt?: Date | null;
  admission?: unknown;
  profile?: {
    phone?: string | null;
    whatsapp?: string | null;
    guardianName?: string | null;
    guardianPhone?: string | null;
    emergencyName?: string | null;
    emergencyPhone?: string | null;
    city?: string | null;
  } | null;
  branch?: { name?: string | null } | null;
  tutor?: { user?: { name?: string | null } | null } | null;
  user?: { name?: string | null; email?: string | null } | null;
};

export type ChaseSheetEntry = { student: ChaseSheetStudent; finance: StudentFinance };

const isoDay = (value: Date | string | null | undefined): string =>
  value ? new Date(value).toISOString().slice(0, 10) : "";

/**
 * What state the student's portal is in, in words the caller can use on the
 * phone: "Locked — no deposit", "On hold — balance", "Waiting for October".
 */
export function portalStatusOf(finance: StudentFinance): string {
  if (finance.awaitingBatch) return `Waiting for ${finance.batchLabel ?? "their"} batch`;
  if (finance.lockActive) return "On hold — balance owing";
  if (finance.lockedOut) return "Locked — deposit not paid";
  if (finance.graceUntil && new Date(finance.graceUntil) > new Date()) return "Open — grace period";
  return "Open";
}

/** Most urgent first; within a priority, the biggest debt first. */
export function sortChaseEntries(entries: ChaseSheetEntry[], now: Date = new Date()): ChaseSheetEntry[] {
  return [...entries].sort((a, b) => {
    const byPriority = chasePriorityOf(a.finance, now) - chasePriorityOf(b.finance, now);
    if (byPriority !== 0) return byPriority;
    return b.finance.owed - a.finance.owed || b.finance.daysEnrolled - a.finance.daysEnrolled;
  });
}

/**
 * One row per student, in the order somebody ringing round would want it.
 *
 * `canSeeMoney` follows the `payments` capability exactly as the roster does:
 * Customer Care can be handed the sheet — who to ring, their number, how urgent
 * — without a naira figure in it. The category and priority stay, because the
 * roster already shows a Customer Care agent who is behind and for how long.
 */
export function chaseSheetHeaders(canSeeMoney: boolean): string[] {
  return [
    "Priority",
    "Name",
    "Phone",
    "WhatsApp",
    "Email",
    "Group",
    ...(canSeeMoney
      ? ["Owed (NGN)", "Short of deposit (NGN)", "Paid so far (NGN)", "Tuition fee (NGN)"]
      : []),
    "Portal",
    "Days since enrolled",
    "Last payment",
    "Lock date",
    "Level",
    "Batch",
    "Branch",
    "Tutor",
    "Session",
    "Attends",
    "City",
    "Guardian",
    "Guardian phone",
    "Emergency contact",
    "Emergency phone",
    "Student code",
    "Enrolled on",
    // Blank columns for the people ringing round to fill in on the sheet.
    "Called?",
    "Outcome",
    "Promised date",
    "Notes",
  ];
}

export function chaseSheetRow(entry: ChaseSheetEntry, canSeeMoney: boolean, now: Date = new Date()): string[] {
  const { student, finance } = entry;
  const category = chaseCategoryOf(finance);
  const contact = studentPhoneRaw(student);
  const admission =
    student.admission && typeof student.admission === "object" && !Array.isArray(student.admission)
      ? (student.admission as Record<string, unknown>)
      : {};
  const batch = typeof admission.batch === "string" ? admission.batch : "";
  const profile = student.profile;

  return [
    CHASE_PRIORITY_LABELS[chasePriorityOf(finance, now)] ?? "",
    student.user?.name ?? finance.name,
    phoneForSheet(contact.phone),
    // Only worth a column when it differs from the main number.
    contact.whatsapp && contact.whatsapp !== contact.phone ? phoneForSheet(contact.whatsapp) : "",
    student.user?.email ?? finance.email,
    category ? CHASE_LABELS[category].label : "",
    ...(canSeeMoney
      ? [String(finance.owed), String(finance.owedOnDeposit), String(finance.paid), String(finance.tuitionFee)]
      : []),
    portalStatusOf(finance),
    String(finance.daysEnrolled),
    isoDay(finance.lastPaymentAt),
    isoDay(finance.lockAt),
    student.level,
    batch,
    student.branch?.name ?? finance.branch,
    student.tutor?.user?.name ?? "",
    student.sessionSlot ?? "",
    student.deliveryMode ?? "",
    profile?.city ?? "",
    profile?.guardianName ?? "",
    phoneForSheet(profile?.guardianPhone),
    profile?.emergencyName ?? "",
    phoneForSheet(profile?.emergencyPhone),
    student.studentCode ?? "",
    isoDay(student.createdAt),
    "",
    "",
    "",
    "",
  ];
}
