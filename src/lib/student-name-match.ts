import { editDistance } from "@/lib/fuzzy-match";

/**
 * Finding a learner from a name somebody typed or pasted.
 *
 * The office hands over lists like "Onyema-Isichie Adaobi / Jimoh Ethel" — no
 * ids, the order of first and last name is whatever the sender felt like, and a
 * hyphen or a stray "Mr" comes with it. The roster stores names however the
 * signup form or the import sheet wrote them ("Agwazie Chioma Patience",
 * "Chioma Chidera Obichukwu A2 PHYSICAL MORNING CLASS Stream 1 …").
 *
 * So: compare bags of words, in any order, forgiving one typo in a longer word.
 * Every word the sender gave must be found in the stored name — a stored name
 * with EXTRA words is fine (middle names, class notes), a missing word is not.
 * That keeps "Jimoh Ethel" from matching every Ethel.
 */

export function nameTokens(value: string): string[] {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((token) => token.length >= 2);
}

function tokenScore(want: string, have: string[]): number {
  let best = 0;
  for (const candidate of have) {
    if (candidate === want) return 1;
    if (want.length >= 5 && candidate.length >= 5 && editDistance(want, candidate, 1) <= 1) best = Math.max(best, 0.85);
    else if (want.length >= 4 && (candidate.startsWith(want) || want.startsWith(candidate)) && Math.min(want.length, candidate.length) >= 4) {
      best = Math.max(best, 0.7);
    }
  }
  return best;
}

/** 0 = not a match. Otherwise 0..1, 1 being every word found exactly. */
export function nameMatchScore(query: string, storedName: string): number {
  const want = nameTokens(query);
  const have = nameTokens(storedName);
  if (want.length === 0 || have.length === 0) return 0;

  let total = 0;
  for (const token of want) {
    const score = tokenScore(token, have);
    if (score === 0) return 0; // every word asked for must be found
    total += score;
  }
  // A single-word query is too loose to trust on its own.
  if (want.length === 1) return total * 0.6;
  return total / want.length;
}

export type NameCandidate<T> = { item: T; score: number };

export function rankNameMatches<T>(
  query: string,
  pool: T[],
  nameOf: (item: T) => string,
  limit = 5,
): Array<NameCandidate<T>> {
  return pool
    .map((item) => ({ item, score: nameMatchScore(query, nameOf(item)) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
