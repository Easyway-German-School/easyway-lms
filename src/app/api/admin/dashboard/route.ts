import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCapability } from "@/lib/admin-roles";

/**
 * Counts across every area of the school.
 *
 * Gated on `reports` rather than on `role === "admin"`, which is all it used to
 * check — one of the last two places where the sub-roles were still decorative.
 * It leaks no names and no money, only totals, but "any admin" is not a
 * permission model and a route that answers to it is one somebody will copy.
 *
 * The two console.logs that printed the session user id and role on every
 * request are gone with it. Request-scoped identifiers do not belong in a log
 * that gets shipped to a shared server.
 */
export async function GET() {
  const gate = await requireCapability("reports");
  if (!gate.ok) return gate.response;

  const branches = await prisma.branch.count();
  const students = await prisma.student.count();
  const enrollments = await prisma.enrollment.count();
  const cachedPlans = await prisma.personalizedPlan.count();
  const exams = await prisma.examRegistration.count();
  const attendances = await prisma.attendance.count();
  const materials = await prisma.material.count();
  // Community posts now live in Message — the forum's Thread/Comment pair was
  // replaced by a running group chat.
  const discussions = await prisma.message.count();

  return NextResponse.json({ branches, students, enrollments, cachedPlans, exams, attendances, materials, discussions });
}
