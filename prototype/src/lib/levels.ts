export const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;
export type Level = (typeof LEVELS)[number];

/** The level a student moves up to after this one. C2 is the end of the ladder. */
export function nextLevelAfter(level: string): string | null {
  const i = (LEVELS as readonly string[]).indexOf((level || "A1").toUpperCase());
  if (i === -1 || i === LEVELS.length - 1) return null;
  return LEVELS[i + 1];
}
