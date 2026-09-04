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
  /** A mock / pretest sitting is coming up — sent to the class and the tutor. */
  examPretest: "exam.pretest",
  /**
   * Internal, to the tutor (and the office if it drags): a sitting has marks
   * in the gradebook but the results have not been released to students. The
   * nudge the auto-release flow falls back to. See src/lib/result-release.ts.
   */
  resultReleaseNudge: "result.release_nudge",
  levelAdvance: "level.advance",
  materialPublished: "material.published",
  /**
   * To the tutor: the AI has finished reading an uploaded material and its
   * quests / study notes are waiting for a sign-off before students see them.
   * See src/lib/material-ai.ts.
   */
  questsToReview: "quests.to_review",
  /**
   * To the student: their tutor signed off the quests + written-up notes for a
   * material, so both are now live. See the quests review PATCH.
   */
  studyNotesReady: "study_notes.ready",
  assignmentDue: "assignment.due",
  /** A student handed in work. The tutor who set it is waiting to mark it. */
  assignmentSubmitted: "assignment.submitted",
  resultPublished: "result.published",
  certificateIssued: "certificate.issued",
  classStarting: "class.starting",
  privateClassUpdated: "private_class.updated",
  attendanceMarked: "attendance.marked",
  lecturerMessage: "lecturer.message",
  leadCaptured: "lead.captured",
  /** A student asked the office for help, or wrote back on a thread. */
  supportTicket: "support.ticket",
  /** The office answered. This is the one the student is waiting on. */
  supportReply: "support.reply",
  /** A student submitted a refund request, acknowledging the policy first. */
  refundRequested: "refund.requested",
  /** The office approved, rejected, or paid out a refund request. */
  refundDecided: "refund.decided",
  announcement: "announcement",
  /** Somebody started a game in the room's chat — see /api/community/messages. */
  gameInvite: "game.invite",
  /** A class recording uploaded but the bucket won't serve it back — admins need to know before a student does. */
  recordingFailed: "recording.failed",
  /** One or more of a tutor's students look like they're drifting away — see src/lib/student-risk.ts. */
  studentAtRisk: "student.at_risk",
  /** A student's day-streak lapses at midnight if they do nothing today — see src/lib/streak-reminders.ts. */
  streakAtRisk: "streak.at_risk",
  /** The transcript + AI notes for a class recording finished generating — see src/lib/class-transcription.ts. */
  classNotesReady: "class.notes_ready",
  /** A class recording is within ~2 days of leaving the student's shelf — download it in the app first. See src/lib/recording-expiry-nudge.ts. */
  recordingExpiring: "recording.expiring",
  /** Becca couldn't write up notes for a tutor's uploaded material — the tutor can retry. See src/lib/material-ai.ts. */
  studyNotesFailed: "study_notes.failed",
  general: "general",
} as const;

export type NotificationKind = (typeof KIND)[keyof typeof KIND];
