export const STUDY_GROUP_CAPACITY = 8;
export const STUDY_GROUP_DURATION_MS = 90 * 60_000;
export const STUDY_GROUP_MAX_SCHEDULE_DAYS = 7;
export const STUDY_GROUP_MIN_SCHEDULE_MINUTES = 5;

export const STUDY_GROUP_FOCI = [
  { id: "vocabulary", label: "Vocabulary sprint" },
  { id: "grammar", label: "Grammar practice" },
  { id: "speaking", label: "Speaking practice" },
  { id: "exam", label: "Exam preparation" },
  { id: "homework", label: "Homework together" },
] as const;

export type StudyGroupFocus = (typeof STUDY_GROUP_FOCI)[number]["id"];

export function isStudyGroupFocus(value: unknown): value is StudyGroupFocus {
  return STUDY_GROUP_FOCI.some((focus) => focus.id === value);
}

export function studyGroupName(level: string, focus: StudyGroupFocus): string {
  const label = STUDY_GROUP_FOCI.find((item) => item.id === focus)?.label;
  return `${level} ${label ?? "Study session"}`;
}

export type StudyGroupTiming =
  | { ok: true; startsAt: Date; expiresAt: Date }
  | { ok: false; error: string };

export function studyGroupTiming(value: unknown, now = new Date()): StudyGroupTiming {
  let startsAt = now;
  if (value !== undefined && value !== null && value !== "") {
    if (typeof value !== "string") return { ok: false, error: "Choose a valid start time." };
    startsAt = new Date(value);
    if (Number.isNaN(startsAt.getTime())) return { ok: false, error: "Choose a valid start time." };

    const earliest = now.getTime() + STUDY_GROUP_MIN_SCHEDULE_MINUTES * 60_000;
    const latest = now.getTime() + STUDY_GROUP_MAX_SCHEDULE_DAYS * 24 * 60 * 60_000;
    if (startsAt.getTime() < earliest) {
      return { ok: false, error: "Scheduled sessions need at least five minutes’ notice." };
    }
    if (startsAt.getTime() > latest) {
      return { ok: false, error: "Study sessions can be scheduled up to seven days ahead." };
    }
  }

  return {
    ok: true,
    startsAt,
    expiresAt: new Date(startsAt.getTime() + STUDY_GROUP_DURATION_MS),
  };
}
