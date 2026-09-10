import { NextResponse } from "next/server";
import { headers } from "next/headers";

import { setTenantScope } from "@/lib/tenant/context";
import { resolveTenantId } from "@/lib/tenant/resolve";
import { defaultSessionSettings } from "@/lib/school-settings";
import { readSessionSettings } from "@/lib/school-settings-server";

/**
 * Which sittings and attendance modes this school runs, per level.
 *
 * Public and unauthenticated, so the tenant comes from the hostname — exactly
 * like /api/branches, and for the same reason: this feeds the sign-up form, and
 * offering one school's sittings on another school's page would place a student
 * wrong before they had typed anything. The admin add-student form reads it too.
 *
 * Only ever exposes which options are on/off — nothing sensitive — so it needs
 * no auth. It falls back to "everything runs" on any error, so the sign-up form
 * never loses its session dropdown because a settings read hiccuped.
 */

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const tenantId = await resolveTenantId({ headers: await headers() });
    setTenantScope(tenantId);
    return NextResponse.json(await readSessionSettings(tenantId));
  } catch (error) {
    console.error("Failed to load school sessions:", error);
    return NextResponse.json(defaultSessionSettings());
  }
}
