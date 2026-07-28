import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { normalizeCommunityRole, getCommunityCourseIds } from "@/lib/community-access";

export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions as any) as any;
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const role = normalizeCommunityRole(session.user.role);
    if (!role) {
      return NextResponse.json({ error: "Unsupported account role" }, { status: 403 });
    }

    const courseIds = await getCommunityCourseIds(session.user.id, role);

    const courses = await prisma.course.findMany({
      where: {
        published: true,
        ...(courseIds === null ? {} : { id: { in: courseIds } }),
      },
      select: {
        id: true,
        title: true,
        level: true,
      },
      orderBy: { order: "asc" },
    });

    return NextResponse.json(courses);
  } catch (error) {
    console.error("Error fetching community channels:", error);
    return NextResponse.json({ error: "Failed to fetch community channels" }, { status: 500 });
  }
}
