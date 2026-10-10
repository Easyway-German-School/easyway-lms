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

export type RiskObservation = {
  id: string;
  source: "incident" | "user report";
  title: string;
  detail: string;
  route: string | null;
  date: string;
  status: string;
  severity: string;
  occurrences: number;
  reopenedCount: number;
};

export type RiskPrediction = {
  id: string;
  title: string;
  scenario: string;
  risk: "high" | "elevated" | "watch";
  score: number;
  confidence: "early signal" | "pattern evidence" | "repeated pattern";
  trend: "rising" | "steady" | "cooling";
  counts: {
    records90d: number;
    reports7d: number;
    reportsBefore7d: number;
    activeNow: number;
    recurrences: number;
    affectedRoutes: number;
  };
  evidence: RiskObservation[];
  history: RecoveryMatch[];
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

function routeShape(route: string | null): string {
  return (route ?? "")
    .toLowerCase()
    .replace(/\/[a-z0-9_-]{16,}(?=\/|$)/g, "/:id")
    .replace(/\/\d+(?=\/|$)/g, "/:id")
    .replace(/\/+/g, "/")
    .replace(/\/$/, "");
}

function similarity(
  left: Set<string>,
  right: Set<string>,
  documentFrequency: Map<string, number>,
  documentCount: number,
): number {
  let intersection = 0;
  let union = 0;
  for (const term of left) {
    const weight = Math.log((documentCount + 1) / ((documentFrequency.get(term) ?? 0) + 1)) + 1;
    union += weight;
    if (right.has(term)) intersection += weight;
  }
  for (const term of right) {
    if (left.has(term)) continue;
    union += Math.log((documentCount + 1) / ((documentFrequency.get(term) ?? 0) + 1)) + 1;
  }
  return union === 0 ? 0 : intersection / union;
}

type RiskCluster = {
  terms: Set<string>;
  observations: RiskObservation[];
};

/**
 * Build a deterministic early-warning view from actual observations.
 * The score is an explainable signal index, not a calibrated probability.
 */
export function buildRiskRadar(observations: RiskObservation[], now = new Date()): {
  predictions: RiskPrediction[];
  patternsExamined: number;
} {
  const prepared = observations
    .filter((observation) => Number.isFinite(Date.parse(observation.date)))
    .map((observation) => ({
      observation,
      terms: new Set(termsOf(`${observation.title} ${observation.detail} ${observation.route ?? ""}`)),
    }));
  const documentFrequency = new Map<string, number>();
  for (const item of prepared) {
    for (const term of item.terms) documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
  }

  const clusters: RiskCluster[] = [];
  for (const item of prepared) {
    let best: RiskCluster | null = null;
    let bestScore = 0;
    for (const cluster of clusters) {
      const sharedTerms = [...item.terms].filter((term) => cluster.terms.has(term)).length;
      if (sharedTerms < 2) continue;
      const score = similarity(item.terms, cluster.terms, documentFrequency, prepared.length);
      if (score > bestScore) {
        best = cluster;
        bestScore = score;
      }
    }
    if (best && bestScore >= 0.14) {
      best.observations.push(item.observation);
      for (const term of item.terms) best.terms.add(term);
    } else {
      clusters.push({ terms: new Set(item.terms), observations: [item.observation] });
    }
  }

  const day = 24 * 60 * 60 * 1000;
  const currentTime = now.getTime();
  const sevenDaysAgo = currentTime - 7 * day;
  const thirtyDaysAgo = currentTime - 30 * day;
  const riskOrder: Record<RiskPrediction["risk"], number> = { high: 0, elevated: 1, watch: 2 };

  const predictions = clusters.map((cluster, index) => {
    const records = [...cluster.observations].sort((a, b) => b.date.localeCompare(a.date));
    const lastSevenDays = records.filter((item) => Date.parse(item.date) >= sevenDaysAgo);
    const previousThirtyDays = records.filter((item) => {
      const at = Date.parse(item.date);
      return at >= thirtyDaysAgo && at < sevenDaysAgo;
    });
    const active = records.filter((item) => item.source === "incident" && ["open", "acknowledged"].includes(item.status));
    const recurrences = records.reduce((count, item) => count + item.reopenedCount, 0);
    const highestSeverity = records.some((item) => item.severity === "critical")
      ? "critical"
      : records.some((item) => item.severity === "high")
        ? "high"
        : records.some((item) => item.severity === "medium")
          ? "medium"
          : "low";
    const olderWeeklyRate = previousThirtyDays.length / (23 / 7);
    const accelerating = lastSevenDays.length >= 2 && lastSevenDays.length >= olderWeeklyRate * 1.75;
    const score = Math.min(
      100,
      Math.min(active.length, 2) * 24
        + Math.min(lastSevenDays.length, 4) * 9
        + Math.min(recurrences, 3) * 14
        + (accelerating ? 15 : 0)
        + (highestSeverity === "critical" ? 18 : highestSeverity === "high" ? 13 : highestSeverity === "medium" ? 7 : 2),
    );
    const hasCurrentSignal = active.length > 0 || lastSevenDays.length >= 2 || recurrences > 0;
    const knownRouteCount = new Set(records.map((item) => routeShape(item.route)).filter(Boolean)).size;
    const title = records[0]?.title ?? "Related issue reports";
    const risk: RiskPrediction["risk"] = score >= 65 ? "high" : score >= 35 ? "elevated" : "watch";
    const trend: RiskPrediction["trend"] = accelerating
      ? "rising"
      : lastSevenDays.length === 0 && previousThirtyDays.length > 0
        ? "cooling"
        : "steady";
    const confidence: RiskPrediction["confidence"] = records.length >= 5
      ? "repeated pattern"
      : records.length >= 2
        ? "pattern evidence"
        : "early signal";
    const scenario = active.length > 0
      ? `If this active ${highestSeverity}-severity pattern continues, more reports about “${title}” may follow.`
      : accelerating
        ? `Reports resembling “${title}” are arriving faster than the preceding period; another recurrence is a risk to watch.`
        : recurrences > 0
          ? `This resolved pattern has returned ${recurrences} time${recurrences === 1 ? "" : "s"}; a similar recurrence is possible.`
          : `This issue pattern appeared ${records.length} times in the last 90 days; keep it on the watchlist.`;

    return {
      id: `pattern-${index}`,
      title,
      scenario,
      risk,
      score,
      confidence,
      trend,
      counts: {
        records90d: records.length,
        reports7d: lastSevenDays.length,
        reportsBefore7d: previousThirtyDays.length,
        activeNow: active.length,
        recurrences,
        affectedRoutes: knownRouteCount,
      },
      evidence: records.slice(0, 4),
      history: [] as RecoveryMatch[],
      hasCurrentSignal,
      sortDate: records[0]?.date ?? "",
    };
  });

  const selected = predictions
    .filter((prediction) => prediction.hasCurrentSignal)
    .sort((a, b) => riskOrder[a.risk] - riskOrder[b.risk] || b.score - a.score || b.sortDate.localeCompare(a.sortDate))
    .slice(0, 10)
    .map(({ hasCurrentSignal: _hasCurrentSignal, sortDate: _sortDate, ...prediction }) => prediction);

  return { predictions: selected, patternsExamined: clusters.length };
}
