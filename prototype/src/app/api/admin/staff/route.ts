import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import {
  resolveAdmin,
  ADMIN_ROLES,
  ADMIN_ROLE_LABELS,
  CAPABILITIES,
  capabilitiesFor,
  capabilitiesForUser,
  normalizeAdminRole,
  parseOverrides,
  type AdminRole,
  type Capability,
} from "@/lib/admin-roles";

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
    select: {
      id: true,
      name: true,
      email: true,
      adminRole: true,
      adminCapabilities: true,
      createdAt: true,
    },
  });

  return NextResponse.json({
    admins: admins.map((a) => {
      const adminRole = normalizeAdminRole(a.adminRole);
      return {
        id: a.id,
        name: a.name,
        email: a.email,
        createdAt: a.createdAt,
        adminRole,
        label: ADMIN_ROLE_LABELS[adminRole],
        // What the preset gives them, what they actually have, and the diff
        // between the two — the page needs all three to draw the tick boxes
        // and mark which ones were set by hand.
        presetCapabilities: capabilitiesFor(adminRole),
        capabilities: capabilitiesForUser(adminRole, a.adminCapabilities),
        overrides: parseOverrides(a.adminCapabilities),
      };
    }),
    roles: ADMIN_ROLES.map((r) => ({
      value: r,
      label: ADMIN_ROLE_LABELS[r],
      capabilities: capabilitiesFor(r),
    })),
    allCapabilities: CAPABILITIES.map((value) => ({ value, label: CAPABILITY_LABELS[value] })),
  });
}

/** Plain English for the office; the capability tokens mean nothing to them. */
const CAPABILITY_LABELS: Record<Capability, string> = {
  students: "Students - enrol, edit, move, graduate",
  attendance: "Attendance registers",
  classes: "Class coordination - timetables, sittings, postponements",
  exams: "Exams and exam registrations",
  payments: "Fees, invoices and the payment dashboard (super admin)",
  materials: "Course materials",
  community: "Community moderation",
  emails: "Bulk email and notifications",
  reports: "Reports and exports",
  branches: "Branches",
  staff: "Staff - invite tutors, set admin roles",
  integrations: "Integrations",
};

export async function PATCH(req: NextRequest) {
  const auth = await requireSuper();
  if (auth.error) return auth.error;

  try {
    const body = await req.json();
    const userId = typeof body.userId === "string" ? body.userId : "";
    // Either field may be sent alone: change the preset, tick a box, or both.
    const adminRole = typeof body.adminRole === "string" ? body.adminRole : null;
    const capabilities = Array.isArray(body.capabilities)
      ? (body.capabilities as unknown[]).filter((c): c is Capability =>
          (CAPABILITIES as readonly string[]).includes(String(c)),
        )
      : null;

    if (!userId) {
      return NextResponse.json({ error: "userId is required" }, { status: 400 });
    }
    if (!adminRole && !capabilities) {
      return NextResponse.json(
        { error: "Send an adminRole, a capabilities list, or both" },
        { status: 400 },
      );
    }
    if (adminRole && !(ADMIN_ROLES as readonly string[]).includes(adminRole)) {
      return NextResponse.json({ error: "Unknown admin role" }, { status: 400 });
    }

    const target = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, adminRole: true, adminCapabilities: true },
    });
    if (!target || String(target.role).toLowerCase() !== "admin") {
      return NextResponse.json({ error: "That user is not an admin" }, { status: 404 });
    }

    const nextRole = normalizeAdminRole(adminRole ?? target.adminRole);
    const preset = capabilitiesFor(nextRole);

    // The tick boxes are stored as a diff against the preset, so widening a
    // preset later still reaches the people who were adjusted by hand.
    const overrides = capabilities
      ? {
          grant: capabilities.filter((c) => !preset.includes(c)),
          revoke: preset.filter((c) => !capabilities.includes(c)),
        }
      : parseOverrides(target.adminCapabilities);

    const effective = capabilitiesForUser(nextRole, overrides);

    // Refuse to remove the last person who can manage staff. There would be
    // nobody left who could grant it back, including whoever is making the
    // change. Checked on the effective capability rather than the role name,
    // now that a Secretary can be handed `staff` by hand.
    if (!effective.includes("staff")) {
      const others = await prisma.user.findMany({
        where: { role: "ADMIN", NOT: { id: userId } },
        select: { adminRole: true, adminCapabilities: true },
      });
      const someoneElseCan = others.some((o) =>
        capabilitiesForUser(o.adminRole, o.adminCapabilities).includes("staff"),
      );
      if (!someoneElseCan) {
        return NextResponse.json(
          { error: "This is the only admin who can manage staff. Give someone else that access first." },
          { status: 409 },
        );
      }
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: {
        adminRole: nextRole as AdminRole,
        // An empty diff is stored as null, which reads as "just the preset".
        adminCapabilities:
          overrides.grant.length === 0 && overrides.revoke.length === 0 ? Prisma.DbNull : overrides,
      },
      select: { id: true, name: true, email: true },
    });

    return NextResponse.json({
      admin: {
        id: updated.id,
        name: updated.name,
        email: updated.email,
        adminRole: nextRole,
        label: ADMIN_ROLE_LABELS[nextRole],
        presetCapabilities: preset,
        capabilities: effective,
        overrides,
      },
    });
  } catch (error) {
    console.error("Admin staff PATCH failed:", error);
    return NextResponse.json({ error: "Unable to update the admin role" }, { status: 500 });
  }
}
