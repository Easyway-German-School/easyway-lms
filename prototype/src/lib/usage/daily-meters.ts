import { guardedPrisma } from "@/lib/prisma";
import { recordUsage } from "@/lib/usage/record";

/**
 * The two meters that are not events.
 *
 * Tokens, emails and API calls each happen at a moment and are recorded when
 * they do. Storage and active students are not like that — they are answers to
 * "how much, right now", and the only honest way to bill them is to ask once a
 * day and record the answer as that day's reading. A meter reading, in the
 * literal sense.
 *
 * Both are keyed on the day, so running the job twice restates the same reading
 * rather than adding a second one.
 */

const BYTES_PER_GB = 1024 ** 3;

/**
 * What each school is keeping in the bucket, charged per gigabyte-month.
 *
 * Recorded as a THIRTIETH of the stored amount each day, so a month of daily
 * readings sums to roughly one gigabyte-month per stored gigabyte. Charging the
 * full amount daily would bill thirty times the rate; charging once a month
 * would mean a school that uploaded on the 2nd and deleted on the 3rd either
 * pays for the whole month or nothing at all, depending on which day the job
 * happened to run.
 *
 * The quantity is in megabyte-thirtieths rather than gigabytes so the integer
 * does not round a small school's storage down to zero — the meter converts.
 */
export async function meterStorage(): Promise<{ tenants: number; totalGb: number }> {
  const day = new Date().toISOString().slice(0, 10);

  const [recordings, materials] = await Promise.all([
    guardedPrisma.classRecording.groupBy({
      by: ["tenantId"],
      _sum: { sizeBytes: true },
    }),
    guardedPrisma.material.groupBy({
      by: ["tenantId"],
      _sum: { fileSize: true },
    }),
  ]);

  const bytesByTenant = new Map<string, number>();
  for (const row of recordings) {
    if (!row.tenantId) continue;
    bytesByTenant.set(row.tenantId, (bytesByTenant.get(row.tenantId) ?? 0) + Number(row._sum.sizeBytes ?? 0));
  }
  for (const row of materials) {
    if (!row.tenantId) continue;
    bytesByTenant.set(row.tenantId, (bytesByTenant.get(row.tenantId) ?? 0) + Number(row._sum.fileSize ?? 0));
  }

  let totalGb = 0;
  let counted = 0;

  for (const [tenantId, bytes] of bytesByTenant) {
    const gb = bytes / BYTES_PER_GB;
    totalGb += gb;

    /**
     * Rounded to the nearest thousandth of a gigabyte-month, expressed as an
     * integer so the ledger never holds a float. The meter's `per` is 1
     * gigabyte, so the rollup divides this back down.
     */
    const thousandths = Math.round((gb / 30) * 1000);
    if (thousandths <= 0) continue;

    const result = await recordUsage({
      tenantId,
      meter: "storage.gb_month",
      quantity: thousandths,
      sourceId: `storage:${tenantId}:${day}`,
      metadata: { bytes, gigabytes: Number(gb.toFixed(3)), reading: day },
    });
    if (result.recorded) counted += 1;
  }

  return { tenants: counted, totalGb: Number(totalGb.toFixed(3)) };
}

/**
 * Distinct students who did anything at all this calendar month.
 *
 * The fairest headline number for a school and the one they can predict — a
 * term with three hundred students costs what three hundred students cost,
 * whether or not somebody left a video playing.
 *
 * "Did anything" is deliberately generous: attended, submitted, was marked, or
 * watched. A student who only ever appears on the register is still a student
 * the platform is carrying — records, notifications, storage, a portal login —
 * and pretending otherwise would make the number smaller and the pricing
 * dishonest.
 *
 * Recorded as a DELTA against what has already been billed this month, so the
 * daily run adds only students who were not counted yesterday. Recording the
 * running total each day would bill the same student once per day.
 */
export async function meterActiveStudents(): Promise<{ tenants: number; students: number }> {
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const month = monthStart.toISOString().slice(0, 7);

  const tenants = await guardedPrisma.tenant.findMany({
    where: { status: "active" },
    select: { id: true },
  });

  let totalStudents = 0;
  let counted = 0;

  for (const tenant of tenants) {
    const [attendance, submissions, progress] = await Promise.all([
      guardedPrisma.attendance.findMany({
        where: { tenantId: tenant.id, date: { gte: monthStart } },
        select: { studentId: true },
        distinct: ["studentId"],
      }),
      guardedPrisma.assignmentSubmission.findMany({
        where: { tenantId: tenant.id, createdAt: { gte: monthStart } },
        select: { studentId: true },
        distinct: ["studentId"],
      }),
      guardedPrisma.videoProgress.findMany({
        where: { tenantId: tenant.id, updatedAt: { gte: monthStart } },
        select: { studentId: true },
        distinct: ["studentId"],
      }),
    ]);

    const active = new Set<string>();
    for (const row of [...attendance, ...submissions, ...progress]) {
      if (row.studentId) active.add(row.studentId);
    }
    if (active.size === 0) continue;

    /**
     * How many were already billed this month. The meter is monotonic within a
     * month — a student who was active on the 3rd stays counted — so the delta
     * is the only thing that should be added today.
     */
    const already = await guardedPrisma.usageEvent.aggregate({
      where: {
        tenantId: tenant.id,
        meter: "students.active_monthly",
        occurredAt: { gte: monthStart },
      },
      _sum: { quantity: true },
    });

    const delta = active.size - (already._sum.quantity ?? 0);
    if (delta <= 0) continue;

    const result = await recordUsage({
      tenantId: tenant.id,
      meter: "students.active_monthly",
      quantity: delta,
      sourceId: `active:${tenant.id}:${month}:${now.toISOString().slice(0, 10)}`,
      metadata: { month, totalActive: active.size, addedToday: delta },
    });

    if (result.recorded) {
      counted += 1;
      totalStudents += delta;
    }
  }

  return { tenants: counted, students: totalStudents };
}
