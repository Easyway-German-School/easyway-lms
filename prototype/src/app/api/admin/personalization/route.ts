import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCapability } from "@/lib/admin-roles";

export async function GET() {
  // The other half of the same fix as /api/admin/dashboard: this checked only
  // `role === "admin"`, so every sub-role reached it regardless of preset.
  const gate = await requireCapability("reports");
  if (!gate.ok) return gate.response;

  const cachedPlans = await prisma.personalizedPlan.count();
  const strategies = ["deterministic", "fewshot", "hybrid"];

  return NextResponse.json({
    cachedPlans,
    strategies,
  });
}
