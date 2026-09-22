import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/admin-roles";
import { isReceivedPayment, isRegistrationFeePayment } from "@/lib/payment";
import { BEHIND_TUITION_MIN_DAYS } from "@/lib/finance/receivables";
import { accessFromStudent } from "@/lib/student-access";
import { readIntakeStartDayOverrides } from "@/lib/intake-server";
import { planStatusForStudent, planSuppressesLock } from "@/lib/payment-plans";
import { computeChurnRisk } from "@/lib/student-risk";
import { deriveSegments } from "@/lib/student-segments";
import { featuresForCurrentTenant } from "@/lib/tenant/features-server";
import { isTemporaryLogin } from "@/lib/login-upgrade";

/**
 * Everything the office knows about one student, in one request.
 *
 * WHY IT IS ONE REQUEST AND ONE PAGE. Until now a student existed on the admin
 * side as a row in a table and a modal that printed the raw admission JSON.
 * Answering "who is this person, have they paid, are they turning up, are they
 * passing, and did our email to them actually arrive?" meant five screens and
 * a guess. Every one of those facts already sat in the database; none of them
 * sat together.
 *
 * CAPABILITY GATING IS PER SECTION, NOT PER PAGE. `students` gets you the file.
 * Money is withheld from an admin without `payments` — the same rule the
 * overview already enforces, and for the same reason: a secretary needs to
 * find a student's phone number without also being handed the school's ledger.
 * The fields are DROPPED rather than zeroed, so there is nothing for the page
 * to render by mistake.
 *
 * NOTHING HERE IS DERIVED IN THE BROWSER — and, as of the fix below, nothing
 * here is derived a SECOND TIME either. The paywall state, the attendance
 * rate and the balance are computed here off `accessFromStudent`
 * (lib/student-access.ts), the exact function the student's own portal gate
 * and the admin remote view call, so this file cannot disagree with either
 * about whether somebody has paid. It used to: this route ran its own
 * `paid >= fee` arithmetic against the flat per-pathway price, which ignored
 * the per-level tuition ledger and any active payment plan — a Travel
 * Package student's balance, or a promoted student's already-settled level,
 * came out wrong here specifically. See project-dossier-paywall-drift-fix.
 */

const DAY = 24 * 60 * 60 * 1000;

/** Values we will not print, whatever the admission form collected. */
const ADMISSION_FILE_KEYS = new Set(["photoUrl", "idProofUrl", "parentIdProofUrl"]);

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const admin = auth.admin;

  if (!admin.can("students")) {
    return NextResponse.json({ error: "Not permitted" }, { status: 403 });
  }

  const { id } = await params;
  const canSeeMoney = admin.can("payments");
  // Can this viewer record a payment for this student and unlock their classes?
  // `payments` (the fee book) or `enrolment` (Customer Care, no fee book). The
  // page uses this to show a "record an offline payment" action even to a
  // viewer who cannot see any amounts.
  const canRecordPayment = admin.can("payments") || admin.can("enrolment");
  // Whether this school may put more than one tutor on an online/hybrid
  // student — see lib/tenant/features.ts. Drives the "Additional tutors"
  // picker the same way it does on the roster page's edit form.
  const sharedStudentsEnabled = (await featuresForCurrentTenant()).roster.sharedStudents;

  const student = await prisma.student.findUnique({
    where: { id },
    select: {
      id: true,
      studentCode: true,
      status: true,
      level: true,
      sessionSlot: true,
      classType: true,
      deliveryMode: true,
      hybridOnlineSlot: true,
      pathway: true,
      outcome: true,
      examReadiness: true,
      admission: true,
      createdAt: true,
      updatedAt: true,
      graduationDate: true,
      classesStartedAt: true,
      paymentGraceUntil: true,
      feeRemindersScheduled: true,
      startConfirmedAt: true,
      startConfirmedVia: true,
      notStartedCount: true,
      notStartedReason: true,
      levelCompletedAt: true,
      levelCompletedFor: true,
      heldBackAt: true,
      heldBackReason: true,
      germanyGoal: true,
      germanyGoalNote: true,
      welcomeTourSeenAt: true,
      journeySeenAt: true,
      tags: true,
      profile: true,
      branch: { select: { id: true, name: true, mode: true, location: true } },
      // The per-level tuition ledger — same rows `accessFromStudent` reads, so
      // the padlock here resolves to the exact figure the student's own
      // portal and the admin remote view show. See lib/finance/ledger.ts.
      tuitionCharges: {
        where: { deletedAt: null },
        select: { id: true, level: true, amount: true, waivedAmount: true, legacyArrears: true, createdAt: true, settledAt: true },
      },
      // A Lecturer carries no name of its own — it hangs off the User row.
      tutor: {
        select: {
          id: true,
          status: true,
          user: { select: { name: true, email: true } },
        },
      },
      coTutors: {
        select: {
          role: true,
          lecturer: {
            select: { id: true, user: { select: { name: true, email: true } } },
          },
        },
      },
      user: {
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          createdAt: true,
          totpEnabledAt: true,
          passwordClaimed: true,
        },
      },
      convertedFromLead: {
        select: { source: true, status: true, createdAt: true, notes: true },
      },
    },
  });

  if (!student) {
    return NextResponse.json({ error: "Student not found" }, { status: 404 });
  }

  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * DAY);

  const [
    payments,
    attendance,
    grades,
    submissions,
    examRegistrations,
    certificates,
    journeyEvents,
    videoProgress,
    notifications,
    emailLog,
    queuedEmail,
    enrolments,
    planStatus,
  ] = await Promise.all([
    prisma.payment.findMany({
      where: { studentId: id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        amount: true,
        currency: true,
        status: true,
        method: true,
        description: true,
        createdAt: true,
      },
    }),
    prisma.attendance.findMany({
      where: { studentId: id },
      orderBy: { date: "desc" },
      take: 60,
      select: { id: true, date: true, present: true, status: true, notes: true },
    }),
    prisma.grade.findMany({
      where: { studentId: id },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, type: true, score: true, grade: true, createdAt: true },
    }),
    prisma.assignmentSubmission.findMany({
      where: { studentId: id },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        score: true,
        createdAt: true,
        assignment: { select: { title: true } },
      },
    }),
    prisma.examRegistration.findMany({
      where: { studentId: id },
      orderBy: { createdAt: "desc" },
      select: { id: true, status: true, createdAt: true },
    }),
    prisma.certificate.findMany({
      where: { studentId: id },
      orderBy: { createdAt: "desc" },
      select: { id: true, kind: true, level: true, award: true, serial: true, passed: true, createdAt: true },
    }),
    prisma.journeyEvent.findMany({
      where: { studentId: id },
      // occurredAt, not createdAt: a start date confirmed a fortnight late
      // belongs in the timeline where it happened, not where it was typed.
      orderBy: { occurredAt: "desc" },
      take: 25,
      select: { id: true, type: true, stage: true, label: true, detail: true, source: true, occurredAt: true },
    }),
    prisma.videoProgress.findMany({
      where: { studentId: id },
      orderBy: { updatedAt: "desc" },
      take: 10,
      select: {
        id: true,
        completed: true,
        positionSeconds: true,
        updatedAt: true,
        material: { select: { title: true } },
      },
    }),
    prisma.notification.findMany({
      where: { studentId: id },
      orderBy: { createdAt: "desc" },
      take: 15,
      select: { id: true, title: true, message: true, createdAt: true, dedupeKey: true },
    }),
    /**
     * DID OUR EMAIL ACTUALLY ARRIVE.
     *
     * This is here because the school had no way to answer it. A student says
     * "I never got anything"; the office has a template, a send button and no
     * evidence either way. EmailLog has recorded every attempt and its failure
     * reason all along — it simply had no reader.
     *
     * The `recipientEmail` half of the OR is skipped entirely when the student
     * has no email on file, rather than falling back to a sentinel value —
     * a stray literal NUL character used to sit here as that sentinel, which
     * Postgres rejects outright in a text parameter on some drivers.
     */
    prisma.emailLog.findMany({
      where: student.user?.email
        ? { OR: [{ studentId: id }, { recipientEmail: student.user.email }] }
        : { studentId: id },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, type: true, subject: true, status: true, errorMessage: true, createdAt: true },
    }),
    prisma.emailMessage.count({
      where: { to: (student.user?.email ?? "").toLowerCase(), status: "queued" },
    }),
    /**
     * The per-level history — see lib/student-enrolment.ts. Every level×batch
     * this student has ever been in, newest first, however many years back it
     * goes — the record that used to disappear every time `promoteStudents()`
     * overwrote `Student.level`.
     */
    prisma.studentEnrolment.findMany({
      where: { studentId: id, deletedAt: null },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        level: true,
        sessionSlot: true,
        classType: true,
        deliveryMode: true,
        batchMonth: true,
        batchYear: true,
        startedAt: true,
        endedAt: true,
        outcome: true,
        outcomeNote: true,
        feeSnapshot: true,
        createdAt: true,
        branch: { select: { name: true } },
        tutor: { select: { user: { select: { name: true } } } },
      },
    }),
    // An on-track tuition payment plan holds the balance lock back, exactly
    // like admin grace — see accessFromStudent below.
    planStatusForStudent(id),
  ]);

  // ---- Money --------------------------------------------------------------
  // Same computation the student's own portal gate (`/api/student/access`)
  // and the admin remote view run — see lib/student-access.ts. `payments`
  // here is fetched separately above (this route needs every payment, not
  // just the received/non-registration ones `STUDENT_ACCESS_SELECT` would
  // filter to), so it is re-filtered the same way before being handed in.
  const receivedTuitionPayments = payments.filter(
    (payment) => isReceivedPayment(payment.status) && !isRegistrationFeePayment(payment.description),
  );
  const accessInput = { ...student, payments: receivedTuitionPayments };
  const startDayOverrides = await readIntakeStartDayOverrides(auth.session.user.tenantId ?? null);
  const access = accessFromStudent(
    accessInput,
    planSuppressesLock(planStatus?.adherence ?? null),
    startDayOverrides,
  );

  const fee = access.tuitionFee;
  const deposit = access.requiredDeposit;
  const paid = access.totalPaid;
  const owed = access.outstandingBalance;

  /**
   * Which side of the padlock they are on. Named the same four ways the
   * overview names them so the two screens cannot drift apart, and computed
   * for EVERY admin — a secretary is not shown the amounts but absolutely
   * needs to know that the student in front of them is locked out.
   *
   * Deposit progress and full-payment progress both come straight off the
   * ledger-aware `access` object now (`progressPercent`/`outstandingBalance`)
   * instead of a flat `paid >= fee` comparison against the static sticker
   * price — see the module comment for what that flat comparison got wrong.
   */
  const depositMet = access.progressPercent >= 100;
  const fullyPaid = owed <= 0;
  const paywall = paid <= 0 ? "unpaid" : fullyPaid ? "fullPaid" : depositMet ? "depositPaid" : "registeredOnly";
  const lockedOut = !depositMet;

  // Part-payment balance lock — deposit in, fee not, 30 days after classes
  // started (falling back to enrolment), unless an admin grace date or an
  // on-track payment plan holds it back. `access` already ran this clock.
  const isPartPayer = depositMet && !fullyPaid;
  const graceDate = access.graceUntil ? new Date(access.graceUntil) : null;
  const balanceLockAt = access.lockAt ? new Date(access.lockAt) : null;
  const balanceLockActive = !access.hasAccess && access.lockReason === "unsettled_balance";

  // ---- Attendance -------------------------------------------------------
  const attended = attendance.filter(
    (record) => record.present || record.status === "present" || record.status === "late",
  ).length;
  const recentAttendance = attendance.filter((record) => record.date >= thirtyDaysAgo);
  const recentAttended = recentAttendance.filter(
    (record) => record.present || record.status === "present" || record.status === "late",
  ).length;

  // ---- Admission --------------------------------------------------------
  const admission = (student.admission ?? null) as Record<string, unknown> | null;
  const admissionEntries = admission
    ? Object.entries(admission)
        .filter(([key, value]) => {
          if (ADMISSION_FILE_KEYS.has(key)) return false;
          if (value === null || value === undefined || value === "") return false;
          return true;
        })
        .map(([key, value]) => ({
          key,
          value: Array.isArray(value)
            ? value.join(", ")
            : typeof value === "object"
              ? JSON.stringify(value)
              : String(value),
        }))
    : [];

  // ---- Churn risk --------------------------------------------------------
  // Reuses the same `paid`/`deposit`/`fee`/daysEnrolled figures already
  // computed above for the paywall, rather than a second lookup — see
  // lib/student-risk.ts for why this is a different question from `paywall`.
  const risk = computeChurnRisk(
    {
      id: student.id,
      createdAt: student.createdAt,
      notStartedCount: student.notStartedCount,
      recentAttendance: recentAttendance.map((record) => ({ present: record.present, status: record.status })),
      lastVideoActivityAt: videoProgress[0]?.updatedAt ?? null,
      lastJourneyEventAt: journeyEvents[0]?.occurredAt ?? null,
      behindOnTuition: lockedOut && Math.floor((now.getTime() - student.createdAt.getTime()) / DAY) >= BEHIND_TUITION_MIN_DAYS,
    },
    now,
  );

  const scored = grades.filter((grade) => typeof grade.score === "number");
  const averageScore =
    scored.length > 0
      ? Math.round(scored.reduce((sum, grade) => sum + grade.score, 0) / scored.length)
      : null;

  return NextResponse.json({
    generatedAt: now.toISOString(),
    viewer: { adminRole: admin.adminRole, canSeeMoney, canRecordPayment, sharedStudentsEnabled },

    identity: {
      id: student.id,
      studentCode: student.studentCode,
      name: student.user?.name ?? "Unnamed",
      email: student.user?.email ?? null,
      phone: typeof admission?.phone === "string" ? admission.phone : null,
      // The one file we do surface, because a face is the point of a file.
      photoUrl: typeof admission?.photoUrl === "string" ? admission.photoUrl : null,
      status: student.status,
      level: student.level,
      sessionSlot: student.sessionSlot,
      classType: student.classType,
      deliveryMode: student.deliveryMode,
      hybridOnlineSlot: student.hybridOnlineSlot,
      pathway: student.pathway,
      outcome: student.outcome,
      examReadiness: student.examReadiness,
      branch: student.branch,
      tutor: student.tutor
        ? {
            id: student.tutor.id,
            name: student.tutor.user?.name ?? "Unnamed tutor",
            email: student.tutor.user?.email ?? null,
            status: student.tutor.status,
          }
        : null,
      coTutors: student.coTutors.map((link) => ({
        id: link.lecturer.id,
        name: link.lecturer.user?.name ?? "Unnamed tutor",
        email: link.lecturer.user?.email ?? null,
        role: link.role,
      })),
      registeredAt: student.createdAt.toISOString(),
      updatedAt: student.updatedAt.toISOString(),
      daysEnrolled: Math.max(0, Math.floor((now.getTime() - student.createdAt.getTime()) / DAY)),
      graduationDate: student.graduationDate?.toISOString() ?? null,
    },

    account: {
      userId: student.user?.id ?? null,
      twoFactorOn: Boolean(student.user?.totpEnabledAt),
      passwordClaimed: student.user?.passwordClaimed ?? true,
      accountCreatedAt: student.user?.createdAt.toISOString() ?? null,
      welcomeTourSeenAt: student.welcomeTourSeenAt?.toISOString() ?? null,
      lastJourneySeenAt: student.journeySeenAt?.toISOString() ?? null,
      // A login the office minted for a no-email student (phone number at a
      // school subdomain, or an importer placeholder). `loginUpgradedByStudentAt`
      // is stamped when they trade it for their own email from the portal.
      loginIsTemporary: isTemporaryLogin(student.user?.email),
      loginUpgradedByStudentAt:
        typeof admission?.loginUpgradedByStudentAt === "string" ? admission.loginUpgradedByStudentAt : null,
      loginUpgradedFrom:
        typeof admission?.loginUpgradedFrom === "string" ? admission.loginUpgradedFrom : null,
    },

    origin: student.convertedFromLead
      ? {
          source: student.convertedFromLead.source,
          status: student.convertedFromLead.status,
          enquiredAt: student.convertedFromLead.createdAt.toISOString(),
          notes: student.convertedFromLead.notes,
        }
      : null,

    // Always present so the page can show the padlock; amounts only for those
    // allowed to see them.
    money: {
      paywall,
      lockedOut,
      // Present for every admin so a secretary can see "access on hold", even
      // without the amounts.
      partPayer: isPartPayer,
      balanceLockAt: balanceLockAt?.toISOString() ?? null,
      balanceLockActive,
      graceUntil: graceDate?.toISOString() ?? null,
      ...(canSeeMoney
        ? {
            fee,
            deposit,
            paid,
            owed,
            feeProgressPercent: access.feeProgressPercent,
            reminderStages: (student.feeRemindersScheduled ?? {}) as Record<string, boolean>,
            payments: payments.map((payment) => ({
              ...payment,
              createdAt: payment.createdAt.toISOString(),
            })),
          }
        : {}),
    },

    attendance: {
      total: attendance.length,
      attended,
      rate: attendance.length > 0 ? Math.round((attended / attendance.length) * 100) : null,
      last30: {
        total: recentAttendance.length,
        attended: recentAttended,
        rate:
          recentAttendance.length > 0
            ? Math.round((recentAttended / recentAttendance.length) * 100)
            : null,
      },
      recent: attendance.slice(0, 14).map((record) => ({
        id: record.id,
        date: record.date.toISOString(),
        status: record.status,
        present: record.present,
        notes: record.notes,
      })),
    },

    academics: {
      averageScore,
      grades: grades.map((grade) => ({ ...grade, createdAt: grade.createdAt.toISOString() })),
      submissions: submissions.map((submission) => ({
        id: submission.id,
        title: submission.assignment?.title ?? "Untitled",
        score: submission.score,
        createdAt: submission.createdAt.toISOString(),
      })),
      examRegistrations: examRegistrations.map((registration) => ({
        ...registration,
        createdAt: registration.createdAt.toISOString(),
      })),
      certificates: certificates.map((certificate) => ({
        ...certificate,
        createdAt: certificate.createdAt.toISOString(),
      })),
    },

    journey: {
      classesStartedAt: student.classesStartedAt?.toISOString() ?? null,
      startConfirmedAt: student.startConfirmedAt?.toISOString() ?? null,
      startConfirmedVia: student.startConfirmedVia,
      notStartedCount: student.notStartedCount,
      notStartedReason: student.notStartedReason,
      levelCompletedAt: student.levelCompletedAt?.toISOString() ?? null,
      levelCompletedFor: student.levelCompletedFor,
      heldBackAt: student.heldBackAt?.toISOString() ?? null,
      heldBackReason: student.heldBackReason,
      germanyGoal: student.germanyGoal,
      germanyGoalNote: student.germanyGoalNote,
      events: journeyEvents.map((event) => ({
        ...event,
        occurredAt: event.occurredAt.toISOString(),
      })),
    },

    engagement: {
      videos: videoProgress.map((entry) => ({
        id: entry.id,
        title: entry.material?.title ?? "Untitled",
        completed: entry.completed,
        positionSeconds: entry.positionSeconds,
        updatedAt: entry.updatedAt.toISOString(),
      })),
      notifications: notifications.map((notification) => ({
        ...notification,
        createdAt: notification.createdAt.toISOString(),
      })),
    },

    /**
     * Churn risk — a different question from `money.lockedOut`. See
     * lib/student-risk.ts: a fully-paid student who has gone quiet is
     * invisible to the paywall/payments view but shows up here.
     */
    risk,

    /**
     * The deliverability trail. `queued` is separate from the log because a
     * message sitting in the queue has not been attempted yet — reporting it as
     * "not sent" and as "failed" are different answers to a parent on the phone.
     */
    email: {
      queued: queuedEmail,
      log: emailLog.map((entry) => ({
        ...entry,
        createdAt: entry.createdAt.toISOString(),
      })),
    },

    admissionEntries,

    // The structured record — see lib/student-profile.ts. `tags` are
    // admin-authored (the chip editor); `segments` are recomputed here off the
    // same facts as `risk`/`money` above so a segment can never disagree with
    // what the rest of this dossier already says.
    profile: student.profile
      ? {
          ...student.profile,
          dateOfBirth: student.profile.dateOfBirth?.toISOString() ?? null,
          passportExpiry: student.profile.passportExpiry?.toISOString() ?? null,
          createdAt: student.profile.createdAt.toISOString(),
          updatedAt: student.profile.updatedAt.toISOString(),
        }
      : null,
    tags: student.tags,
    segments: deriveSegments(
      {
        status: student.status,
        classType: student.classType,
        deliveryMode: student.deliveryMode,
        heldBackAt: student.heldBackAt,
        classesStartedAt: student.classesStartedAt,
        createdAt: student.createdAt,
        enrolmentCount: enrolments.length,
      },
      {
        now,
        // Same `behindOnTuition` rule the `risk` input above was built from
        // (see it a few lines up) — recomputed rather than re-derived, so this
        // can never disagree with `money.lockedOut` or `risk` itself.
        finance: {
          behindOnTuition:
            lockedOut && Math.floor((now.getTime() - student.createdAt.getTime()) / DAY) >= BEHIND_TUITION_MIN_DAYS,
          owed,
          progressPercent: 0,
        },
        risk,
      },
    ),

    /**
     * The per-level timeline — every year, every level, every branch and
     * tutor this student has ever been under. See lib/student-enrolment.ts.
     * Empty for a student created before this table existed and not yet
     * touched by scripts/backfill-student-enrolments.mjs — that gap is the
     * backfill's job, not a bug in this read.
     */
    enrolments: enrolments.map((row) => ({
      id: row.id,
      level: row.level,
      sessionSlot: row.sessionSlot,
      classType: row.classType,
      deliveryMode: row.deliveryMode,
      batchMonth: row.batchMonth,
      batchYear: row.batchYear,
      startedAt: row.startedAt?.toISOString() ?? null,
      endedAt: row.endedAt?.toISOString() ?? null,
      outcome: row.outcome,
      outcomeNote: row.outcomeNote,
      feeSnapshot: row.feeSnapshot,
      branchName: row.branch?.name ?? null,
      tutorName: row.tutor?.user?.name ?? null,
      createdAt: row.createdAt.toISOString(),
    })),
  });
}
