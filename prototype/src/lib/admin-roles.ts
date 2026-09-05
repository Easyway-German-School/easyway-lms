import type { Session } from "next-auth";
import { prisma } from "@/lib/prisma";
import { beginRequestScope } from "@/lib/tenant/context";
import { beginAuditScope } from "@/lib/audit-context";

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

export const ADMIN_ROLES = ["super", "secretary", "accountant", "data_comm"] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

export const ADMIN_ROLE_LABELS: Record<AdminRole, string> = {
  super: "Super Admin",
  secretary: "Secretary",
  accountant: "Accountant",
  data_comm: "Data & Communications Manager",
};

export const CAPABILITIES = [
  "students",     // enrol, edit, move, graduate
  "attendance",
  "classes",      // timetables, sittings, postponements — coordinating classes
  "exams",        // exams and exam registrations
  "payments",     // fees, invoices, financial reporting
  "materials",
  "community",    // moderation
  "emails",       // bulk mail and notifications
  "reports",
  "branches",
  "staff",        // inviting lecturers, assigning admin roles
  "integrations",
  "security",     // the audit trail, restoring deleted records, backup health
  "work_drive",   // the staff file store — workspaces, folders, files, sharing
  "events",       // the staff calendar, events, and webinars
  "payroll",      // what the school pays its tutors — separate from `payments`,
                  // which is tuition coming IN, not compensation going OUT
] as const;
export type Capability = (typeof CAPABILITIES)[number];

/**
 * PAYMENTS BELONGS TO WHOEVER RUNS THE SCHOOL — AND TO THE ACCOUNTANT.
 *
 * The earlier rule was that no preset carried `payments` at all: it had been on
 * `data_comm` on the reasoning that whoever owns the reporting owns the
 * numbers, and the school pulled it back so that every student's balance, every
 * transaction and the collected totals sat with one person. That was the right
 * call while there was nobody else whose job was the money.
 *
 * There is now. An accountant who has to be hand-granted `payments` one account
 * at a time is a preset that lies about how the office is staffed, and the
 * likely outcome is the school stops bothering and signs the accountant in as a
 * super admin — which hands over the student records, the staff list and the
 * audit trail to close a gap that was only ever about the fee book. So the role
 * exists, it carries the money and nothing else, and `secretary` and
 * `data_comm` still do not.
 *
 * `security` stays out of every preset. See SUPER_ONLY_CAPABILITIES below: it
 * has a separate reason that this change does not touch.
 */
const GRANTS: Record<AdminRole, Capability[] | "all"> = {
  // Runs the school: everything, including who else is an admin.
  super: "all",

  // Front desk: the student lifecycle and the paperwork around it. No access
  // to money, staffing or bulk communications. `events` because the front desk
  // is who books the staff meeting and the open day; `work_drive` is left
  // hand-granted for now (see docs/WORK_DRIVE.md open questions).
  secretary: ["students", "attendance", "classes", "exams", "materials", "branches", "events"],

  /**
   * The fee book and what explains it. Narrow on purpose.
   *
   * `payments` is the job. `reports` comes with it because an accountant asked
   * "why did Abuja collect less this month" needs the enrolment and attendance
   * shape to answer, and refusing it would send them to ask a super admin for a
   * screenshot. `students` is deliberately absent — the receivables screens
   * name students and show their balances, which is the accountant's business,
   * but editing a student record, moving them between branches or graduating
   * them is not.
   */
  accountant: ["payments", "reports", "payroll"],

  // Owns communications and the numbers, not the student records or the money.
  // `events` too: a webinar is a broadcast, and the open day is a comms job.
  data_comm: ["community", "emails", "reports", "integrations", "events"],
};

/**
 * The capabilities that demand a second factor.
 *
 * Read by `shouldRequireMfa` in src/lib/mfa.ts and by nothing else — it is not
 * a restriction on the presets above, and since the Accountant role landed it
 * is no longer true that only a super admin can hold one of these. The name is
 * kept because the shape of the rule has not changed: whoever holds the money
 * or the audit trail signs in with an authenticator, whatever their job title.
 *
 * `security` is here for its own reason. The audit trail is how you find out
 * what an admin did, and the restore screen can put back a record somebody
 * deleted on purpose. Both are ordinary tools right up until the person being
 * investigated is the one holding them, so it stays out of every preset and is
 * granted one person at a time or not at all.
 */
export const SUPER_ONLY_CAPABILITIES: Capability[] = ["payments", "security", "payroll"];

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
 * Which branches this admin may see/manage, or `null` for unrestricted.
 *
 * Stored on User.adminBranchIds as a plain JSON array of branch ids — not a
 * grant/revoke diff like capabilities, because there is no preset to diff
 * against: "which branches" has no school-wide default beyond "all of them".
 *
 * Null AND an empty array both mean unrestricted. Empty is treated the same
 * as null rather than as "access to nothing" because a superadmin unticking
 * every box in the UI is indistinguishable from never having restricted this
 * person at all, and the safer reading of that ambiguity is the wider one —
 * the same reasoning `parseOverrides` above uses for a capability that is
 * both granted and revoked, just pointed the other way: there, an
 * unresolvable conflict picks the narrower access; here, an empty selection
 * is not a conflict; it is nobody having deliberately drawn a boundary yet.
 */
export function parseBranchIds(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const ids = raw.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
  const unique = Array.from(new Set(ids));
  return unique.length > 0 ? unique : null;
}

/**
 * The branch filter a route should apply for this admin: `null` means every
 * branch (today's behaviour, and every admin until restricted by hand), an
 * array means exactly those branch ids.
 *
 *   const gate = await requireCapability("students");
 *   if (!gate.ok) return gate.response;
 *   const branchIds = scopedBranchIds(gate.admin);
 *   if (branchIds) whereClause.branchId = { in: branchIds };
 */
export function scopedBranchIds(admin: Pick<AdminContext, "branchIds">): string[] | null {
  return admin.branchIds;
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
/**
 * Name the actor for everything this request goes on to write.
 *
 * The admin gates are the single door every admin route passes through, so
 * attaching identity here means the audit trail covers routes nobody
 * remembered to instrument — including the ones written after this. Set
 * before any capability check rather than after, so that a refused attempt is
 * still attributable: somebody probing endpoints they cannot reach is exactly
 * the pattern worth having on record.
 *
 * SHARED BY BOTH GATES, AND IT DID NOT USED TO BE. This lived inline in
 * `requireCapability` only, so every route reached through `requireAdmin` —
 * the ones that do their own `admin.can(...)` check — wrote audit entries with
 * nobody's name on them. An audit line that cannot say who did the thing
 * answers the one question an audit trail exists to answer with a shrug.
 */
async function nameAuditActor(admin: AdminContext | null): Promise<void> {
  if (!admin) return;
  const { setAuditActor, actorFromRequest } = await import("@/lib/audit-context");
  const { headers } = await import("next/headers");
  let request: { ip?: string; userAgent?: string; route?: string; requestId?: string } = {};
  try {
    const headerList = await headers();
    request = actorFromRequest({ headers: headerList });
  } catch {
    // Called outside a request scope (a script, a build-time render). The
    // actor is still worth recording without the network details.
  }
  setAuditActor({
    userId: admin.userId,
    email: admin.email,
    role: `admin:${admin.adminRole}`,
    source: "app",
    ...request,
  });
}

export async function requireCapability(
  capability: Capability,
): Promise<{ ok: true; admin: AdminContext; session: Session } | { ok: false; response: Response }> {
  /**
   * FIRST STATEMENT, BEFORE ANY AWAIT — including before the dynamic imports
   * below, which are awaits like any other. This installs the scope holder in
   * the calling route's context; requireAuthSession fills it in. See
   * src/lib/tenant/context.ts for why the order is load-bearing.
   */
  beginRequestScope();
  // Same rule, same reason: synchronously, before the first await, so the
  // holder reaches the route handler. See beginAuditScope.
  beginAuditScope();

  // Imported here rather than at the top: this module is pulled into client
  // bundles for its label maps, and next-auth's server entry must not follow.
  const { requireAuthSession } = await import("@/lib/auth");
  const { NextResponse } = await import("next/server");

  const session = await requireAuthSession();
  if (!session) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  const admin = await resolveAdmin(session.user.id);
  await nameAuditActor(admin);

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

  return { ok: true, admin, session };
}

export async function requireAdmin(): Promise<
  | { ok: true; admin: AdminContext; session: Session }
  | { ok: false; response: Response }
> {
  beginRequestScope();
  beginAuditScope();

  const { requireAuthSession } = await import("@/lib/auth");
  const { NextResponse } = await import("next/server");

  const session = await requireAuthSession();
  if (!session) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  const admin = await resolveAdmin(session.user.id);
  await nameAuditActor(admin);

  if (!admin) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Admin access required" }, { status: 403 }),
    };
  }

  return { ok: true, admin, session };
}

export type AdminContext = {
  userId: string;
  /** Copied into every audit entry, so the trail survives the account. */
  email: string;
  adminRole: AdminRole;
  /** What this person can actually reach: preset plus their own overrides. */
  capabilities: Capability[];
  can: (capability: Capability) => boolean;
  /** Null means every branch. See scopedBranchIds() above for how to use this. */
  branchIds: string[] | null;
};

/**
 * Resolve the signed-in user as an admin, or return null when they are not one.
 * Route handlers pair this with `can()` to gate a specific area.
 */
export async function resolveAdmin(userId: string | undefined): Promise<AdminContext | null> {
  if (!userId) return null;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      role: true,
      adminRole: true,
      adminCapabilities: true,
      adminBranchIds: true,
    },
  });

  if (!user || String(user.role).toLowerCase() !== "admin") return null;

  const adminRole = normalizeAdminRole(user.adminRole);
  const capabilities = capabilitiesForUser(adminRole, user.adminCapabilities);
  return {
    userId: user.id,
    email: user.email,
    adminRole,
    capabilities,
    can: (capability: Capability) => capabilities.includes(capability),
    branchIds: parseBranchIds(user.adminBranchIds),
  };
}
