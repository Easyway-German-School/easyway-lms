import { instantToZonedParts, SCHOOL_TIMEZONE } from "@/lib/school-time";
import { examCountdown } from "@/lib/exam-schedule";

/**
 * The exam-registration campaign — one running at a time, currently the ÖSD
 * German Examination in Lagos, October 2026.
 *
 * This is an AWARENESS campaign, not an internal booking flow: candidates
 * register on ÖSD's own site. What the LMS owns is the push — a daily Becca
 * popup, a 3×/week reminder, a pinned banner, a "find out more" page and an
 * "ask the office" enquiry — and the office's switch to turn all of it off once
 * the sitting is done.
 *
 * The CONTENT lives in one `SchoolSetting` row (`exam.campaign`, JSON), the same
 * mechanism as `class.sessions` and `results.autoRelease`, so the office edits
 * dates / fees / links / the on-off toggle without a deploy. The per-student
 * "I've registered" / "I enquired" flags live in `ExamCampaignResponse`.
 *
 * Prisma-free (types + pure helpers only) so the popup, the banner and the
 * public page can all import it on the client.
 */

export const EXAM_CAMPAIGN_KEY = "exam.campaign";

export type ExamCampaignFee = { level: string; amount: number };
export type ExamCampaignVenue = { name: string; address: string };

export type ExamCampaignConfig = {
  /** Master switch. Off → no popup, no banner, no reminders, page shows a "closed" note. */
  enabled: boolean;
  /**
   * Stable id for THIS sitting. Bumping it (next campaign) makes every student
   * "not registered" again without touching the old `ExamCampaignResponse` rows.
   */
  campaignKey: string;
  examBody: string;
  title: string;
  tagline: string;
  blurb: string;
  levels: string[];
  /** ISO calendar dates (YYYY-MM-DD), read as the school's local day. */
  examStart: string;
  examEnd: string;
  prepClassDate: string;
  prepClassVenue: string;
  registrationDeadline: string;
  /** The day the daily popup is allowed to start appearing. */
  startPopupsOn: string;
  registerUrl: string;
  practiceUrl: string;
  contactEmail: string;
  venues: ExamCampaignVenue[];
  fees: ExamCampaignFee[];
  currency: string;
  expressFee: number;
  regularResultText: string;
  expressResultText: string;
  /** Days of the week the reminder sweep fires. 0 = Sunday … 6 = Saturday. */
  reminderWeekdays: number[];
  reminderTitle: string;
  reminderMessage: string;
};

export const DEFAULT_EXAM_CAMPAIGN: ExamCampaignConfig = {
  enabled: true,
  campaignKey: "osd-oct-2026",
  examBody: "ÖSD",
  title: "ÖSD German Examination — now in Nigeria",
  tagline: "Sit an internationally recognised German exam right here in Lagos.",
  blurb:
    "Registration for the ÖSD German Examination is open. Write your A1–B2 exam in Ikeja this " +
    "October — no travelling abroad, no waiting for a rare slot. Registered candidates also get a " +
    "FREE preparation class and access to official practice materials.",
  levels: ["A1", "A2", "B1", "B2"],
  examStart: "2026-10-29",
  examEnd: "2026-10-31",
  prepClassDate: "2026-10-28",
  prepClassVenue: "No. 23 Unity Road, Ikeja, Lagos",
  registrationDeadline: "2026-10-06",
  startPopupsOn: "2026-09-08",
  registerUrl: "https://osd-examregistration.com/register/JTHDDX",
  practiceUrl: "https://osd.at/downloads/#a1",
  contactEmail: "exams@easywaylanguageschool.com",
  venues: [
    { name: "Allen Avenue centre", address: "No. 1 Allen Avenue, Ikeja, Lagos" },
    { name: "Unity Road centre", address: "No. 23 Unity Road, Ikeja, Lagos" },
  ],
  fees: [
    { level: "A1", amount: 160_000 },
    { level: "A2", amount: 180_000 },
    { level: "B1", amount: 190_000 },
    { level: "B2", amount: 210_000 },
  ],
  currency: "NGN",
  expressFee: 192_500,
  regularResultText: "about 2–4 weeks",
  expressResultText: "as fast as 1 week",
  reminderWeekdays: [1, 3, 5],
  reminderTitle: "Register for the ÖSD exam — spaces are limited",
  reminderMessage:
    "The ÖSD German Examination runs 29–31 October in Ikeja, Lagos, and registration closes on " +
    "6 October. Tap to see the dates, fees and the free prep class — and once you've registered on " +
    "the ÖSD site, mark yourself done so we stop reminding you.",
};

/* -------------------------------------------------------------------------- */
/* Parsing — a hand-edited or older row must degrade, never throw            */
/* -------------------------------------------------------------------------- */

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}
function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
}
function asBool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}
/** YYYY-MM-DD or fallback. */
function asDateKey(value: unknown, fallback: string): string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : fallback;
}
function asStringList(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  const cleaned = value.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
  return cleaned.length ? cleaned : fallback;
}
function asWeekdays(value: unknown, fallback: number[]): number[] {
  if (!Array.isArray(value)) return fallback;
  const cleaned = [...new Set(value.filter((v): v is number => typeof v === "number" && v >= 0 && v <= 6))].sort();
  return cleaned.length ? cleaned : fallback;
}
function asFees(value: unknown, fallback: ExamCampaignFee[]): ExamCampaignFee[] {
  if (!Array.isArray(value)) return fallback;
  const cleaned = value
    .filter((f): f is ExamCampaignFee => !!f && typeof f === "object")
    .map((f) => ({ level: asString((f as ExamCampaignFee).level, ""), amount: asNumber((f as ExamCampaignFee).amount, 0) }))
    .filter((f) => f.level && f.amount > 0);
  return cleaned.length ? cleaned : fallback;
}
function asVenues(value: unknown, fallback: ExamCampaignVenue[]): ExamCampaignVenue[] {
  if (!Array.isArray(value)) return fallback;
  const cleaned = value
    .filter((v): v is ExamCampaignVenue => !!v && typeof v === "object")
    .map((v) => ({
      name: asString((v as ExamCampaignVenue).name, "Exam centre"),
      address: asString((v as ExamCampaignVenue).address, ""),
    }))
    .filter((v) => v.address);
  return cleaned.length ? cleaned : fallback;
}

/**
 * Merge a stored value onto the defaults. `strict` (used by the admin save
 * route) returns `null` when the value is not an object at all; the read path
 * is permissive and always returns a usable config.
 */
export function parseExamCampaign(value: unknown, opts?: { strict?: boolean }): ExamCampaignConfig | null {
  if (typeof value !== "object" || value === null) {
    return opts?.strict ? null : { ...DEFAULT_EXAM_CAMPAIGN };
  }
  const v = value as Record<string, unknown>;
  const d = DEFAULT_EXAM_CAMPAIGN;
  return {
    enabled: asBool(v.enabled, d.enabled),
    campaignKey: asString(v.campaignKey, d.campaignKey),
    examBody: asString(v.examBody, d.examBody),
    title: asString(v.title, d.title),
    tagline: asString(v.tagline, d.tagline),
    blurb: asString(v.blurb, d.blurb),
    levels: asStringList(v.levels, d.levels),
    examStart: asDateKey(v.examStart, d.examStart),
    examEnd: asDateKey(v.examEnd, d.examEnd),
    prepClassDate: asDateKey(v.prepClassDate, d.prepClassDate),
    prepClassVenue: asString(v.prepClassVenue, d.prepClassVenue),
    registrationDeadline: asDateKey(v.registrationDeadline, d.registrationDeadline),
    startPopupsOn: asDateKey(v.startPopupsOn, d.startPopupsOn),
    registerUrl: asString(v.registerUrl, d.registerUrl),
    practiceUrl: asString(v.practiceUrl, d.practiceUrl),
    contactEmail: asString(v.contactEmail, d.contactEmail),
    venues: asVenues(v.venues, d.venues),
    fees: asFees(v.fees, d.fees),
    currency: asString(v.currency, d.currency),
    expressFee: asNumber(v.expressFee, d.expressFee),
    regularResultText: asString(v.regularResultText, d.regularResultText),
    expressResultText: asString(v.expressResultText, d.expressResultText),
    reminderWeekdays: asWeekdays(v.reminderWeekdays, d.reminderWeekdays),
    reminderTitle: asString(v.reminderTitle, d.reminderTitle),
    reminderMessage: asString(v.reminderMessage, d.reminderMessage),
  };
}

/* -------------------------------------------------------------------------- */
/* Pure helpers                                                              */
/* -------------------------------------------------------------------------- */

const DAY_MS = 86_400_000;

/** The school-local calendar day for an instant, as YYYY-MM-DD. */
export function schoolDateKey(now: Date = new Date()): string {
  return instantToZonedParts(now, SCHOOL_TIMEZONE).dateKey;
}

/** The school-local weekday for an instant (0 = Sunday). */
export function schoolWeekday(now: Date = new Date()): number {
  return instantToZonedParts(now, SCHOOL_TIMEZONE).weekday;
}

/** Midday UTC on a YYYY-MM-DD — safe to compare/countdown without tz drift near midnight. */
export function dateKeyToInstant(key: string): Date {
  return new Date(`${key}T12:00:00.000Z`);
}

export function feeForLevel(cfg: ExamCampaignConfig, level: string | null | undefined): number | null {
  if (!level) return null;
  const hit = cfg.fees.find((f) => f.level.toUpperCase() === level.toUpperCase());
  return hit ? hit.amount : null;
}

/** Cheapest advertised fee — for the "from ₦160,000" line. */
export function lowestFee(cfg: ExamCampaignConfig): number {
  return cfg.fees.reduce((min, f) => (f.amount < min ? f.amount : min), cfg.fees[0]?.amount ?? 0);
}

export type CampaignPhase = "disabled" | "upcoming" | "open" | "closing-soon" | "closed";

/**
 * Where the campaign is in its life. Registration is treated as open through
 * the END of the deadline day (a candidate registering on the 6th is in time),
 * "closing-soon" inside the last week.
 */
export function campaignPhase(cfg: ExamCampaignConfig, now: Date = new Date()): CampaignPhase {
  if (!cfg.enabled) return "disabled";
  const todayKey = schoolDateKey(now);
  if (todayKey < cfg.startPopupsOn) return "upcoming";
  if (todayKey > cfg.registrationDeadline) return "closed";
  const daysLeft = Math.round(
    (dateKeyToInstant(cfg.registrationDeadline).getTime() - dateKeyToInstant(todayKey).getTime()) / DAY_MS,
  );
  return daysLeft <= 7 ? "closing-soon" : "open";
}

/** Should the daily popup / banner / reminders run for this campaign right now? */
export function campaignIsLive(cfg: ExamCampaignConfig, now: Date = new Date()): boolean {
  const phase = campaignPhase(cfg, now);
  return phase === "open" || phase === "closing-soon";
}

/** "in 5 days" / "tomorrow" / "today" until registration closes. */
export function deadlineCountdown(cfg: ExamCampaignConfig, now: Date = new Date()) {
  return examCountdown(dateKeyToInstant(cfg.registrationDeadline), now);
}

/** "29–31 October 2026" style label from examStart/examEnd. */
export function examDatesLabel(cfg: ExamCampaignConfig): string {
  const start = dateKeyToInstant(cfg.examStart);
  const end = dateKeyToInstant(cfg.examEnd);
  const day = (d: Date) => d.getUTCDate();
  const month = new Intl.DateTimeFormat("en-GB", { month: "long", timeZone: "UTC" });
  const year = start.getUTCFullYear();
  if (cfg.examStart === cfg.examEnd) return `${day(start)} ${month.format(start)} ${year}`;
  if (start.getUTCMonth() === end.getUTCMonth()) {
    return `${day(start)}–${day(end)} ${month.format(start)} ${year}`;
  }
  return `${day(start)} ${month.format(start)} – ${day(end)} ${month.format(end)} ${year}`;
}

export function formatMoney(amount: number, currency = "NGN"): string {
  const symbol = currency === "NGN" ? "₦" : "";
  return `${symbol}${Math.round(amount).toLocaleString("en-NG")}`;
}

/** The subset safe to hand to the browser (everything here is already public). */
export function publicCampaign(cfg: ExamCampaignConfig) {
  return cfg;
}
