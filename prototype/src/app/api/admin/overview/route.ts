import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/admin-roles";
import { requiredDepositFor, tuitionFeeFor } from "@/lib/payment";
import { activeTransport } from "@/lib/mailer";

const DAY = 24 * 60 * 60 * 1000;

function monthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Everything the front page of the admin portal needs, in one request.
 *
 * The old dashboard showed six `count()` results. Those say how big the school
 * is but not whether it is healthy, so this adds the numbers someone running
 * the place actually acts on: money in versus money owed, who is stuck behind
 * the tuition paywall, whether attendance is slipping, and whether the plumbing
 * (email, integrations) is alive.
 *
 * Money is withheld from admins without the `payments` capability rather than
 * the whole page 403ing — a secretary still needs the student numbers.
 */
export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const admin = auth.admin;

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * DAY);

  const [
    students,
    branches,
    lecturers,
    leads,
    materials,
    threads,
    comments,
    examRegistrations,
    pendingExamRegistrations,
    ungradedSubmissions,
    recentAttendance,
    connectors,
    recentPayments,
    recentStudents,
    recentSubmissions,
  ] = await Promise.all([
    prisma.student.findMany({
      select: {
        id: true,
        level: true,
        status: true,
        classType: true,
        createdAt: true,
        branch: { select: { id: true, name: true } },
        user: { select: { name: true, email: true } },
        payments: { where: { status: "completed" }, select: { amount: true } },
      },
    }),
    prisma.branch.count(),
    prisma.lecturer.count(),
    prisma.lead.groupBy({ by: ["status"], _count: { id: true } }),
    prisma.material.count(),
    prisma.thread.count(),
    prisma.comment.count(),
    prisma.examRegistration.count(),
    prisma.examRegistration.count({ where: { status: "pending" } }),
    prisma.assignmentSubmission.count({ where: { score: null } }),
    prisma.attendance.findMany({
      where: { date: { gte: thirtyDaysAgo } },
      select: { present: true, status: true },
    }),
    prisma.integrationConnector.findMany({
      select: { id: true, name: true, enabled: true, status: true, lastSyncAt: true, lastError: true, itemsSynced: true },
    }),
    prisma.payment.findMany({
      where: { status: "completed", createdAt: { gte: sixMonthsAgo } },
      // `student.id` rides along so the feed entry can open the person it is
      // about. Without it the front page could name someone and then offer no
      // way to reach them — the reader had to memorise a name, open the
      // roster and search for it.
      select: {
        amount: true,
        createdAt: true,
        method: true,
        student: { select: { id: true, user: { select: { name: true } } } },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.student.findMany({
      take: 5,
      orderBy: { createdAt: "desc" },
      select: { id: true, createdAt: true, level: true, user: { select: { name: true } }, branch: { select: { name: true } } },
    }),
    prisma.assignmentSubmission.findMany({
      take: 5,
      orderBy: { createdAt: "desc" },
      select: {
        createdAt: true,
        student: { select: { id: true, user: { select: { name: true } } } },
        assignment: { select: { title: true } },
      },
    }),
  ]);

  // ---- Payment cohorts -------------------------------------------------
  // Which side of the tuition paywall every student sits on. "Registered only"
  // is the group the padlock is showing to, and the group worth chasing.
  const cohorts = { unpaid: 0, registeredOnly: 0, depositPaid: 0, fullPaid: 0 };
  let expectedRevenue = 0;
  let collectedRevenue = 0;
  const atRisk: Array<{ id: string; name: string; email: string; level: string; branch: string; paid: number; owed: number; daysEnrolled: number }> = [];
  const byLevel: Record<string, number> = {};
  const byBranch: Record<string, { name: string; students: number; collected: number; expected: number }> = {};

  for (const student of students) {
    const feeLookup = { level: student.level, branch: student.branch?.name ?? null, classType: student.classType };
    const fee = tuitionFeeFor(feeLookup);
    const deposit = requiredDepositFor(feeLookup);
    const paid = student.payments.reduce((sum, payment) => sum + payment.amount, 0);

    expectedRevenue += fee;
    collectedRevenue += paid;

    if (paid <= 0) cohorts.unpaid += 1;
    else if (paid >= fee) cohorts.fullPaid += 1;
    else if (paid >= deposit) cohorts.depositPaid += 1;
    else cohorts.registeredOnly += 1;

    byLevel[student.level] = (byLevel[student.level] ?? 0) + 1;

    const branchKey = student.branch?.id ?? "unassigned";
    const branchEntry = byBranch[branchKey] ?? {
      name: student.branch?.name ?? "Unassigned",
      students: 0,
      collected: 0,
      expected: 0,
    };
    branchEntry.students += 1;
    branchEntry.collected += paid;
    branchEntry.expected += fee;
    byBranch[branchKey] = branchEntry;

    const daysEnrolled = Math.floor((now.getTime() - student.createdAt.getTime()) / DAY);
    // Two weeks in and still short of the deposit: the class has started
    // without them, so this is the chase list.
    if (paid < deposit && daysEnrolled >= 14) {
      atRisk.push({
        id: student.id,
        name: student.user?.name ?? "Unnamed",
        email: student.user?.email ?? "",
        level: student.level,
        branch: student.branch?.name ?? "Unassigned",
        paid,
        owed: deposit - paid,
        daysEnrolled,
      });
    }
  }

  atRisk.sort((a, b) => b.daysEnrolled - a.daysEnrolled);

  // ---- Revenue trend ---------------------------------------------------
  // Label is taken from the same Date that produced the key. Re-parsing
  // "2026-07" as UTC and then formatting it locally lands on 30 June for any
  // timezone behind UTC, which labelled every bar one month early.
  const trendBuckets = new Map<string, { label: string; amount: number }>();
  for (let i = 5; i >= 0; i -= 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
    trendBuckets.set(monthKey(date), {
      label: date.toLocaleDateString("en-GB", { month: "short" }),
      amount: 0,
    });
  }
  let revenueThisMonth = 0;
  let revenueLastMonth = 0;
  for (const payment of recentPayments) {
    const bucket = trendBuckets.get(monthKey(payment.createdAt));
    if (bucket) bucket.amount += payment.amount;
    if (payment.createdAt >= startOfMonth) revenueThisMonth += payment.amount;
    else if (payment.createdAt >= startOfLastMonth) revenueLastMonth += payment.amount;
  }

  const revenueTrend = [...trendBuckets.values()].map((bucket) => ({
    month: bucket.label,
    amount: bucket.amount,
  }));

  // ---- Attendance ------------------------------------------------------
  const attendedCount = recentAttendance.filter(
    (record) => record.present || record.status === "present" || record.status === "late",
  ).length;
  const attendanceRate =
    recentAttendance.length > 0 ? Math.round((attendedCount / recentAttendance.length) * 100) : null;

  // ---- Activity feed ---------------------------------------------------
  //
  // `canSeeMoney` is computed further down for the finance block; the feed
  // needs it too, so it is read here rather than duplicated.
  const feedShowsMoney = admin.can("payments");

  /**
   * `studentId` is only emitted to an admin who may open the file it points at.
   * A `data_comm` manager legitimately sees the feed — it is the pulse of the
   * school — but has no `students` capability, and a link that 403s on arrival
   * is worse than no link. The field is dropped rather than nulled so the page
   * renders a plain row for them with nothing to click.
   */
  const feedLinksToFiles = admin.can("students");
  const linkTo = (studentId: string | null | undefined) =>
    feedLinksToFiles && studentId ? { studentId } : {};

  const activity = [
    ...recentStudents.map((student) => ({
      kind: "signup" as const,
      at: student.createdAt.toISOString(),
      ...linkTo(student.id),
      text: `${student.user?.name ?? "A new student"} enrolled${student.branch?.name ? ` at ${student.branch.name}` : ""} (${student.level})`,
    })),
    ...recentPayments.slice(0, 5).map((payment) => ({
      kind: "payment" as const,
      at: payment.createdAt.toISOString(),
      ...linkTo(payment.student?.id),
      // THE THIRD PLACE THE SAME LEAK LIVED. Headline finance was gated, the
      // at-risk balances were not, and neither was this — a running feed of
      // "Running Student paid ₦180,000 via manual" on the front page of a
      // Secretary's dashboard. The event is theirs to see; the amount is not.
      text: feedShowsMoney
        ? `${payment.student?.user?.name ?? "A student"} paid ₦${payment.amount.toLocaleString("en-NG")}${payment.method ? ` via ${payment.method}` : ""}`
        : `${payment.student?.user?.name ?? "A student"} made a payment`,
    })),
    ...recentSubmissions.map((submission) => ({
      kind: "submission" as const,
      at: submission.createdAt.toISOString(),
      ...linkTo(submission.student?.id),
      text: `${submission.student?.user?.name ?? "A student"} submitted "${submission.assignment?.title ?? "an assignment"}"`,
    })),
  ]
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, 10);

  const leadCounts = leads.reduce<Record<string, number>>((acc, row) => {
    acc[row.status] = row._count.id;
    return acc;
  }, {});

  const newStudentsThisMonth = students.filter((student) => student.createdAt >= startOfMonth).length;

  const canSeeMoney = admin.can("payments");

  return NextResponse.json({
    adminRole: admin.adminRole,
    generatedAt: now.toISOString(),

    school: {
      students: students.length,
      activeStudents: students.filter((s) => s.status === "active").length,
      newStudentsThisMonth,
      privateStudents: students.filter((s) => s.classType === "private").length,
      branches,
      lecturers,
      materials,
      threads,
      comments,
      examRegistrations,
      byLevel,
    },

    // Per-branch performance. Money columns follow the same capability rule as
    // the finance block, so a secretary sees head counts without revenue.
    branchPerformance: Object.values(byBranch)
      .map((branch) => ({
        name: branch.name,
        students: branch.students,
        collected: canSeeMoney ? branch.collected : null,
        expected: canSeeMoney ? branch.expected : null,
        collectionRate:
          canSeeMoney && branch.expected > 0 ? Math.round((branch.collected / branch.expected) * 100) : null,
      }))
      .sort((a, b) => b.students - a.students),

    cohorts,

    // The whole point of the paywall: how many are stuck behind it.
    lockedOut: cohorts.unpaid + cohorts.registeredOnly,

    attendance: {
      rate: attendanceRate,
      recordsLast30Days: recentAttendance.length,
    },

    leads: {
      total: leads.reduce((sum, row) => sum + row._count.id, 0),
      new: leadCounts.new ?? 0,
      invited: leadCounts.invited ?? 0,
      converted: leadCounts.converted ?? 0,
      dropped: leadCounts.dropped ?? 0,
    },

    finance: canSeeMoney
      ? {
          expectedRevenue,
          collectedRevenue,
          outstanding: Math.max(0, expectedRevenue - collectedRevenue),
          collectionRate: expectedRevenue > 0 ? Math.round((collectedRevenue / expectedRevenue) * 100) : 0,
          revenueThisMonth,
          revenueLastMonth,
          monthOnMonthPercent:
            revenueLastMonth > 0
              ? Math.round(((revenueThisMonth - revenueLastMonth) / revenueLastMonth) * 100)
              : null,
          revenueTrend,
        }
      : null,

    actionQueue: {
      atRiskCount: atRisk.length,
      /**
       * THE BALANCES COME OFF FOR ANYONE WITHOUT `payments`.
       *
       * The `finance` block above was gated from the day sub-roles landed, and
       * that was mistaken for the whole job. It was not: this queue carries a
       * per-student `paid` and `owed`, and it was rendering both to a Secretary
       * on the front page of their dashboard — "₦150,000 paid, ₦30,000 owed",
       * by name, in a table headed PAID and OWED. Every headline figure was
       * correctly hidden while the actual balances sat underneath them.
       *
       * The row itself stays, because "this student is behind and has been for
       * a fortnight" is exactly what a front desk should chase. What they lose
       * is the amount, which is the part the school decided belongs to whoever
       * runs it. `daysEnrolled` is what makes the row actionable, not the sum.
       */
      atRisk: atRisk.slice(0, 8).map((student) =>
        canSeeMoney
          ? student
          : {
              // The id survives the money strip: it is not a balance, and it
              // is what turns "chase this person" into a click.
              id: student.id,
              name: student.name,
              email: student.email,
              level: student.level,
              branch: student.branch,
              daysEnrolled: student.daysEnrolled,
            },
      ),
      pendingExamRegistrations,
      ungradedSubmissions,
      leadsAwaitingInvite: leadCounts.new ?? 0,
    },

    health: {
      /**
       * ASKED OF THE MAILER, NOT RE-DERIVED HERE.
       *
       * This used to test `MAILERSEND_API_KEY || SMTP_HOST` — its own second
       * opinion about a question `src/lib/mailer.ts` already answers, and a
       * wrong one in both directions. A school configured the supported way,
       * with `EMAIL_PROVIDER=brevo` (which supplies the host from a preset, so
       * SMTP_HOST is deliberately unset), was told on the front page that it
       * had no email provider while mail was going out perfectly. And an
       * SMTP_HOST with no credentials passed this check while `buildTransport`
       * correctly refused it, so the banner stayed quiet on a server that could
       * not deliver a thing.
       *
       * A health check that disagrees with the subsystem it reports on is worse
       * than no health check: it teaches people to ignore the banner.
       */
      emailProvider: (() => {
        const transport = activeTransport();
        return {
          name: transport === "mailersend" ? "MailerSend" : transport === "smtp" ? "SMTP" : "None",
          configured: transport !== "none",
        };
      })(),
      integrations: connectors.map((connector) => ({
        id: connector.id,
        name: connector.name,
        enabled: connector.enabled,
        status: connector.status,
        lastSyncAt: connector.lastSyncAt?.toISOString() ?? null,
        lastError: connector.lastError,
        itemsSynced: connector.itemsSynced,
      })),
    },

    activity,
  });
}
