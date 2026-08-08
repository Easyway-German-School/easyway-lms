import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { inviteLeads, importLeadsFromCsv } from "@/lib/leads";
import { requireCapability } from "@/lib/admin-roles";

export const dynamic = "force-dynamic";

/** GET — the enquiry list, with counts per status for the summary row. */
export async function GET(req: NextRequest) {
  const gate = await requireCapability("students");
  if (!gate.ok) return gate.response;

  try {
    const status = req.nextUrl.searchParams.get("status");
    const branchId = req.nextUrl.searchParams.get("branchId");
    const search = req.nextUrl.searchParams.get("q")?.trim();

    const leads = await prisma.lead.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(branchId ? { branchId } : {}),
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: "insensitive" as const } },
                { email: { contains: search, mode: "insensitive" as const } },
              ],
            }
          : {}),
      },
      include: { branch: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      // A five-thousand-row payload would stall the page; the filters narrow it.
      take: 500,
    });

    const grouped = await prisma.lead.groupBy({ by: ["status"], _count: { status: true } });
    const counts = Object.fromEntries(grouped.map((g) => [g.status, g._count.status]));

    return NextResponse.json({
      leads: leads.map((l) => ({
        id: l.id,
        name: l.name,
        email: l.email,
        phone: l.phone,
        branchName: l.branch?.name ?? null,
        interestedLevel: l.interestedLevel,
        sessionSlot: l.sessionSlot,
        classType: l.classType,
        source: l.source,
        status: l.status,
        notes: l.notes,
        invitedAt: l.invitedAt,
        convertedAt: l.convertedAt,
        createdAt: l.createdAt,
      })),
      counts,
      total: Object.values(counts).reduce((a, b) => a + b, 0),
    });
  } catch (error) {
    console.error("Leads GET failed:", error);
    return NextResponse.json({ error: "Unable to load enquiries" }, { status: 500 });
  }
}

/** POST — invite, drop, or bulk-import. */
export async function POST(req: NextRequest) {
  const gate = await requireCapability("students");
  if (!gate.ok) return gate.response;

  try {
    const body = await req.json();
    const action = String(body?.action ?? "");

    if (action === "invite") {
      const ids = Array.isArray(body.leadIds) ? body.leadIds.filter((v: unknown) => typeof v === "string") : [];
      if (ids.length === 0) {
        return NextResponse.json({ error: "Select at least one enquiry" }, { status: 400 });
      }
      return NextResponse.json(await inviteLeads(ids));
    }

    if (action === "drop") {
      const ids = Array.isArray(body.leadIds) ? body.leadIds.filter((v: unknown) => typeof v === "string") : [];
      if (ids.length === 0) {
        return NextResponse.json({ error: "Select at least one enquiry" }, { status: 400 });
      }
      // Converted enquiries are history, not a working list — never drop those.
      const { count } = await prisma.lead.updateMany({
        where: { id: { in: ids }, status: { not: "converted" } },
        data: { status: "dropped" },
      });
      return NextResponse.json({ dropped: count });
    }

    if (action === "import") {
      if (typeof body.csv !== "string" || !body.csv.trim()) {
        return NextResponse.json({ error: "Paste or upload CSV content first" }, { status: 400 });
      }
      const result = await importLeadsFromCsv(body.csv, {
        source: typeof body.source === "string" ? body.source : "csv_import",
        branchId: typeof body.branchId === "string" ? body.branchId : null,
      });
      return NextResponse.json(result);
    }

    return NextResponse.json({ error: `Unknown action "${action}"` }, { status: 400 });
  } catch (error) {
    console.error("Leads POST failed:", error);
    return NextResponse.json({ error: "Unable to complete that action" }, { status: 500 });
  }
}
