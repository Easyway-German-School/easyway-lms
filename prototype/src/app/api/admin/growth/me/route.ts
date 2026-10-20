import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCapability } from "@/lib/admin-roles";
import { normalizeGrowthTitle, GROWTH_TITLE_LABELS } from "@/lib/growth/titles";

export const dynamic = "force-dynamic";

/** GET — who's signed in and which Growth Desk job they hold, for the dashboard to personalise around. */
export async function GET() {
  const gate = await requireCapability("growth");
  if (!gate.ok) return gate.response;

  const user = await prisma.user.findUnique({
    where: { id: gate.admin.userId },
    select: { name: true, growthTitle: true },
  });

  const title = normalizeGrowthTitle(user?.growthTitle);

  return NextResponse.json({
    name: user?.name ?? null,
    title,
    titleLabel: GROWTH_TITLE_LABELS[title],
  });
}
