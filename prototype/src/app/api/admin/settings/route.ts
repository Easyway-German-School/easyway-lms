import { requireCapability } from "@/lib/admin-roles";
import { NextResponse } from "next/server";

/**
 * In-memory settings store for now. This will be migrated to a database table later.
 * Key: tenantId, Value: settings JSON
 */
const settingsStore = new Map<string, Record<string, any>>();

const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"];
const DEFAULT_SETTINGS = {
  sessions: LEVELS.map((level) => ({
    level,
    morning: true,
    afternoon: true,
    evening: true,
  })),
};

export async function GET(request: Request) {
  const gate = await requireCapability("staff");
  if (!gate.ok) return gate.response;

  const tenantId = gate.session.user.tenantId || "root";
  const settings = settingsStore.get(tenantId) || DEFAULT_SETTINGS;

  return NextResponse.json(settings);
}

export async function POST(request: Request) {
  const gate = await requireCapability("staff");
  if (!gate.ok) return gate.response;

  try {
    const body = await request.json();
    const tenantId = gate.session.user.tenantId || "root";

    // Validate the settings structure
    if (!body.sessions || !Array.isArray(body.sessions)) {
      return NextResponse.json({ error: "Invalid settings format" }, { status: 400 });
    }

    // Store the settings
    settingsStore.set(tenantId, body);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to save settings:", error);
    return NextResponse.json({ error: "Failed to save settings" }, { status: 500 });
  }
}
