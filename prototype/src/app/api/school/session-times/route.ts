import { NextResponse } from "next/server";
import { headers } from "next/headers";

import { setTenantScope } from "@/lib/tenant/context";
import { resolveTenantId } from "@/lib/tenant/resolve";
import { defaultSessionTimes } from "@/lib/session-times";
import { readSessionTimes } from "@/lib/session-times-server";

/**
 * The clock times to quote for each sitting — see lib/session-times.ts.
 * Public and unauthenticated for the same reason as /api/school/sessions:
 * this feeds the sign-up form's hybrid combo picker before a student has
 * typed anything, and falls back to the seeded defaults on any error rather
 * than losing the times entirely.
 */

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const tenantId = await resolveTenantId({ headers: await headers() });
    setTenantScope(tenantId);
    return NextResponse.json(await readSessionTimes(tenantId));
  } catch (error) {
    console.error("Failed to load session times:", error);
    return NextResponse.json(defaultSessionTimes());
  }
}
