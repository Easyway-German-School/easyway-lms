import { NextResponse } from "next/server";

import { requireCapability, scopedBranchIds } from "@/lib/admin-roles";
import { prisma, unguardedPrisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/prisma-guard";
import { batchFromAdmission } from "@/lib/batch";
import {
  buildClusters,
  normalizeName,
  phoneKeyOf,
  type DuplicateMemberInput,
} from "@/lib/student-duplicates";

/**
 * Possible duplicates — the same student entered twice.
 *
 * GET clusters the roster on `normalised name` + `phone` and returns the
 * clusters with two or more rows, each with the keeper picked out.
 *
 * POST folds one non-keeper into the keeper: their payments, tuition charges,
 * invoices, payment plans and guardian links move across, the keeper's blank
 * fields are filled from the duplicate, and the duplicate's User + Student are
 * soft-deleted with a `mergedInto` marker. It refuses if the duplicate has any
 * classroom history (attendance, marked work, grades, a certificate) — that
 * one needs a person.
 *
 * Everything it touches is a soft delete or a moved foreign key, and the guard
 * writes a before-image of every write, so a merge can be walked back from the
 * audit trail.
 */

export const dynamic = "force-dynamic";

const MAX_STUDENTS = 6000;

/** The tenant fence GET/POST on /api/admin/students and /api/admin/cohorts use. */
function tenantWhere(tenantId: string | null | undefined) {
  if (!tenantId) return {};
  return { OR: [{ tenantId }, { branch: { tenantId } }, { user: { tenantId } }] };
}

const memberSelect = {
  id: true,
  studentCode: true,
  level: true,
  sessionSlot: true,
  deliveryMode: true,
  classType: true,
  branchId: true,
  admission: true,
  createdAt: true,
  branch: { select: { name: true } },
  profile: {
    select: {
      phone: true,
      altPhone: true,
      whatsapp: true,
      photoUrl: true,
    },
  },
  user: { select: { id: true, name: true, email: true, passwordClaimed: true, createdAt: true } },
  _count: {
    select: {
      attendances: true,
      assignmentSubmissions: true,
      grades: true,
      certificates: true,
      payments: true,
      tuitionCharges: true,
    },
  },
} as const;

type MemberRow = {
  id: string;
  studentCode: string | null;
  level: string;
  sessionSlot: string;
  deliveryMode: string;
  classType: string;
  branchId: string | null;
  admission: unknown;
  createdAt: Date;
  branch: { name: string } | null;
  profile: { phone: string | null; altPhone: string | null; whatsapp: string | null; photoUrl: string | null } | null;
  user: { id: string; name: string | null; email: string; passwordClaimed: boolean; createdAt: Date } | null;
  _count: {
    attendances: number;
    assignmentSubmissions: number;
    grades: number;
    certificates: number;
    payments: number;
    tuitionCharges: number;
  };
};

function phoneOf(row: MemberRow): string | null {
  const admission = (row.admission ?? null) as Record<string, unknown> | null;
  const candidates = [
    row.profile?.phone,
    row.profile?.altPhone,
    row.profile?.whatsapp,
    admission && typeof admission === "object" ? admission.phone : null,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && phoneKeyOf(c).length >= 10) return c;
  }
  return null;
}

function toInput(row: MemberRow): DuplicateMemberInput {
  const admission = (row.admission ?? null) as Record<string, unknown> | null;
  return {
    studentId: row.id,
    userId: row.user?.id ?? "",
    name: row.user?.name ?? "",
    email: row.user?.email ?? "",
    passwordClaimed: row.user?.passwordClaimed ?? false,
    studentCode: row.studentCode,
    level: row.level,
    branchName: row.branch?.name ?? null,
    sessionSlot: row.sessionSlot,
    batch: batchFromAdmission(row.admission),
    phone: phoneOf(row),
    hasPhoto: Boolean(row.profile?.photoUrl || (admission && typeof admission.photoUrl === "string" && admission.photoUrl)),
    createdAt: row.createdAt.toISOString(),
    activity: {
      attendance: row._count.attendances,
      submissions: row._count.assignmentSubmissions,
      grades: row._count.grades,
      certificates: row._count.certificates,
      payments: row._count.payments,
      tuitionCharges: row._count.tuitionCharges,
    },
  };
}

export async function GET() {
  const gate = await requireCapability("students");
  if (!gate.ok) return gate.response;

  const tenantId = gate.session.user.tenantId ?? null;
  const where: Record<string, unknown> = { ...tenantWhere(tenantId) };
  const allowedBranchIds = scopedBranchIds(gate.admin);
  if (allowedBranchIds) where.branchId = { in: allowedBranchIds };

  try {
    const rows = (await prisma.student.findMany({
      where,
      take: MAX_STUDENTS,
      orderBy: { createdAt: "desc" },
      select: memberSelect,
    })) as unknown as MemberRow[];

    const clusters = buildClusters(rows.map(toInput));

    return NextResponse.json({
      clusters,
      scanned: rows.length,
      truncated: rows.length >= MAX_STUDENTS,
      pairs: clusters.length,
      mergeable: clusters.reduce((n, c) => n + c.mergeableIds.length, 0),
    });
  } catch (error) {
    console.error("Failed to scan for duplicates:", error);
    return NextResponse.json({ error: "Unable to scan for duplicates" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const gate = await requireCapability("students");
  if (!gate.ok) return gate.response;

  const tenantId = gate.session.user.tenantId ?? null;
  const body = await request.json().catch(() => ({}));
  const keeperId = typeof body.keeperId === "string" ? body.keeperId.trim() : "";
  const absorbId = typeof body.absorbId === "string" ? body.absorbId.trim() : "";

  if (!keeperId || !absorbId || keeperId === absorbId) {
    return NextResponse.json({ error: "Pick a keeper and a different duplicate." }, { status: 400 });
  }

  const where: Record<string, unknown> = { id: { in: [keeperId, absorbId] }, ...tenantWhere(tenantId) };
  const allowedBranchIds = scopedBranchIds(gate.admin);
  if (allowedBranchIds) where.branchId = { in: allowedBranchIds };

  try {
    const rows = (await prisma.student.findMany({ where, select: memberSelect })) as unknown as MemberRow[];
    const keeper = rows.find((r) => r.id === keeperId);
    const absorb = rows.find((r) => r.id === absorbId);

    if (!keeper || !absorb) {
      return NextResponse.json({ error: "One of those students is no longer on your roster." }, { status: 404 });
    }
    if (!keeper.user || !absorb.user) {
      return NextResponse.json({ error: "One of those students has no login to merge." }, { status: 409 });
    }

    // Re-check the pairing server-side: same normalised name AND same phone.
    const kIn = toInput(keeper);
    const aIn = toInput(absorb);
    if (
      normalizeName(kIn.name) !== normalizeName(aIn.name) ||
      phoneKeyOf(kIn.phone).length < 10 ||
      phoneKeyOf(kIn.phone) !== phoneKeyOf(aIn.phone)
    ) {
      return NextResponse.json(
        { error: "These two no longer match on name and phone — reload the list." },
        { status: 409 },
      );
    }

    // The duplicate must be a dead record, not a second real student.
    const c = absorb._count;
    if (c.attendances || c.assignmentSubmissions || c.grades || c.certificates) {
      return NextResponse.json(
        { error: "That duplicate has attendance or classwork. Merge this one by hand." },
        { status: 409 },
      );
    }

    const keeperAdmission = ((keeper.admission ?? {}) as Record<string, unknown>) || {};
    const absorbAdmission = ((absorb.admission ?? {}) as Record<string, unknown>) || {};
    const nowIso = new Date().toISOString();

    const moved = await prisma.$transaction(async (tx) => {
      // 1. The money and its scaffolding — the whole reason to do this.
      const payments = await tx.payment.updateMany({
        where: { studentId: absorb.id },
        data: { studentId: keeper.id },
      });
      const invoices = await tx.invoice.updateMany({
        where: { studentId: absorb.id },
        data: { studentId: keeper.id },
      });
      const plans = await tx.paymentPlan.updateMany({
        where: { studentId: absorb.id },
        data: { studentId: keeper.id },
      });

      // 2. Tuition charges — one per (student, level). Move the levels the
      //    keeper has no charge for; drop the duplicate's for a level the
      //    keeper already carries (the office reconciles the figure later).
      const keeperLevels = new Set(
        (await tx.tuitionCharge.findMany({ where: { studentId: keeper.id }, select: { level: true } })).map(
          (r) => r.level,
        ),
      );
      const absorbCharges = await tx.tuitionCharge.findMany({
        where: { studentId: absorb.id },
        select: { id: true, level: true },
      });
      let chargesMoved = 0;
      let chargesDropped = 0;
      for (const charge of absorbCharges) {
        if (keeperLevels.has(charge.level)) {
          await tx.tuitionCharge.delete({ where: { id: charge.id } });
          chargesDropped += 1;
        } else {
          await tx.tuitionCharge.update({ where: { id: charge.id }, data: { studentId: keeper.id } });
          keeperLevels.add(charge.level);
          chargesMoved += 1;
        }
      }

      // 3. Guardian links — one per (parent, student). Move the new ones,
      //    drop a link to a guardian the keeper already has.
      const keeperParents = new Set(
        (await tx.parentStudent.findMany({ where: { studentId: keeper.id }, select: { parentId: true } })).map(
          (r) => r.parentId,
        ),
      );
      const absorbLinks = await tx.parentStudent.findMany({
        where: { studentId: absorb.id },
        select: { id: true, parentId: true },
      });
      let guardiansMoved = 0;
      for (const link of absorbLinks) {
        if (keeperParents.has(link.parentId)) {
          await tx.parentStudent.delete({ where: { id: link.id } });
        } else {
          await tx.parentStudent.update({ where: { id: link.id }, data: { studentId: keeper.id } });
          guardiansMoved += 1;
        }
      }

      // 4. Fill the keeper's blanks from the duplicate — never overwrite.
      const keeperData: Record<string, unknown> = {};
      if (!keeper.branchId && absorb.branchId) keeperData.branchId = absorb.branchId;
      if (keeper.deliveryMode === "physical" && absorb.deliveryMode !== "physical") {
        keeperData.deliveryMode = absorb.deliveryMode;
      }
      const mergedAdmission: Record<string, unknown> = { ...absorbAdmission, ...keeperAdmission };
      if (!keeperAdmission.batch && absorbAdmission.batch) mergedAdmission.batch = absorbAdmission.batch;
      if (!keeperAdmission.phone && absorbAdmission.phone) mergedAdmission.phone = absorbAdmission.phone;
      const priorMerges = Array.isArray(keeperAdmission.mergedFrom) ? keeperAdmission.mergedFrom : [];
      mergedAdmission.mergedFrom = [
        ...priorMerges,
        {
          studentId: absorb.id,
          studentCode: absorb.studentCode ?? null,
          email: absorb.user.email,
          at: nowIso,
        },
      ];
      keeperData.admission = mergedAdmission;
      await tx.student.update({ where: { id: keeper.id }, data: keeperData });

      // Profile: move it wholesale if the keeper has none, else fill blanks.
      const keeperProfile = keeper.profile;
      const absorbProfile = absorb.profile;
      if (!keeperProfile && absorbProfile) {
        await tx.studentProfile.update({ where: { studentId: absorb.id }, data: { studentId: keeper.id } });
      } else if (keeperProfile && absorbProfile) {
        const fill: Record<string, unknown> = {};
        for (const key of ["phone", "altPhone", "whatsapp", "photoUrl"] as const) {
          if (!keeperProfile[key] && absorbProfile[key]) fill[key] = absorbProfile[key];
        }
        if (Object.keys(fill).length > 0) {
          await tx.studentProfile.update({ where: { studentId: keeper.id }, data: fill });
        }
      }

      // 5. Retire the duplicate. Marker first so it survives in the audit
      //    before-image, then the soft deletes free the name and the login.
      await tx.student.update({
        where: { id: absorb.id },
        data: {
          status: "merged",
          admission: {
            ...absorbAdmission,
            mergedInto: keeper.studentCode ?? keeper.id,
            mergedIntoId: keeper.id,
            mergedAt: nowIso,
          },
        },
      });
      await tx.student.delete({ where: { id: absorb.id } });
      await tx.user.delete({ where: { id: absorb.user.id } });

      return {
        payments: payments.count,
        invoices: invoices.count,
        paymentPlans: plans.count,
        chargesMoved,
        chargesDropped,
        guardiansMoved,
      };
    });

    await writeAudit(unguardedPrisma, {
      action: "update",
      model: "Student",
      recordId: keeper.id,
      affectedCount: 1,
      severity: "notice",
      summary:
        `Merged duplicate ${absorb.user.name ?? "student"} (${absorb.user.email}) into ` +
        `${keeper.user.name ?? "student"} (${keeper.user.email}) — ` +
        `${moved.payments} payment(s), ${moved.chargesMoved} charge(s), ${moved.guardiansMoved} guardian(s) moved`,
      after: { keeperId: keeper.id, absorbId: absorb.id, moved },
    });

    return NextResponse.json({ ok: true, keeperId: keeper.id, absorbId: absorb.id, moved });
  } catch (error) {
    console.error("Failed to merge duplicate students:", error);
    return NextResponse.json({ error: "Could not merge those records. Nothing was changed." }, { status: 500 });
  }
}
