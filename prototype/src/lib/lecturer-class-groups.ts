/**
 * Splitting a tutor's students into the classes they actually teach.
 *
 * A tutor who takes two or three levels — or the same level online and in the
 * room — had every one of those students in a single flat list, with no way to
 * see at a glance which sub-class a name belonged to or to address one of them
 * on its own. This is the one place that decides what "a group" means for the
 * tutor portal: level, then delivery mode, then sitting, then batch. The roster
 * and the announcement picker both read it so they never disagree.
 */

import { compareBatches } from "@/lib/class-batch";

export type ClassGroupMember = {
  level?: string | null;
  deliveryMode?: string | null;
  sessionSlot?: string | null;
  batch?: string | null;
  branchId?: string | null;
  branchMode?: string | null;
  /** Put on the tutor by the office rather than matched into the class. */
  namedByOffice?: boolean;
};

export function deliveryModeLabel(mode?: string | null): string {
  switch ((mode || "").toLowerCase()) {
    case "online":
      return "Online";
    case "hybrid":
      return "Hybrid";
    default:
      return "In person";
  }
}

export function sessionLabel(slot?: string | null): string {
  if (!slot) return "";
  return slot.charAt(0).toUpperCase() + slot.slice(1);
}

export function classGroupKey(member: ClassGroupMember): string {
  return [
    (member.level || "").trim().toUpperCase() || "—",
    (member.deliveryMode || "physical").toLowerCase(),
    (member.sessionSlot || "").toLowerCase() || "—",
    (member.batch || "").trim(),
  ].join("|");
}

export function classGroupLabel(member: ClassGroupMember): string {
  const parts = [member.level?.trim() || "Level not set", deliveryModeLabel(member.deliveryMode)];
  const session = sessionLabel(member.sessionSlot);
  if (session) parts.push(session);
  if (member.batch?.trim()) parts.push(`${member.batch.trim()} batch`);
  return parts.join(" · ");
}

export type ClassGroup<T> = {
  key: string;
  label: string;
  /** Lower-cased delivery mode — "online" | "hybrid" | "physical". */
  mode: string;
  /** The intake this class is ("September"), or "" when its students have none on record. */
  batch: string;
  members: T[];
};

/**
 * The `/live?group=` key that starts THIS class — `branchId:LEVEL:slot:Batch`,
 * the same key `teachingGroups` hands the dashboard — or null when the class
 * cannot be started from here: no branch on its students, or only students the
 * office put on the tutor by name (those are not a class the assignment covers,
 * and the server would refuse the room), or a campus-only class with no video room.
 */
export function goLiveKeyFor<T extends ClassGroupMember>(group: ClassGroup<T>): string | null {
  const own = group.members.filter((member) => !member.namedByOffice && member.branchId);
  if (own.length === 0) return null;
  const first = own[0];
  const hasVideoRoom =
    group.mode === "online" || group.mode === "hybrid" || (first.branchMode ?? "") !== "physical";
  if (!hasVideoRoom) return null;
  const level = (first.level || "").trim().toUpperCase();
  const slot = (first.sessionSlot || "").trim().toLowerCase();
  if (!level) return null;
  const base = `${first.branchId}:${level}:${slot}`;
  return group.batch ? `${base}:${group.batch}` : base;
}

/**
 * Group members into classes, ordered so the online sittings sit together at
 * the end (a tutor scanning for "the one I take online" wants them in one
 * place) and everything else reads level-first.
 */
export function groupByClass<T extends ClassGroupMember>(members: T[]): Array<ClassGroup<T>> {
  const map = new Map<string, ClassGroup<T>>();
  for (const member of members) {
    const key = classGroupKey(member);
    let group = map.get(key);
    if (!group) {
      group = {
        key,
        label: classGroupLabel(member),
        mode: (member.deliveryMode || "physical").toLowerCase(),
        batch: (member.batch || "").trim(),
        members: [],
      };
      map.set(key, group);
    }
    group.members.push(member);
  }

  const modeRank = (mode: string) => (mode === "online" ? 2 : mode === "hybrid" ? 1 : 0);
  // The batches of one class sit together, the one that started first on top —
  // September above October. Sorting on the whole label put them alphabetically.
  const withoutBatch = (group: ClassGroup<T>) =>
    group.batch ? group.label.slice(0, group.label.length - ` · ${group.batch} batch`.length) : group.label;
  return [...map.values()].sort(
    (a, b) =>
      modeRank(a.mode) - modeRank(b.mode) ||
      withoutBatch(a).localeCompare(withoutBatch(b)) ||
      compareBatches(a.batch, b.batch),
  );
}
