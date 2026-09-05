import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import {
  AGING_BUCKETS,
  computeStudentFinance,
  focusPreset,
  type StudentFinance,
} from "@/lib/finance/receivables";
import { computeChurnRisk, churnRiskPreset, RECENT_WINDOW_DAYS, type ChurnRisk } from "@/lib/student-risk";
import { deriveSegments } from "@/lib/student-segments";

/**
 * ONE QUERY, TWO CALLERS.
 *
 * `api/admin/students` (the roster GET) and `api/admin/students/export` (the
 * CSV) used to risk drifting apart — a filter added to one and forgotten in
 * the other means "what you see is not what you export". This module is the
 * single builder both call: same `where` clause, same branch scoping, same
 * derived-filter (focus / risk / aging bucket / tag / segment) pass over the
 * results. Lifted out of the GET handler almost verbatim — see its git
 * history for the reasoning behind each rule kept below.
 */

export type RosterFilters = {
  branchId?: string | null;
  level?: string | null;
  batch?: string | null;
  classType?: string | null;
  sessionSlot?: string | null;
  status?: string | null;
  paymentStatus?: string | null;
  tutorId?: string | null;
  search?: string | null;
  focus?: string | null;
  agingBucket?: string | null;
  ids?: string | null;
  /**
   * A stored `Student.tags` entry OR a derived segment id from
   * lib/student-segments.ts (e.g. "returning", "behind-on-fees"). Resolved in
   * the post-query pass since a segment can't be expressed as SQL.
   */
  tag?: string | null;
  /**
   * A calendar year — "who was here in 2024". Unlike `tag`, this IS a real
   * relational filter (StudentEnrolment.batchYear), so it runs in SQL rather
   * than the post-query pass; see buildRosterWhereClause.
   */
  year?: string | null;
};

export function parseRosterFilters(url: URL): RosterFilters {
  return {
    branchId: url.searchParams.get("branchId"),
    level: url.searchParams.get("level"),
    batch: url.searchParams.get("batch"),
    classType: url.searchParams.get("classType"),
    sessionSlot: url.searchParams.get("sessionSlot"),
    status: url.searchParams.get("status"),
    paymentStatus: url.searchParams.get("paymentStatus"),
    tutorId: url.searchParams.get("tutorId"),
    search: url.searchParams.get("search") || undefined,
    focus: url.searchParams.get("focus"),
    agingBucket: url.searchParams.get("agingBucket"),
    ids: url.searchParams.get("ids"),
    tag: url.searchParams.get("tag"),
    year: url.searchParams.get("year"),
  };
}

/** True when any filter can only be resolved after the query runs (post-query pass). */
export function hasDerivedFilter(filters: RosterFilters): boolean {
  return Boolean(
    (filters.focus && focusPreset(filters.focus)) ||
      (filters.focus && churnRiskPreset(filters.focus)) ||
      filters.agingBucket ||
      filters.ids ||
      filters.tag,
  );
}

export function buildRosterWhereClause(
  filters: RosterFilters,
  ctx: { tenantId: string | null | undefined; allowedBranchIds: string[] | null },
): any {
  const whereClause: any = {};
  // Never surface staff in the student roster — see api/admin/students GET's
  // long-form note on why this join, not a role column alone, is the rule.
  whereClause.user = { is: { role: "STUDENT", adminRole: null } };
  if (filters.branchId) whereClause.branchId = filters.branchId;
  if (filters.level) whereClause.level = filters.level;
  if (filters.batch) whereClause.admission = { path: ["batch"], equals: filters.batch };
  if (filters.classType) whereClause.classType = filters.classType;
  if (filters.sessionSlot) whereClause.sessionSlot = filters.sessionSlot;
  if (filters.status) whereClause.status = filters.status;

  if (ctx.tenantId) {
    whereClause.OR = [
      { branch: { tenantId: ctx.tenantId } },
      { user: { tenantId: ctx.tenantId } },
    ];
  }

  if (ctx.allowedBranchIds) {
    if (filters.branchId) {
      if (!ctx.allowedBranchIds.includes(filters.branchId)) whereClause.branchId = "__no-branch-access__";
    } else {
      whereClause.branchId = { in: ctx.allowedBranchIds };
    }
  }

  if (filters.search) {
    whereClause.AND = whereClause.AND || [];
    whereClause.AND.push({
      OR: [
        { user: { name: { contains: filters.search, mode: "insensitive" } } },
        { user: { email: { contains: filters.search, mode: "insensitive" } } },
      ],
    });
  }

  if (filters.paymentStatus) {
    whereClause.payments = { some: { status: filters.paymentStatus } };
  }
  if (filters.tutorId) {
    whereClause.tutorId = filters.tutorId;
  }
  if (filters.year) {
    const year = Number(filters.year);
    if (Number.isInteger(year)) {
      whereClause.enrolments = { some: { batchYear: year, deletedAt: null } };
    }
  }

  return whereClause;
}

/** Shared `include` — every field the finance / risk / segment / export computations read. */
export const ROSTER_INCLUDE = {
  user: true,
  branch: true,
  tutor: { include: { user: true } },
  profile: true,
  payments: {
    where: { deletedAt: null },
    orderBy: { createdAt: "desc" as const },
  },
  invoices: {
    include: { payments: { where: { deletedAt: null } } },
  },
  tuitionCharges: {
    where: { deletedAt: null },
    select: { id: true, level: true, amount: true, waivedAmount: true, legacyArrears: true, createdAt: true, settledAt: true },
  },
  attendances: {
    where: { date: { gte: new Date(Date.now() - RECENT_WINDOW_DAYS * 24 * 60 * 60 * 1000) } },
    select: { present: true, status: true },
  },
  videoProgress: {
    orderBy: { updatedAt: "desc" as const },
    take: 1,
    select: { updatedAt: true },
  },
  journeyEvents: {
    orderBy: { occurredAt: "desc" as const },
    take: 1,
    select: { occurredAt: true },
  },
  // How many level×batch stints this student has ever had — see
  // lib/student-enrolment.ts. Feeds deriveSegments' "returning" rule; more
  // than every existing row is created before enrolment-history existed
  // (see the Phase 2 backfill), so this reads 0 for a not-yet-backfilled row
  // rather than 1, which deriveSegments treats the same as "new" either way.
  _count: { select: { enrolments: true } },
} satisfies Prisma.StudentInclude;

export type RosterRow = Prisma.StudentGetPayload<{ include: typeof ROSTER_INCLUDE }>;

export type ScoredRosterRow = {
  student: RosterRow;
  finance: StudentFinance;
  risk: ChurnRisk;
  segments: string[];
};

/**
 * Attaches finance / churn-risk / derived-segment figures to every row, then
 * applies whichever derived filters were requested (focus preset, risk
 * preset, aging bucket, an explicit id set, or a tag/segment). Pagination
 * happens AFTER this — see the roster GET and the export route, which both
 * cut the page only once the derived filter has already run, for the same
 * reason the original GET handler did: cutting first would paginate "page 1
 * of everyone" rather than "page 1 of the behind list".
 */
export function scoreAndFilterRoster(
  students: RosterRow[],
  filters: RosterFilters,
  now: Date = new Date(),
): ScoredRosterRow[] {
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const focus = focusPreset(filters.focus);
  const riskFocus = focus ? null : churnRiskPreset(filters.focus);
  const ids = filters.ids
    ? new Set(filters.ids.split(",").map((id) => id.trim()).filter(Boolean))
    : null;

  const scored: ScoredRosterRow[] = students.map((student) => {
    const finance = computeStudentFinance(
      {
        id: student.id,
        level: student.level,
        status: student.status,
        classType: student.classType,
        createdAt: student.createdAt,
        branch: student.branch ? { id: student.branch.id, name: student.branch.name } : null,
        user: student.user,
        payments: student.payments,
        tuitionCharges: student.tuitionCharges,
      },
      now,
    );
    const risk = computeChurnRisk(
      {
        id: student.id,
        createdAt: student.createdAt,
        notStartedCount: student.notStartedCount,
        recentAttendance: student.attendances,
        lastVideoActivityAt: student.videoProgress[0]?.updatedAt ?? null,
        lastJourneyEventAt: student.journeyEvents[0]?.occurredAt ?? null,
        behindOnTuition: finance.behindOnTuition,
      },
      now,
    );
    const segments = deriveSegments(
      {
        status: student.status,
        classType: student.classType,
        deliveryMode: student.deliveryMode,
        heldBackAt: student.heldBackAt,
        classesStartedAt: student.classesStartedAt,
        createdAt: student.createdAt,
        enrolmentCount: student._count.enrolments,
      },
      { now, finance, risk },
    );
    return { student, finance, risk, segments };
  });

  let matched = scored;
  if (focus) {
    matched = matched.filter((entry) =>
      focus.matches(entry.finance, { now, startOfMonth }, {
        id: entry.student.id,
        level: entry.student.level,
        status: entry.student.status,
        classType: entry.student.classType,
        createdAt: entry.student.createdAt,
        branch: entry.student.branch ? { id: entry.student.branch.id, name: entry.student.branch.name } : null,
        user: entry.student.user,
        payments: entry.student.payments,
        tuitionCharges: entry.student.tuitionCharges,
      }),
    );
  }
  if (riskFocus) {
    matched = matched.filter((entry) => riskFocus.matches(entry.risk));
  }
  if (filters.agingBucket) {
    matched = matched.filter(
      (entry) => entry.finance.owed > 0 && entry.finance.agingBucket === filters.agingBucket,
    );
  }
  if (ids) {
    matched = matched.filter((entry) => ids.has(entry.student.id));
  }
  if (filters.tag) {
    const tag = filters.tag;
    matched = matched.filter(
      (entry) => entry.student.tags.includes(tag) || entry.segments.includes(tag),
    );
  }

  return matched;
}

export { AGING_BUCKETS };
