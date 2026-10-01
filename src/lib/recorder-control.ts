/**
 * Steering the recorder fleet from the admin page.
 *
 * The page writes a small JSON "control file" into the recordings bucket; the scheduler (a separate always-on
 * server) reads it every five minutes and obeys it. The LMS never talks to the scheduler or to Linode, so a
 * break-in here cannot reach the servers account. The scheduler writes a heartbeat file back, which this module
 * reads so the page can show whether it is alive and what it last did.
 *
 * The file's shape and limits are mirrored in the EduPrime-Recorder repository (src/fleet/control.ts), which has
 * the matching reader; a fixed example is asserted in both repositories' tests.
 *
 * What the controls can NOT do, on purpose: delete a server. Pausing only stops NEW servers from starting.
 * Killing a server mid-class would lose the recording, so there is no such button.
 */

export const CONTROL_KEY = "recordings/_recorder-release/control.json";
export const PRIMARY_BEAT_KEY = "recordings/_recorder-release/scheduler-heartbeat.json";
export const STANDBY_BEAT_KEY = "recordings/_recorder-release/scheduler-standby.json";

export type Control = {
  version: 1;
  updatedAt: string;
  updatedBy: string;
  paused: boolean;
  pauseNote: string;
  skipDates: string[];
  boost: { classes: number; until: string } | null;
  spareClasses: number | null;
  maxServers: number | null;
};

export const NO_CONTROL: Control = { version: 1, updatedAt: "", updatedBy: "", paused: false, pauseNote: "", skipDates: [], boost: null, spareClasses: null, maxServers: null };

export const MAX_BOOST_CLASSES = 12;
export const MAX_BOOST_HOURS = 12;
export const MAX_SKIP_DATES = 60;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const clean = (value: unknown, max: number): string => (typeof value === "string" ? value.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max) : "");

/** Read what is stored, tolerantly: anything unusable is "no instructions". Mirrors the scheduler's reader. */
export function parseStoredControl(value: unknown): Control {
  const v = value as Record<string, unknown> | null;
  if (!v || typeof v !== "object" || Array.isArray(v) || v.version !== 1 || typeof v.paused !== "boolean") return NO_CONTROL;
  const b = v.boost as { classes?: unknown; until?: unknown } | null | undefined;
  const until = b && typeof b === "object" ? Date.parse(String(b.until)) : NaN;
  const bounded = (x: unknown, lo: number, hi: number): number | null => (Number.isInteger(x) && (x as number) >= lo && (x as number) <= hi ? (x as number) : null);
  return {
    version: 1,
    updatedAt: clean(v.updatedAt, 40),
    updatedBy: clean(v.updatedBy, 120),
    paused: v.paused,
    pauseNote: clean(v.pauseNote, 200),
    skipDates: Array.isArray(v.skipDates) ? [...new Set(v.skipDates.filter((d): d is string => typeof d === "string" && DATE.test(d)))].sort().slice(0, MAX_SKIP_DATES) : [],
    boost: b && Number.isInteger(b.classes) && (b.classes as number) >= 1 && Number.isFinite(until) ? { classes: Math.min(b.classes as number, MAX_BOOST_CLASSES), until: new Date(until).toISOString() } : null,
    spareClasses: bounded(v.spareClasses, 0, 5),
    maxServers: bounded(v.maxServers, 1, 12),
  };
}

/** What the page may ask for. Each field is optional; absent means "leave as it is". */
export type ControlRequest = {
  paused?: boolean;
  pauseNote?: string;
  addSkipDate?: string;
  removeSkipDate?: string;
  /** Start room for this many classes for this many hours. null cancels a boost. */
  boost?: { classes: number; hours: number } | null;
  spareClasses?: number | null;
  maxServers?: number | null;
};

export type ControlResult = { ok: true; control: Control } | { ok: false; error: string };

/** Apply a request to the current control, strictly: a bad request is refused, never half-applied or quietly clamped. */
export function applyControlRequest(current: Control, request: unknown, by: string, now: Date): ControlResult {
  if (!request || typeof request !== "object" || Array.isArray(request)) return { ok: false, error: "Nothing to change." };
  const r = request as Record<string, unknown>;
  const next: Control = { ...current, skipDates: [...current.skipDates], version: 1, updatedAt: now.toISOString(), updatedBy: clean(by, 120) || "an admin" };
  let changed = false;

  if ("paused" in r) {
    if (typeof r.paused !== "boolean") return { ok: false, error: "paused must be true or false." };
    next.paused = r.paused;
    next.pauseNote = r.paused ? clean(r.pauseNote, 200) : "";
    changed = true;
  }
  if (typeof r.addSkipDate !== "undefined") {
    const d = r.addSkipDate;
    if (typeof d !== "string" || !DATE.test(d) || !Number.isFinite(Date.parse(`${d}T00:00:00Z`))) return { ok: false, error: "That is not a valid date." };
    if (!next.skipDates.includes(d)) {
      if (next.skipDates.length >= MAX_SKIP_DATES) return { ok: false, error: `At most ${MAX_SKIP_DATES} days off at once. Remove some old ones first.` };
      next.skipDates.push(d);
      next.skipDates.sort();
    }
    changed = true;
  }
  if (typeof r.removeSkipDate !== "undefined") {
    if (typeof r.removeSkipDate !== "string") return { ok: false, error: "That is not a valid date." };
    next.skipDates = next.skipDates.filter((d) => d !== r.removeSkipDate);
    changed = true;
  }
  if ("boost" in r) {
    if (r.boost === null) next.boost = null;
    else {
      const b = r.boost as { classes?: unknown; hours?: unknown };
      if (!b || !Number.isInteger(b.classes) || (b.classes as number) < 1 || (b.classes as number) > MAX_BOOST_CLASSES) return { ok: false, error: `Choose between 1 and ${MAX_BOOST_CLASSES} classes.` };
      if (typeof b.hours !== "number" || !(b.hours > 0) || b.hours > MAX_BOOST_HOURS) return { ok: false, error: `Choose a time of up to ${MAX_BOOST_HOURS} hours.` };
      next.boost = { classes: b.classes as number, until: new Date(now.getTime() + b.hours * 3_600_000).toISOString() };
    }
    changed = true;
  }
  for (const [field, lo, hi] of [["spareClasses", 0, 5], ["maxServers", 1, 12]] as const) {
    if (field in r) {
      const v = r[field];
      if (v !== null && !(Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi)) return { ok: false, error: `${field === "maxServers" ? "Server limit" : "Spare capacity"} must be between ${lo} and ${hi}.` };
      next[field] = v as number | null;
      changed = true;
    }
  }
  return changed ? { ok: true, control: next } : { ok: false, error: "Nothing to change." };
}

/** Is a boost still running at `now`? */
export const boostActive = (control: Control, now: Date): boolean => !!control.boost && Date.parse(control.boost.until) > now.getTime();

/* -------------------------------------------------------------------------- */
/* The scheduler's heartbeat                                                  */
/* -------------------------------------------------------------------------- */

export type SchedulerBeat = {
  at: string;
  role: "primary" | "standby";
  holder: string;
  acting: boolean;
  servers: number;
  needSoon: number;
  actions: number;
  failed: number;
  timetable: string;
  paused: boolean;
  notes: string[];
  recent: { at: string; text: string }[];
};

export function parseSchedulerBeat(value: unknown): SchedulerBeat | null {
  const v = value as Partial<SchedulerBeat> | null;
  if (!v || typeof v !== "object" || typeof v.at !== "string" || !Number.isFinite(Date.parse(v.at))) return null;
  const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : 0);
  return {
    at: v.at,
    role: v.role === "standby" ? "standby" : "primary",
    holder: typeof v.holder === "string" ? v.holder.slice(0, 80) : "",
    acting: v.acting !== false,
    servers: num(v.servers), needSoon: num(v.needSoon), actions: num(v.actions), failed: num(v.failed),
    timetable: typeof v.timetable === "string" ? v.timetable.slice(0, 300) : "",
    paused: v.paused === true,
    notes: Array.isArray(v.notes) ? v.notes.filter((n): n is string => typeof n === "string").slice(0, 10) : [],
    recent: Array.isArray(v.recent) ? v.recent.filter((l): l is { at: string; text: string } => !!l && typeof l.at === "string" && typeof l.text === "string").slice(-40) : [],
  };
}

/* -------------------------------------------------------------------------- */
/* Bucket I/O (small files, read fresh each time)                              */
/* -------------------------------------------------------------------------- */

async function readJson(key: string): Promise<unknown | null> {
  try {
    const { getFile } = await import("@/lib/storage");
    const response = await getFile(key);
    if (!response) return null;
    return await response.json();
  } catch {
    return null;
  }
}

export async function readControl(): Promise<Control> {
  return parseStoredControl(await readJson(CONTROL_KEY));
}

export async function writeControl(control: Control): Promise<void> {
  const { putFile } = await import("@/lib/storage");
  await putFile({ key: CONTROL_KEY, body: Buffer.from(JSON.stringify(control)), contentType: "application/json" });
}

export const SPEND_KEY = "recordings/_recorder-release/spend.json";

export async function readSpendFile(): Promise<unknown | null> {
  return readJson(SPEND_KEY);
}

export async function readSchedulerBeats(): Promise<{ primary: SchedulerBeat | null; standby: SchedulerBeat | null }> {
  const [primary, standby] = await Promise.all([readJson(PRIMARY_BEAT_KEY), readJson(STANDBY_BEAT_KEY)]);
  return { primary: parseSchedulerBeat(primary), standby: parseSchedulerBeat(standby) };
}

/* -------------------------------------------------------------------------- */
/* "Why did no server take this class?" for the alerts                         */
/* -------------------------------------------------------------------------- */

const SILENT_MS = 10 * 60_000;

/** One sentence naming the most likely cause, or "" when the scheduler looks fine (so the alert says nothing extra). */
export function describeSchedulerProblem(beats: { primary: SchedulerBeat | null; standby: SchedulerBeat | null }, control: Control, now: Date): string {
  const age = (b: SchedulerBeat | null) => (b ? now.getTime() - Date.parse(b.at) : Infinity);
  const standbyActing = !!beats.standby && beats.standby.acting && age(beats.standby) < SILENT_MS;
  if (control.paused) return `Automatic servers are paused${control.updatedBy ? ` (by ${control.updatedBy})` : ""}: resume them on the recorder page.`;
  if (age(beats.primary) > SILENT_MS && !standbyActing) {
    return beats.primary
      ? `The recorder scheduler has been silent for ${Math.round(age(beats.primary) / 60_000)} minutes, so no server was started.`
      : "The recorder scheduler has never reported, so no server was started.";
  }
  return "";
}

let hintCache: { at: number; text: string } | null = null;

/** The cause line for an alert. Never throws, never waits long, and is cached for a minute (alerts can repeat every heartbeat). */
export async function schedulerHint(now: Date = new Date()): Promise<string> {
  if (hintCache && now.getTime() - hintCache.at < 60_000) return hintCache.text;
  let text = "";
  try {
    const [beats, control] = await Promise.race([
      Promise.all([readSchedulerBeats(), readControl()]),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 2_500)),
    ]);
    // Nothing in the bucket at all means the scheduler is not set up (or storage is not configured): say nothing rather than guess.
    text = beats.primary || beats.standby || control.updatedAt ? describeSchedulerProblem(beats, control, now) : "";
  } catch {
    text = "";
  }
  hintCache = { at: now.getTime(), text };
  return text;
}

export function resetSchedulerHintCache(): void {
  hintCache = null;
}
