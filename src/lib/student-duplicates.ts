/**
 * Finding — and safely collapsing — the same student entered twice.
 *
 * The office adds students three ways: the WordPress signup form, a paper /
 * spreadsheet import, and one-at-a-time on /admin/students. A returning student
 * who signed themselves up in July and is then imported again from a September
 * paper form ends up as two rows: one with their real Gmail and a claimed
 * password, one with a placeholder `noemail.…@…placeholder.…` address nobody
 * can type. Same person, two logins, and their fees land against whichever row
 * the last write touched.
 *
 * This module clusters those pairs on `normalised name` + `phone` (BOTH must
 * match — siblings share a phone but not a name, so they never cluster), scores
 * each row for completeness, and names the one to keep. The actual merge lives
 * in the route; this file is pure so the page and the route can share the
 * types and the scoring without either pulling in Prisma.
 */

export type EmailKind = "typed" | "login" | "placeholder" | "missing";

/** The school's synthesised login domain — a real address, but not a mailbox. */
export const LOGIN_EMAIL_DOMAIN = "student.easywayschoollms.com.ng";

/** digits only, drop leading zeros, keep the last 10 — the importer's key. */
export function phoneKeyOf(value: string | null | undefined): string {
  return String(value ?? "").replace(/\D/g, "").replace(/^0+/, "").slice(-10);
}

/**
 * Lowercase, strip everything but letters/digits/spaces, collapse whitespace,
 * then sort the words so "Franklin Izuka" and "Izuka, Franklin" land on the
 * same key. Returns "" when nothing usable is left.
 */
export function normalizeName(value: string | null | undefined): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(" ");
}

export function emailKindOf(raw: string | null | undefined): EmailKind {
  const email = (raw ?? "").trim().toLowerCase();
  if (!email) return "missing";
  if (
    email.includes(".placeholder.") ||
    email.includes("noemail") ||
    email.endsWith(".invalid") ||
    email.endsWith(".local") ||
    email.endsWith(".test") ||
    email.endsWith(".example")
  ) {
    return "placeholder";
  }
  if (email.endsWith(`@${LOGIN_EMAIL_DOMAIN}`)) return "login";
  if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email)) return "placeholder";
  return "typed";
}

export type DuplicateActivity = {
  attendance: number;
  submissions: number;
  grades: number;
  certificates: number;
  payments: number;
  tuitionCharges: number;
};

export type DuplicateMemberInput = {
  studentId: string;
  userId: string;
  name: string;
  email: string;
  passwordClaimed: boolean;
  studentCode: string | null;
  level: string;
  branchName: string | null;
  sessionSlot: string;
  batch: string | null;
  phone: string | null;
  hasPhoto: boolean;
  createdAt: string;
  activity: DuplicateActivity;
};

export type DuplicateMember = DuplicateMemberInput & {
  emailKind: EmailKind;
  score: number;
  /** Attendance, marked work, grades or a certificate — real classroom history. */
  hasLearningHistory: boolean;
};

export type DuplicateCluster = {
  key: string;
  nameKey: string;
  phoneKey: string;
  keeperId: string;
  members: DuplicateMember[];
  /** Non-keepers with no learning history — safe to fold in with one click. */
  mergeableIds: string[];
  /** Set when something in the cluster needs a person, not the button. */
  reviewNote: string | null;
};

/** Higher is "more of a real, in-use account". */
export function scoreMember(m: DuplicateMemberInput): number {
  const kind = emailKindOf(m.email);
  let score = 0;
  if (kind === "typed") score += 6;
  else if (kind === "login") score += 2;
  if (kind === "typed" && m.passwordClaimed) score += 2; // they set their own password
  if (m.hasPhoto) score += 2;
  if (m.branchName) score += 1;
  if (m.phone) score += 1;
  if (m.batch) score += 1;
  if (m.studentCode) score += 1;
  if (m.activity.payments > 0) score += 5;
  if (m.activity.tuitionCharges > 0) score += 1;
  if (m.activity.attendance > 0) score += 4;
  if (m.activity.submissions > 0) score += 3;
  if (m.activity.grades > 0) score += 2;
  if (m.activity.certificates > 0) score += 3;
  return score;
}

function learningHistory(a: DuplicateActivity): boolean {
  return a.attendance > 0 || a.submissions > 0 || a.grades > 0 || a.certificates > 0;
}

/**
 * Group members into duplicate clusters. A cluster needs a non-empty name key
 * AND a 10-digit phone key shared by two or more rows.
 */
export function buildClusters(rows: DuplicateMemberInput[]): DuplicateCluster[] {
  const buckets = new Map<string, DuplicateMember[]>();

  for (const row of rows) {
    const nameKey = normalizeName(row.name);
    const phoneKey = phoneKeyOf(row.phone);
    if (!nameKey || phoneKey.length < 10) continue;
    const key = `${nameKey}||${phoneKey}`;
    const member: DuplicateMember = {
      ...row,
      emailKind: emailKindOf(row.email),
      score: scoreMember(row),
      hasLearningHistory: learningHistory(row.activity),
    };
    const list = buckets.get(key) ?? [];
    list.push(member);
    buckets.set(key, list);
  }

  const clusters: DuplicateCluster[] = [];
  for (const [key, members] of buckets) {
    if (members.length < 2) continue;
    members.sort(
      (a, b) => b.score - a.score || a.createdAt.localeCompare(b.createdAt), // tie: the older row is the original
    );
    const [nameKey, phoneKey] = key.split("||");
    const keeper = members[0];
    const others = members.slice(1);
    const mergeableIds = others.filter((m) => !m.hasLearningHistory).map((m) => m.studentId);

    let reviewNote: string | null = null;
    const blocked = others.filter((m) => m.hasLearningHistory);
    if (blocked.length > 0) {
      reviewNote = `${blocked.length === 1 ? "One duplicate has" : `${blocked.length} duplicates have`} attendance or classwork — merge ${blocked.length === 1 ? "it" : "them"} by hand.`;
    } else if (members.length > 2) {
      reviewNote = "Three or more records — check each before folding them in.";
    }

    clusters.push({ key, nameKey, phoneKey, keeperId: keeper.studentId, members, mergeableIds, reviewNote });
  }

  // Busiest / most-complete keeper first.
  clusters.sort((a, b) => b.members[0].score - a.members[0].score);
  return clusters;
}
