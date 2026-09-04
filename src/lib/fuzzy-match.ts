/**
 * Matching what an admin typed against what the school actually has.
 *
 * ---------------------------------------------------------------------------
 * THE BUG THIS EXISTS TO KILL
 *
 * A spreadsheet of twenty students imported five. The other fifteen failed on
 * one word: the file said `portharcourt` and the branch is called
 * `Port Harcourt`. The importer did `branchByName.get(name.toLowerCase())`,
 * an exact lookup, so a missing space was indistinguishable from a branch that
 * does not exist. The admin got fifteen red rows and no idea why.
 *
 * That is not an admin making a mistake. `portharcourt`, `Port-Harcourt`,
 * `PORT HARCOURT` and `port harcourt ` are the same place to every human who
 * will ever use this product, and a system that disagrees is the one that is
 * wrong.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS NOT AI, EVEN THOUGH THERE IS A MODEL IN THE BUILDING
 *
 * Reaching for Ollama here is the obvious move and the worse one. Matching
 * free text against a KNOWN, SHORT list — five branches, six levels, three
 * sittings, twelve months — is a solved problem that string distance does
 * perfectly, in microseconds, with the same answer every time. A local model
 * would take fifty seconds per row, produce a different answer on Tuesday than
 * on Monday, and can invent a branch that does not exist. On a five-hundred
 * row import those are not trade-offs, they are disqualifications.
 *
 * The model earns its place where the answer is not in a list — reading a
 * question, drafting a message, summarising a document. Here the answer is
 * always one of five strings, and the job is to find which one.
 *
 * ---------------------------------------------------------------------------
 * IT NEVER GUESSES SILENTLY
 *
 * Every correction is returned with the row so the preview can show
 * `portharcourt → Port Harcourt`. An importer that quietly reinterprets your
 * data is worse than one that rejects it: the rejection you notice.
 * `confident` marks the difference between "these are obviously the same
 * string" and "this is my best guess" — callers can accept the first
 * automatically and put the second in front of a person.
 */

/**
 * Everything a human would consider decorative, removed.
 *
 * Spaces, hyphens, apostrophes, full stops and case all go, so `Port Harcourt`,
 * `portharcourt`, `PORT-HARCOURT` and `Port.Harcourt` collapse to one key.
 * Accents are folded too — a tutor typing `Köln` and an export writing `Koln`
 * must land on the same branch.
 */
export function normaliseKey(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Levenshtein distance, iterative with two rows.
 *
 * Bounded by `max`: once every value in a row exceeds it the strings cannot
 * come back under the threshold, so it bails. Import files are long and this
 * runs per candidate per row.
 */
export function editDistance(a: string, b: string, max = Infinity): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  let current = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    let rowMin = current[0];

    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
      if (current[j] < rowMin) rowMin = current[j];
    }

    if (rowMin > max) return max + 1;
    [previous, current] = [current, previous];
  }

  return previous[b.length];
}

export type Match<T> = {
  value: T;
  /** What the file said. */
  input: string;
  /** The canonical string it resolved to. */
  label: string;
  /**
   * True when the two are the same once decoration is stripped — a certain
   * match a caller can accept without asking anybody.
   */
  confident: boolean;
  /** Set when the input was not already the canonical spelling. */
  corrected: boolean;
};

/**
 * The closest candidate, or null when nothing is close enough.
 *
 * Order of attempts, strictest first:
 *   1. identical once normalised            → confident   ("portharcourt")
 *   2. one contains the other, and the
 *      shorter is at least 4 characters     → confident   ("lagos" vs "lagos main")
 *   3. edit distance within the tolerance    → best guess  ("port harcout")
 *
 * The tolerance scales with length because one wrong letter in a four-letter
 * word is a different word, while two wrong letters in "Port Harcourt" is
 * still obviously Port Harcourt.
 */
export function bestMatch<T>(
  input: string,
  candidates: Array<{ value: T; label: string; aliases?: string[] }>,
): Match<T> | null {
  const raw = input.trim();
  if (!raw) return null;

  const needle = normaliseKey(raw);
  if (!needle) return null;

  type Scored = { candidate: (typeof candidates)[number]; distance: number; key: string };
  const scored: Scored[] = [];

  for (const candidate of candidates) {
    for (const form of [candidate.label, ...(candidate.aliases ?? [])]) {
      const key = normaliseKey(form);
      if (!key) continue;

      if (key === needle) {
        return {
          value: candidate.value,
          input: raw,
          label: candidate.label,
          confident: true,
          corrected: raw !== candidate.label,
        };
      }

      scored.push({ candidate, key, distance: editDistance(needle, key, 4) });
    }
  }

  /**
   * PREFIX, not "contains anywhere".
   *
   * The point of this rule is to catch a qualified version of the same name —
   * "Lagos" against "Lagos Main Campus", "Port Harcourt" against
   * "Port Harcourt Annex". Those always share a beginning.
   *
   * Plain containment looked equivalent and was not: it confidently resolved
   * "midnight" to the evening sitting, because "midnight" contains "night".
   * A substring sitting in the MIDDLE of a word is usually a different word,
   * and being wrong here is silent — the row imports, into the wrong class.
   *
   * The four-character floor stays. Without it "a1" prefixes "a1evening" and
   * a two-letter match is a coin toss dressed up as a decision.
   */
  const prefixed = scored.find(
    (entry) =>
      Math.min(entry.key.length, needle.length) >= 4 &&
      (entry.key.startsWith(needle) || needle.startsWith(entry.key)),
  );
  if (prefixed) {
    return {
      value: prefixed.candidate.value,
      input: raw,
      label: prefixed.candidate.label,
      confident: true,
      corrected: true,
    };
  }

  scored.sort((a, b) => a.distance - b.distance);
  const best = scored[0];
  if (!best) return null;

  const tolerance = needle.length <= 4 ? 1 : needle.length <= 8 ? 2 : 3;
  if (best.distance > tolerance) return null;

  // A tie between two candidates at the same distance is not a match. "Abaja"
  // sitting one letter from both "Abuja" and "Abaka" must be asked about, not
  // silently assigned to whichever the database returned first.
  const runnerUp = scored.find((entry) => entry.candidate !== best.candidate);
  if (runnerUp && runnerUp.distance === best.distance) return null;

  return {
    value: best.candidate.value,
    input: raw,
    label: best.candidate.label,
    confident: false,
    corrected: true,
  };
}

/* -------------------------------------------------------------------------- */
/* The vocabularies an import actually has to resolve                         */
/* -------------------------------------------------------------------------- */

/** A1–C2, however the file writes it: "a1", "A 1", "Level B2", "b-2". */
export function matchLevel(input: string, levels: readonly string[]): Match<string> | null {
  return bestMatch(
    input,
    levels.map((level) => ({
      value: level,
      label: level,
      aliases: [`level ${level}`, `class ${level}`],
    })),
  );
}

/**
 * morning / afternoon / evening, from whatever the office writes in the column:
 * "AM", "9am", "Morning class", "eve".
 */
export function matchSessionSlot(input: string): Match<string> | null {
  return bestMatch(input, [
    { value: "morning", label: "morning", aliases: ["am", "9am", "morning class", "morn"] },
    { value: "afternoon", label: "afternoon", aliases: ["pm", "noon", "afternoon class", "aft"] },
    { value: "evening", label: "evening", aliases: ["eve", "night", "evening class", "6pm"] },
    { value: "weekend", label: "weekend", aliases: ["sat", "saturday", "saturdays", "weekend class", "weekends"] },
  ]);
}

/**
 * physical / online / hybrid, from whatever the office writes in the column:
 * "Physical", "ONLINE", "Virtual", "Zoom".
 */
export function matchDeliveryMode(input: string): Match<string> | null {
  return bestMatch(input, [
    { value: "physical", label: "physical", aliases: ["in person", "in-person", "campus", "onsite", "on-site"] },
    { value: "online", label: "online", aliases: ["virtual", "remote", "zoom", "video"] },
    { value: "hybrid", label: "hybrid", aliases: ["mixed", "both"] },
  ]);
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/**
 * A batch month, normalised to "July 2026".
 *
 * The year is pulled out with a regex before matching, because "jul2026" and
 * "July 2026" and "07/2026" all carry it and none of them are close to the
 * word "July" once the digits are in the string. A batch with no year takes
 * the current one, which is what an office writing "July" in August means.
 */
export function matchBatch(input: string, now = new Date()): Match<string> | null {
  const raw = input.trim();
  if (!raw) return null;

  const yearMatch = raw.match(/(20\d{2})/);
  const year = yearMatch ? Number(yearMatch[1]) : now.getFullYear();
  const withoutYear = raw.replace(/(20\d{2})/, " ").trim();

  // Numeric months: "07/2026", "2026-07".
  const numeric = withoutYear.match(/\b(0?[1-9]|1[0-2])\b/);
  if (numeric && !/[a-z]/i.test(withoutYear)) {
    const month = MONTHS[Number(numeric[1]) - 1];
    return { value: `${month} ${year}`, input: raw, label: `${month} ${year}`, confident: true, corrected: true };
  }

  const month = bestMatch(
    withoutYear,
    MONTHS.map((name) => ({ value: name, label: name, aliases: [name.slice(0, 3)] })),
  );
  if (!month) return null;

  const label = `${month.value} ${year}`;
  return { value: label, input: raw, label, confident: month.confident, corrected: raw !== label };
}
