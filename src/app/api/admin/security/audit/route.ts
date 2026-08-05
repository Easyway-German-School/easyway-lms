import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCapability } from "@/lib/admin-roles";

/**
 * The audit trail, read back.
 *
 * Behind `security`, which is super-admin only — a trail readable by the
 * people it records is a trail with an obvious incentive problem, and this one
 * carries before images of student records, so it is also some of the most
 * personal data in the system gathered conveniently in one place.
 */
export async function GET(request: Request) {
  const gate = await requireCapability("security");
  if (!gate.ok) return gate.response;

  const url = new URL(request.url);
  const action = url.searchParams.get("action") || undefined;
  const model = url.searchParams.get("model") || undefined;
  const actorId = url.searchParams.get("actorId") || undefined;
  const severity = url.searchParams.get("severity") || undefined;
  const onlyRestorable = url.searchParams.get("restorable") === "true";
  const take = Math.min(Number(url.searchParams.get("take")) || 100, 300);
  const cursor = url.searchParams.get("cursor") || undefined;

  const where = {
    ...(action ? { action } : {}),
    ...(model ? { model } : {}),
    ...(actorId ? { actorId } : {}),
    ...(severity ? { severity } : {}),
    ...(onlyRestorable ? { restorable: true } : {}),
  };

  const entries = await prisma.auditLog.findMany({
    where,
    orderBy: { at: "desc" },
    take: take + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: {
      id: true,
      at: true,
      action: true,
      model: true,
      recordId: true,
      summary: true,
      affectedCount: true,
      actorEmail: true,
      actorRole: true,
      source: true,
      ip: true,
      route: true,
      severity: true,
      restorable: true,
      restoredAt: true,
      // The before image is deliberately not in the list payload. It is the
      // personal data itself, and shipping every student's full record to the
      // browser to render a table of one-line summaries would be the largest
      // unnecessary disclosure in the application.
    },
  });

  const hasMore = entries.length > take;
  const page = hasMore ? entries.slice(0, take) : entries;

  return NextResponse.json({
    entries: page,
    nextCursor: hasMore ? page[page.length - 1]?.id : null,
  });
}
