import { prisma } from "@/lib/prisma";
import { OFFERED_LEVELS } from "@/lib/levels";
import { readAssignment, spaceWhereForAssignment } from "@/lib/lecturer-assignment";
import { isSessionEnabled } from "@/lib/school-settings";
import { readSessionSettings } from "@/lib/school-settings-server";

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
 * Admins are the deliberate exception: the office has to be able to monitor
 * every room in the school. A tutor is not — a tutor sees exactly the rooms
 * their own admin-set assignment covers (see lib/lecturer-assignment.ts), the
 * same branches/levels/sittings that already govern their roster and
 * gradebook. Giving every tutor every room used to be the default and it was
 * a real hole: a tutor assigned to one cohort could read and moderate the
 * whole school, and a student's message could be lost among 50-odd rooms
 * their own tutor was never meant to see.
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

/** Admins, specifically — the one role that still sees every room. */
function isAdminRole(role: unknown) {
  return normalizeRole(role) === "admin";
}

/** The sittings, in the order a timetable reads. */
export const SESSION_SLOTS = ["morning", "afternoon", "evening", "weekend"] as const;
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
 * Does the school actually run this level?
 *
 * A room for a class nobody teaches is worse than no room: it sits at the top
 * of the hub, permanently silent, and students ask the office why their C2
 * group is dead. C2 is priced and recorded — old certificates point at it —
 * but it is not taught, so it gets no chat room.
 */
export function isOfferedLevel(level: unknown): boolean {
  return (OFFERED_LEVELS as readonly string[]).includes(String(level ?? "").trim().toUpperCase());
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

  // Never conjure a room for a level the school does not teach. Returning null
  // rather than throwing because the callers all treat "no room" as an empty
  // state they already render, and a student on a retired level should see
  // that rather than a stack trace.
  if (!isOfferedLevel(level)) return null;

  const branchName =
    cohort.branchName ??
    (await prisma.branch.findUnique({ where: { id: cohort.branchId }, select: { name: true } }))?.name ??
    "EasyWay";

  // Fetch the branch to get tenantId
  const branch = await prisma.branch.findUnique({
    where: { id: cohort.branchId },
    select: { tenantId: true },
  });

  // Never re-provision a room for a sitting the office has switched off on
  // /admin/settings. The data for a previously-run sitting is kept (re-enabling
  // brings the room back), but a disabled one must not spring back to life the
  // next time a stray student record still points at it.
  if (!isSessionEnabled(await readSessionSettings(branch?.tenantId), level, sessionSlot)) {
    return null;
  }

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
      tenantId: branch?.tenantId ?? null,
    },
  });

  // Channels are upserted too, so a room created before a channel was added to
  // the default set gains it on the next visit instead of staying incomplete.
  for (const channel of DEFAULT_CHANNELS) {
    await prisma.channel.upsert({
      where: { spaceId_slug: { spaceId: space.id, slug: channel.slug } },
      update: {},
      create: { spaceId: space.id, ...channel, tenantId: space.tenantId },
    });
  }

  return space;
}

/**
 * Drop the rooms whose sitting the office has switched off on /admin/settings.
 * Staff (admins and tutors) would otherwise keep seeing a room no student
 * resolves to any more. `tenantId` comes from the viewer's own account.
 */
async function keepEnabledSpaces(
  rows: Array<{ id: string; level: string; sessionSlot: string }>,
  tenantId: string | null | undefined,
): Promise<string[]> {
  if (rows.length === 0) return [];
  const settings = await readSessionSettings(tenantId);
  return rows.filter((r) => isSessionEnabled(settings, r.level, r.sessionSlot)).map((r) => r.id);
}

/** Resolve exactly which spaces this viewer may read or post in. */
export async function resolveSpaceScope(viewer: Viewer): Promise<SpaceScope> {
  const account = await prisma.user.findUnique({
    where: { id: viewer.userId },
    select: { tenantId: true },
  });
  const tenantId = account?.tenantId ?? null;

  if (isAdminRole(viewer.role)) {
    // Admins see every room in the school, minus the ones for levels it no
    // longer runs — moderation covers what is live, and a retired C2 room
    // would otherwise sit in the admin's list forever. Sittings the office
    // switched off are dropped for the same reason.
    const all = await prisma.space.findMany({
      where: { level: { in: OFFERED_LEVELS as unknown as string[] } },
      select: { id: true, level: true, sessionSlot: true },
    });
    return {
      spaceIds: await keepEnabledSpaces(all, tenantId),
      isStaff: true,
      branchId: null,
      level: null,
      sessionSlot: null,
    };
  }

  if (isStaffRole(viewer.role)) {
    // A tutor sees exactly the rooms their assignment covers — same source of
    // truth as the roster (readAssignment / spaceWhereForAssignment). No
    // fallback to "everything": an unassigned tutor sees no rooms, mirroring
    // isAssigned()'s refusal everywhere else a tutor's class is resolved.
    const lecturer = await prisma.lecturer.findUnique({
      where: { userId: viewer.userId },
      select: {
        branchId: true,
        level: true,
        sessionSlot: true,
        branchIds: true,
        levels: true,
        sessionSlots: true,
      },
    });

    const where = spaceWhereForAssignment(readAssignment(lecturer));
    if (!where) {
      return { spaceIds: [], isStaff: true, branchId: null, level: null, sessionSlot: null };
    }

    const rooms = await prisma.space.findMany({
      where,
      select: { id: true, level: true, sessionSlot: true },
    });
    return {
      spaceIds: await keepEnabledSpaces(rooms, tenantId),
      isStaff: true,
      branchId: null,
      level: null,
      sessionSlot: null,
    };
  }

  const student = await prisma.student.findUnique({
    where: { userId: viewer.userId },
    select: {
      branchId: true,
      level: true,
      sessionSlot: true,
      classType: true,
      deliveryMode: true,
      hybridOnlineSlot: true,
      branch: { select: { name: true } },
    },
  });

  // Private students have a named tutor and a one-to-one classroom. They are
  // not members of a cohort story, so never create or resolve a group-game
  // space for them and never surface a turn prompt on their dashboard.
  if (student?.classType === "private") {
    return {
      spaceIds: [],
      isStaff: false,
      branchId: student.branchId ?? null,
      level: student.level ?? null,
      sessionSlot: student.sessionSlot ?? null,
    };
  }

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

  // Creates the room if this is the first student of the sitting to arrive,
  // and returns null for a level the school no longer runs.
  const space = await ensureSpaceForCohort({
    branchId: student.branchId,
    branchName: student.branch?.name,
    level: student.level,
    sessionSlot,
  });

  const spaceIds = space ? [space.id] : [];

  /**
   * A hybrid student is in TWO cohorts, not one — their campus sitting and
   * their online sitting each run their own group chat, same as any other
   * physical or online-only student's does. Before this they resolved to
   * exactly one room (their campus one) and had no online-cohort room at
   * all, whichever mode they actually spent more of their week in. Every
   * consumer of `spaceIds` already treats it as a set (`.includes`,
   * `{ in: … }`), so adding a second id here is the whole fix.
   */
  if (student.deliveryMode === "hybrid" && student.hybridOnlineSlot) {
    const onlineBranch = await prisma.branch.findFirst({
      where: { mode: "online", ...(tenantId ? { tenantId } : {}) },
      select: { id: true, name: true },
    });
    if (onlineBranch) {
      const onlineSlot = normalizeSlot(student.hybridOnlineSlot);
      const onlineSpace = await ensureSpaceForCohort({
        branchId: onlineBranch.id,
        branchName: onlineBranch.name,
        level: student.level,
        sessionSlot: onlineSlot,
      });
      if (onlineSpace) spaceIds.push(onlineSpace.id);
    }
  }

  return {
    spaceIds,
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

  // A DM channel belongs to no Space, and is scoped to exactly two people:
  // any admin (the office, collectively) and the one student it is with.
  // Never the space-membership check below — that would let every tutor and
  // every other student in, which is the one thing this thread must not do.
  if (channel.kind === "dm") {
    return isAdminRole(viewer.role) || channel.dmStudentId === viewer.userId ? channel : null;
  }

  const scope = await resolveSpaceScope(viewer);
  return channel.spaceId && scope.spaceIds.includes(channel.spaceId) ? channel : null;
}

/** Confirm a message sits inside a channel the viewer may access. */
export async function authorizeMessage(viewer: Viewer, messageId: string) {
  const message = await prisma.message.findUnique({
    where: { id: messageId },
    include: { channel: { include: { space: true } } },
  });
  if (!message) return null;

  if (message.channel.kind === "dm") {
    return isAdminRole(viewer.role) || message.channel.dmStudentId === viewer.userId ? message : null;
  }

  const scope = await resolveSpaceScope(viewer);
  return message.channel.spaceId && scope.spaceIds.includes(message.channel.spaceId) ? message : null;
}

/**
 * A student's private thread with the office — the whole reason it exists is
 * "click a student, message them privately", so only an admin may create one.
 * Idempotent: the second admin to message the same student lands in the
 * thread the first one already opened, never a second copy.
 */
export async function getOrCreateDmChannel(studentUserId: string) {
  const existing = await prisma.channel.findUnique({ where: { dmStudentId: studentUserId } });
  if (existing) return existing;

  const student = await prisma.user.findUnique({
    where: { id: studentUserId },
    select: { id: true, role: true, tenantId: true, name: true },
  });
  if (!student || normalizeRole(student.role) !== "student") return null;

  return prisma.channel.upsert({
    where: { dmStudentId: studentUserId },
    update: {},
    create: {
      dmStudentId: studentUserId,
      slug: "dm",
      name: student.name ?? "Student",
      kind: "dm",
      tenantId: student.tenantId ?? null,
    },
  });
}

/**
 * The DM thread(s) a viewer may see, shaped like a `Space` so the sidebar that
 * already groups rooms by space can render this section for free. An admin
 * gets every thread in the school, tagged "Office" the same way a staff post
 * in an ordinary room is — no single admin owns a thread. A student gets their
 * own thread once an admin has opened it, and nothing before that: only the
 * office may start one. A tutor gets nothing; this is deliberately not a
 * capability they have, per [[project-community-group-chat]] design and the
 * explicit instruction that tutors moderate rooms, not private student lines.
 */
export async function listDmSpaceForViewer(viewer: Viewer) {
  if (isAdminRole(viewer.role)) {
    const channels = await prisma.channel.findMany({
      where: { kind: "dm" },
      select: {
        id: true,
        slug: true,
        name: true,
        description: true,
        kind: true,
        dmStudent: { select: { name: true } },
        _count: { select: { messages: true } },
      },
      orderBy: { updatedAt: "desc" },
    });
    if (channels.length === 0) return null;
    return {
      id: "__dm__",
      name: "Direct messages",
      level: "",
      sessionSlot: "",
      description: "Private threads with one student, visible only to the office.",
      branch: { id: "__dm__", name: "" },
      channels: channels.map((c) => ({
        id: c.id,
        slug: c.slug,
        name: c.dmStudent?.name ?? c.name,
        description: c.description,
        kind: c.kind,
        _count: c._count,
      })),
    };
  }

  if (isStaffRole(viewer.role)) return null; // tutors: no DM access at all.

  const own = await prisma.channel.findUnique({
    where: { dmStudentId: viewer.userId },
    select: { id: true, slug: true, name: true, description: true, kind: true, _count: { select: { messages: true } } },
  });
  if (!own) return null;

  return {
    id: "__dm__",
    name: "Direct messages",
    level: "",
    sessionSlot: "",
    description: null,
    branch: { id: "__dm__", name: "" },
    channels: [{ ...own, name: "The office" }],
  };
}
