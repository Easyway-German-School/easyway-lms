export const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;
export type Level = (typeof LEVELS)[number];

/**
 * How long one level runs. Lives here rather than in `promotion.ts` because
 * client code needs it too (the checkout spreads the fee over the teaching
 * weeks) and `promotion.ts` imports prisma, which cannot cross into the browser.
 */
export const SESSION_MONTHS = 2;

/** Weeks of teaching in one level, used to express tuition per week. */
export const WEEKS_OF_TEACHING = SESSION_MONTHS * 4;

/** The level a student moves up to after this one. C2 is the end of the ladder. */
export function nextLevelAfter(level: string): string | null {
  const i = (LEVELS as readonly string[]).indexOf((level || "A1").toUpperCase());
  if (i === -1 || i === LEVELS.length - 1) return null;
  return LEVELS[i + 1];
}
