import { prisma } from "@/lib/prisma";

type CommunityRole = "admin" | "lecturer" | "student";

export async function getCommunityCourseIds(userId: string, role: CommunityRole) {
  if (role === "admin") {
    return null;
  }

  if (role === "lecturer") {
    const lecturer = await prisma.lecturer.findUnique({
      where: { userId },
      select: { classes: { select: { courseId: true } } },
    });
    return [...new Set(lecturer?.classes.map((item) => item.courseId) || [])];
  }

  const student = await prisma.student.findUnique({
    where: { userId },
    select: {
      enrollments: {
        select: {
          pathway: {
            select: { courses: { select: { id: true } } },
          },
        },
      },
    },
  });

  return [...new Set(
    student?.enrollments.flatMap((enrollment) =>
      enrollment.pathway.courses.map((course) => course.id),
    ) || [],
  )];
}

export function normalizeCommunityRole(role: unknown): CommunityRole | null {
  const normalized = String(role || "").toLowerCase();
  return normalized === "admin" || normalized === "lecturer" || normalized === "student"
    ? normalized
    : null;
}
