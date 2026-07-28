import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generatePersonalizedSchedule } from "@/lib/schedule";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const session = (await getServerSession(authOptions as any)) as any;
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const student = await prisma.student.findUnique({
      where: { userId: session.user.id },
    });

    if (!student) {
      return NextResponse.json({ error: "Student not found" }, { status: 404 });
    }

    const admission =
      typeof student.admission === "object" && student.admission !== null
        ? (student.admission as Record<string, unknown>)
        : {};
    const batch = typeof admission.batch === "string" ? admission.batch : null;

    const schedule = generatePersonalizedSchedule({
      level: student.level,
      batch,
      now: new Date(),
      months: 2,
    });

    // Persist the latest generated plan so it can be reused / audited.
    try {
      const planJson = JSON.stringify({ ...schedule, generatedAt: new Date().toISOString() });
      await prisma.personalizedPlan.upsert({
        where: { studentId: student.id },
        update: { plan: planJson, updatedAt: new Date() as any },
        create: { studentId: student.id, plan: planJson },
      });
    } catch (err) {
      console.warn("Failed to persist personalized plan:", err);
    }

    return NextResponse.json({ ...schedule, provider: "batch-level-engine" });
  } catch (error) {
    console.error("Error generating schedule:", error);
    return NextResponse.json({ error: "Failed to generate schedule" }, { status: 500 });
  }
}
