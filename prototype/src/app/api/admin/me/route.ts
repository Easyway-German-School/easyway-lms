import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { NextResponse } from "next/server";
import { resolveAdmin, capabilitiesFor, ADMIN_ROLE_LABELS } from "@/lib/admin-roles";

/**
 * What the signed-in admin is allowed to do. The admin shell calls this to
 * hide areas the user cannot open — the routes still enforce it themselves,
 * this just avoids showing doors that lead to a 403.
 */

export const dynamic = "force-dynamic";

export async function GET() {
  const session = (await getServerSession(authOptions as any)) as any;
  const admin = await resolveAdmin(session?.user?.id);

  if (!admin) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  return NextResponse.json({
    adminRole: admin.adminRole,
    label: ADMIN_ROLE_LABELS[admin.adminRole],
    capabilities: capabilitiesFor(admin.adminRole),
  });
}
