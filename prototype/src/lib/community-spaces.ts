import { prisma } from "@/lib/prisma";

/**
 * Who may read and write in which cohort's chat.
 *
 * A Space is scoped to one branch, one level AND one sitting. That last part is
 * the change that matters, and it is not a refinement — it is a correction.
 * Branch + level was never a class. Lagos runs A1 in the morning, the afternoon
 * and the evening as three separate cohorts, with three different tutors and
 * three sets of students who never meet each other. Putting them in one room
 * meant a morning student read questions about a lesson they had not sat, and
 * answers from a tutor who is not theirs.
 *
 * So a student resolves to exactly one space: theirs. Not "theirs plus the
 * other sittings, filtered in the UI" — resolved here, once, and every
 * community route asks this module rather than trusting an id from the client.
 *
 * Staff are the deliberate exception. An admin has to be able to monitor every
 * room in the school, and a tutor covering a colleague's sitting has to be able
 * to answer in it. Restricting staff would break the moderation the school is
 * promising its students, which is the opposite of the point.
 */

export type Viewer = {
  userId: string;
  role: string;
};

export type SpaceScope = {
  spaceIds: string[];
  isStaff: boolean;
  branchId: string | null;
  level: string | null;
  sessionSlot: string | null;
};

function normalizeRole(role: unknown) {
  return String(role || "").toLowerCase();
}

export function isStaffRole(role: unknown) {
  const r = normalizeRole(role);
  return r === "admin" || r === "lecturer";
}

/** The three sittings, in the order a timetable reads. */
export const SESSION_SLOTS = ["morning", "afternoon", "evening"] as const;
export type SessionSlot = (typeof SESSION_SLOTS)[number];

export function normalizeSlot(value: unknown): SessionSlot {
  const slot = String(value ?? "").trim().toLowerCase();
  return (SESSION_SLOTS as readonly string[]).includes(slot) ? (slot as SessionSlot) : "morning";
}

export function slotLabel(slot: string): string {
  const normalized = normalizeSlot(slot);
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

/**
 * The rooms every cohort gets.
 *
 * Deliberately three, and the reasoning is the same one that trimmed the
 * original six: empty rooms are what kill a young community. A student who
 * opens the hub and finds six silent channels does not come back. Add more when
 * these get noisy.
 *
 * `announcement` is not a topic — it is the one room where students read and
 * only staff write, which is what stops class news being buried under chat.
 */
const DEFAULT_CHANNELS: Array<{
  slug: string;
  name: string;
  description: string;
  kind: string;
  position: number;
}> = [
  {
    slug: "announcements",
    name: "Announcements",
    description: "Class news from your tutor and the branch office.",
    kind: "announcement",
    position: 0,
  },
  {
    slug: "general",
    name: "General",
    description: "Say hallo, share wins, ask anything.",
    kind: "topic",
    position: 1,
  },
  {
    slug: "grammar",
    name: "Homework & help",
    description: "Stuck on an exercise, a case or a verb? Post it here.",
    kind: "topic",
    position: 2,
  },
];

/** Only staff may post in an announcement channel. Enforced server-side. */
export function canPostInChannel(kind: string, role: unknown): boolean {
  return kind !== "announcement" || isStaffRole(role);
}

export type CohortKey = {
  branchId: string;
  branchName?: string | null;
  level: string;
  sessionSlot: string;
};

/**
 * Make sure this cohort has a room, and hand it back.
 *
 * PROVISIONED ON DEMAND RATHER THAN SEEDED, because seeding cannot keep up.
 * Spaces used to be created by a script that walked every branch × level, which
 * meant a new branch, a new level or — the case that broke this — a new sitting
 * had no room until somebody remembered to re-run it. A student in the first
 * evening A1 class would have opened the community and found nothing, with no
 * error to explain it.
 *
 * Upserting on the natural key makes that impossible: the first person through
 * the door creates the room. It is also why the unique constraint carries all
 * three columns — two students arriving at once both upsert, and the database
 * settles it rather than leaving duplicate rooms.
 */
export async function ensureSpaceForCohort(cohort: CohortKey) {
  const sessionSlot = normalizeSlot(cohort.sessionSlot);
  const level = cohort.level;

  const branchName =
    cohort.branchName ??
    (await prisma.branch.findUnique({ where: { id: cohort.branchId }, select: { name: true } }))?.name ??
    "EasyWay";

  const space = await prisma.space.upsert({
    where: {
      branchId_level_sessionSlot: { branchId: cohort.branchId, level, sessionSlot },
    },
    update: {},
    create: {
      branchId: cohort.branchId,
      level,
      sessionSlot,
      name: `${branchName} · ${level} · ${slotLabel(sessionSlot)}`,
      description: `${slotLabel(sessionSlot)} ${level} class at ${branchName}.`,
    },
  });

  // Channels are upserted too, so a room created before a channel was added to
  // the default set gains it on the next visit instead of staying incomplete.
  for (const channel of DEFAULT_CHANNELS) {
    await prisma.channel.upsert({
      where: { spaceId_slug: { spaceId: space.id, slug: channel.slug } },
      update: {},
      create: { spaceId: space.id, ...channel },
    });
  }

  return space;
}

/** Resolve exactly which spaces this viewer may read or post in. */
export async function resolveSpaceScope(viewer: Viewer): Promise<SpaceScope> {
  if (isStaffRole(viewer.role)) {
    const all = await prisma.space.findMany({ select: { id: true } });
    return { spaceIds: all.map((s) => s.id), isStaff: true, branchId: null, level: null, sessionSlot: null };
  }

  const student = await prisma.student.findUnique({
    where: { userId: viewer.userId },
    select: { branchId: true, level: true, sessionSlot: true, branch: { select: { name: true } } },
  });

  if (!student?.branchId || !student.level) {
    return {
      spaceIds: [],
      isStaff: false,
      branchId: student?.branchId ?? null,
      level: student?.level ?? null,
      sessionSlot: student?.sessionSlot ?? null,
    };
  }

  const sessionSlot = normalizeSlot(student.sessionSlot);

  // Creates the room if this is the first student of the sitting to arrive.
  const space = await ensureSpaceForCohort({
    branchId: student.branchId,
    branchName: student.branch?.name,
    level: student.level,
    sessionSlot,
  });

  return {
    spaceIds: [space.id],
    isStaff: false,
    branchId: student.branchId,
    level: student.level,
    sessionSlot,
  };
}

/** Spaces (with channels) the viewer is allowed to see, ready for the sidebar. */
export async function listVisibleSpaces(viewer: Viewer) {
  const scope = await resolveSpaceScope(viewer);
  if (scope.spaceIds.length === 0) return { spaces: [], scope };

  const spaces = await prisma.space.findMany({
    where: { id: { in: scope.spaceIds } },
    include: {
      branch: { select: { id: true, name: true } },
      channels: {
        orderBy: [{ position: "asc" }, { name: "asc" }],
        select: {
          id: true,
          slug: true,
          name: true,
          description: true,
          kind: true,
          _count: { select: { messages: true } },
        },
      },
    },
    // Staff see every room in the school, so the order has to be the one a
    // person scanning a list expects: branch, then level, then time of day.
    orderBy: [{ branchId: "asc" }, { level: "asc" }, { sessionSlot: "asc" }],
  });

  return { spaces, scope };
}

/**
 * Confirm a channel belongs to a space the viewer may access.
 * Returns the channel when allowed, otherwise null.
 */
export async function authorizeChannel(viewer: Viewer, channelId: string) {
  const channel = await prisma.channel.findUnique({
    where: { id: channelId },
    include: { space: { include: { branch: { select: { id: true, name: true } } } } },
  });
  if (!channel) return null;

  const scope = await resolveSpaceScope(viewer);
  return scope.spaceIds.includes(channel.spaceId) ? channel : null;
}

/** Confirm a message sits inside a channel the viewer may access. */
export async function authorizeMessage(viewer: Viewer, messageId: string) {
  const message = await prisma.message.findUnique({
    where: { id: messageId },
    include: { channel: { include: { space: true } } },
  });
  if (!message) return null;

  const scope = await resolveSpaceScope(viewer);
  return scope.spaceIds.includes(message.channel.spaceId) ? message : null;
}
