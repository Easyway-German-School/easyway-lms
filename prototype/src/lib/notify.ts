import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { sendPushToUsers } from "@/lib/push";

/**
 * Everything that reaches somebody's bell goes through here.
 *
 * Before this, three different places wrote Notification rows their own way and
 * a fourth read them back with a `where` that matched almost none of them —
 * payment warnings were being written with the tier stashed in `channel`, so
 * they never appeared in the portal at all. One function now owns the shape of
 * a notification, who it reaches, and whether their phone buzzes.
 *
 * Sends are FANNED OUT: a broadcast to two hundred students writes two hundred
 * rows sharing a `batchId`. It costs rows, but one row shared between readers
 * cannot record which of them has read it, and "mark as read" quietly marking
 * it read for the whole school is worse than the storage. The admin list folds
 * a batch back into one line.
 *
 * Rows written before this file existed have no `userId`; the read side still
 * matches them on `studentId` / `branchId` / `level`, so nobody's history
 * disappears.
 *
 *   await notify({
 *     to: { audience: "admin", capability: "payments" },
 *     kind: KIND.paymentReceived,
 *     severity: "success",
 *     title: "Payment received",
 *     message: `${name} paid ₦${amount.toLocaleString()}.`,
 *     link: "/admin/payments",
 *   });
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
  classStarting: "class.starting",
  lecturerMessage: "lecturer.message",
  leadCaptured: "lead.captured",
  announcement: "announcement",
  general: "general",
} as const;

/** Who a notification is for. Exactly one shape per send. */
export type NotifyTarget =
  /** Specific accounts, whatever role they hold. */
  | { userIds: string[] }
  /** Specific students, by Student id. */
  | { studentIds: string[] }
  /**
   * Every student matching. Both fields optional — omitting them both reaches
   * every active student, which is what a school-wide announcement wants.
   */
  | {
      students: {
        branchId?: string | null;
        level?: string | null;
        tutorId?: string | null;
        /**
         * Which sitting. A branch runs the same level morning, afternoon and
         * evening as three separate classes, so a message about one of them
         * must not reach the other two — postponing the morning class and
         * buzzing the evening students trains everybody to ignore the bell.
         */
        sessionSlot?: string | null;
      };
    }
  /**
   * Everyone holding a role. For admins, `capability` narrows it to the ones
   * cleared for that area, so the bursar is not woken for a community report.
   */
  | { audience: "admin" | "lecturer" | "student" | "all"; capability?: string };

export type NotifyInput = {
  to: NotifyTarget;
  title: string;
  message: string;
  kind?: string;
  severity?: Severity;
  /** Where clicking it takes the reader. */
  link?: string;
  /** The account that sent it, when a person did. */
  senderId?: string;
  /**
   * Idempotency token. A second send with the same key to the same person is
   * dropped, so a cron that re-runs does not spam anybody.
   */
  dedupeKey?: string;
  /** Also buzz their phone. Defaults on for warning and critical. */
  push?: boolean;
};

export type NotifyResult = {
  batchId: string;
  /** Rows written. Zero is normal — everyone may already have this one. */
  created: number;
  /** Recipients skipped because `dedupeKey` said they already had it. */
  skipped: number;
  /** Devices reached. Zero when VAPID keys are not configured. */
  pushed: number;
};

/** Resolve a target down to the user ids it actually reaches. */
async function resolveRecipients(to: NotifyTarget): Promise<string[]> {
  if ("userIds" in to) {
    return [...new Set(to.userIds.filter(Boolean))];
  }

  if ("studentIds" in to) {
    const students = await prisma.student.findMany({
      where: { id: { in: to.studentIds } },
      select: { userId: true },
    });
    return [...new Set(students.map((s) => s.userId))];
  }

  if ("students" in to) {
    const students = await prisma.student.findMany({
      where: {
        status: "active",
        ...(to.students.branchId ? { branchId: to.students.branchId } : {}),
        ...(to.students.level ? { level: to.students.level } : {}),
        ...(to.students.tutorId ? { tutorId: to.students.tutorId } : {}),
        ...(to.students.sessionSlot ? { sessionSlot: to.students.sessionSlot } : {}),
      },
      select: { userId: true },
    });
    return [...new Set(students.map((s) => s.userId))];
  }

  const roles =
    to.audience === "all"
      ? ["ADMIN", "LECTURER", "STUDENT"]
      : to.audience === "admin"
        ? ["ADMIN"]
        : to.audience === "lecturer"
          ? ["LECTURER"]
          : ["STUDENT"];

  const users = await prisma.user.findMany({
    where: { role: { in: roles as never } },
    select: { id: true, role: true, adminRole: true, adminCapabilities: true },
  });

  if (to.audience === "admin" && to.capability) {
    // Imported lazily: admin-roles imports prisma, and a top-level cycle
    // between the two would leave one of them half-initialised.
    const { capabilitiesForUser } = await import("@/lib/admin-roles");
    return users
      .filter((u) =>
        capabilitiesForUser(u.adminRole, u.adminCapabilities).includes(to.capability as never),
      )
      .map((u) => u.id);
  }

  return users.map((u) => u.id);
}

/** Push is on by default for the two severities that mean "look now". */
function shouldPush(input: NotifyInput): boolean {
  if (typeof input.push === "boolean") return input.push;
  const severity = input.severity ?? "info";
  return severity === "warning" || severity === "critical";
}

export async function notify(input: NotifyInput): Promise<NotifyResult> {
  const batchId = randomUUID();
  const severity = input.severity ?? "info";
  const kind = input.kind ?? KIND.general;

  const recipients = await resolveRecipients(input.to);
  if (recipients.length === 0) {
    return { batchId, created: 0, skipped: 0, pushed: 0 };
  }

  // Anyone who already got this exact notification is dropped rather than
  // sent a duplicate.
  let targets = recipients;
  let skipped = 0;
  if (input.dedupeKey) {
    const already = await prisma.notification.findMany({
      where: { dedupeKey: input.dedupeKey, userId: { in: recipients } },
      select: { userId: true },
    });
    const seen = new Set(already.map((n) => n.userId));
    targets = recipients.filter((id) => !seen.has(id));
    skipped = recipients.length - targets.length;
  }

  if (targets.length === 0) {
    return { batchId, created: 0, skipped, pushed: 0 };
  }

  // The student id is denormalised onto the row so the existing student-scoped
  // queries and the admin reports keep resolving without a join through User.
  const students = await prisma.student.findMany({
    where: { userId: { in: targets } },
    select: { id: true, userId: true, branchId: true, level: true },
  });
  const studentByUser = new Map(students.map((s) => [s.userId, s]));

  const now = new Date();
  await prisma.notification.createMany({
    data: targets.map((userId) => {
      const student = studentByUser.get(userId);
      return {
        userId,
        studentId: student?.id ?? null,
        branchId: student?.branchId ?? null,
        level: student?.level ?? null,
        audience: "audience" in input.to ? input.to.audience : null,
        title: input.title,
        message: input.message,
        channel: "in-app",
        kind,
        severity,
        link: input.link ?? null,
        senderId: input.senderId ?? null,
        batchId,
        dedupeKey: input.dedupeKey ?? null,
        status: "sent",
        sentAt: now,
      };
    }),
  });

  let pushed = 0;
  if (shouldPush(input)) {
    // Best effort throughout: a push that fails must never lose the row that
    // is already saved, nor fail the request that triggered it.
    try {
      const result = await sendPushToUsers(targets, {
        title: input.title,
        body: input.message,
        url: input.link,
        tag: kind,
      });
      pushed = result.sent;
    } catch (error) {
      console.warn("notify: push delivery failed", error);
    }
  }

  return { batchId, created: targets.length, skipped, pushed };
}

/**
 * Fire a notification without making the caller wait or handle failure.
 *
 * For the webhooks and sign-up handlers: a student's payment must be recorded
 * even if the office's bell never rings, so the notification is deliberately
 * not allowed to fail the request around it.
 */
export function notifyInBackground(input: NotifyInput): void {
  void notify(input).catch((error) => {
    console.error(`notify(${input.kind ?? "general"}) failed:`, error);
  });
}
