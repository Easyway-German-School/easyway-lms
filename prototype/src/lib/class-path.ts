/**
 * Shared shape and rules for the class schedule views.
 *
 * The path map and the month grid are two renderings of the same thing, so the
 * unlock rule, the "which one is next" rule and the date formatting all live
 * here. If they lived in each component they would drift, and a class could
 * read as locked in one view and open in the other.
 */

export type Material = { id: string; title: string; filePath: string; fileType: string };

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
};

/** done = already held · today = running today · locked = ahead · off = postponed/cancelled */
export type NodeState = "done" | "today" | "locked" | "off";

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
  done: number;
  total: number;
  nextNode: ClassNode | null;
};

/** Flatten months into one ordered list and work out each class's state. */
export function buildNodes(months: Month[] | undefined, now = new Date()): BuiltSchedule {
  const flat: Session[] = (months ?? []).flatMap((m) => m.sessions);

  let firstFuture = -1;
  const nodes: ClassNode[] = flat.map((s, index) => {
    const date = new Date(s.date);
    const off = s.status === "postponed" || s.status === "cancelled";
    const isPast = startOfDay(date) < startOfDay(now);
    const isToday = daysBetween(date, now) === 0;

    if (!off && !isPast && !isToday && firstFuture === -1) firstFuture = index;

    const state: NodeState = off ? "off" : isPast ? "done" : isToday ? "today" : "locked";
    return { ...s, index, state, isNext: false };
  });

  if (firstFuture >= 0) nodes[firstFuture].isNext = true;

  return {
    nodes,
    done: nodes.filter((n) => n.state === "done").length,
    total: nodes.length,
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
  };
}
