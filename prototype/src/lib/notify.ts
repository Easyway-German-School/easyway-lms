import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { sendPushToUsers } from "@/lib/push";
import { queueEmail } from "@/lib/email-queue";
import { queueSms } from "@/lib/sms-queue";
import { normalizeNigerianPhone } from "@/lib/sms";
import { renderNotificationEmail } from "@/lib/notification-email";
import { planFor } from "@/lib/notification-routing";
import { mutedChannelsFor, type MutedChannels } from "@/lib/notification-prefs";
import { KIND as KINDS, type Severity } from "@/lib/notification-kinds";
import { readAssignment } from "@/lib/lecturer-assignment";

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

/**
 * The kind vocabulary now lives in its own leaf module and is re-exported
 * here, so `import { KIND } from "@/lib/notify"` keeps working everywhere it
 * is already written. See notification-kinds.ts for why it had to move: the
 * routing layer names kinds, and notify.ts depends on the routing layer.
 */
export { KIND } from "@/lib/notification-kinds";
export type { Severity, NotificationKind } from "@/lib/notification-kinds";

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
  | { audience: "admin" | "lecturer" | "student" | "all"; capability?: string }
  /**
   * Tutors, narrowed. `{ audience: "lecturer" }` reaches every one of them;
   * this reaches the ones at a branch, teaching a level, or a named few. Level
   * is matched against the tutor's ASSIGNMENT (the `levels` list an admin set),
   * not a level they are at — a tutor has none. `lecturerIds`, when given,
   * wins outright: the office picked those people by name.
   */
  | { lecturers: { branchId?: string | null; level?: string | null; lecturerIds?: string[] } }
  /**
   * Every parent/guardian linked to any of these students, via ParentStudent.
   * A student with two linked guardians reaches both; a student nobody has
   * linked yet reaches no one, silently — that's correct, not an error.
   */
  | { parentsOfStudentIds: string[] };

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
  /**
   * Also text it, as an SMS, to whichever recipients are students with a
   * phone number on file. Left undefined the admin settings decide (see
   * notification-routing.ts); pass a boolean to force the issue for one send.
   * Every SMS costs money, so unlike push this defaults OFF for most kinds.
   */
  sms?: boolean;
  /**
   * Also send it as an email.
   *
   * Left undefined the admin settings decide, falling back to the per-kind
   * default in mail-identity.ts. Pass a boolean only to force the issue for
   * one specific send — a password reset that must go out whatever the
   * settings say, for instance.
   */
  email?: boolean;
  /**
   * Longer body for the emailed copy. The in-app bell wants one line; an email
   * with one line in it looks broken. Falls back to `message`.
   */
  emailBody?: string;
  /**
   * A ready-made email body, replacing the standard notification template.
   *
   * For the admin composer, whose whole point is a designed message: running
   * its blocks back through `renderNotificationEmail` would throw the design
   * away and re-render it as a title and a paragraph. Everything else about
   * the send is unchanged — the same recipients, the same bell row, the same
   * push, the same routing and per-person preferences.
   *
   * Given the recipient, so the caller can resolve merge fields per person.
   * Returning null falls back to the standard template for that recipient.
   */
  emailHtmlFor?: (recipient: { id: string; email: string; name: string | null }) => string | null;
};

export type NotifyResult = {
  batchId: string;
  /** Rows written. Zero is normal — everyone may already have this one. */
  created: number;
  /** Recipients skipped because `dedupeKey` said they already had it. */
  skipped: number;
  /** Devices reached. Zero when VAPID keys are not configured. */
  pushed: number;
  /** Emails put on the queue. Zero when this kind does not email. */
  queuedEmails: number;
  /** SMS put on the queue. Zero when this kind does not text, or nobody reached has a usable phone number. */
  queuedSms: number;
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

  if ("parentsOfStudentIds" in to) {
    const links = await prisma.parentStudent.findMany({
      where: { studentId: { in: to.parentsOfStudentIds } },
      select: { parent: { select: { userId: true } } },
    });
    return [...new Set(links.map((l) => l.parent.userId))];
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

  if ("lecturers" in to) {
    const picked = (to.lecturers.lecturerIds ?? []).filter(Boolean);
    const lecturers = await prisma.lecturer.findMany({
      where: {
        status: { not: "inactive" },
        ...(picked.length ? { id: { in: picked } } : {}),
      },
      select: {
        userId: true,
        branchId: true,
        level: true,
        branchIds: true,
        levels: true,
        assignmentGroups: true,
      },
    });

    // A named list is a named list — the filters do not get to trim it. When no
    // names were given, branch and level are matched against the tutor's
    // ASSIGNMENT (the lists an admin set), not just the primary column, so a
    // tutor whose Lagos posting is their second campus is still reached. A
    // tutor is not "at" a level, so level only ever means an assigned level.
    const level = !picked.length && to.lecturers.level ? to.lecturers.level.toUpperCase() : null;
    const branchId = !picked.length ? to.lecturers.branchId ?? null : null;

    const matched = lecturers.filter((lecturer) => {
      if (picked.length) return true;
      const assignment = readAssignment(lecturer);
      const branches = assignment.branchIds.length
        ? assignment.branchIds
        : lecturer.branchId
          ? [lecturer.branchId]
          : [];
      if (branchId && !branches.includes(branchId)) return false;
      if (level && !assignment.levels.includes(level)) return false;
      return true;
    });

    return [...new Set(matched.map((lecturer) => lecturer.userId))];
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

/** Every notification is pushed unless its caller explicitly opts out. */
function shouldPush(input: NotifyInput): boolean {
  if (typeof input.push === "boolean") return input.push;
  return true;
}

export async function notify(input: NotifyInput): Promise<NotifyResult> {
  const batchId = randomUUID();
  const severity = input.severity ?? "info";
  const kind = input.kind ?? KINDS.general;

  const recipients = await resolveRecipients(input.to);
  if (recipients.length === 0) {
    return { batchId, created: 0, skipped: 0, pushed: 0, queuedEmails: 0, queuedSms: 0 };
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
    return { batchId, created: 0, skipped, pushed: 0, queuedEmails: 0, queuedSms: 0 };
  }

  // The student id is denormalised onto the row so the existing student-scoped
  // queries and the admin reports keep resolving without a join through User.
  const students = await prisma.student.findMany({
    where: { userId: { in: targets } },
    select: { id: true, userId: true, branchId: true, level: true },
  });
  const studentByUser = new Map(students.map((s) => [s.userId, s]));

  // What this kind is allowed to use. Resolved once for the whole batch: it is
  // a property of the kind, not of the recipient.
  const plan = await planFor(kind, shouldPush(input));

  /**
   * And what each RECIPIENT still accepts, which is the per-person half.
   *
   * Applied strictly after the plan and only ever to subtract: `plan` is the
   * school's policy and this can narrow it, never widen it. Loaded in one
   * query for the whole batch — see notification-prefs.ts.
   */
  const prefs = await mutedChannelsFor(targets, kind, severity);
  const accepts = (userId: string, channel: keyof MutedChannels) =>
    prefs.get(userId)?.[channel] ?? true;

  const now = new Date();
  const inAppTargets = plan.inApp ? targets.filter((id) => accepts(id, "inApp")) : [];
  if (inAppTargets.length > 0) await prisma.notification.createMany({
    data: inAppTargets.map((userId) => {
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
  const pushTargets = plan.push ? targets.filter((id) => accepts(id, "push")) : [];
  if (pushTargets.length > 0) {
    // Best effort throughout: a push that fails must never lose the row that
    // is already saved, nor fail the request that triggered it.
    try {
      const result = await sendPushToUsers(pushTargets, {
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

  /**
   * The same message, by email.
   *
   * QUEUED, NEVER SENT INLINE. An announcement to two hundred students would
   * otherwise hold the admin's request open for minutes and lose the lot on a
   * provider hiccup. The queue already owns suppression, retry with widening
   * backoff, and the EmailLog record — this only decides who and as whom.
   *
   * Explicit `email: false` wins over any setting; explicit `true` overrides a
   * kind that is off, for the handful of sends that must go out regardless.
   * Everything else follows the admin's routing.
   */
  let queuedEmails = 0;
  const wantsEmail = typeof input.email === "boolean" ? input.email : plan.email;
  if (wantsEmail) {
    try {
      const people = await prisma.user.findMany({
        where: { id: { in: targets } },
        select: { id: true, email: true, name: true },
      });
      const studentIdByUser = new Map(students.map((s) => [s.userId, s.id]));

      for (const person of people) {
        if (!person.email) continue;
        // Somebody who has turned this kind's email off still gets the bell
        // and the push — only the mailbox is spared.
        if (!accepts(person.id, "email")) continue;

        // A designed campaign supplies its own body; everything else gets the
        // standard notification letterhead. Both now render through the same
        // shell in email-brand.ts, so the two do not look like two schools.
        const custom = input.emailHtmlFor?.({
          id: person.id,
          email: person.email,
          name: person.name,
        });

        await queueEmail({
          to: person.email,
          subject: input.title,
          html:
            custom ??
            renderNotificationEmail({
              name: person.name,
              title: input.title,
              body: input.emailBody ?? input.message,
              link: input.link,
              identity: plan.identity,
            }),
          type: kind,
          studentId: studentIdByUser.get(person.id) ?? null,
          identity: plan.identity,
        });
        queuedEmails += 1;
      }
    } catch (error) {
      // Same rule as push: the bell already rang, and a mail queue problem
      // must not undo it or fail the request that triggered it.
      console.warn("notify: email queueing failed", error);
    }
  }

  /**
   * The same message, by SMS.
   *
   * Students only, for now: the phone number lives on StudentProfile, and
   * every kind that texts by default (payments, exam reminders) is
   * student-facing anyway. `wantsSms` follows the same explicit-override
   * rule as email above.
   */
  let queuedSms = 0;
  const wantsSms = typeof input.sms === "boolean" ? input.sms : plan.sms;
  if (wantsSms) {
    try {
      const smsTargets = targets.filter((id) => accepts(id, "sms"));
      const studentIds = smsTargets
        .map((userId) => studentByUser.get(userId)?.id)
        .filter((id): id is string => Boolean(id));

      if (studentIds.length > 0) {
        const profiles = await prisma.studentProfile.findMany({
          where: { studentId: { in: studentIds } },
          select: { studentId: true, phone: true, whatsapp: true },
        });
        const phoneByStudent = new Map(
          profiles.map((p) => [p.studentId, normalizeNigerianPhone(p.phone ?? p.whatsapp)]),
        );

        for (const userId of smsTargets) {
          const student = studentByUser.get(userId);
          const phone = student ? phoneByStudent.get(student.id) : null;
          if (!phone) continue; // No usable number on file — nothing to text.

          await queueSms({
            to: phone,
            message: `${input.title}: ${input.message}`,
            type: kind,
            studentId: student?.id ?? null,
          });
          queuedSms += 1;
        }
      }
    } catch (error) {
      // Same rule as push and email: the bell already rang, and an SMS queue
      // problem must not undo it or fail the request that triggered it.
      console.warn("notify: sms queueing failed", error);
    }
  }

  // Rows actually written, not recipients considered. A tutor's announcements
  // page reports `sentTo` from this, and counting people who had muted the
  // kind would tell them thirty students were reached when twenty-eight were.
  return { batchId, created: inAppTargets.length, skipped, pushed, queuedEmails, queuedSms };
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
