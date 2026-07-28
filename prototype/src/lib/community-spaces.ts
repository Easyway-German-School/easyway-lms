import { prisma } from "@/lib/prisma";

/**
 * Visibility rules for the community hub.
 *
 * A Space is scoped to one branch AND one level. Students only ever see the
 * single space matching their own branch + level — an Abuja A1 learner must not
 * reach the Lagos A1 space even though the syllabus is identical. Staff can see
 * every space so tutors and admins can answer questions across the school.
 *
 * Every community route resolves access through here rather than trusting an
 * id from the client.
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
};

function normalizeRole(role: unknown) {
  return String(role || "").toLowerCase();
}

export function isStaffRole(role: unknown) {
  const r = normalizeRole(role);
  return r === "admin" || r === "lecturer";
}

/** Resolve exactly which spaces this viewer may read or post in. */
export async function resolveSpaceScope(viewer: Viewer): Promise<SpaceScope> {
  if (isStaffRole(viewer.role)) {
    const all = await prisma.space.findMany({ select: { id: true } });
    return { spaceIds: all.map((s) => s.id), isStaff: true, branchId: null, level: null };
  }

  const student = await prisma.student.findUnique({
    where: { userId: viewer.userId },
    select: { branchId: true, level: true },
  });

  if (!student?.branchId || !student.level) {
    return { spaceIds: [], isStaff: false, branchId: student?.branchId ?? null, level: student?.level ?? null };
  }

  const space = await prisma.space.findUnique({
    where: { branchId_level: { branchId: student.branchId, level: student.level } },
    select: { id: true },
  });

  return {
    spaceIds: space ? [space.id] : [],
    isStaff: false,
    branchId: student.branchId,
    level: student.level,
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
          _count: { select: { threads: true } },
        },
      },
    },
    orderBy: [{ level: "asc" }],
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

/** Confirm a thread sits inside a channel the viewer may access. */
export async function authorizeThread(viewer: Viewer, threadId: string) {
  const thread = await prisma.thread.findUnique({
    where: { id: threadId },
    include: { channel: { include: { space: true } } },
  });
  if (!thread) return null;

  const scope = await resolveSpaceScope(viewer);
  return scope.spaceIds.includes(thread.channel.spaceId) ? thread : null;
}

export type CommentNode = {
  id: string;
  body: string;
  createdAt: Date;
  author: { id: string; name: string | null; role: string };
  children: CommentNode[];
};

/** Turn a flat comment list into a Reddit-style reply tree. */
export function nestComments(
  rows: Array<{
    id: string;
    body: string;
    createdAt: Date;
    parentId: string | null;
    author: { id: string; name: string | null; role: string };
  }>,
): CommentNode[] {
  const byId = new Map<string, CommentNode>();
  const roots: CommentNode[] = [];

  for (const row of rows) {
    byId.set(row.id, {
      id: row.id,
      body: row.body,
      createdAt: row.createdAt,
      author: row.author,
      children: [],
    });
  }

  for (const row of rows) {
    const node = byId.get(row.id)!;
    const parent = row.parentId ? byId.get(row.parentId) : null;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  return roots;
}
