import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiKey } from "@/lib/api/auth";
import { apiError, apiPage, parseLimit } from "@/lib/api/response";
import { publicStudent, studentSelect } from "@/lib/api/shapes";

export const dynamic = "force-dynamic";

/**
 * The school's students.
 *
 * Every query here goes through `prisma`, which is tenant-scoped from the
 * context `requireApiKey` set — so there is no `where: { tenantId }` in this
 * file and there must not be. Writing one would suggest the filter is this
 * route's job, and the next route somebody adds would be written without it.
 */
export async function GET(request: NextRequest) {
  const gate = await requireApiKey(request, "students:read");
  if (!gate.ok) return gate.response;

  const params = request.nextUrl.searchParams;
  const limit = parseLimit(params.get("limit"));
  const cursor = params.get("cursor");
  const status = params.get("status");
  const level = params.get("level");
  const branchId = params.get("branchId");

  /**
   * One more than asked for, so `hasMore` is known without a second count
   * query. `apiPage` trims it back.
   */
  const rows = await prisma.student.findMany({
    where: {
      ...(status ? { status } : {}),
      ...(level ? { level } : {}),
      ...(branchId ? { branchId } : {}),
      deletedAt: null,
    },
    select: studentSelect,
    orderBy: { id: "asc" },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  return apiPage(rows.map(publicStudent), { limit, cursorOf: (s) => s.id });
}

/**
 * Look one up by the code printed on their card, without paging the list.
 *
 * `?studentCode=` on the collection rather than a separate route, because it is
 * a filter that happens to match one row, and a partner who has the code should
 * not have to learn a second URL shape to use it.
 */
export async function POST(request: NextRequest) {
  const gate = await requireApiKey(request, "students:read");
  if (!gate.ok) return gate.response;

  /**
   * Deliberately not a create endpoint yet.
   *
   * Enrolling a student writes a User, a Student, a student code and an alert
   * to the office, and it has a photo-upload step and a branch-pricing step
   * that only make sense inside the signup flow. Exposing a half of that over
   * the API would create accounts the school's own screens cannot finish
   * setting up. Better to say so than to ship a create that produces broken
   * students.
   */
  return apiError(
    "invalid_request",
    "Creating students over the API is not supported yet. Enrolment writes an account, a student code and an office alert together, and the API cannot yet do all three. Use the admin portal.",
  );
}
