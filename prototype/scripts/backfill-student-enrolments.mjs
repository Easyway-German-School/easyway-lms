/**
 * Reconstructs `StudentEnrolment` history for every student who predates the
 * table — see the model's doc comment in schema.prisma and
 * src/lib/student-enrolment.ts for why it exists.
 *
 * WHAT IT CAN AND CANNOT KNOW. `TuitionCharge` rows are the only per-level
 * trail that survived the old "overwrite `Student.level`" design — one charge
 * per level a student was ever billed for, in the order they were raised.
 * From that this script reconstructs: which levels a student passed through,
 * roughly when (the charge's `createdAt`), and what each cost
 * (`feeSnapshot`). It CANNOT know their branch or tutor at each past level —
 * those were never recorded per-level, only as the single current value on
 * `Student` — so closed rows use the student's CURRENT branch/session/class
 * type/delivery mode as the best available approximation, clearly not fact.
 * A student with no charges at all (never billed — an old fixture, a fully
 * comped account) gets a single `ongoing` row for their current level and
 * nothing invented before it.
 *
 * Idempotent: only students with zero StudentEnrolment rows are touched, so
 * re-running after some students have already been promoted (and so already
 * have real history) is a no-op for them.
 *
 *   node scripts/backfill-student-enrolments.mjs
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const CHUNK = 100;

function batchFromAdmission(admission) {
  if (!admission || typeof admission !== "object") return null;
  const value = admission.batch;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function main() {
  let created = 0;
  let studentsBackfilled = 0;
  let skipped = 0;

  while (true) {
    const batch = await prisma.student.findMany({
      where: { enrolments: { none: {} } },
      take: CHUNK,
      select: {
        id: true,
        level: true,
        branchId: true,
        tutorId: true,
        sessionSlot: true,
        classType: true,
        deliveryMode: true,
        admission: true,
        createdAt: true,
        updatedAt: true,
        tenantId: true,
      },
      orderBy: { createdAt: "asc" },
    });
    if (batch.length === 0) break;

    for (const student of batch) {
      try {
        const charges = await prisma.tuitionCharge.findMany({
          where: { studentId: student.id, deletedAt: null, legacyArrears: false },
          orderBy: { createdAt: "asc" },
          select: { id: true, level: true, amount: true, createdAt: true },
        });

        // One row per distinct level, oldest charge for that level wins —
        // a student can carry more than one charge per level (a top-up, a
        // correction), and this is reconstructing LEVELS, not charges.
        const byLevel = new Map();
        for (const charge of charges) {
          if (!byLevel.has(charge.level)) byLevel.set(charge.level, charge);
        }
        const orderedCharges = [...byLevel.values()].sort(
          (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
        );

        const rows = [];
        for (let i = 0; i < orderedCharges.length; i++) {
          const charge = orderedCharges[i];
          const next = orderedCharges[i + 1];
          const isCurrent = charge.level === student.level && !next;
          rows.push({
            studentId: student.id,
            level: charge.level,
            branchId: student.branchId,
            tutorId: isCurrent ? student.tutorId : null,
            sessionSlot: student.sessionSlot,
            classType: student.classType,
            deliveryMode: student.deliveryMode,
            batchMonth: isCurrent ? batchFromAdmission(student.admission) : null,
            batchYear: charge.createdAt.getFullYear(),
            startedAt: charge.createdAt,
            endedAt: isCurrent ? null : (next ? next.createdAt : student.updatedAt),
            outcome: isCurrent ? "ongoing" : "completed",
            outcomeNote: isCurrent ? null : "Reconstructed from tuition-charge history",
            tuitionChargeId: charge.id,
            feeSnapshot: charge.amount,
            tenantId: student.tenantId,
          });
        }

        // No charges at all, or the student's current level never got one
        // (a manual add with the charge step skipped) — still give them the
        // one row that is definitely true: they are ongoing at their current
        // level, right now.
        if (!rows.some((row) => row.outcome === "ongoing")) {
          rows.push({
            studentId: student.id,
            level: student.level,
            branchId: student.branchId,
            tutorId: student.tutorId,
            sessionSlot: student.sessionSlot,
            classType: student.classType,
            deliveryMode: student.deliveryMode,
            batchMonth: batchFromAdmission(student.admission),
            batchYear: student.createdAt.getFullYear(),
            startedAt: student.createdAt,
            endedAt: null,
            outcome: "ongoing",
            outcomeNote: null,
            tuitionChargeId: null,
            feeSnapshot: null,
            tenantId: student.tenantId,
          });
        }

        if (rows.length > 0) {
          await prisma.studentEnrolment.createMany({ data: rows });
          created += rows.length;
          studentsBackfilled += 1;
        }
      } catch (error) {
        console.error(`Failed to backfill enrolments for student ${student.id}:`, error);
        skipped += 1;
      }
    }

    console.log(`Backfilled ${studentsBackfilled} students / ${created} enrolment rows so far (${skipped} skipped)…`);
  }

  console.log(`Done. ${studentsBackfilled} students, ${created} StudentEnrolment rows created, ${skipped} skipped.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
