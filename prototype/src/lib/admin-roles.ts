import { prisma } from "@/lib/prisma";

/**
 * Admin sub-roles.
 *
 * Everyone here is role=ADMIN as far as authentication is concerned; this
 * decides what they can actually reach once inside. Keeping it separate from
 * the Role enum means the 26 existing "is this an admin?" checks keep working
 * untouched, and an admin with no sub-role set behaves exactly as before.
 *
 * Capabilities are deliberately coarse — one per area of the admin area,
 * matching how the office is actually staffed rather than per-endpoint.
 */

export const ADMIN_ROLES = ["super", "secretary", "data_comm"] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

export const ADMIN_ROLE_LABELS: Record<AdminRole, string> = {
  super: "Super Admin",
  secretary: "Secretary",
  data_comm: "Data & Communications Manager",
};

export const CAPABILITIES = [
  "students",     // enrol, edit, move, graduate
  "attendance",
  "exams",        // exams and exam registrations
  "payments",     // fees, invoices, financial reporting
  "materials",
  "community",    // moderation
  "emails",       // bulk mail and notifications
  "reports",
  "branches",
  "staff",        // inviting lecturers, assigning admin roles
  "integrations",
] as const;
export type Capability = (typeof CAPABILITIES)[number];

const GRANTS: Record<AdminRole, Capability[] | "all"> = {
  // Runs the school: everything, including who else is an admin.
  super: "all",

  // Front desk: the student lifecycle and the paperwork around it. No access
  // to money, staffing or bulk communications.
  secretary: ["students", "attendance", "exams", "materials", "branches"],

  // Owns communications and the numbers, not the student records.
  data_comm: ["community", "emails", "reports", "integrations", "payments"],
};

/** An admin with no sub-role set is treated as super — nobody loses access. */
export function normalizeAdminRole(value: unknown): AdminRole {
  const v = String(value ?? "").toLowerCase();
  return (ADMIN_ROLES as readonly string[]).includes(v) ? (v as AdminRole) : "super";
}

export function adminCan(adminRole: unknown, capability: Capability): boolean {
  const role = normalizeAdminRole(adminRole);
  const grants = GRANTS[role];
  return grants === "all" || grants.includes(capability);
}

export function capabilitiesFor(adminRole: unknown): Capability[] {
  const role = normalizeAdminRole(adminRole);
  const grants = GRANTS[role];
  return grants === "all" ? [...CAPABILITIES] : grants;
}

/**
 * Per-person adjustments layered on top of a preset.
 *
 * Stored on User.adminCapabilities as `{ grant: [...], revoke: [...] }`. It is
 * a diff rather than a flat list on purpose: a secretary given `payments` by
 * hand still picks up anything added to the secretary preset later, which a
 * frozen copy of the list would not.
 *
 * Null — every admin who existed before this — means "just the preset", so
 * nobody's access moves until somebody deliberately ticks a box.
 */
export type CapabilityOverrides = {
  grant: Capability[];
  revoke: Capability[];
};

function isCapability(value: unknown): value is Capability {
  return (CAPABILITIES as readonly string[]).includes(String(value));
}

/** Tolerant of anything: bad JSON in the column must not lock an admin out. */
export function parseOverrides(raw: unknown): CapabilityOverrides {
  const empty: CapabilityOverrides = { grant: [], revoke: [] };
  if (!raw || typeof raw !== "object") return empty;

  const source = raw as Record<string, unknown>;
  const read = (key: string) =>
    Array.isArray(source[key]) ? (source[key] as unknown[]).filter(isCapability) : [];

  const grant = read("grant");
  const revoke = read("revoke");
  // A capability in both lists is a contradiction; revoking wins, because the
  // safer reading of an ambiguous permission is the narrower one.
  return { grant: grant.filter((c) => !revoke.includes(c)), revoke };
}

/** The preset, plus this person's grants, minus their revocations. */
export function capabilitiesForUser(adminRole: unknown, overrides: unknown): Capability[] {
  const { grant, revoke } = parseOverrides(overrides);
  const base = new Set<Capability>(capabilitiesFor(adminRole));
  for (const capability of grant) base.add(capability);
  for (const capability of revoke) base.delete(capability);
  return CAPABILITIES.filter((capability) => base.has(capability));
}

/**
 * Convenience for route handlers that already established the user is an
 * admin and just need to check one capability by user id.
 */
export async function adminHasCapability(userId: string, capability: Capability): Promise<boolean> {
  const admin = await resolveAdmin(userId);
  return Boolean(admin?.can(capability));
}

/**
 * The whole door in one call: reads the session, resolves the admin, checks
 * the capability, and hands back either a context or the response to return.
 *
 *   const gate = await requireCapability("payments");
 *   if (!gate.ok) return gate.response;
 *   // gate.admin is available from here
 *
 * This exists because eighteen admin routes had drifted into checking only
 * `role === "admin"` — and two into checking nothing at all — which made the
 * sub-roles decorative on every one of them: a Secretary with no `payments`
 * capability could still read the fee book straight off the API.
 */
export async function requireCapability(
  capability: Capability,
): Promise<{ ok: true; admin: AdminContext } | { ok: false; response: Response }> {
  // Imported here rather than at the top: this module is pulled into client
  // bundles for its label maps, and next-auth's server entry must not follow.
  const { getServerSession } = await import("next-auth");
  const { authOptions } = await import("@/lib/auth");
  const { NextResponse } = await import("next/server");

  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null;
  const admin = await resolveAdmin(session?.user?.id);

  if (!admin) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Admin access required" }, { status: 403 }),
    };
  }

  if (!admin.can(capability)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: `Your admin role does not cover ${capability}` },
        { status: 403 },
      ),
    };
  }

  return { ok: true, admin };
}

export type AdminContext = {
  userId: string;
  adminRole: AdminRole;
  /** What this person can actually reach: preset plus their own overrides. */
  capabilities: Capability[];
  can: (capability: Capability) => boolean;
};

/**
 * Resolve the signed-in user as an admin, or return null when they are not one.
 * Route handlers pair this with `can()` to gate a specific area.
 */
export async function resolveAdmin(userId: string | undefined): Promise<AdminContext | null> {
  if (!userId) return null;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, adminRole: true, adminCapabilities: true },
  });

  if (!user || String(user.role).toLowerCase() !== "admin") return null;

  const adminRole = normalizeAdminRole(user.adminRole);
  const capabilities = capabilitiesForUser(adminRole, user.adminCapabilities);
  return {
    userId: user.id,
    adminRole,
    capabilities,
    can: (capability: Capability) => capabilities.includes(capability),
  };
}
