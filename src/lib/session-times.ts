/**
 * The clock times a school quotes for each sitting — admin-editable, because
 * they change every batch (the September cohort's afternoon sitting is not
 * the same hours as the one before it). Read by the hybrid combo picker at
 * signup and the HybridComboMoment popup, so a student picking "Physical
 * afternoon + Online evening" sees the actual hours instead of a bare label.
 *
 * Same shape as school-settings.ts (a SchoolSetting row, permissive
 * defaults, no prisma import here so client code can use it) but
 * deliberately its own key/file: that file's grid is about which sessions
 * RUN, this one is about what time they run at, and the two change on
 * different schedules — a session toggling on/off is a rare policy call, a
 * clock time is corrected every intake.
 */

export const SESSION_TIMES_KEY = "class.sessionTimes";

export type SessionTimes = {
  physical: { morning: string; afternoon: string; evening: string; weekend: string };
  online: { morning: string; evening: string };
};

/** The September batch hours, as given by the office — the seeded default. */
export function defaultSessionTimes(): SessionTimes {
  return {
    physical: {
      morning: "10:00 AM – 1:00 PM",
      afternoon: "1:00 PM – 4:00 PM",
      evening: "5:00 PM – 7:00 PM",
      weekend: "10:00 AM – 2:00 PM",
    },
    online: {
      morning: "9:00 AM – 12:00 PM",
      evening: "6:30 PM – 9:00 PM",
    },
  };
}

function readTime(source: Record<string, unknown> | null, key: string, fallback: string, strict: boolean): string | null {
  const raw = source?.[key];
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  return strict ? null : fallback;
}

export function parseSessionTimes(value: unknown): SessionTimes;
export function parseSessionTimes(value: unknown, options: { strict: true }): SessionTimes | null;
export function parseSessionTimes(value: unknown, options?: { strict?: boolean }): SessionTimes | null {
  const strict = options?.strict === true;
  const fallback = defaultSessionTimes();
  if (!value || typeof value !== "object") return strict ? null : fallback;

  const record = value as Record<string, unknown>;
  const physicalSrc = (record.physical && typeof record.physical === "object" ? record.physical : null) as Record<string, unknown> | null;
  const onlineSrc = (record.online && typeof record.online === "object" ? record.online : null) as Record<string, unknown> | null;
  if (strict && (!physicalSrc || !onlineSrc)) return null;

  const morning = readTime(physicalSrc, "morning", fallback.physical.morning, strict);
  const afternoon = readTime(physicalSrc, "afternoon", fallback.physical.afternoon, strict);
  const evening = readTime(physicalSrc, "evening", fallback.physical.evening, strict);
  const weekend = readTime(physicalSrc, "weekend", fallback.physical.weekend, strict);
  const onlineMorning = readTime(onlineSrc, "morning", fallback.online.morning, strict);
  const onlineEvening = readTime(onlineSrc, "evening", fallback.online.evening, strict);

  if (strict && [morning, afternoon, evening, weekend, onlineMorning, onlineEvening].some((v) => v === null)) {
    return null;
  }

  return {
    physical: {
      morning: morning ?? fallback.physical.morning,
      afternoon: afternoon ?? fallback.physical.afternoon,
      evening: evening ?? fallback.physical.evening,
      weekend: weekend ?? fallback.physical.weekend,
    },
    online: {
      morning: onlineMorning ?? fallback.online.morning,
      evening: onlineEvening ?? fallback.online.evening,
    },
  };
}

/** "Physical morning — 10:00 AM – 1:00 PM", for the combo picker. */
export function timeFor(times: SessionTimes, mode: "physical" | "online", slot: string): string | null {
  const bucket = times[mode] as Record<string, string>;
  return bucket[slot] ?? null;
}
