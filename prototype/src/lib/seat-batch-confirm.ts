import { prisma } from "@/lib/prisma";
import { batchFromAdmission, monthNameToIndex, MONTH_NAMES } from "@/lib/batch";
import { readCurrentIntake } from "@/lib/intake-server";
import { KIND, notify } from "@/lib/notify";

/**
 * BECCA, ASKING BEFORE TOUCHING A SEAT.
 *
 * Triggered by the office for one student at a time (never a bulk scan) when
 * a held "keep my seat" batch looks implausible — Ruth Adelusi confirmed a
 * seat for a batch over a YEAR out (October 2027, held Nov 2026) while every
 * other held seat in the system sits within the next couple of months. That
 * is almost certainly a mistake, but it might not be, and silently moving
 * someone who meant it is worse than leaving a stale lock bug in place one
 * more day. So this never rewrites `admission.batch` itself — it only asks,
 * and `resolveSeatBatchConfirmation` below does the actual write, and only
 * once the student has answered.
 *
 * `admission.seatConfirm` is the one record of an open ask:
 *   { askedAt, heldMonth, heldYear, openMonth, openYear, resolution?, resolvedAt? }
 */

type SeatConfirmRecord = {
  askedAt: string;
  heldMonth: string;
  heldYear: number;
  openMonth: string;
  openYear: number;
  resolution?: "confirmed" | "mistake";
  resolvedAt?: string;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? { ...(value as Record<string, unknown>) } : {};
}

function readSeatConfirm(admission: Record<string, unknown>): SeatConfirmRecord | null {
  const raw = admission.seatConfirm;
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.askedAt !== "string" || typeof r.heldMonth !== "string" || typeof r.heldYear !== "number") return null;
  if (typeof r.openMonth !== "string" || typeof r.openYear !== "number") return null;
  return r as unknown as SeatConfirmRecord;
}

/**
 * Sends the ask. No-op (returns null) if there is already an unresolved ask
 * pending, or if the student's held batch does not actually have a year on
 * it yet (nothing to confirm).
 */
export async function askSeatBatchConfirmation(studentId: string): Promise<SeatConfirmRecord | null> {
  const student = await prisma.student.findUnique({
    where: { id: studentId },
    select: { id: true, level: true, admission: true, tenantId: true, user: { select: { name: true, email: true } } },
  });
  if (!student) return null;

  const admission = asRecord(student.admission);
  const existing = readSeatConfirm(admission);
  if (existing && !existing.resolution) return existing;

  const heldMonthLabel = batchFromAdmission(student.admission);
  const heldMonthIndex = monthNameToIndex(heldMonthLabel);
  const heldYear = typeof admission.batchYear === "number" ? admission.batchYear : null;
  if (heldMonthIndex === null || heldYear === null) return null;

  const open = await readCurrentIntake(student.tenantId ?? null);

  const record: SeatConfirmRecord = {
    askedAt: new Date().toISOString(),
    heldMonth: MONTH_NAMES[heldMonthIndex],
    heldYear,
    openMonth: open.month,
    openYear: open.year,
  };

  await prisma.student.update({
    where: { id: studentId },
    data: { admission: { ...admission, seatConfirm: record } as never },
  });

  const name = student.user.name || student.user.email;
  await notify({
    to: { studentIds: [studentId] },
    kind: KIND.seatBatchConfirm,
    severity: "warning",
    title: `Please confirm your ${student.level} seat`,
    message:
      `You asked to keep your seat in ${student.level} for the ${record.heldMonth} ${record.heldYear} batch — ` +
      `that is quite a way off, so I want to check it's really what you meant before I lock it in. ` +
      `If that's right, say so and I'll hold it. If it was a mix-up, I can move you into the ` +
      `${record.openMonth} ${record.openYear} batch instead, which is open now.`,
    link: "/next-level",
  });

  await notify({
    to: { audience: "admin", capability: "students" },
    kind: KIND.seatBatchConfirm,
    severity: "info",
    title: `Asked ${name} to confirm their ${record.heldMonth} ${record.heldYear} seat`,
    message: `Their held batch (${record.heldMonth} ${record.heldYear}) is unusually far out. Becca has asked them to confirm it or move to the open ${record.openMonth} ${record.openYear} batch.`,
    link: `/admin/students/${studentId}`,
  });

  return record;
}

/** What the student currently has open to answer, or null if nothing is pending. */
export async function pendingSeatBatchConfirmation(
  studentId: string,
): Promise<{ level: string; held: { month: string; year: number }; open: { month: string; year: number } } | null> {
  const student = await prisma.student.findUnique({
    where: { id: studentId },
    select: { level: true, admission: true },
  });
  if (!student) return null;
  const record = readSeatConfirm(asRecord(student.admission));
  if (!record || record.resolution) return null;
  return {
    level: student.level,
    held: { month: record.heldMonth, year: record.heldYear },
    open: { month: record.openMonth, year: record.openYear },
  };
}

/**
 * The student's answer. "confirmed" writes the held batch back onto
 * `admission.batch` YEAR-QUALIFIED (so the portal lock in
 * batch-reservation.ts reads it correctly and actually counts down to it).
 * "mistake" moves them onto the currently open batch and unlocks their
 * portal immediately, the same way an ordinary already-running student
 * reads — they picked the batch that got them here, so a resubmission
 * shouldn't feel like a new application.
 */
export async function resolveSeatBatchConfirmation(
  studentId: string,
  decision: "confirmed" | "mistake",
): Promise<{ ok: true; decision: "confirmed" | "mistake" } | { ok: false; reason: string }> {
  const student = await prisma.student.findUnique({
    where: { id: studentId },
    select: { id: true, level: true, admission: true, user: { select: { name: true, email: true } } },
  });
  if (!student) return { ok: false, reason: "not_found" };

  const admission = asRecord(student.admission);
  const record = readSeatConfirm(admission);
  if (!record || record.resolution) return { ok: false, reason: "nothing_pending" };

  const now = new Date();
  const resolved: SeatConfirmRecord = { ...record, resolution: decision, resolvedAt: now.toISOString() };

  if (decision === "confirmed") {
    await prisma.student.update({
      where: { id: studentId },
      data: {
        admission: {
          ...admission,
          batch: `${record.heldMonth} ${record.heldYear}`,
          batchYear: record.heldYear,
          seatConfirm: resolved,
        } as never,
      },
    });
  } else {
    await prisma.student.update({
      where: { id: studentId },
      data: {
        admission: { ...admission, batch: record.openMonth, batchYear: record.openYear, seatConfirm: resolved } as never,
        classesStartedAt: now,
        startConfirmedAt: now,
        startConfirmedVia: "seat-confirm",
        startPromptSnoozedUntil: null,
      },
    });
    await prisma.studentEnrolment
      .updateMany({
        where: { studentId, outcome: "ongoing", deletedAt: null },
        data: { batchMonth: record.openMonth, batchYear: record.openYear, startedAt: now },
      })
      .catch(() => undefined);
  }

  const name = student.user.name || student.user.email;
  await notify({
    to: { audience: "admin", capability: "students" },
    kind: KIND.seatBatchConfirm,
    severity: "success",
    title:
      decision === "confirmed"
        ? `${name} confirmed their ${record.heldMonth} ${record.heldYear} seat`
        : `${name} said their ${record.heldMonth} ${record.heldYear} seat was a mistake`,
    message:
      decision === "confirmed"
        ? `Their ${student.level} portal is now locked to the ${record.heldMonth} ${record.heldYear} batch, as they confirmed.`
        : `Moved onto the open ${record.openMonth} ${record.openYear} batch and unlocked — they said the far-out date was a mix-up.`,
    link: `/admin/students/${studentId}`,
  });

  return { ok: true, decision };
}
