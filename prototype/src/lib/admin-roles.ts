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
 * Convenience for route handlers that already established the user is an
 * admin and just need to check one capability by user id.
 */
export async function adminHasCapability(userId: string, capability: Capability): Promise<boolean> {
  const admin = await resolveAdmin(userId);
  return Boolean(admin?.can(capability));
}

export type AdminContext = {
  userId: string;
  adminRole: AdminRole;
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
    select: { id: true, role: true, adminRole: true },
  });

  if (!user || String(user.role).toLowerCase() !== "admin") return null;

  const adminRole = normalizeAdminRole(user.adminRole);
  return {
    userId: user.id,
    adminRole,
    can: (capability: Capability) => adminCan(adminRole, capability),
  };
}
