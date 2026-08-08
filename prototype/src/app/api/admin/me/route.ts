import { NextResponse } from "next/server";
import { requireAdmin, ADMIN_ROLE_LABELS } from "@/lib/admin-roles";

/**
 * What the signed-in admin is allowed to do. The admin shell calls this to
 * hide areas the user cannot open — the routes still enforce it themselves,
 * this just avoids showing doors that lead to a 403.
 */

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const admin = auth.admin;

  return NextResponse.json({
    adminRole: admin.adminRole,
    label: ADMIN_ROLE_LABELS[admin.adminRole],
    // This person's own capabilities, preset plus their overrides — not the
    // preset alone, which is what this used to send and which would have
    // hidden a hand-granted area from the sidebar.
    capabilities: admin.capabilities,
  });
}
