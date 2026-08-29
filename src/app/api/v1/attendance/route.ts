import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiKey } from "@/lib/api/auth";
import { apiPage, apiError, parseLimit } from "@/lib/api/response";
import { publicAttendance, attendanceSelect } from "@/lib/api/shapes";

export const dynamic = "force-dynamic";

/**
 * Ninety days, maximum, per request.
 *
 * The register is the largest table in the school and grows every teaching day,
 * so an unbounded scan of it is both the slowest query a partner can ask for
 * and the one they are most likely to ask for by accident on their first
 * afternoon. Ninety days is generous for the real use — a parent app showing
 * this term — and refuses the accident with a message that says what to do
 * instead.
 */
const MAX_WINDOW_DAYS = 90;

export async function GET(request: NextRequest) {
  const gate = await requireApiKey(request, "attendance:read");
  if (!gate.ok) return gate.response;

  const params = request.nextUrl.searchParams;
  const limit = parseLimit(params.get("limit"));
  const cursor = params.get("cursor");
  const studentId = params.get("studentId");
  const classId = params.get("classId");

  const to = params.get("to") ? new Date(params.get("to")!) : new Date();
  const from = params.get("from")
    ? new Date(params.get("from")!)
    : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);

  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return apiError("invalid_request", "from and to must be ISO dates.");
  }
  if (to.getTime() - from.getTime() > MAX_WINDOW_DAYS * 24 * 60 * 60 * 1000) {
    return apiError(
      "invalid_request",
      `The window between from and to may not exceed ${MAX_WINDOW_DAYS} days. Request it in shorter spans instead.`,
    );
  }

  const rows = await prisma.attendance.findMany({
    where: {
      date: { gte: from, lte: to },
      ...(studentId ? { studentId } : {}),
      ...(classId ? { classId } : {}),
    },
    select: attendanceSelect,
    orderBy: { id: "asc" },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  return apiPage(rows.map(publicAttendance), { limit, cursorOf: (a) => a.id });
}
