import type { Capability } from "@/lib/admin-roles";

/**
 * WHICH ADMIN PAGE NEEDS WHICH CAPABILITY — written down once.
 *
 * This existed twice and disagreed with itself. The sidebar carried a
 * capability on each nav item, which is what hides an area a role does not
 * cover; the dashboard carried none at all, which is why its tiles linked
 * wherever seemed reasonable at the time and an Accountant clicking "Students"
 * would land on "Not your area". The API routes are the real enforcement and
 * always were — this table is about not offering the door in the first place.
 *
 * Longest prefix wins. Every admin path begins with `/admin`, so a naive
 * `startsWith` match against a table containing `/admin` itself matches the
 * dashboard for everything and silently waves through the lot. That exact bug
 * is documented in AdminShell; the sort below is what prevents it here.
 */
const AREA_CAPABILITIES: Array<{ prefix: string; capability: Capability }> = [
  { prefix: "/admin/students", capability: "students" },
  // A certificate is a statement about a named student's result, so it sits
  // with whoever holds the student records.
  { prefix: "/admin/certificates", capability: "students" },
  { prefix: "/admin/leads", capability: "students" },
  // A guardian's account is paperwork about a named student, same desk as
  // the rest of the student record.
  { prefix: "/admin/parents", capability: "students" },
  // The help desk sits with whoever holds the student records: answering a
  // ticket almost always means opening the asker's file.
  { prefix: "/admin/enquiries", capability: "students" },
  { prefix: "/admin/journey", capability: "students" },
  { prefix: "/admin/promotions", capability: "students" },

  { prefix: "/admin/attendance", capability: "attendance" },
  // Who is live right now, in which class — coordinating classes in real
  // time is the same desk as coordinating them on the timetable.
  { prefix: "/admin/live", capability: "classes" },
  { prefix: "/admin/branches", capability: "branches" },

  { prefix: "/admin/exams", capability: "exams" },
  { prefix: "/admin/exam-centre", capability: "exams" },
  { prefix: "/admin/exam-registrations", capability: "exams" },
  { prefix: "/admin/marking", capability: "exams" },

  { prefix: "/admin/courses", capability: "materials" },
  { prefix: "/admin/materials", capability: "materials" },
  { prefix: "/admin/community", capability: "community" },

  { prefix: "/admin/payments", capability: "payments" },
  { prefix: "/admin/finance", capability: "payments" },
  // What the school owes the platform, as opposed to what students owe the
  // school. Same desk reads both — it is the bursar who checks an invoice — so
  // it sits behind the same capability rather than inventing a tenth.
  //
  // `/admin/platform` is deliberately NOT in this table. It is not a school
  // area at all, and it is gated on User.platformRole rather than on any
  // capability a school can grant. Adding it here would let a school's super
  // admin hand out the cross-tenant console with a checkbox.
  { prefix: "/admin/billing", capability: "payments" },
  { prefix: "/admin/reports", capability: "reports" },
  { prefix: "/admin/personalization", capability: "reports" },

  { prefix: "/admin/emails", capability: "emails" },
  { prefix: "/admin/notifications", capability: "emails" },
  { prefix: "/admin/notification-settings", capability: "emails" },

  { prefix: "/admin/staff", capability: "staff" },
  { prefix: "/admin/lecturer-invite", capability: "staff" },
  // School-wide configuration: which sittings run at which level. Same
  // capability as the other "who and how this school is set up" screens, and
  // it must match the capability its API asks for — a nav entry visible to
  // somebody the route will refuse renders as a broken page, not a locked one.
  { prefix: "/admin/settings", capability: "staff" },

  { prefix: "/admin/security", capability: "security" },
  { prefix: "/admin/integrations", capability: "integrations" },
  // Outbound event delivery, as opposed to the inbound connectors on
  // /admin/integrations. Same desk, same capability — the routes behind it
  // already ask for exactly this one.
  { prefix: "/admin/webhooks", capability: "integrations" },
];

const SORTED = [...AREA_CAPABILITIES].sort((a, b) => b.prefix.length - a.prefix.length);

/** The capability an admin path sits behind, or null for one open to any admin. */
export function capabilityForAdminPath(path: string): Capability | null {
  const pathname = path.split("?")[0].split("#")[0];
  const match = SORTED.find((area) => pathname === area.prefix || pathname.startsWith(`${area.prefix}/`));
  return match?.capability ?? null;
}

/**
 * Whether this admin can open this path.
 *
 * `capabilities === null` means the lookup has not answered yet, and everything
 * passes — a network hiccup must not blank out somebody's own dashboard, and
 * the routes behind these pages refuse the request either way.
 */
export function canReachAdminPath(path: string, capabilities: string[] | null | undefined): boolean {
  if (capabilities == null) return true;
  const capability = capabilityForAdminPath(path);
  return !capability || capabilities.includes(capability);
}

/**
 * The first destination this admin can actually open.
 *
 * Dashboard figures mean different things to different desks, and the right
 * page differs with them: an Accountant clicking a count of students behind on
 * tuition wants the receivables ledger, a Secretary wants the roster. Callers
 * list their destinations best-first and get back the first reachable one, or
 * undefined — and a tile with no reachable destination renders as plain text
 * rather than as a link that apologises on arrival.
 */
export function firstReachable(
  capabilities: string[] | null | undefined,
  ...candidates: Array<string | null | undefined>
): string | undefined {
  for (const candidate of candidates) {
    if (candidate && canReachAdminPath(candidate, capabilities)) return candidate;
  }
  return undefined;
}
