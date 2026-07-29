import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { resolveAdmin, ADMIN_ROLES, ADMIN_ROLE_LABELS, normalizeAdminRole, type AdminRole } from "@/lib/admin-roles";

/**
 * Lists admins and sets their sub-role.
 *
 * Gated on the `staff` capability, which only Super Admin holds — otherwise a
 * Secretary could promote themselves and the whole separation would be
 * decorative.
 */

export const dynamic = "force-dynamic";

async function requireSuper() {
  const session = (await getServerSession(authOptions as any)) as any;
  const admin = await resolveAdmin(session?.user?.id);
  if (!admin) {
    return { error: NextResponse.json({ error: "Admin access required" }, { status: 403 }) };
  }
  if (!admin.can("staff")) {
    return { error: NextResponse.json({ error: "Only a Super Admin can change admin roles" }, { status: 403 }) };
  }
  return { admin };
}

export async function GET() {
  const auth = await requireSuper();
  if (auth.error) return auth.error;

  const admins = await prisma.user.findMany({
    where: { role: "ADMIN" },
    orderBy: { name: "asc" },
    select: { id: true, name: true, email: true, adminRole: true, createdAt: true },
  });

  return NextResponse.json({
    admins: admins.map((a) => ({
      ...a,
      adminRole: normalizeAdminRole(a.adminRole),
      label: ADMIN_ROLE_LABELS[normalizeAdminRole(a.adminRole)],
    })),
    roles: ADMIN_ROLES.map((r) => ({ value: r, label: ADMIN_ROLE_LABELS[r] })),
  });
}

export async function PATCH(req: NextRequest) {
  const auth = await requireSuper();
  if (auth.error) return auth.error;

  try {
    const { userId, adminRole } = await req.json();
    if (!userId || !adminRole) {
      return NextResponse.json({ error: "userId and adminRole are required" }, { status: 400 });
    }
    if (!(ADMIN_ROLES as readonly string[]).includes(adminRole)) {
      return NextResponse.json({ error: "Unknown admin role" }, { status: 400 });
    }

    const target = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    if (!target || String(target.role).toLowerCase() !== "admin") {
      return NextResponse.json({ error: "That user is not an admin" }, { status: 404 });
    }

    // Refuse to remove the last Super Admin — there would be nobody left who
    // could grant the role back, including the person making the change.
    if (adminRole !== "super") {
      const supers = await prisma.user.findMany({
        where: { role: "ADMIN", OR: [{ adminRole: "super" }, { adminRole: null }] },
        select: { id: true },
      });
      const remaining = supers.filter((s) => s.id !== userId);
      if (remaining.length === 0) {
        return NextResponse.json(
          { error: "This is the only Super Admin. Promote someone else first." },
          { status: 409 },
        );
      }
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: { adminRole: adminRole as AdminRole },
      select: { id: true, name: true, email: true, adminRole: true },
    });

    return NextResponse.json({
      admin: { ...updated, label: ADMIN_ROLE_LABELS[normalizeAdminRole(updated.adminRole)] },
    });
  } catch (error) {
    console.error("Admin staff PATCH failed:", error);
    return NextResponse.json({ error: "Unable to update the admin role" }, { status: 500 });
  }
}
