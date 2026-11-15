import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAdminRequest } from "@/lib/admin-auth";
import { jsonRoute } from "@/lib/api-route";

export const dynamic = "force-dynamic";

/** The levels this centre offers (or might, once toggled on) — not every ExamSession.level value ever typed in, just the standard set. */
const KNOWN_LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;

export const GET = jsonRoute(async () => {
  if (!(await isAdminRequest())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await prisma.examLevelSetting.findMany();
  const byLevel = new Map(rows.map((r) => [r.level, r.enabled]));
  // A level with no row is enabled by default (the migration seeds all six, but never assume it ran twice identically).
  return NextResponse.json({ levels: KNOWN_LEVELS.map((level) => ({ level, enabled: byLevel.get(level) ?? true })) });
});

export const PATCH = jsonRoute(async (req: NextRequest) => {
  if (!(await isAdminRequest())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { level, enabled } = await req.json();
  if (typeof level !== "string" || !level.trim() || typeof enabled !== "boolean") {
    return NextResponse.json({ error: "level and enabled are required" }, { status: 400 });
  }
  await prisma.examLevelSetting.upsert({
    where: { level: level.trim().toUpperCase() },
    create: { level: level.trim().toUpperCase(), enabled },
    update: { enabled },
  });
  return NextResponse.json({ ok: true });
});
