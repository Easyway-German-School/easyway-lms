import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCapability } from "@/lib/admin-roles";
import { restoreFromAudit } from "@/lib/audit-restore";

/**
 * One entry, including its before image.
 *
 * Fetched on demand rather than with the list, because this is where the
 * personal data lives. Opening a record is itself recorded below — reading a
 * deleted student's full details is an event, not a page view.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const gate = await requireCapability("security");
  if (!gate.ok) return gate.response;

  const { id } = await context.params;
  const entry = await prisma.auditLog.findUnique({ where: { id } });
  if (!entry) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ entry });
}

/** Restore the record this entry describes. */
export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const gate = await requireCapability("security");
  if (!gate.ok) return gate.response;

  const { id } = await context.params;
  const result = await restoreFromAudit(id, gate.admin.userId);

  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
