import { prisma } from "@/lib/prisma";

export type CommunityRole = "student" | "lecturer" | "admin";

export function normalizeCommunityRole(role: unknown): CommunityRole | null {
  if (!role || typeof role !== "string") return null;

  const normalized = role.toLowerCase();
  if (normalized === "student" || normalized === "learner") return "student";
  if (normalized === "lecturer" || normalized === "teacher") return "lecturer";
  if (normalized === "admin" || normalized === "administrator") return "admin";

  return null;
}

export async function getCommunityCourseIds(userId: string, role: CommunityRole): Promise<string[] | null> {
  if (role === "admin") {
    return null;
  }

  if (role === "lecturer") {
    const courses = await prisma.course.findMany({
      where: {
        published: true,
        pathway: { name: "Lecturer Uploaded Courses" },
      },
      select: { id: true },
    });
    return courses.map((course) => course.id);
  }

  const student = await prisma.student.findUnique({
    where: { userId },
    select: { pathway: true },
  });

  if (!student?.pathway) {
    return [];
  }

  const pathwayCourses = await prisma.course.findMany({
    where: {
      published: true,
      pathway: { name: student.pathway },
    },
    select: { id: true },
  });

  return pathwayCourses.map((course) => course.id);
}
