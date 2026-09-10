/**
 * The database side of the class-sessions setting — see school-settings.ts for
 * the shape and the "where does a stranded student go" arithmetic.
 *
 * One read, used by every surface that has to agree on which sittings and
 * modes a school runs: the public sign-up form (via /api/school/sessions), the
 * community's space resolver, and the sign-up route's server-side guard. Kept
 * apart from school-settings.ts so that file stays free of prisma and can be
 * imported by client code.
 */

import { prisma } from "@/lib/prisma";
import {
  CLASS_SESSIONS_KEY,
  defaultSessionSettings,
  parseSessionSettings,
  type SessionSettings,
} from "@/lib/school-settings";

/**
 * The school's configured sittings/modes, or "everything runs" if it has never
 * opened the settings screen. Never throws — a surface that cannot read this
 * should behave as it did before the screen existed, not fall over.
 */
export async function readSessionSettings(
  tenantId: string | null | undefined,
): Promise<SessionSettings> {
  if (!tenantId) return defaultSessionSettings();
  try {
    const row = await prisma.schoolSetting.findUnique({
      where: { tenantId_key: { tenantId, key: CLASS_SESSIONS_KEY } },
    });
    return parseSessionSettings(row?.value);
  } catch {
    return defaultSessionSettings();
  }
}
