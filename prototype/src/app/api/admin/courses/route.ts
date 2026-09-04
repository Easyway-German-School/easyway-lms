import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

import { requireCapability } from "@/lib/admin-roles";

async function isLecturer(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return false;
  return (user.role?.toLowerCase() === "lecturer" || user.role?.toLowerCase() === "admin");
}

/**
 * The course shells the Courses screen and the Materials uploader hang off.
 *
 * WHY THIS IS A TOP-LEVEL `course.findMany` AND NOT `pathway.findUnique({
 * include: { courses } })`.
 *
 * The soft-delete guard (src/lib/prisma-guard.ts) rewrites `course.delete` into
 * `deletedAt = now()` and folds `deletedAt: null` into every top-level read of
 * a soft-deleted model — but a Prisma client extension does NOT run for a
 * nested relation load. Reading the courses through `pathway.include.courses`
 * therefore returned the deleted ones too, so a course the admin had just
 * deleted reappeared on the next refresh: "I can't delete anything." Querying
 * Course directly puts the read back under the guard, and the explicit
 * `deletedAt: null` makes it obvious besides.
 */
export async function GET() {
  const gate = await requireCapability("materials");
  if (!gate.ok) return gate.response;
  const session = gate.session;

  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await isLecturer(session.user.id)))
    return NextResponse.json({ error: "Lecturer access required" }, { status: 403 });

  const courses = await prisma.course.findMany({
    where: {
      deletedAt: null,
      pathway: { name: "Lecturer Uploaded Courses" },
    },
    orderBy: [{ order: "asc" }, { createdAt: "desc" }],
    select: {
      id: true,
      title: true,
      description: true,
      level: true,
      duration: true,
      published: true,
    },
  });

  return NextResponse.json({ courses });
}
