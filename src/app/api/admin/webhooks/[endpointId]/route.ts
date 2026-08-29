import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCapability } from "@/lib/admin-roles";

export const dynamic = "force-dynamic";

/**
 * Turn an endpoint back on after it was disabled for failing, or re-subscribe
 * it to a different set of events.
 *
 * Re-enabling resets the failure count. Leaving it at twenty would mean the
 * endpoint switches itself off again on the very next failure, which is not
 * what "I have fixed it" should mean.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ endpointId: string }> },
) {
  const gate = await requireCapability("integrations");
  if (!gate.ok) return gate.response;

  const { endpointId } = await params;
  const body = await request.json().catch(() => null);

  const existing = await prisma.webhookEndpoint.findFirst({
    where: { id: endpointId },
    select: { id: true },
  });
  if (!existing) return NextResponse.json({ error: "No such endpoint." }, { status: 404 });

  const endpoint = await prisma.webhookEndpoint.update({
    where: { id: endpointId },
    data: {
      ...(body?.enabled === true ? { disabledAt: null, failureCount: 0 } : {}),
      ...(body?.enabled === false ? { disabledAt: new Date() } : {}),
      ...(typeof body?.events === "string" ? { events: body.events } : {}),
    },
    select: { id: true, url: true, events: true, disabledAt: true, failureCount: true },
  });

  return NextResponse.json({ endpoint });
}

/**
 * Delete it, and its delivery history with it.
 *
 * Deleted rather than disabled, because unlike an API key there is nothing to
 * attribute afterwards — a webhook endpoint makes no calls of its own, it only
 * receives them. Disabling is available through PATCH for the case where the
 * school wants to keep the record.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ endpointId: string }> },
) {
  const gate = await requireCapability("integrations");
  if (!gate.ok) return gate.response;

  const { endpointId } = await params;

  const existing = await prisma.webhookEndpoint.findFirst({
    where: { id: endpointId },
    select: { id: true },
  });
  if (!existing) return NextResponse.json({ error: "No such endpoint." }, { status: 404 });

  await prisma.webhookEndpoint.delete({ where: { id: endpointId } });

  return NextResponse.json({ ok: true });
}
