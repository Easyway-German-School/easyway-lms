import bcryptjs from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import {
  requireCapability,
  ADMIN_ROLES,
  ADMIN_ROLE_LABELS,
  CAPABILITIES,
  capabilitiesFor,
  capabilitiesForUser,
  normalizeAdminRole,
  parseOverrides,
  type AdminContext,
  type AdminRole,
  type Capability,
} from "@/lib/admin-roles";

/**
 * Admin accounts: who they are, what they can reach, and how they get in.
 *
 * Gated on the `staff` capability, which only Super Admin holds — otherwise a
 * Secretary could promote themselves and the whole separation would be
 * decorative.
 *
 * WHAT WAS MISSING. This route could set an existing admin's sub-role and
 * nothing else. There was no way anywhere in the product to CREATE an admin,
 * change one's email, or reset a forgotten password — the only route to a new
 * secretary was writing a row into the database by hand, and a locked-out
 * admin stayed locked out. So POST creates, PATCH now also moves the name,
 * email and password, and DELETE steps somebody down to a plain account
 * rather than deleting a person who owns audit history.
 */

export const dynamic = "force-dynamic";

const MIN_PASSWORD = 8;

function badPassword(password: string): string | null {
  if (password.length < MIN_PASSWORD) return `Password must be at least ${MIN_PASSWORD} characters`;
  return null;
}

function normaliseEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

/** Rejects "a@b" and "no-at-sign" without pretending to validate deliverability. */
function looksLikeEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

async function requireSuper() {
  return requireCapability("staff");
}

/**
 * Would this change leave nobody able to manage staff?
 *
 * Checked on the effective capability rather than the role name, now that a
 * Secretary can be handed `staff` by hand. If it ever returns true the change
 * is refused: there would be nobody left who could grant it back, including
 * whoever is making the change.
 */
async function wouldOrphanStaff(userId: string, keepsStaff: boolean): Promise<boolean> {
  if (keepsStaff) return false;
  const others = await prisma.user.findMany({
    where: { role: "ADMIN", NOT: { id: userId } },
    select: { adminRole: true, adminCapabilities: true },
  });
  return !others.some((other) =>
    capabilitiesForUser(other.adminRole, other.adminCapabilities).includes("staff"),
  );
}

export async function GET() {
  const auth = await requireSuper();
  if (!auth.ok) return auth.response;

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
      totpEnabledAt: true,
    },
  });

  return NextResponse.json({
    // Where these accounts actually sign in. The page shows it rather than
    // making somebody guess — admins do not use the student sign-in page and
    // there is nothing on it that says so.
    signInPath: "/auth/admin",
    admins: admins.map((a) => {
      const adminRole = normalizeAdminRole(a.adminRole);
      return {
        id: a.id,
        name: a.name,
        email: a.email,
        createdAt: a.createdAt,
        // Possession of a secret is not enrolment; the confirmed date is.
        mfaEnabled: Boolean(a.totpEnabledAt),
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
  security: "Security & recovery - the activity trail, restoring deleted records (super admin)",
};

/**
 * POST — create an admin account.
 *
 * The password is set here and echoed back exactly once so it can be handed
 * over; it is stored as a bcrypt hash and is never readable again, which is
 * why the reset below replaces rather than reveals.
 */
export async function POST(req: NextRequest) {
  const auth = await requireSuper();
  if (!auth.ok) return auth.response;

  try {
    const body = await req.json();
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const email = normaliseEmail(body.email);
    const password = typeof body.password === "string" ? body.password : "";
    const adminRole = normalizeAdminRole(
      typeof body.adminRole === "string" ? body.adminRole : "secretary",
    );

    if (!name || !email || !password) {
      return NextResponse.json({ error: "Name, email and password are all required" }, { status: 400 });
    }
    if (!looksLikeEmail(email)) {
      return NextResponse.json({ error: "That does not look like an email address" }, { status: 400 });
    }
    const weak = badPassword(password);
    if (weak) return NextResponse.json({ error: weak }, { status: 400 });

    const existing = await prisma.user.findUnique({
      where: { email },
      select: { id: true, role: true },
    });
    if (existing) {
      // Naming the conflict is the difference between a super admin fixing it
      // in ten seconds and one filing a bug.
      return NextResponse.json(
        {
          error:
            String(existing.role).toLowerCase() === "admin"
              ? "That email is already an admin account."
              : `That email already belongs to a ${String(existing.role).toLowerCase()} account. Use a different address.`,
        },
        { status: 409 },
      );
    }

    const created = await prisma.user.create({
      data: {
        name,
        email,
        password: await bcryptjs.hash(password, 10),
        role: "ADMIN",
        adminRole,
      },
      select: { id: true, name: true, email: true, createdAt: true },
    });

    return NextResponse.json(
      {
        admin: {
          ...created,
          adminRole,
          label: ADMIN_ROLE_LABELS[adminRole],
          presetCapabilities: capabilitiesFor(adminRole),
          capabilities: capabilitiesFor(adminRole),
          overrides: { grant: [], revoke: [] },
          mfaEnabled: false,
        },
        // Echoed once so the super admin can pass it on. Never stored in the
        // clear and never returned again.
        password,
        signInPath: "/auth/admin",
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Admin staff POST failed:", error);
    return NextResponse.json({ error: "Unable to create that admin" }, { status: 500 });
  }
}

/**
 * DELETE — step an admin down to a plain account.
 *
 * Not a row deletion. An admin owns audit-trail entries, notifications and
 * anything else keyed to their id, and removing the user makes that history
 * unreadable. Demoting to STUDENT closes every admin route to them while
 * leaving the record of what they did intact.
 */
export async function DELETE(req: NextRequest) {
  const auth = await requireSuper();
  if (!auth.ok) return auth.response;

  const userId = req.nextUrl.searchParams.get("userId") ?? "";
  if (!userId) return NextResponse.json({ error: "userId is required" }, { status: 400 });

  if (userId === auth.admin?.userId) {
    return NextResponse.json(
      { error: "You cannot revoke your own admin access." },
      { status: 409 },
    );
  }

  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, name: true, email: true },
  });
  if (!target || String(target.role).toLowerCase() !== "admin") {
    return NextResponse.json({ error: "That user is not an admin" }, { status: 404 });
  }

  if (await wouldOrphanStaff(userId, false)) {
    return NextResponse.json(
      { error: "This is the only admin who can manage staff. Give someone else that access first." },
      { status: 409 },
    );
  }

  await prisma.user.update({
    where: { id: userId },
    data: { role: "STUDENT", adminRole: null, adminCapabilities: Prisma.DbNull },
  });

  return NextResponse.json({ success: true, revoked: target.email });
}

export async function PATCH(req: NextRequest) {
  const auth = await requireSuper();
  if (!auth.ok) return auth.response;

  try {
    const body = await req.json();
    const userId = typeof body.userId === "string" ? body.userId : "";
    // Any field may be sent alone: change the preset, tick a box, rename them,
    // move their email, reset their password, or several at once.
    const adminRole = typeof body.adminRole === "string" ? body.adminRole : null;
    const capabilities = Array.isArray(body.capabilities)
      ? (body.capabilities as unknown[]).filter((c): c is Capability =>
          (CAPABILITIES as readonly string[]).includes(String(c)),
        )
      : null;
    const name = typeof body.name === "string" ? body.name.trim() : null;
    const email = body.email === undefined ? null : normaliseEmail(body.email);
    const password = typeof body.password === "string" ? body.password : null;

    if (!userId) {
      return NextResponse.json({ error: "userId is required" }, { status: 400 });
    }
    if (!adminRole && !capabilities && name === null && email === null && password === null) {
      return NextResponse.json({ error: "Nothing to change" }, { status: 400 });
    }
    if (adminRole && !(ADMIN_ROLES as readonly string[]).includes(adminRole)) {
      return NextResponse.json({ error: "Unknown admin role" }, { status: 400 });
    }

    const target = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, adminRole: true, adminCapabilities: true, email: true },
    });
    if (!target || String(target.role).toLowerCase() !== "admin") {
      return NextResponse.json({ error: "That user is not an admin" }, { status: 404 });
    }

    /* ---------------------------------------------------------- account */

    const account: Prisma.UserUpdateInput = {};

    if (name !== null) {
      if (!name) return NextResponse.json({ error: "A name cannot be empty" }, { status: 400 });
      account.name = name;
    }

    if (email !== null && email !== target.email) {
      if (!looksLikeEmail(email)) {
        return NextResponse.json({ error: "That does not look like an email address" }, { status: 400 });
      }
      const clash = await prisma.user.findUnique({ where: { email }, select: { id: true } });
      if (clash && clash.id !== userId) {
        return NextResponse.json({ error: "Another account already uses that email" }, { status: 409 });
      }
      account.email = email;
    }

    if (password !== null) {
      const weak = badPassword(password);
      if (weak) return NextResponse.json({ error: weak }, { status: 400 });
      account.password = await bcryptjs.hash(password, 10);
      // A password set by a super admin is a known password, so the account is
      // claimed — it is not one of the placeholder accounts an exam booking
      // creates, whose claim link must stay open.
      account.passwordClaimed = true;
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
    // change.
    if (await wouldOrphanStaff(userId, effective.includes("staff"))) {
      return NextResponse.json(
        { error: "This is the only admin who can manage staff. Give someone else that access first." },
        { status: 409 },
      );
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: {
        ...account,
        adminRole: nextRole as AdminRole,
        // An empty diff is stored as null, which reads as "just the preset".
        adminCapabilities:
          overrides.grant.length === 0 && overrides.revoke.length === 0 ? Prisma.DbNull : overrides,
      },
      select: { id: true, name: true, email: true, totpEnabledAt: true },
    });

    return NextResponse.json({
      admin: {
        id: updated.id,
        name: updated.name,
        email: updated.email,
        mfaEnabled: Boolean(updated.totpEnabledAt),
        adminRole: nextRole,
        label: ADMIN_ROLE_LABELS[nextRole],
        presetCapabilities: preset,
        capabilities: effective,
        overrides,
      },
      // Told back so the page can say "they must sign in again with this",
      // rather than the super admin having to remember what they typed.
      passwordChanged: password !== null,
    });
  } catch (error) {
    console.error("Admin staff PATCH failed:", error);
    return NextResponse.json({ error: "Unable to update that admin" }, { status: 500 });
  }
}
