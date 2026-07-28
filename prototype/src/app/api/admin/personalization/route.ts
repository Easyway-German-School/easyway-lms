import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await getServerSession(authOptions as any) as any;
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await prisma.user.findUnique({ where: { id: session.user.id as string } });
  if (user?.role?.toLowerCase() !== "admin") return NextResponse.json({ error: "Admin access required" }, { status: 403 });

  const cachedPlans = await prisma.personalizedPlan.count();
  const strategies = ["deterministic", "fewshot", "hybrid"];

  return NextResponse.json({
    cachedPlans,
    strategies,
  });
}
