import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/admin-roles";
import { prisma, unguardedPrisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/prisma-guard";
import {
  LIVE_ONLY_ROUTES,
  TUITION_FREE_ROUTES,
  canAttendLive,
  deriveStudentAccess,
} from "@/lib/access";
import { requiredDepositFor, tuitionFeeFor } from "@/lib/payment";
import { profileFor } from "@/lib/learner-intelligence";
import { hourLabel } from "@/lib/learner-signals";

/**
 * REMOTE VIEW — looking over one student's shoulder, without becoming them.
 *
 * WHAT THIS IS NOT. It is not impersonation. No session is issued, no cookie
 * is swapped, nothing is signed as the student, and nothing this route touches
 * can write to their account. That distinction is the whole design: the
 * moment an admin can *act* as a student, every audit line in the system
 * becomes ambiguous — "the student accepted the terms" stops being a fact
 * about the student. The office's actual need is to SEE what the student sees
 * so they can answer a phone call, and that need is fully met by reading.
 *
 * The alternative the school had been reaching for was resetting the
 * student's password and logging in as them. That locks the student out of
 * their own account mid-conversation, leaves a login the audit trail
 * attributes to the student, and hands a member of staff a working credential.
 * This route exists so nobody ever has a reason to do that again.
 *
 * IT IS LOGGED, EVERY TIME. Reading a named person's file, their movements and
 * their balance is a privileged act. `remoteView` goes into the audit trail
 * with the admin's name on it, at `notice` severity, exactly like any other
 * access to confidential data.
 */

export const dynamic = "force-dynamic";

/** How much of the movement trail to return. Enough to see a session's shape. */
const TRAIL_LIMIT = 80;

/** Minutes of silence after which we stop calling somebody "here now". */
const ONLINE_WINDOW_MINUTES = 10;

/** One audit entry per admin per student per this many minutes. See below. */
const AUDIT_DEDUPE_MINUTES = 10;

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const admin = auth.admin;
  if (!admin.can("students")) return NextResponse.json({ error: "Not permitted" }, { status: 403 });

  const { id } = await params;
  const canSeeMoney = admin.can("payments");

  const student = await prisma.student.findUnique({
    where: { id },
    select: {
      id: true,
      studentCode: true,
      level: true,
      status: true,
      sessionSlot: true,
      classType: true,
      pathway: true,
      deliveryMode: true,
      nextLive: true,
      // The passport photo lives on the admission blob, not on User — see the
      // dossier route, which reads it from the same place.
      admission: true,
      examReadiness: true,
      branch: { select: { name: true } },
      tutor: { select: { user: { select: { name: true } } } },
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          analyticsOptOutAt: true,
          createdAt: true,
        },
      },
      payments: { select: { amount: true, status: true } },
    },
  });
  if (!student) return NextResponse.json({ error: "No such student" }, { status: 404 });

  const name = student.user.name ?? student.user.email ?? "This student";
  const admission = student.admission && typeof student.admission === "object" && !Array.isArray(student.admission)
    ? (student.admission as Record<string, unknown>)
    : null;
  const admissionPhoto = typeof admission?.photoUrl === "string" ? admission.photoUrl : null;

  /* ---- What the portal is currently doing to them --------------------- */
  const totalPaid = student.payments
    .filter((payment) => payment.status === "success")
    .reduce((sum, payment) => sum + payment.amount, 0);
  const fees = { level: student.level, branch: student.branch?.name ?? null, classType: student.classType, pathway: student.pathway };
  const tuitionFee = tuitionFeeFor(fees);
  const access = deriveStudentAccess({
    totalPaid,
    tuitionFee,
    requiredDeposit: requiredDepositFor(fees),
    deliveryMode: student.deliveryMode,
    classType: student.classType,
  });

  /**
   * The tabs, resolved the same way the student's own shell resolves them, so
   * the mirror cannot disagree with the real portal about what is padlocked.
   * Reimplementing the rule here is how the two drift apart and an admin ends
   * up reassuring somebody that a page is open when it is not.
   */
  const live = canAttendLive(student.deliveryMode, student.classType);
  const tabs = [
    { path: "/dashboard", label: "Dashboard" },
    { path: "/classes", label: "Classes" },
    { path: "/materials", label: "Materials" },
    { path: "/community", label: "Community" },
    { path: "/exams", label: "Exams" },
    { path: "/watch", label: "Watch" },
    ...LIVE_ONLY_ROUTES.map((path) => ({ path, label: "Live class" })),
    ...TUITION_FREE_ROUTES.map((path) => ({ path, label: path.replace("/", "") })),
  ].map((tab) => {
    const liveOnly = (LIVE_ONLY_ROUTES as readonly string[]).includes(tab.path);
    const free = (TUITION_FREE_ROUTES as readonly string[]).includes(tab.path);
    const hidden = liveOnly && !live;
    return {
      ...tab,
      label: tab.label.charAt(0).toUpperCase() + tab.label.slice(1),
      hidden,
      locked: !hidden && !free && !access.hasAccess,
    };
  });

  /* ---- What is on their screen right now ------------------------------ */
  const now = new Date();
  /**
   * The same audience rule the student's own bell uses: a notification reaches
   * them either by account or by student record. Counting only one of the two
   * would show the admin a different unread badge than the student is looking
   * at, which defeats the point of a mirror.
   */
  const addressedToThem = { OR: [{ userId: student.user.id }, { studentId: student.id }] };
  const [unreadNotifications, latestNotifications, nextPrivate, openAssignments] = await Promise.all([
    prisma.notification.count({ where: { AND: [addressedToThem, { readAt: null }] } }),
    prisma.notification.findMany({
      where: addressedToThem,
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { id: true, title: true, message: true, createdAt: true, readAt: true },
    }),
    student.classType === "private"
      ? prisma.privateClass.findFirst({
          where: { studentId: student.id, status: { in: ["scheduled", "postponed"] }, scheduledAt: { gte: now } },
          orderBy: { scheduledAt: "asc" },
          select: { scheduledAt: true, topic: true, status: true },
        })
      : Promise.resolve(null),
    prisma.assignmentSubmission.count({
      where: { studentId: student.id, submittedAt: null },
    }),
  ]);

  /* ---- What they have been doing -------------------------------------- */
  const trail = await prisma.learnerUsageEvent.findMany({
    where: { userId: student.user.id },
    orderBy: { occurredAt: "desc" },
    take: TRAIL_LIMIT,
    select: {
      id: true,
      area: true,
      action: true,
      path: true,
      detail: true,
      deviceKind: true,
      hourLocal: true,
      sessionKey: true,
      durationSeconds: true,
      occurredAt: true,
    },
  });

  const behaviour = student.user.analyticsOptOutAt ? null : await profileFor(student.user.id, name);
  const lastSeenAt = trail[0]?.occurredAt ?? null;
  const onlineNow = lastSeenAt ? now.getTime() - lastSeenAt.getTime() < ONLINE_WINDOW_MINUTES * 60000 : false;

  /**
   * Recorded whether or not anything sensitive was ultimately returned. An
   * audit trail that only fires on the interesting cases teaches you nothing
   * about the boring ones, and "who looked at this student's file" is a
   * question the school may one day have to answer precisely.
   *
   * ONE ENTRY PER SITTING, NOT ONE PER POLL. This screen re-reads itself every
   * thirty seconds so it moves as the student moves, which without this check
   * writes a hundred and twenty identical audit lines an hour. That does not
   * make the trail more complete, it makes it unreadable — the deliberate act
   * of opening a student's file disappears into a wall of automatic refreshes,
   * and the one question this record exists to answer becomes hard to answer.
   * A fresh entry after ten quiet minutes is a genuine second visit.
   */
  const recentlyLogged = await unguardedPrisma.auditLog.findFirst({
    where: {
      action: "remoteView",
      model: "Student",
      recordId: student.id,
      actorId: admin.userId,
      at: { gte: new Date(now.getTime() - AUDIT_DEDUPE_MINUTES * 60000) },
    },
    select: { id: true },
  });
  if (!recentlyLogged) {
    await writeAudit(unguardedPrisma, {
      action: "remoteView",
      model: "Student",
      recordId: student.id,
      severity: "notice",
      summary: `Remote view of ${name}'s portal${canSeeMoney ? " (including balance)" : ""}`,
    });
  }

  return NextResponse.json({
    generatedAt: now.toISOString(),
    identity: {
      id: student.id,
      userId: student.user.id,
      studentCode: student.studentCode,
      name,
      email: student.user.email,
      photoUrl: admissionPhoto,
      level: student.level,
      status: student.status,
      pathway: student.pathway,
      sessionSlot: student.sessionSlot,
      classType: student.classType,
      deliveryMode: student.deliveryMode,
      branch: student.branch?.name ?? null,
      tutor: student.tutor?.user.name ?? null,
    },
    portal: {
      locked: !access.hasAccess,
      registrationPaid: access.registrationPaid,
      progressPercent: access.progressPercent,
      // Amounts follow the same rule as the rest of the admin area: an admin
      // without `payments` gets the padlock STATE without the ledger. Dropped,
      // not zeroed, so there is nothing for the page to render by mistake.
      ...(canSeeMoney
        ? { outstanding: access.outstanding, totalPaid: access.totalPaid, tuitionFee: access.tuitionFee }
        : {}),
      tabs,
    },
    screen: {
      nextClass: nextPrivate
        ? { at: nextPrivate.scheduledAt.toISOString(), topic: nextPrivate.topic, status: nextPrivate.status }
        : student.nextLive
          ? { at: null, topic: student.nextLive, status: "scheduled" }
          : null,
      unreadNotifications,
      latestNotifications: latestNotifications.map((row) => ({
        id: row.id,
        title: row.title,
        body: row.message,
        at: row.createdAt.toISOString(),
        read: Boolean(row.readAt),
      })),
      openAssignments,
      examReadiness: student.examReadiness,
    },
    presence: {
      onlineNow,
      lastSeenAt: lastSeenAt ? lastSeenAt.toISOString() : null,
      currentArea: onlineNow ? (trail[0]?.path ?? trail[0]?.area ?? null) : null,
    },
    behaviour: behaviour
      ? {
          archetype: behaviour.archetype,
          summary: behaviour.summary,
          engagementScore: behaviour.engagementScore,
          riskScore: behaviour.riskScore,
          predictability: behaviour.predictability,
          sessionsPerWeek: behaviour.sessionsPerWeek,
          avgSessionMinutes: behaviour.avgSessionMinutes,
          daysSinceSeen: behaviour.daysSinceSeen,
          peakHourLabel: behaviour.peakHour === null ? null : hourLabel(behaviour.peakHour),
          signals: behaviour.signals,
        }
      : null,
    optedOut: Boolean(student.user.analyticsOptOutAt),
    trail: trail.map((row) => ({
      id: row.id,
      area: row.area,
      action: row.action,
      path: row.path,
      detail: row.detail,
      deviceKind: row.deviceKind,
      sessionKey: row.sessionKey,
      seconds: row.durationSeconds,
      at: row.occurredAt.toISOString(),
    })),
  });
}
