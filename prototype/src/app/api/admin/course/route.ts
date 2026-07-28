import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

// Check if user is lecturer/admin
async function isLecturer(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId }
  });
  if (!user) return false;
  return (user.role?.toLowerCase() === "lecturer" || user.role?.toLowerCase() === "admin");
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions as any) as any;
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!await isLecturer(session.user.id)) {
    return NextResponse.json({ error: "Lecturer access required" }, { status: 403 });
  }

  const body = await request.json();
  const { title, description, level } = body;

  if (!title) {
    return NextResponse.json({ error: "Title required" }, { status: 400 });
  }

  try {
    // Find or create a default pathway for lecturer courses
    const pathway = await prisma.pathway.upsert({
      where: { name: "Lecturer Uploaded Courses" },
      update: {},
      create: {
        name: "Lecturer Uploaded Courses",
        headline: "Courses uploaded by lecturers",
        description: "Community-contributed courses",
        duration: "Varies",
        level: level || "A1-C2"
      }
    });

    const course = await prisma.course.create({
      data: {
        pathwayId: pathway.id,
        title,
        description: description || "",
        order: 999,
        duration: 60,
        level: level || "A1"
      }
    });

    return NextResponse.json({ course }, { status: 201 });
  } catch (error) {
    console.error("Course creation error:", error);
    return NextResponse.json({ error: "Failed to create course" }, { status: 500 });
  }
}
