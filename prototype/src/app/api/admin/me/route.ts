import { NextResponse } from "next/server";
import { requireAdmin, ADMIN_ROLE_LABELS } from "@/lib/admin-roles";
import { isPlatformOperator } from "@/lib/platform";

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

  /**
   * Whether this person operates the platform, which is a different job from
   * running this school and is granted by a different column. The sidebar needs
   * it to decide whether to show the cross-tenant console at all — and unlike a
   * capability, the default here is false: an unknown answer hides the door
   * rather than showing it, because the cost of briefly offering the platform
   * console to a school's super admin is worse than the cost of a flicker.
   *
   * This is a signpost only. /api/platform/* re-checks the column itself and
   * answers 404 to everybody else.
   */
  const platformOperator = await isPlatformOperator(admin.userId);

  return NextResponse.json({
    adminRole: admin.adminRole,
    label: ADMIN_ROLE_LABELS[admin.adminRole],
    // This person's own capabilities, preset plus their overrides — not the
    // preset alone, which is what this used to send and which would have
    // hidden a hand-granted area from the sidebar.
    capabilities: admin.capabilities,
    platformOperator,
  });
}
