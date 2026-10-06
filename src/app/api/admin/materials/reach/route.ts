import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCapability } from "@/lib/admin-roles";
import { COURSE_LEVELS, SESSION_SLOTS } from "@/lib/lecturer-assignment";
import { batchOfAdmission, canonicalBatch, compareBatches } from "@/lib/class-batch";

export const dynamic = "force-dynamic";

/**
 * "Who would this upload reach?" — answered BEFORE the office presses upload.
 *
 * The upload form lets an admin aim a material at a level and optionally one
 * branch, one sitting and one batch. Left to guess, an admin picks "October" for
 * a class that has no October students, or leaves the batch on "All" and reaches
 * both. This counts the real students behind the choice and lists the batches
 * that actually exist in it, so the form can offer only those and say "9
 * students" before anything is sent.
 *
 * Same students `studentIdsForMaterial` would notify: active, not deleted, at the
 * level, in the branch / sitting when named, and — when a batch is named — in
 * that batch exactly.
 */
export async function GET(req: NextRequest) {
  const gate = await requireCapability("materials");
  if (!gate.ok) return gate.response;

  const params = req.nextUrl.searchParams;
  const level = String(params.get("level") ?? "").toUpperCase();
  if (!(COURSE_LEVELS as readonly string[]).includes(level)) {
    return NextResponse.json({ error: "Choose a level first." }, { status: 400 });
  }
  const branchId = String(params.get("branchId") ?? "").trim() || null;
  const sessionSlot = (SESSION_SLOTS as readonly string[]).includes(String(params.get("sessionSlot")))
    ? String(params.get("sessionSlot"))
    : null;
  const batch = canonicalBatch(params.get("batch"));

  const students = await prisma.student.findMany({
    where: {
      level,
      status: "active",
      deletedAt: null,
      ...(branchId ? { branchId } : {}),
      ...(sessionSlot ? { sessionSlot } : {}),
    },
    select: { admission: true },
  });

  const counts = new Map<string, number>();
  let unplaced = 0;
  for (const student of students) {
    const own = batchOfAdmission(student.admission);
    if (!own) unplaced += 1;
    else counts.set(own, (counts.get(own) ?? 0) + 1);
  }

  const reached = batch ? counts.get(batch) ?? 0 : students.length;

  return NextResponse.json({
    /** Students the chosen audience reaches right now. */
    students: reached,
    /** Every active student in the level / branch / sitting, whatever the batch. */
    inCohort: students.length,
    /** The batches that really exist here, September before October, with their sizes. */
    batches: [...counts.entries()]
      .map(([name, count]) => ({ batch: name, students: count }))
      .sort((a, b) => compareBatches(a.batch, b.batch)),
    /** Students with no batch on record — reached only by an upload with no batch chosen. */
    unplaced,
  });
}
