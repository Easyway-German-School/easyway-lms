/**
 * Shared shape and rules for the class schedule views.
 *
 * The path map and the month grid are two renderings of the same thing, so the
 * unlock rule, the "which one is next" rule and the date formatting all live
 * here. If they lived in each component they would drift, and a class could
 * read as locked in one view and open in the other.
 */

export type Material = {
  id: string;
  title: string;
  filePath: string;
  fileType: string;
  /** Two sentences generated after upload, so the calendar can preview it. */
  aiSummary?: string | null;
  aiQuestCount?: number;
};

export type Session = {
  date: string;
  weekday: string;
  title: string;
  defaultFocus: string;
  timeSlot: string;
  startTime: string;
  endTime: string;
  topic: string | null;
  notes: string | null;
  status: string;
  postponedTo: string | null;
  lecturerName: string | null;
  material: Material | null;
};

export type Month = { label: string; patternLabel: string; sessions: Session[] };

export type SchedulePayload = {
  level: string;
  months: Month[];
  currentLevel?: string;
  nextLevel?: string | null;
  viewingNextLevel?: boolean;
  /** When this student joined — see `buildNodes`. */
  joinedAt?: string | null;
  /** What the register actually says, keyed by YYYY-MM-DD. */
  attendance?: Array<{ date: string; present: boolean }>;
};

/**
 * done = already held · today = running today · locked = ahead ·
 * postponed = moved to another date · cancelled = not happening
 *
 * Postponed and cancelled were one state ("off") drawn in one colour. To a
 * student scanning their month those are completely different pieces of news —
 * one means "turn up on a different day", the other means "do not turn up" —
 * and a single red box made them indistinguishable.
 */
/**
 * `before` and `missed` are the two states this map used to be missing, and
 * their absence is what made it dishonest.
 *
 *   before   the class ran before this student joined the school. Not theirs to
 *            have attended, and not counted against them.
 *   done     they were marked present.
 *   missed   they were marked absent.
 *   held     it happened, after they joined, and nobody marked the register.
 *
 * The old type had only `done`, and every past date got it — so a student who
 * registered yesterday opened the calendar to a run of completed classes and a
 * progress bar celebrating work they had never done.
 */
export type NodeState =
  | "before"
  | "done"
  | "missed"
  | "held"
  | "today"
  | "locked"
  | "postponed"
  | "cancelled";

export type ClassNode = Session & {
  index: number;
  state: NodeState;
  isNext: boolean;
};

export const SLOT_LABEL: Record<string, string> = {
  morning: "Morning",
  afternoon: "Afternoon",
  evening: "Evening",
};

export const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const WEEKDAY_INITIALS = ["S", "M", "T", "W", "T", "F", "S"];

/**
 * Dates are formatted explicitly rather than with toLocaleDateString, whose
 * output depends on the runtime's locale — server and browser can disagree
 * ("Friday, July 31" vs "Friday 31 July") and React then throws the tree away
 * as a hydration mismatch.
 */
export function longDate(d: Date) {
  return `${WEEKDAY_NAMES[d.getDay()]} ${d.getDate()} ${MONTH_NAMES[d.getMonth()]}`;
}

export function shortDate(d: Date) {
  return `${d.getDate()} ${MONTH_NAMES[d.getMonth()]}`;
}

/**
 * Read a stored class day back as a local date.
 *
 * `ClassSession.date` and `postponedTo` are midnight UTC — the join key the
 * whole timetable is built on. Passing that straight to `new Date()` and then
 * reading `getDate()` gives the previous day for any reader west of UTC, which
 * is how a postponement notice ended up naming the wrong date. This rebuilds
 * the same calendar day in local terms so the formatters above are safe.
 */
export function parseDayKey(iso: string): Date {
  const utc = new Date(iso);
  return new Date(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate());
}

export function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function daysBetween(a: Date, b: Date) {
  return Math.round((startOfDay(a).getTime() - startOfDay(b).getTime()) / 86_400_000);
}

/**
 * A class unlocks at the start of its own day. Today's is readable, tomorrow's
 * is sealed.
 *
 * The TIME is never hidden — a student has to be able to plan around when they
 * are expected. It is the topic that stays behind the lock.
 */
export function isUnlocked(node: { state: NodeState }) {
  return node.state !== "locked";
}

export type BuiltSchedule = {
  nodes: ClassNode[];
  /** Classes marked present. Never inferred from the date alone. */
  done: number;
  /**
   * Classes this student could have attended — excludes anything that ran
   * before they joined, which is what the progress bar must be a fraction of.
   */
  total: number;
  /** Held after they joined but never marked, so honestly unknown. */
  unmarked: number;
  nextNode: ClassNode | null;
};

export type ScheduleFacts = {
  /** When this student joined. Classes before it were never theirs. */
  joinedAt?: string | null;
  /** Register entries, keyed by YYYY-MM-DD. */
  attendance?: Array<{ date: string; present: boolean }>;
};

/** Local YYYY-MM-DD, matching how the server keys attendance. */
function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Flatten months into one ordered list and work out each class's state.
 *
 * `facts` is optional so the tutor's timetable — which renders the same shape
 * for a cohort rather than a person — can keep calling this without inventing
 * an attendance record. Without it, past classes read as `held`: happened,
 * unknown outcome. That is the honest default, and importantly it is NOT
 * `done`, which used to be applied to every past date on no evidence at all.
 */
export function buildNodes(
  months: Month[] | undefined,
  now = new Date(),
  facts: ScheduleFacts = {},
): BuiltSchedule {
  const flat: Session[] = (months ?? []).flatMap((m) => m.sessions);

  const joined = facts.joinedAt ? startOfDay(new Date(facts.joinedAt)) : null;
  const register = new Map((facts.attendance ?? []).map((a) => [a.date, a.present]));

  let firstFuture = -1;
  const nodes: ClassNode[] = flat.map((s, index) => {
    const date = new Date(s.date);
    const off = s.status === "postponed" || s.status === "cancelled";
    const isPast = startOfDay(date) < startOfDay(now);
    const isToday = daysBetween(date, now) === 0;

    if (!off && !isPast && !isToday && firstFuture === -1) firstFuture = index;

    let state: NodeState;
    if (off) {
      state = s.status === "cancelled" ? "cancelled" : "postponed";
    } else if (isPast) {
      /**
       * The batch rotation is generated from the batch month, which is
       * routinely earlier than the day somebody signed up. Those classes are
       * real — they happened — but they happened to other people, and showing
       * them as this student's completed work is how a calendar starts lying
       * on day one.
       */
      if (joined && startOfDay(date) < joined) {
        state = "before";
      } else {
        const marked = register.get(dayKey(date));
        state = marked === true ? "done" : marked === false ? "missed" : "held";
      }
    } else {
      state = isToday ? "today" : "locked";
    }

    return { ...s, index, state, isNext: false };
  });

  if (firstFuture >= 0) nodes[firstFuture].isNext = true;

  // A class that ran before they arrived is not part of anybody's denominator.
  const theirs = nodes.filter((n) => n.state !== "before");

  return {
    nodes,
    done: nodes.filter((n) => n.state === "done").length,
    total: theirs.length,
    unmarked: nodes.filter((n) => n.state === "held").length,
    nextNode: firstFuture >= 0 ? nodes[firstFuture] : null,
  };
}

/** What a popover should show for a class, honouring the lock. */
export function nodeSummary(node: ClassNode) {
  return {
    when: `${node.startTime}–${node.endTime}`,
    slot: SLOT_LABEL[node.timeSlot] ?? node.timeSlot,
    // Time is always shown; the topic is what the lock withholds.
    topic: isUnlocked(node) ? node.topic || node.defaultFocus : null,
    lockedUntil: isUnlocked(node) ? null : shortDate(new Date(node.date)),
    tutor: node.lecturerName,
    material: isUnlocked(node) ? node.material : null,
    postponedTo: node.postponedTo,
    status: node.status,
    /**
     * The tutor's note for the day. Shown even while the topic is locked: a
     * note saying "bring your workbook" is useless if it only appears on the
     * morning of the class.
     */
    notes: node.notes,
    /**
     * Materials stay downloadable through a postponement. The class moved; the
     * homework did not, and hiding it punishes the student for the change.
     */
    materialAlways: node.material,
  };
}
