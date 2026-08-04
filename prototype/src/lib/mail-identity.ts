// From the leaf module, NOT from notify.ts. notify.ts depends on the routing
// layer which depends on this file, so importing KIND from there is a cycle
// that throws "Cannot access 'KIND' before initialization" at import time.
import { KIND } from "@/lib/notification-kinds";

/**
 * The school's two sending identities.
 *
 * WHY TWO, AND WHY IT IS NOT COSMETIC.
 *
 * A payment receipt and a note from the office are different kinds of object
 * and a student answers them differently. A receipt arriving from a person's
 * address invites a reply nobody is watching; an announcement arriving from
 * `donotreply@` tells a student the school does not want to hear back, which
 * is the opposite of what an announcement is for. So:
 *
 *   support    Someone reads the replies. Anything an admin composes by hand,
 *              anything a student might reasonably answer.
 *   noreply    Automated. Receipts, reminders, results, system confirmations.
 *              Carries no Reply-To, so a client that offers "reply" at least
 *              sends it to the support address rather than into a void.
 *
 * ONE MAILBOX AUTHENTICATES, TWO ADDRESSES SEND. SMTP authentication is per
 * mailbox; the `From:` header is per message. So the school signs in once with
 * `SMTP_USER` and sets `From:` per message — which every provider allows only
 * for a domain it has verified. Both addresses here must be on the school's own
 * domain and that domain needs SPF and DKIM, or the second address is the one
 * that starts landing in spam while the first looks fine.
 */

export type MailIdentityKey = "support" | "noreply";

export type MailIdentity = {
  key: MailIdentityKey;
  email: string;
  name: string;
  /** Where a reply should land. Null means the client offers no useful reply. */
  replyTo: string | null;
  /** One line the templates can print under the signature. */
  footer: string;
};

const DOMAIN = process.env.MAIL_DOMAIN?.trim() || "easywaylanguageschool.com";
const SCHOOL = process.env.MAIL_SCHOOL_NAME?.trim() || "Easyway Language School";

function address(envKey: string, fallbackLocal: string): string {
  const configured = process.env[envKey]?.trim();
  return configured || `${fallbackLocal}@${DOMAIN}`;
}

export const SUPPORT_ADDRESS = address("MAIL_SUPPORT_ADDRESS", "support");
export const NOREPLY_ADDRESS = address("MAIL_NOREPLY_ADDRESS", "donotreply");

export const MAIL_IDENTITIES: Record<MailIdentityKey, MailIdentity> = {
  support: {
    key: "support",
    email: SUPPORT_ADDRESS,
    name: SCHOOL,
    replyTo: SUPPORT_ADDRESS,
    footer: `Reply to this email and the office will see it — ${SUPPORT_ADDRESS}`,
  },
  noreply: {
    key: "noreply",
    email: NOREPLY_ADDRESS,
    name: SCHOOL,
    // Deliberately points at support rather than being null. A student WILL
    // hit reply on a receipt when something is wrong with it, and the reply
    // should reach a person instead of bouncing.
    replyTo: SUPPORT_ADDRESS,
    footer: `This message is automated. For help, write to ${SUPPORT_ADDRESS}`,
  },
};

export function isMailIdentityKey(value: unknown): value is MailIdentityKey {
  return value === "support" || value === "noreply";
}

export function identityFor(key: unknown): MailIdentity {
  return isMailIdentityKey(key) ? MAIL_IDENTITIES[key] : MAIL_IDENTITIES.noreply;
}

/** RFC 5322 `Name <local@domain>`, which is what nodemailer's `from` wants. */
export function formatFrom(identity: MailIdentity): string {
  return `${identity.name} <${identity.email}>`;
}

/**
 * Which identity a notification kind goes out as.
 *
 * The rule, stated once so it is not re-litigated per template: if a human
 * being composed it or a human being should read the reply, it is `support`.
 * Everything a machine emits on its own is `noreply`.
 *
 * Anything absent falls through to `noreply` — the safe default, because a
 * new automated mail wrongly promising a reply is worse than one that does not
 * offer it.
 */
const IDENTITY_BY_KIND: Partial<Record<string, MailIdentityKey>> = {
  // Composed by a person, or genuinely worth answering.
  [KIND.announcement]: "support",
  [KIND.lecturerMessage]: "support",
  [KIND.tuitionReminder]: "support",
  [KIND.paymentFailed]: "support",
  [KIND.gatewayError]: "support",
  [KIND.leadCaptured]: "support",
  [KIND.levelAdvance]: "support",

  // Emitted by the system. Receipts and confirmations.
  [KIND.paymentReceived]: "noreply",
  [KIND.paymentPending]: "noreply",
  [KIND.studentRegistered]: "noreply",
  [KIND.studentImported]: "noreply",
  [KIND.examRegistered]: "noreply",
  [KIND.materialPublished]: "noreply",
  [KIND.assignmentDue]: "noreply",
  [KIND.resultPublished]: "noreply",
  [KIND.classStarting]: "noreply",
  [KIND.general]: "noreply",
};

export function identityForKind(kind: string): MailIdentity {
  return MAIL_IDENTITIES[IDENTITY_BY_KIND[kind] ?? "noreply"];
}

/**
 * Whether a kind emails by default.
 *
 * Deliberately NOT "everything". A notification that emails every time is how
 * a school teaches its students to filter its own domain into the bin, and the
 * ones below are the ones that are either time-critical or money. The rest
 * stay in-app until an admin turns them on, which they can do per kind.
 *
 * `class.starting` is the notable omission: it fires minutes before a class,
 * when email is the slowest channel available and push is the right one.
 */
const EMAILS_BY_DEFAULT = new Set<string>([
  KIND.paymentReceived,
  KIND.paymentFailed,
  KIND.paymentPending,
  KIND.tuitionReminder,
  KIND.studentRegistered,
  KIND.examRegistered,
  KIND.resultPublished,
  KIND.levelAdvance,
  KIND.announcement,
  KIND.assignmentDue,
]);

export function emailsByDefault(kind: string): boolean {
  return EMAILS_BY_DEFAULT.has(kind);
}

/** Human labels for the admin settings page. */
export const KIND_LABELS: Record<string, string> = {
  [KIND.studentRegistered]: "A student registers",
  [KIND.studentImported]: "Students imported in bulk",
  [KIND.paymentReceived]: "Payment received",
  [KIND.paymentFailed]: "Payment failed",
  [KIND.paymentPending]: "Payment pending",
  [KIND.gatewayError]: "Payment gateway error",
  [KIND.tuitionReminder]: "Tuition reminder",
  [KIND.examRegistered]: "Exam registration confirmed",
  [KIND.levelAdvance]: "Level finished — next level offer",
  [KIND.materialPublished]: "New material published",
  [KIND.assignmentDue]: "Assignment due",
  [KIND.resultPublished]: "A result is released",
  [KIND.classStarting]: "Class starting soon",
  [KIND.lecturerMessage]: "Message from a tutor",
  [KIND.leadCaptured]: "New enquiry",
  [KIND.announcement]: "Announcement from the office",
  [KIND.general]: "General",
};

/** Which of these a student can receive, for grouping the settings page. */
export const KIND_GROUPS: Array<{ group: string; kinds: string[] }> = [
  {
    group: "Money",
    kinds: [KIND.paymentReceived, KIND.paymentFailed, KIND.paymentPending, KIND.tuitionReminder, KIND.gatewayError],
  },
  {
    group: "Classes and calendar",
    kinds: [KIND.classStarting, KIND.assignmentDue, KIND.materialPublished, KIND.lecturerMessage],
  },
  {
    group: "Progress",
    kinds: [KIND.resultPublished, KIND.examRegistered, KIND.levelAdvance],
  },
  {
    group: "Office",
    kinds: [KIND.announcement, KIND.studentRegistered, KIND.studentImported, KIND.leadCaptured, KIND.general],
  },
];
