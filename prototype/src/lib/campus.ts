/**
 * CAMPUS — a place you can see other students being, not another chat app.
 *
 * The idea, in one line: people come back to somewhere that feels inhabited.
 * "9 studying right now" is a stronger reason to open the app than any
 * notification, and it costs almost nothing to run if it is built the right
 * way round.
 *
 * THE RIGHT WAY ROUND
 *
 *   Rooms, not coordinates. A free-roaming map needs a position update from
 *   every phone several times a second; a room needs one number a minute. A
 *   student is "in the Library", not at (x, y) — and the screen still looks
 *   like a street full of people, because the headcounts and the faces are the
 *   whole effect.
 *
 *   Heartbeat, not connection. A phone says "still here" every 90 seconds
 *   while the app is visible. Online is simply "said so in the last 150
 *   seconds", so there is nothing to clean up when a phone goes in a pocket.
 *
 *   One shared snapshot. Everyone in the same age band reads the same
 *   10-second-old picture of the campus (see campus-server.ts), so the number
 *   of database reads depends on how many BANDS there are, not on how many
 *   students are looking.
 *
 * THE SAFETY LINE
 *
 *   Students under 18 and adults never meet. `bandOf` puts every student in one
 *   of three bands, and the server — never the browser — scopes every
 *   snapshot, request and duel to the viewer's own band. A student whose age we
 *   cannot work out is in a third band of their own rather than guessed at,
 *   because a wrong guess in either direction puts an adult among minors or a
 *   minor among adults. There are no private messages anywhere on Campus, and
 *   in this first slice there is no free text at all: a wave and a challenge
 *   are the only things one student can send another.
 *
 * Pure, client-safe, unit-tested without a database.
 */

export type Band = "minor" | "adult" | "unknown";

/** Under 18, 18 and over, and "we do not know". */
export function bandOf(age: number | null | undefined): Band {
  if (typeof age !== "number" || !Number.isFinite(age)) return "unknown";
  return age < 18 ? "minor" : "adult";
}

/* -------------------------------------------------------------------------- */
/* Rooms                                                                      */
/* -------------------------------------------------------------------------- */

export type RoomId = "library" | "arena" | "cafe" | "exam";

export type RoomDef = {
  id: RoomId;
  name: string;
  blurb: string;
  /** False = shown as "opening soon". A teaser is an honest promise, not a dead button. */
  open: boolean;
};

export const ROOMS: readonly RoomDef[] = [
  { id: "library", name: "Library", blurb: "Silent study with a shared timer", open: true },
  { id: "arena", name: "Arena", blurb: "Wortduell — der, die or das?", open: true },
  { id: "cafe", name: "Café", blurb: "Chat in German, easy mode", open: false },
  { id: "exam", name: "Prüfungsraum", blurb: "Exam practice with others", open: false },
];

/** Where a student can be: a room, or just wandering the campus. */
export type PresenceRoom = RoomId | "lobby";

export const isPresenceRoom = (value: unknown): value is PresenceRoom =>
  value === "lobby" || ROOMS.some((r) => r.id === value);

/* -------------------------------------------------------------------------- */
/* Presence                                                                   */
/* -------------------------------------------------------------------------- */

/** How often a visible phone says "still here". */
export const HEARTBEAT_MS = 90_000;
/** How long after the last heartbeat somebody still counts as online. */
export const ONLINE_WINDOW_MS = 150_000;
/** How often the Campus screen refreshes its picture while it is open. */
export const SNAPSHOT_REFRESH_MS = 30_000;
/** The shared server-side snapshot is reused for this long. */
export const SNAPSHOT_TTL_MS = 10_000;
/** Faces drawn per room — the rest are a "+N". */
export const FACES_PER_ROOM = 8;

export const isOnline = (lastSeenAt: Date | number, now: Date | number = Date.now()): boolean =>
  new Date(now).getTime() - new Date(lastSeenAt).getTime() <= ONLINE_WINDOW_MS;

/** "Ada Okafor" -> "Ada O." — enough to be recognised, not enough to be searched. */
export function displayName(full: string | null | undefined): string {
  const parts = String(full ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "Student";
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
}

export type PresencePerson = {
  userId: string;
  name: string;
  avatar: unknown;
  level: string;
  room: PresenceRoom;
};

export type RoomSummary = {
  id: PresenceRoom;
  count: number;
  people: PresencePerson[];
  /** People beyond FACES_PER_ROOM, shown as "+N". */
  more: number;
};

export type CampusSnapshot = {
  online: number;
  /** In the Library right now. */
  studying: number;
  rooms: Record<PresenceRoom, RoomSummary>;
};

/**
 * Fold a list of online people into per-room headcounts.
 *
 * The viewer is included in the counts but never in their own face row: you do
 * not need to see yourself standing in the Library, you need to see who else is.
 * Callers pass only people who are visible (not hidden) and online.
 */
export function summariseCampus(people: PresencePerson[], viewerId?: string): CampusSnapshot {
  const empty = (id: PresenceRoom): RoomSummary => ({ id, count: 0, people: [], more: 0 });
  const rooms: Record<PresenceRoom, RoomSummary> = {
    lobby: empty("lobby"),
    library: empty("library"),
    arena: empty("arena"),
    cafe: empty("cafe"),
    exam: empty("exam"),
  };

  for (const person of people) {
    const room = rooms[person.room] ?? rooms.lobby;
    room.count += 1;
    if (person.userId === viewerId) continue;
    if (room.people.length < FACES_PER_ROOM) room.people.push(person);
    else room.more += 1;
  }

  return { online: people.length, studying: rooms.library.count, rooms };
}

/* -------------------------------------------------------------------------- */
/* Requests                                                                   */
/* -------------------------------------------------------------------------- */

export type RequestKind = "wave" | "duel";

export const REQUEST_TTL_MS: Record<RequestKind, number> = {
  /** A duel is for now; if nobody takes it in three minutes the moment has passed. */
  duel: 3 * 60_000,
  /** A wave is a hello; it can wait a few minutes to be seen. */
  wave: 5 * 60_000,
};

/** Per student, per rolling hour — enough to be sociable, too few to spam. */
export const MAX_REQUESTS_PER_HOUR = 10;
/** Open (unanswered) requests one student may have out at once. */
export const MAX_OPEN_OUTGOING = 3;

export type RequestGate = { ok: true } | { ok: false; reason: "rate" | "open" | "self" | "band" };

export function requestAllowed(input: {
  sentLastHour: number;
  openOutgoing: number;
  fromUserId: string;
  toUserId: string | null;
  fromBand: Band;
  toBand: Band | null;
}): RequestGate {
  if (input.toUserId && input.toUserId === input.fromUserId) return { ok: false, reason: "self" };
  if (input.toUserId && input.toBand !== input.fromBand) return { ok: false, reason: "band" };
  if (input.sentLastHour >= MAX_REQUESTS_PER_HOUR) return { ok: false, reason: "rate" };
  if (input.openOutgoing >= MAX_OPEN_OUTGOING) return { ok: false, reason: "open" };
  return { ok: true };
}

export const REQUEST_REFUSALS: Record<Exclude<RequestGate, { ok: true }>["reason"], string> = {
  self: "You can't send that to yourself.",
  band: "That student isn't available to you.",
  rate: "You've sent a lot of requests — give it a few minutes.",
  open: "You already have requests waiting. Let one finish first.",
};

/* -------------------------------------------------------------------------- */
/* Coins                                                                      */
/* -------------------------------------------------------------------------- */

export type CoinReason = "daily" | "avatar" | "duel_play" | "duel_win" | "focus" | "wave";

/**
 * What earns coins, how much, and how many times a day.
 *
 * Every reward has a daily cap, and that is the entire anti-farming design: a
 * coin economy that can be ground by repeating one cheap action stops meaning
 * anything within a week. With these caps the most one student can earn in a
 * day is `MAX_DAILY_COINS`, and the large part of it needs real activity — a
 * study streak, a few duels, a focus block.
 *
 * `once` rewards happen a single time per student, ever.
 */
export const COIN_RULES: Record<CoinReason, { amount: number; perDay?: number; once?: boolean; label: string }> = {
  daily: { amount: 5, perDay: 1, label: "Daily visit" },
  avatar: { amount: 20, once: true, label: "Made your avatar" },
  duel_play: { amount: 8, perDay: 5, label: "Played a duel" },
  duel_win: { amount: 7, perDay: 5, label: "Won a duel" },
  focus: { amount: 3, perDay: 4, label: "Finished a focus block" },
  wave: { amount: 1, perDay: 5, label: "Said hello" },
};

export const MAX_DAILY_COINS = Object.values(COIN_RULES).reduce(
  (sum, rule) => sum + (rule.once ? 0 : rule.amount * (rule.perDay ?? 1)),
  0,
);

/**
 * The student's "today". Campus days roll over at midnight in Lagos (UTC+1),
 * not at 01:00 — a daily reward that resets while somebody is still studying
 * at 12:30 a.m. feels like a bug.
 */
export function campusDay(now: Date | number = Date.now()): string {
  return new Date(new Date(now).getTime() + 3_600_000).toISOString().slice(0, 10);
}

/**
 * The idempotency key for one award. Unique per student, so repeating the same
 * award (a retry, a refresh, two tabs) is a no-op rather than a second payout.
 * `n` distinguishes the 1st, 2nd, 3rd … award of a reason within a day.
 */
export function coinRefKey(reason: CoinReason, day: string, n: number = 1, extra?: string): string {
  const rule = COIN_RULES[reason];
  if (rule.once) return `${reason}:once`;
  return [reason, day, extra ?? n].join(":");
}

/* -------------------------------------------------------------------------- */
/* The shared timer                                                           */
/* -------------------------------------------------------------------------- */

export const FOCUS_MS = 25 * 60_000;
export const BREAK_MS = 5 * 60_000;
const CYCLE_MS = FOCUS_MS + BREAK_MS;

export type FocusPhase = {
  phase: "focus" | "break";
  /** Milliseconds left in this phase. */
  remainingMs: number;
  /** Which 30-minute cycle this is, counted from the epoch — the same number on every phone. */
  cycle: number;
};

/**
 * The Library's timer is the WALL CLOCK: every half hour is 25 minutes of focus
 * then 5 of break, on every phone, with no server in the loop. Everybody in the
 * room is therefore on the same beat for free — the thing that makes studying
 * alongside strangers feel shared — and it costs nothing to run.
 */
export function focusPhase(now: Date | number = Date.now()): FocusPhase {
  const t = new Date(now).getTime();
  const cycle = Math.floor(t / CYCLE_MS);
  const into = t - cycle * CYCLE_MS;
  return into < FOCUS_MS
    ? { phase: "focus", remainingMs: FOCUS_MS - into, cycle }
    : { phase: "break", remainingMs: CYCLE_MS - into, cycle };
}

/** "07:42" */
export function clock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}
