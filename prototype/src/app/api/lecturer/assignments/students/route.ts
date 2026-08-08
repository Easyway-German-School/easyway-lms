import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

/**
 * The names for the "who gets this?" picker.
 *
 * Its own endpoint rather than reusing /api/lecturer/students, which returns
 * payments, attendance and certificate counts for each person. A picker needs
 * three fields, and sending a student's fee history to render a checkbox is
 * both slow and more of their record on the wire than the job requires.
 */

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await requireAuthSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { role: true },
  });
  const role = String(user?.role ?? "").toLowerCase();
  if (role !== "lecturer" && role !== "admin") {
    return NextResponse.json({ error: "Staff access required" }, { status: 403 });
  }

  const level = req.nextUrl.searchParams.get("level");
  const branchId = req.nextUrl.searchParams.get("branchId");
  if (!level) return NextResponse.json({ students: [] });

  const students = await prisma.student.findMany({
    where: {
      level: level.toUpperCase(),
      ...(branchId ? { branchId } : {}),
      // Somebody who has left should not appear on a list of people to set
      // work for. Their old submissions stay; new work does not follow them.
      status: "active",
    },
    orderBy: [{ user: { name: "asc" } }],
    select: {
      id: true,
      studentCode: true,
      sessionSlot: true,
      user: { select: { name: true } },
      branch: { select: { name: true } },
    },
  });

  return NextResponse.json({
    students: students.map((student) => ({
      id: student.id,
      name: student.user?.name ?? "Unnamed student",
      studentCode: student.studentCode,
      sessionSlot: student.sessionSlot,
      branchName: student.branch?.name ?? null,
    })),
  });
}
