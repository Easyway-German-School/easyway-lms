export type RecoverySource = "incident" | "user report" | "issue" | "pull request" | "commit";

export type RecoveryCandidate = {
  id: string;
  source: RecoverySource;
  title: string;
  detail: string;
  url: string | null;
  date: string;
  status?: string;
  resolutionNote?: string | null;
  kind?: string;
  severity?: string;
  occurrences?: number;
  reopenedCount?: number;
};

export type RecoveryMatch = RecoveryCandidate & {
  score: number;
  match: "strong" | "related";
};

const STOP_WORDS = new Set([
  "about", "after", "again", "also", "and", "are", "because", "been", "being", "but", "could", "does",
  "during", "each", "from", "have", "into", "just", "more", "most", "much", "need", "only", "other",
  "our", "please", "same", "should", "some", "such", "than", "that", "their", "them", "then", "there",
  "these", "they", "this", "those", "through", "under", "using", "very", "was", "were", "what", "when",
  "where", "which", "while", "with", "would", "your", "cannot", "doesnt", "isnt", "wont", "cant",
]);

const CONCEPTS: Record<string, readonly string[]> = {
  auth: ["auth", "authentication", "login", "logout", "signin", "signout", "session", "cookie", "password"],
  connection: ["connect", "connecting", "connection", "hang", "hanging", "stuck", "freeze", "frozen", "loading"],
  deployment: ["build", "compile", "compilation", "webpack", "deploy", "deployment", "encoding"],
  live: ["live", "video", "livekit", "classroom", "meeting", "room", "call"],
  mobile: ["mobile", "phone", "responsive", "narrow"],
  notification: ["email", "sms", "notification", "notify", "alert"],
  payment: ["payment", "paystack", "tuition", "deposit", "fee", "invoice", "receipt"],
  student: ["student", "learner", "user"],
};

const CANONICAL = new Map<string, string>();
for (const [concept, words] of Object.entries(CONCEPTS)) {
  for (const word of words) CANONICAL.set(word, concept);
}

const CONCEPT_WORDS = new Map<string, readonly string[]>(
  Object.entries(CONCEPTS).map(([concept, words]) => [concept, words]),
);

function singular(word: string): string {
  if (word.length > 5 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length > 4 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

function termsOf(text: string): string[] {
  return [...new Set(
    text
      .normalize("NFKD")
      .toLowerCase()
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/[^a-z0-9]+/g, " ")
      .split(/\s+/)
      .map(singular)
      .filter((word) => word.length >= 3 && !STOP_WORDS.has(word))
      .map((word) => CANONICAL.get(word) ?? word),
  )];
}

/** Terms to use for the indexed database pre-filter, including known equivalents. */
export function recoverySearchTerms(query: string): string[] {
  const terms = new Set<string>();
  for (const term of termsOf(query)) {
    const synonyms = CONCEPT_WORDS.get(term);
    if (synonyms) {
      for (const synonym of synonyms) terms.add(synonym);
    } else {
      terms.add(term);
    }
  }
  return [...terms].slice(0, 24);
}

/**
 * Rank records by overlap in both their title and description. This deliberately
 * reports similarity rather than inventing a cause or asserting a fix worked.
 */
export function findRecoveryMatches(
  query: string,
  candidates: RecoveryCandidate[],
  limit = 12,
): RecoveryMatch[] {
  const queryTerms = termsOf(query);
  if (queryTerms.length === 0) return [];

  const minimumOverlap = queryTerms.length >= 3 ? 2 : 1;
  const matches: RecoveryMatch[] = [];

  for (const candidate of candidates) {
    const titleTerms = new Set(termsOf(candidate.title));
    const bodyTerms = new Set(termsOf(`${candidate.detail} ${candidate.resolutionNote ?? ""}`));
    const matchesInTitle = queryTerms.filter((term) => titleTerms.has(term)).length;
    const matchesAnywhere = queryTerms.filter((term) => titleTerms.has(term) || bodyTerms.has(term)).length;
    if (matchesAnywhere < minimumOverlap) continue;

    const coverage = matchesAnywhere / queryTerms.length;
    const titleCoverage = matchesInTitle / queryTerms.length;
    const score = Math.min(1, coverage * 0.65 + titleCoverage * 0.35);
    if (score < 0.24) continue;

    matches.push({
      ...candidate,
      score,
      match: score >= 0.6 ? "strong" : "related",
    });
  }

  return matches
    .sort((a, b) => {
      const aStableResolution = Boolean(a.resolutionNote?.trim()) && (a.reopenedCount ?? 0) === 0;
      const bStableResolution = Boolean(b.resolutionNote?.trim()) && (b.reopenedCount ?? 0) === 0;
      if (aStableResolution !== bStableResolution) return aStableResolution ? -1 : 1;
      if (a.reopenedCount !== b.reopenedCount) return (a.reopenedCount ?? 0) - (b.reopenedCount ?? 0);
      return b.score - a.score || b.date.localeCompare(a.date);
    })
    .slice(0, limit);
}
