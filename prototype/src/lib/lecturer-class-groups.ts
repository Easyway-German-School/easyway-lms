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

export type ClassGroupMember = {
  level?: string | null;
  deliveryMode?: string | null;
  sessionSlot?: string | null;
  batch?: string | null;
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
  if (member.batch?.trim()) parts.push(member.batch.trim());
  return parts.join(" · ");
}

export type ClassGroup<T> = {
  key: string;
  label: string;
  /** Lower-cased delivery mode — "online" | "hybrid" | "physical". */
  mode: string;
  members: T[];
};

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
        members: [],
      };
      map.set(key, group);
    }
    group.members.push(member);
  }

  const modeRank = (mode: string) => (mode === "online" ? 2 : mode === "hybrid" ? 1 : 0);
  return [...map.values()].sort(
    (a, b) => modeRank(a.mode) - modeRank(b.mode) || a.label.localeCompare(b.label),
  );
}
