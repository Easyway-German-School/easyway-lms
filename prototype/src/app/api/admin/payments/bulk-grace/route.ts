import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { requireCapability, scopedBranchIds } from "@/lib/admin-roles";
import { bulkGraceBatchLabel, BULK_GRACE_PAYMENT_STATUSES, compareBulkGraceBatchLabels, matchesBulkGraceBatch, matchesBulkGracePaymentStatus, type BulkGracePaymentStatus } from "@/lib/bulk-grace";
import { computeStudentFinance, FINANCE_STUDENT_SELECT } from "@/lib/finance/receivables";
import { LEVELS } from "@/lib/levels";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const MAX_STUDENTS = 5000;
const GRACE_STATUSES = ["any", "none", "active", "expired"] as const;
type GraceStatus = (typeof GRACE_STATUSES)[number];

type BulkGraceFilters = {
  batch: string;
  level: string;
  branchId: string;
  classType: "" | "group" | "private";
  paymentStatus: BulkGracePaymentStatus;
  graceStatus: GraceStatus;
};

function parseFilters(values: Record<string, unknown>): BulkGraceFilters | string {
  const batch = typeof values.batch === "string" ? values.batch.trim() : "";
  const level = typeof values.level === "string" ? values.level.trim().toUpperCase() : "";
  const branchId = typeof values.branchId === "string" ? values.branchId.trim() : "";
  const classType = typeof values.classType === "string" ? values.classType : "";
  const paymentStatus = typeof values.paymentStatus === "string" ? values.paymentStatus : "all";
  const graceStatus = typeof values.graceStatus === "string" ? values.graceStatus : "any";

  if (level && !(LEVELS as readonly string[]).includes(level)) return "Choose a valid level.";
  if (classType && classType !== "group" && classType !== "private") return "Choose a valid membership type.";
  if (!(BULK_GRACE_PAYMENT_STATUSES as readonly string[]).includes(paymentStatus)) return "Choose a valid payment status.";
  if (!(GRACE_STATUSES as readonly string[]).includes(graceStatus)) return "Choose a valid grace status.";

  return {
    batch,
    level,
    branchId,
    classType: classType as BulkGraceFilters["classType"],
    paymentStatus: paymentStatus as BulkGracePaymentStatus,
    graceStatus: graceStatus as GraceStatus,
  };
}

function rosterWhere(tenantId: string | null | undefined, branchIds: string[] | null): Prisma.StudentWhereInput {
  const and: Prisma.StudentWhereInput[] = [
    { status: "active" },
    { user: { is: { role: "STUDENT" } } },
  ];
  if (tenantId) {
    and.push({
      OR: [{ tenantId }, { branch: { tenantId } }, { user: { tenantId } }],
    });
  }
  if (branchIds) and.push({ branchId: { in: branchIds } });
  return { AND: and };
}

async function findTargets(
  baseWhere: Prisma.StudentWhereInput,
  filters: BulkGraceFilters,
  now: Date,
) {
  const students = await prisma.student.findMany({
    where: baseWhere,
    take: MAX_STUDENTS + 1,
    orderBy: { createdAt: "desc" },
    select: {
      ...FINANCE_STUDENT_SELECT,
      enrolments: {
        where: { deletedAt: null },
        orderBy: { startedAt: "desc" },
        select: { batchMonth: true, batchYear: true, outcome: true },
      },
    },
  });
  if (students.length > MAX_STUDENTS) {
    throw new Error(`This selection contains more than ${MAX_STUDENTS} active students. Narrow it by batch, level, branch or payment status.`);
  }

  const batchOptions = new Set<string>();
  const branchOptions = new Map<string, string>();
  const targets: Array<{
    id: string;
    name: string;
    level: string;
    batch: string | null;
    branchId: string | null;
    branch: string;
    paid: number;
    owed: number;
    depositPaid: boolean;
    currentLevelOutstanding: number;
    graceUntil: string | null;
  }> = [];

  for (const student of students) {
    const batch = bulkGraceBatchLabel(student);
    const finance = computeStudentFinance(student, now);
    const currentCharge = finance.openCharges.find(
      (charge) => charge.level.toUpperCase() === student.level.toUpperCase(),
    );
    const currentLevelOutstanding = currentCharge?.outstanding ?? finance.owed;
    if (batch) batchOptions.add(batch);
    if (finance.branchId) branchOptions.set(finance.branchId, finance.branch);

    if (!matchesBulkGraceBatch(filters.batch, batch)) continue;
    if (filters.level && student.level.toUpperCase() !== filters.level) continue;
    if (filters.branchId && finance.branchId !== filters.branchId) continue;
    if (filters.classType && student.classType !== filters.classType) continue;
    if (!matchesBulkGracePaymentStatus(filters.paymentStatus, {
      paid: finance.paid,
      owed: finance.owed,
      currentLevelOutstanding,
      depositPaid: finance.depositPaid,
    })) continue;

    const graceDate = student.paymentGraceUntil ? new Date(student.paymentGraceUntil) : null;
    const graceIsActive = Boolean(graceDate && graceDate.getTime() > now.getTime());
    if (
      (filters.graceStatus === "none" && graceDate) ||
      (filters.graceStatus === "active" && !graceIsActive) ||
      (filters.graceStatus === "expired" && (!graceDate || graceIsActive))
    ) {
      continue;
    }

    targets.push({
      id: student.id,
      name: student.user?.name || student.user?.email || "Unnamed",
      level: student.level,
      batch,
      branchId: finance.branchId,
      branch: finance.branch,
      paid: finance.paid,
      owed: finance.owed,
      depositPaid: finance.depositPaid,
      currentLevelOutstanding,
      graceUntil: graceDate?.toISOString() ?? null,
    });
  }

  return {
    targets,
    batchOptions: [...batchOptions].sort(compareBulkGraceBatchLabels),
    branchOptions: Array.from(branchOptions, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
  };
}

async function findFilterOptions(baseWhere: Prisma.StudentWhereInput) {
  const students = await prisma.student.findMany({
    where: baseWhere,
    select: {
      admission: true,
      createdAt: true,
      branch: { select: { id: true, name: true } },
      enrolments: {
        where: { deletedAt: null, outcome: "ongoing" },
        orderBy: { startedAt: "desc" },
        take: 1,
        select: { batchMonth: true, batchYear: true, outcome: true },
      },
    },
  });
  const batches = new Set<string>();
  const branches = new Map<string, string>();
  for (const student of students) {
    const batch = bulkGraceBatchLabel(student);
    if (batch) batches.add(batch);
    if (student.branch) branches.set(student.branch.id, student.branch.name);
  }
  return {
    batchOptions: [...batches].sort(compareBulkGraceBatchLabels),
    branchOptions: Array.from(branches, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
  };
}

function filtersFromUrl(url: URL): BulkGraceFilters | string {
  return parseFilters(Object.fromEntries(url.searchParams.entries()));
}

export async function GET(request: Request) {
  const gate = await requireCapability("payments");
  if (!gate.ok) return gate.response;
  const url = new URL(request.url);
  const baseWhere = rosterWhere(gate.session.user.tenantId, scopedBranchIds(gate.admin));
  if (url.searchParams.get("optionsOnly") === "true") {
    try {
      return NextResponse.json(await findFilterOptions(baseWhere));
    } catch (error) {
      console.error("Bulk payment grace filter options failed", error);
      return NextResponse.json({ error: "Could not load payment filters." }, { status: 500 });
    }
  }

  const filters = filtersFromUrl(url);
  if (typeof filters === "string") return NextResponse.json({ error: filters }, { status: 400 });

  try {
    const result = await findTargets(
      baseWhere,
      filters,
      new Date(),
    );
    return NextResponse.json({
      count: result.targets.length,
      activeGraceCount: result.targets.filter((target) => target.graceUntil && new Date(target.graceUntil).getTime() > Date.now()).length,
      graceRecordCount: result.targets.filter((target) => target.graceUntil !== null).length,
      depositClearedCount: result.targets.filter((target) => target.depositPaid).length,
      batchOptions: result.batchOptions,
      branchOptions: result.branchOptions,
      sample: result.targets.slice(0, 12),
    });
  } catch (error) {
    console.error("Bulk payment grace preview failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not preview this group." },
      { status: error instanceof Error && error.message.startsWith("This selection contains more than") ? 413 : 500 },
    );
  }
}

export async function POST(request: Request) {
  const gate = await requireCapability("payments");
  if (!gate.ok) return gate.response;

  const body: unknown = await request.json().catch(() => ({}));
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "A valid request body is required." }, { status: 400 });
  }
  const record = body as Record<string, unknown>;
  const filters = parseFilters(record);
  if (typeof filters === "string") return NextResponse.json({ error: filters }, { status: 400 });

  const action = record.action;
  if (action !== "grant" && action !== "clear") {
    return NextResponse.json({ error: "Choose whether to grant or clear grace." }, { status: 400 });
  }

  let graceUntil: Date | null = null;
  if (action === "grant") {
    if (typeof record.graceUntil !== "string" || !record.graceUntil.trim()) {
      return NextResponse.json({ error: "Choose the date grace should end." }, { status: 400 });
    }
    graceUntil = new Date(record.graceUntil);
    if (Number.isNaN(graceUntil.getTime()) || graceUntil.getTime() <= Date.now()) {
      return NextResponse.json({ error: "Grace must end in the future." }, { status: 400 });
    }
  }

  const baseWhere = rosterWhere(gate.session.user.tenantId, scopedBranchIds(gate.admin));
  try {
    const { targets } = await findTargets(baseWhere, filters, new Date());
    const selectedTargets = action === "clear"
      ? targets.filter((target) => target.graceUntil !== null)
      : targets;
    if (!selectedTargets.length) return NextResponse.json({ updated: 0 });

    const result = await prisma.student.updateMany({
      where: {
        AND: [baseWhere, { id: { in: selectedTargets.map((target) => target.id) } }],
      },
      data: { paymentGraceUntil: graceUntil },
    });
    return NextResponse.json({ updated: result.count, graceUntil: graceUntil?.toISOString() ?? null });
  } catch (error) {
    console.error("Bulk payment grace update failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not update grace for this group." },
      { status: error instanceof Error && error.message.startsWith("This selection contains more than") ? 413 : 500 },
    );
  }
}
