/**
 * The vocabulary of notification kinds, on its own with no imports.
 *
 * WHY THIS IS A SEPARATE FILE. `KIND` used to live in notify.ts, which is fine
 * until something notify.ts depends on also needs to name a kind. The routing
 * layer does exactly that — it maps kind → channels → sender — so the import
 * graph became notify → notification-routing → mail-identity → notify, and a
 * cycle through a `const` object is not a warning, it is a crash: whichever
 * module evaluates second sees `KIND` as uninitialised and throws
 * "Cannot access 'KIND' before initialization" at import time.
 *
 * A leaf module with no imports of its own cannot participate in a cycle. Both
 * notify.ts and mail-identity.ts read the vocabulary from here instead of from
 * each other, and notify.ts re-exports it so every existing
 * `import { KIND } from "@/lib/notify"` keeps working untouched.
 */

export type Severity = "info" | "success" | "warning" | "critical";

/**
 * Well-known kinds. A kind is just a string — anything unrecognised still
 * delivers and renders, it simply falls back to the default icon — but the
 * ones the UI styles specially live here so a typo is a compile error.
 */
export const KIND = {
  studentRegistered: "student.registered",
  studentImported: "student.imported",
  paymentReceived: "payment.received",
  paymentFailed: "payment.failed",
  paymentPending: "payment.pending",
  gatewayError: "gateway.error",
  tuitionReminder: "tuition.reminder",
  examRegistered: "exam.registered",
  levelAdvance: "level.advance",
  materialPublished: "material.published",
  assignmentDue: "assignment.due",
  resultPublished: "result.published",
  certificateIssued: "certificate.issued",
  classStarting: "class.starting",
  lecturerMessage: "lecturer.message",
  leadCaptured: "lead.captured",
  /** A student asked the office for help, or wrote back on a thread. */
  supportTicket: "support.ticket",
  /** The office answered. This is the one the student is waiting on. */
  supportReply: "support.reply",
  announcement: "announcement",
  general: "general",
} as const;

export type NotificationKind = (typeof KIND)[keyof typeof KIND];
