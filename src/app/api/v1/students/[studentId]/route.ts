import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiKey } from "@/lib/api/auth";
import { apiOk, apiError } from "@/lib/api/response";
import { publicStudent, studentSelect } from "@/lib/api/shapes";

export const dynamic = "force-dynamic";

/**
 * One student.
 *
 * The soft-delete check is explicit. A removed student is gone as far as a
 * partner is concerned — returning one would let an integration resurrect a
 * record the school deleted on purpose, and 404 is the honest answer to "does
 * this student exist".
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ studentId: string }> },
) {
  const gate = await requireApiKey(request, "students:read");
  if (!gate.ok) return gate.response;

  const { studentId } = await params;

  /**
   * Accepts either the internal id or the student code, because a partner
   * integrating against a school's paperwork has the code and not the cuid, and
   * making them look it up first is a round trip for nothing. The two cannot be
   * confused: codes are not cuids.
   */
  const student = await prisma.student.findFirst({
    where: {
      OR: [{ id: studentId }, { studentCode: studentId }],
      deletedAt: null,
    },
    select: studentSelect,
  });

  if (!student) return apiError("not_found", "No student with that id or code.");

  return apiOk({ student: publicStudent(student) });
}
