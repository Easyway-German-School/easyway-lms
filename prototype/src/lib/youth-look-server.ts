/**
 * The database side of the look rollout — see youth-look.ts for what it is and
 * why. Kept apart so that file stays free of prisma and can be imported by
 * client components.
 */

import { prisma } from "@/lib/prisma";
import { ageFromDob, dobOfStudent } from "@/lib/age-bands";
import {
  DEFAULT_LOOK_WAVE,
  LOOK_WAVE_KEY,
  parseLookChoice,
  parseLookWave,
  resolveLook,
  type LookDecision,
  type LookWave,
} from "@/lib/youth-look";

/**
 * The school's current wave, or wave one if it has never been set. Never
 * throws — a request that cannot read this still gets an answer, just the
 * default one, which is the safe direction (fewest people moved).
 */
export async function readLookWave(tenantId: string | null | undefined): Promise<LookWave> {
  if (!tenantId) return DEFAULT_LOOK_WAVE;
  try {
    const row = await prisma.schoolSetting.findUnique({
      where: { tenantId_key: { tenantId, key: LOOK_WAVE_KEY } },
    });
    return parseLookWave(row?.value);
  } catch {
    return DEFAULT_LOOK_WAVE;
  }
}

/** What the rollout says for one student row loaded with the fields below. */
export async function decideLookForStudent(student: {
  tenantId: string | null;
  uiLook: string | null;
  admission: unknown;
  profile: { dateOfBirth: Date | null } | null;
}): Promise<LookDecision> {
  const wave = await readLookWave(student.tenantId);
  const age = ageFromDob(dobOfStudent(student.profile, student.admission));
  return resolveLook({ age, choice: parseLookChoice(student.uiLook), wave });
}
