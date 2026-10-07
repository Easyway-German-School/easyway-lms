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
  promptFor,
  resolveLook,
  type Look,
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

export type StudentForLook = {
  tenantId: string | null;
  uiLook: string | null;
  lookPromptedAt: Date | null;
  createdAt: Date | null;
  admission: unknown;
  profile: { dateOfBirth: Date | null } | null;
};

/** What the rollout says for one student, plus whether Becca should speak up. */
export async function decideLookForStudent(
  student: StudentForLook,
): Promise<LookDecision & { prompt: "announce" | "invite" | null }> {
  const wave = await readLookWave(student.tenantId);
  const age = ageFromDob(dobOfStudent(student.profile, student.admission));
  const choice = parseLookChoice(student.uiLook);

  const decision = resolveLook({ age, choice, wave });
  return { ...decision, prompt: promptFor(decision, student.lookPromptedAt !== null) };
}

/**
 * A look decision worth counting — the invitation appearing, someone taking it
 * or declining it, switching in either direction. Written server-side rather
 * than from a click handler so a blocked tracker or a closed tab cannot lose
 * the single most important number in the rollout: how many people said yes.
 *
 * `detail` is a label this code chose (never anything typed). Best-effort and
 * respectful of the analytics opt-out: it can never make a switch fail.
 */
export async function recordLookEvent(input: {
  userId: string;
  tenantId: string | null;
  detail: string;
  look: Look;
}): Promise<void> {
  try {
    const user = await prisma.user.findUnique({ where: { id: input.userId }, select: { analyticsOptOutAt: true } });
    if (!user || user.analyticsOptOutAt) return;
    const now = new Date();
    await prisma.learnerUsageEvent.create({
      data: {
        userId: input.userId,
        tenantId: input.tenantId,
        area: "look",
        action: "complete",
        detail: input.detail.slice(0, 120),
        look: input.look,
        // Server clock on purpose: this row is about a decision, not about when in
        // the learner's day it happened, so it carries no hour/weekday rhythm.
        occurredAt: now,
      },
    });
  } catch (error) {
    console.error("[look] could not record look event", error);
  }
}

/** The full look decision for a roster row — look, why, cohort, and the age it was decided from. */
export function lookDecisionOfRow(
  row: { uiLook: string | null; admission: unknown; profile: { dateOfBirth: Date | null } | null },
  wave: LookWave,
  now = new Date(),
): LookDecision & { age: number | null } {
  const age = ageFromDob(dobOfStudent(row.profile, row.admission), now);
  return { ...resolveLook({ age, choice: parseLookChoice(row.uiLook), wave }), age };
}

/** Which look each of these students is actually seeing — for analytics only, never shown by name. */
export function lookOfRow(
  row: { uiLook: string | null; admission: unknown; profile: { dateOfBirth: Date | null } | null },
  wave: LookWave,
  now = new Date(),
): Look {
  return lookDecisionOfRow(row, wave, now).look;
}
