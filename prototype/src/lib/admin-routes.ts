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
  // A read-only roll-call of who has finished a batch / level. Same desk as
  // the cohort console it links out to.
  { prefix: "/admin/completions", capability: "students" },
  // Onboarding and tracking Travel Package students is a front-desk job, same
  // as the rest of the manual "walk-in student" workflow it grew out of.
  { prefix: "/admin/travel-package", capability: "students" },

  { prefix: "/admin/attendance", capability: "attendance" },
  { prefix: "/admin/schedule", capability: "classes" },
  // Who is live right now, in which class — coordinating classes in real
  // time is the same desk as coordinating them on the timetable.
  { prefix: "/admin/live", capability: "classes" },
  { prefix: "/admin/branches", capability: "branches" },

  { prefix: "/admin/exams", capability: "exams" },
  { prefix: "/admin/exam-centre", capability: "exams" },
  { prefix: "/admin/exam-registrations", capability: "exams" },
  { prefix: "/admin/marking", capability: "exams" },
  { prefix: "/admin/gradebook", capability: "exams" },

  { prefix: "/admin/courses", capability: "materials" },
  { prefix: "/admin/materials", capability: "materials" },
  { prefix: "/admin/community", capability: "community" },

  { prefix: "/admin/payments", capability: "payments" },
  { prefix: "/admin/finance", capability: "payments" },
  // Refund decisions are money leaving the school, and Terms acceptance is
  // what a refund decision gets checked against — same desk as the rest of
  // the fee book rather than a new capability for what is, underneath, a
  // billing dispute.
  { prefix: "/admin/legal", capability: "payments" },
  // What the school pays its tutors. Its own capability — see the note on
  // `payroll` in admin-roles.ts for why this is not folded into `payments`.
  { prefix: "/admin/payroll", capability: "payroll" },
  // `/admin/billing` (what the school owes the platform) and `/admin/platform`
  // (the operator console) are deliberately NOT in this table. Neither is a
  // school area: `/admin/billing` is now a redirect to `/platform/billing`
  // under EduPrime, and `/admin/platform` redirects to `/platform`. Both are
  // gated on User.platformRole / the platform proxy rule, not on a capability
  // a school can grant — adding them here would let a school's super admin
  // hand out the platform's own screens with a checkbox.
  { prefix: "/admin/reports", capability: "reports" },
  { prefix: "/admin/personalization", capability: "reports" },
  // Behaviour patterns across the roster. Sits with reporting rather than
  // with `students`: it is an aggregate reading of the school, and the one
  // per-student view of it is reached from the student file, which is
  // separately gated on `students` by its own route.
  { prefix: "/admin/intelligence", capability: "reports" },
  { prefix: "/admin/ai-usage", capability: "reports" },
  { prefix: "/admin/beta", capability: "reports" },

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

  // The staff file store. Its own capability, hand-granted for now — see
  // docs/WORK_DRIVE.md. The API routes under /api/admin/work-drive enforce the
  // same one.
  { prefix: "/admin/work-drive", capability: "work_drive" },
  // Turning the Work Drive on and setting its storage ceiling is school setup,
  // not a Work Drive action — longer prefix, so this wins over the line above.
  { prefix: "/admin/work-drive/settings", capability: "staff" },
  // The staff calendar, events and webinars. `/admin/calendar` is the
  // month/week view; the webinar host console lives under it.
  { prefix: "/admin/calendar", capability: "events" },
  { prefix: "/admin/webinars", capability: "events" },

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
