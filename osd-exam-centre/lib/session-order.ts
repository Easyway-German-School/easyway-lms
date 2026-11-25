/**
 * Default display rank for a CEFR level — used when a sitting is created
 * (so A1 lands above B2 without the office having to drag it) and as a
 * tie-breaker when two sittings share a sortOrder.
 */
const LEVEL_RANK: Record<string, number> = {
  A1: 10,
  A2: 20,
  B1: 30,
  B2: 40,
  C1: 50,
  C2: 60,
};

export function defaultSortOrderForLevel(level: string): number {
  return LEVEL_RANK[level.trim().toUpperCase()] ?? 100;
}

/** Stable compare for sittings lists — sortOrder first, then level rank, then date. */
export function compareSessionsByDisplayOrder<T extends { sortOrder: number; level: string; startDate: Date | string }>(a: T, b: T): number {
  if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
  const la = defaultSortOrderForLevel(a.level);
  const lb = defaultSortOrderForLevel(b.level);
  if (la !== lb) return la - lb;
  return new Date(a.startDate).getTime() - new Date(b.startDate).getTime();
}
