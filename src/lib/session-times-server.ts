/**
 * The database side of session-times.ts — see that file for the shape and
 * the September-batch defaults.
 */

import { prisma } from "@/lib/prisma";
import { SESSION_TIMES_KEY, defaultSessionTimes, parseSessionTimes, type SessionTimes } from "@/lib/session-times";

export async function readSessionTimes(tenantId: string | null | undefined): Promise<SessionTimes> {
  if (!tenantId) return defaultSessionTimes();
  try {
    const row = await prisma.schoolSetting.findUnique({
      where: { tenantId_key: { tenantId, key: SESSION_TIMES_KEY } },
    });
    return parseSessionTimes(row?.value);
  } catch {
    return defaultSessionTimes();
  }
}
