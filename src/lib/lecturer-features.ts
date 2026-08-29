/**
 * WHAT A TUTOR CAN REACH, as distinct from what a tutor teaches.
 *
 * `src/lib/lecturer-assignment.ts` already answers "which classes are this
 * tutor's?" — branches, levels, sittings, class types, batches. This answers a
 * different question that kept being mistaken for the same one: which parts of
 * the portal should this person see at all.
 *
 * They are not the same question, and conflating them breaks in both
 * directions. A tutor assigned to `classTypes: ["online"]` still might not be
 * the one who runs the video call — the school may have one person who takes
 * every live session while others prepare the material. And a tutor assigned
 * only to physical classes may still need the recording library to review what
 * was taught. So this is its own field, set by an admin, and it defaults to
 * everything.
 *
 * NULL MEANS EVERYTHING. Every tutor who existed before this field keeps the
 * portal they had; nobody's access moves until an admin deliberately unticks a
 * box. A stored empty array is a real answer — "none of these" — and is
 * distinct from null, which is why the parser below cannot use `?? []`.
 *
 * No prisma import: the admin form and the tutor shell both need this
 * vocabulary, and a server-only dependency would stop it reaching the browser.
 */

export const LECTURER_FEATURES = ["live_classes", "private_classes", "recordings"] as const;
export type LecturerFeature = (typeof LECTURER_FEATURES)[number];

export const LECTURER_FEATURE_LABELS: Record<LecturerFeature, string> = {
  live_classes: "Live classes",
  private_classes: "Private classes",
  recordings: "Recording library",
};

export const LECTURER_FEATURE_HINTS: Record<LecturerFeature, string> = {
  live_classes: "Can open the live classroom and start a session for their class.",
  private_classes: "Can book and run one-to-one sessions, and see their private students.",
  recordings: "Can watch back recordings of the classes they teach.",
};

/** Which sidebar entries each feature governs. Consulted by LecturerShell. */
export const LECTURER_FEATURE_PATHS: Record<LecturerFeature, string[]> = {
  live_classes: ["/live"],
  private_classes: ["/lecturer/private-classes"],
  recordings: ["/lecturer/recordings"],
};

function isFeature(value: unknown): value is LecturerFeature {
  return (LECTURER_FEATURES as readonly string[]).includes(String(value));
}

/**
 * Read the stored column into a clean list.
 *
 * Tolerant of anything: bad JSON in this column must not lock a tutor out of
 * their own portal, so anything that is not an array reads as "not set", which
 * means everything.
 */
export function lecturerFeatures(raw: unknown): LecturerFeature[] {
  if (!Array.isArray(raw)) return [...LECTURER_FEATURES];
  return LECTURER_FEATURES.filter((feature) => raw.some((entry) => isFeature(entry) && entry === feature));
}

/** Whether this tutor may reach one named area. */
export function lecturerCan(raw: unknown, feature: LecturerFeature): boolean {
  return lecturerFeatures(raw).includes(feature);
}

/** Normalise submitted form input before it is stored. */
export function parseLecturerFeatures(raw: unknown): LecturerFeature[] {
  if (!Array.isArray(raw)) return [...LECTURER_FEATURES];
  return LECTURER_FEATURES.filter((feature) => raw.includes(feature));
}

/**
 * Whether a path in the tutor portal is behind one of these toggles.
 * Longest prefix wins, for the reason set out in src/lib/admin-routes.ts.
 */
const PATH_INDEX: Array<{ prefix: string; feature: LecturerFeature }> = Object.entries(LECTURER_FEATURE_PATHS)
  .flatMap(([feature, paths]) => paths.map((prefix) => ({ prefix, feature: feature as LecturerFeature })))
  .sort((a, b) => b.prefix.length - a.prefix.length);

export function featureForLecturerPath(path: string): LecturerFeature | null {
  const pathname = path.split("?")[0].split("#")[0];
  const match = PATH_INDEX.find((entry) => pathname === entry.prefix || pathname.startsWith(`${entry.prefix}/`));
  return match?.feature ?? null;
}

/**
 * Whether this tutor can open this path.
 *
 * `features === null` means the lookup has not answered yet and everything
 * passes — a network hiccup must not blank out a tutor's own sidebar, and the
 * routes behind these pages enforce it regardless.
 */
export function lecturerCanReach(path: string, features: string[] | null | undefined): boolean {
  if (features == null) return true;
  const feature = featureForLecturerPath(path);
  return !feature || features.includes(feature);
}
