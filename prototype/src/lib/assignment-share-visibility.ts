import { prisma } from "@/lib/prisma";
import { resolveSpaceScope, type Viewer } from "@/lib/community-spaces";

/**
 * Assignment ids reposted into any class chat this viewer belongs to.
 *
 * This is what makes the repost card in Community actually work the way a
 * normal assignment does: tapping it has to land the student on an
 * Assignments tab that can open and submit it, not a page that finds nothing
 * because the same visibility rule that hid it from their own tab also hides
 * it from this lookup. So a repost grants real access — not just a link —
 * to everyone in the room it was posted in, not only the one classmate who
 * was named: several students can share the same gap, and they all tap the
 * same card.
 *
 * Scoped to the viewer's OWN space(s) (resolveSpaceScope) — a repost in one
 * cohort's room never reaches another cohort's room.
 */
export async function sharedAssignmentIdsFor(viewer: Viewer): Promise<string[]> {
  const scope = await resolveSpaceScope(viewer);
  if (!scope.spaceIds.length) return [];

  const rows = await prisma.message.findMany({
    where: {
      kind: "assignment_share",
      sharedAssignmentId: { not: null },
      hiddenAt: null,
      channel: { spaceId: { in: scope.spaceIds } },
    },
    select: { sharedAssignmentId: true },
    distinct: ["sharedAssignmentId"],
  });

  return rows.map((row) => row.sharedAssignmentId).filter((id): id is string => Boolean(id));
}
