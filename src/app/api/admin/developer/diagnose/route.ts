import { NextResponse } from "next/server";

import { requireCapability } from "@/lib/admin-roles";
import { runDiagnosis, searchStudents, studentIdForUser } from "@/lib/diagnose-server";

export const dynamic = "force-dynamic";
// The deep check asks Paystack (two calls, each with its own deadline); leave room.
export const maxDuration = 60;

/** Paystack references are short opaque tokens; anything else is not one. */
const REFERENCE = /^[A-Za-z0-9_.\-]{4,120}$/;

/**
 * Find a student to diagnose, or turn a complaint's reporter into one.
 *   ?q=<name / email / student ID>   → up to 8 matching students
 *   ?userId=<id>                     → { studentId } (a complaint incident carries the user id)
 * Behind `security` like the rest of the console.
 */
export async function GET(request: Request) {
  const gate = await requireCapability("security");
  if (!gate.ok) return gate.response;

  const url = new URL(request.url);
  const userId = url.searchParams.get("userId");
  if (userId) return NextResponse.json({ studentId: await studentIdForUser(userId) });

  return NextResponse.json({ students: await searchStudents(url.searchParams.get("q") ?? "") });
}

/**
 * Run the rules for one student. `deep: true` also asks Paystack what this
 * student has paid and compares it with what we recorded; `references` adds
 * receipts the student sent that the email lookup did not find.
 */
export async function POST(request: Request) {
  const gate = await requireCapability("security");
  if (!gate.ok) return gate.response;

  const body = (await request.json().catch(() => ({}))) as { studentId?: unknown; deep?: unknown; references?: unknown };
  const studentId = typeof body.studentId === "string" ? body.studentId : "";
  if (!studentId) return NextResponse.json({ error: "studentId is required" }, { status: 400 });

  const references = Array.isArray(body.references)
    ? body.references.filter((r): r is string => typeof r === "string" && REFERENCE.test(r)).slice(0, 5)
    : [];

  const result = await runDiagnosis(studentId, { paystack: body.deep === true || references.length > 0, extraReferences: references });
  if (!result) return NextResponse.json({ error: "Student not found" }, { status: 404 });
  return NextResponse.json(result);
}
