import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiKey } from "@/lib/api/auth";
import { apiPage, parseLimit } from "@/lib/api/response";
import { publicPayment, paymentSelect } from "@/lib/api/shapes";

export const dynamic = "force-dynamic";

/**
 * Tuition payments — the school's money from its students, not the school's
 * bill from us. The platform's own charges are at /v1/usage.
 *
 * Read-only, and it should stay that way. A write endpoint here would let an
 * integration record money that never arrived, and reconciling "what the API
 * was told" against "what Paystack settled" is exactly the argument nobody
 * wants to have with a school. Payments enter this system through the provider
 * webhook or not at all.
 */
export async function GET(request: NextRequest) {
  const gate = await requireApiKey(request, "payments:read");
  if (!gate.ok) return gate.response;

  const params = request.nextUrl.searchParams;
  const limit = parseLimit(params.get("limit"));
  const cursor = params.get("cursor");
  const studentId = params.get("studentId");
  const status = params.get("status");
  const since = params.get("since");

  const sinceDate = since ? new Date(since) : null;
  const validSince = sinceDate && !Number.isNaN(sinceDate.getTime()) ? sinceDate : null;

  const rows = await prisma.payment.findMany({
    where: {
      ...(studentId ? { studentId } : {}),
      ...(status ? { status } : {}),
      ...(validSince ? { createdAt: { gte: validSince } } : {}),
      deletedAt: null,
    },
    select: paymentSelect,
    orderBy: { id: "asc" },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  return apiPage(rows.map(publicPayment), { limit, cursorOf: (p) => p.id });
}
