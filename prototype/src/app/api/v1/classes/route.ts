import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiKey } from "@/lib/api/auth";
import { apiPage, parseLimit } from "@/lib/api/response";
import { publicClass, classSelect } from "@/lib/api/shapes";

export const dynamic = "force-dynamic";

/** The school's classes, with the course and tutor each belongs to. */
export async function GET(request: NextRequest) {
  const gate = await requireApiKey(request, "classes:read");
  if (!gate.ok) return gate.response;

  const params = request.nextUrl.searchParams;
  const limit = parseLimit(params.get("limit"));
  const cursor = params.get("cursor");
  const level = params.get("level");

  const rows = await prisma.class.findMany({
    where: {
      // The level lives on the Course, not the Class. Filtering through the
      // relation rather than duplicating the column keeps the two from drifting.
      ...(level ? { course: { level } } : {}),
      deletedAt: null,
    },
    select: classSelect,
    orderBy: { id: "asc" },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  return apiPage(rows.map(publicClass), { limit, cursorOf: (c) => c.id });
}
