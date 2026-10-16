import { NextRequest, NextResponse } from "next/server";

import { readClosedSignupSlots } from "@/lib/signup-availability-server";
import { currentTenantId, setTenantScope } from "@/lib/tenant/context";
import { resolveTenantId } from "@/lib/tenant/resolve";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    setTenantScope(await resolveTenantId(request));
    const tenantId = currentTenantId();
    if (!tenantId) {
      return NextResponse.json({ error: "No school is configured for this signup" }, { status: 400 });
    }
    return NextResponse.json({ closedSlots: await readClosedSignupSlots(tenantId) });
  } catch (error) {
    console.error("Failed to load public signup availability:", error);
    return NextResponse.json({ error: "Unable to load signup availability" }, { status: 500 });
  }
}
