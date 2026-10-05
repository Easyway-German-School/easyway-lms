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
  isInviteAge,
  parseLookChoice,
  parseLookWave,
  promptFor,
  resolveLook,
  type LookDecision,
  type LookWave,
  type PhoneUsage,
} from "@/lib/youth-look";

/** How far back "recent" reaches when judging whether somebody lives on their phone. */
export const USAGE_WINDOW_DAYS = 30;

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

/**
 * One student's recent phone usage, from the same activity events the
 * learner-behaviour profile is built on. Never throws: no usage data just
 * means "no evidence", which resolves to the classic cohort.
 */
export async function readPhoneUsage(userId: string): Promise<PhoneUsage | null> {
  try {
    const since = new Date(Date.now() - USAGE_WINDOW_DAYS * 86_400_000);
    const rows = await prisma.learnerUsageEvent.groupBy({
      by: ["deviceKind"],
      where: { userId, occurredAt: { gte: since } },
      _count: { _all: true },
    });
    let events = 0;
    let mobileEvents = 0;
    for (const row of rows) {
      events += row._count._all;
      if (row.deviceKind === "mobile") mobileEvents += row._count._all;
    }
    return { events, mobileEvents };
  } catch {
    return null;
  }
}

export type StudentForLook = {
  tenantId: string | null;
  uiLook: string | null;
  lookPromptedAt: Date | null;
  admission: unknown;
  profile: { dateOfBirth: Date | null } | null;
};

/** What the rollout says for one student, plus whether Becca should speak up. */
export async function decideLookForStudent(
  student: StudentForLook,
  userId: string,
): Promise<LookDecision & { prompt: "announce" | "invite" | null }> {
  const wave = await readLookWave(student.tenantId);
  const age = ageFromDob(dobOfStudent(student.profile, student.admission));
  const choice = parseLookChoice(student.uiLook);

  // Phone usage is only worth a query for the one age band it can change the answer for.
  const usage = !choice && isInviteAge(age, wave) ? await readPhoneUsage(userId) : null;

  const decision = resolveLook({ age, choice, wave, usage });
  return { ...decision, prompt: promptFor(decision, student.lookPromptedAt !== null) };
}
