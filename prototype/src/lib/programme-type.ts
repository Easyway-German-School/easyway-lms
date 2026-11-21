/**
 * The three programmes the office actually filters by.
 *
 * `Student.pathway` still stores the signup choice ("Study and work in
 * Germany", "Exam Preparatory", "Travel Package", …). This file is the one
 * place that folds those strings into Exam prep, Language training, or
 * Travel package, so the roster, the export, and a tutor scoped to exam
 * prep all answer the question the same way.
 */

export const PROGRAMME_TYPES = [
  { value: "exam_prep", label: "Exam prep" },
  { value: "language_training", label: "Language training" },
  { value: "travel_package", label: "Travel package" },
] as const;

export type ProgrammeType = (typeof PROGRAMME_TYPES)[number]["value"];

/** Spellings that have been typed into `Student.pathway` for exam prep. */
export const EXAM_PREP_PATHWAYS = ["Exam Preparatory", "Exam prep", "Exam preparation"] as const;

export const TRAVEL_PACKAGE_PATHWAYS = ["Travel Package"] as const;

function norm(value: string | null | undefined): string {
  return String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

export function isProgrammeType(value: string | null | undefined): value is ProgrammeType {
  return PROGRAMME_TYPES.some((item) => item.value === value);
}

export function programmeTypeForPathway(pathway: string | null | undefined): ProgrammeType {
  const value = norm(pathway);
  if (TRAVEL_PACKAGE_PATHWAYS.some((alias) => norm(alias) === value)) return "travel_package";
  if (EXAM_PREP_PATHWAYS.some((alias) => norm(alias) === value)) return "exam_prep";
  return "language_training";
}

export function programmeLabel(pathway: string | null | undefined): string {
  const type = programmeTypeForPathway(pathway);
  return PROGRAMME_TYPES.find((item) => item.value === type)?.label ?? "Language training";
}

function equalsPathway(alias: string): Record<string, unknown> {
  return { pathway: { equals: alias, mode: "insensitive" } };
}

/** Prisma filter for one programme. Language training is everyone who is not exam prep or travel. */
export function programmeWhere(type: ProgrammeType): Record<string, unknown> {
  const exam = EXAM_PREP_PATHWAYS.map((alias) => equalsPathway(alias));
  const travel = TRAVEL_PACKAGE_PATHWAYS.map((alias) => equalsPathway(alias));
  if (type === "exam_prep") return { OR: exam };
  if (type === "travel_package") return { OR: travel };
  return { NOT: { OR: [...exam, ...travel] } };
}

/**
 * A tutor assignment's pathway list, widened so "Exam Preparatory" also
 * matches a student stored as "Exam prep". One clause, safe to AND with the
 * branch/level match.
 */
export function pathwayMatchWhere(pathways: string[]): Record<string, unknown> | null {
  if (!pathways.length) return null;
  const ors: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  for (const pathway of pathways) {
    const aliases =
      programmeTypeForPathway(pathway) === "exam_prep" &&
      EXAM_PREP_PATHWAYS.some((alias) => norm(alias) === norm(pathway))
        ? EXAM_PREP_PATHWAYS
        : [pathway];
    for (const alias of aliases) {
      const key = norm(alias);
      if (seen.has(key)) continue;
      seen.add(key);
      ors.push(equalsPathway(alias));
    }
  }
  if (!ors.length) return null;
  return ors.length === 1 ? ors[0] : { OR: ors };
}
