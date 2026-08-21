import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/** Lightweight database probe for uptime monitoring and Neon cold starts. */
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ ok: true, service: "database" });
  } catch (error) {
    console.error("Database health check failed:", error);
    return NextResponse.json({ ok: false, service: "database" }, { status: 503 });
  }
}
