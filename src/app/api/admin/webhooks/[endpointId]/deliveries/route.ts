import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCapability } from "@/lib/admin-roles";

export const dynamic = "force-dynamic";

/**
 * What this endpoint was actually sent, and what came back.
 *
 * The question a webhook screen exists to answer is never "how many endpoints
 * do I have" — it is "did the event arrive, and if not, why not". Without this
 * the answer lives only in a table nobody outside the office can query, and the
 * support conversation becomes the integrator describing what they did not
 * receive.
 *
 * The payload is deliberately NOT returned. It carries student records, and a
 * delivery log that quotes them turns a page behind the `integrations`
 * capability into a way of reading the register — which is the one thing the
 * capability split exists to prevent. Event name, status and the error are
 * enough to debug a delivery; the body is the integrator's own to inspect on
 * the receiving end.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ endpointId: string }> },
) {
  const gate = await requireCapability("integrations");
  if (!gate.ok) return gate.response;

  const { endpointId } = await params;

  /**
   * The endpoint is looked up first, through the tenant-scoped client, purely
   * so that an id belonging to another school answers 404 rather than an empty
   * list. An empty list is indistinguishable from "no deliveries yet", which
   * would let a caller probe for the existence of other tenants' endpoints one
   * id at a time.
   */
  const endpoint = await prisma.webhookEndpoint.findFirst({
    where: { id: endpointId },
    select: { id: true },
  });
  if (!endpoint) return NextResponse.json({ error: "No such endpoint." }, { status: 404 });

  const deliveries = await prisma.webhookDelivery.findMany({
    where: { endpointId },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      event: true,
      status: true,
      attempts: true,
      lastStatus: true,
      lastError: true,
      nextAttemptAt: true,
      deliveredAt: true,
      createdAt: true,
    },
  });

  return NextResponse.json({ deliveries });
}
