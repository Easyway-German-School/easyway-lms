/**
 * The database side of the current-intake setting — see intake.ts for what it
 * is and why.
 *
 * One read, used by every doorway that creates a student (the public sign-up,
 * the office Add-student form, the CSV import) to fill in a batch month the
 * person did not choose. Kept apart from intake.ts so that file stays free of
 * prisma and can be imported by client code.
 */

import { prisma } from "@/lib/prisma";
import {
  CURRENT_INTAKE_KEY,
  defaultCurrentIntake,
  parseCurrentIntake,
  INTAKE_START_DAYS_KEY,
  parseIntakeStartDayOverrides,
  type CurrentIntake,
  type IntakeStartDayOverrides,
} from "@/lib/intake";

/**
 * The school's current intake, or the current calendar month if it has never
 * been set. Never throws — a doorway that cannot read this still creates the
 * student, just with the month we are in.
 */
export async function readCurrentIntake(tenantId: string | null | undefined): Promise<CurrentIntake> {
  if (!tenantId) return defaultCurrentIntake();
  try {
    const row = await prisma.schoolSetting.findUnique({
      where: { tenantId_key: { tenantId, key: CURRENT_INTAKE_KEY } },
    });
    return parseCurrentIntake(row?.value);
  } catch {
    return defaultCurrentIntake();
  }
}

/**
 * The batch month a new student gets when they did not pick one. Callers store
 * this straight onto `admission.batch`, which is a bare month name — the year
 * is implied by the student's registration date (see resolveBatchAbsolute).
 */
export async function defaultBatchMonth(tenantId: string | null | undefined): Promise<string> {
  return (await readCurrentIntake(tenantId)).month;
}

/**
 * Which specific months open off the 1st — see lib/intake.ts. Never throws;
 * an unreadable row just means every batch opens on the 1st, same as before
 * this existed.
 */
export async function readIntakeStartDayOverrides(
  tenantId: string | null | undefined,
): Promise<IntakeStartDayOverrides> {
  if (!tenantId) return {};
  try {
    const row = await prisma.schoolSetting.findUnique({
      where: { tenantId_key: { tenantId, key: INTAKE_START_DAYS_KEY } },
    });
    return parseIntakeStartDayOverrides(row?.value);
  } catch {
    return {};
  }
}

/**
 * Set (or, with `day: null`, clear) one month's override. Returns the full
 * map afterwards so the caller can respond with the up-to-date list.
 */
export async function writeIntakeStartDayOverride(
  tenantId: string,
  monthKey: string,
  day: number | null,
): Promise<IntakeStartDayOverrides> {
  const current = await readIntakeStartDayOverrides(tenantId);
  const next = { ...current };
  if (day === null) delete next[monthKey];
  else next[monthKey] = day;

  await prisma.schoolSetting.upsert({
    where: { tenantId_key: { tenantId, key: INTAKE_START_DAYS_KEY } },
    update: { value: next },
    create: { tenantId, key: INTAKE_START_DAYS_KEY, value: next },
  });
  return next;
}
