import { prisma } from "@/lib/prisma";

/**
 * Every /api/parent/* route needs the same two facts: which Parent record is
 * this session, and is the studentId in the request actually one of theirs.
 * Centralized so that check can't be skipped in one route and not another —
 * a parent seeing a child that isn't theirs is the one mistake this feature
 * cannot afford.
 */

export async function getParentForUser(userId: string) {
  return prisma.parent.findUnique({ where: { userId }, select: { id: true } });
}

/** Throws-free: returns the linked student ids, or an empty array if none. */
export async function getLinkedStudentIds(parentId: string): Promise<string[]> {
  const links = await prisma.parentStudent.findMany({
    where: { parentId },
    select: { studentId: true },
  });
  return links.map((l) => l.studentId);
}

/** True only if `studentId` is one of this parent's own linked children. */
export async function assertParentOwnsStudent(parentId: string, studentId: string): Promise<boolean> {
  const link = await prisma.parentStudent.findUnique({
    where: { parentId_studentId: { parentId, studentId } },
    select: { id: true },
  });
  return Boolean(link);
}
