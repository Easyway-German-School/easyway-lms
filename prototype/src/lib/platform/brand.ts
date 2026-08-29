/**
 * EduPrime — the brand of the platform layer, kept apart from any school's.
 *
 * EasyWay is a *school*: a classroom brand, teal ground and an orange reward
 * signal, aimed at a learner. The platform underneath it — the thing that lets
 * a second, third, tenth school run on the same deployment without ever seeing
 * each other's data, and produces a bill for doing so — is a different product
 * sold to a different person (a school owner, an operator) and it needs its own
 * name, its own domain and its own visual language. That product is EduPrime.
 *
 * NOTHING HERE TOUCHES A SCHOOL. This module is pure constants + one host test.
 * It is imported by the edge proxy, so it must not pull in Prisma, `next/*` or
 * anything Node-only.
 *
 * The story in the name: "Prime" as in the foundational layer, first-class,
 * primed and ready — and *prism*, one beam of raw capability split cleanly into
 * many branded, isolated schools. The mark is a prism; see EduPrimeLogo.
 */

export const EDUPRIME = {
  /** What it calls itself. */
  name: "EduPrime",
  /** On invoices and legal footers. */
  legalName: "EduPrime Platforms",
  /** The one-liner. Operator-facing, not learner-facing. */
  tagline: "Run your school like a company.",
  /** The sentence under the tagline. */
  blurb:
    "White-label learning portals, isolated student data, live classrooms and usage-based billing — one platform, every school its own.",
  /** The positioning line, used small. */
  positioning: "The layer underneath your school.",
  /** Where the marketing site lives once DNS is pointed. Display only. */
  primaryDomain: "eduprime.africa",
  /** Inbox for demo requests when no webhook is configured. */
  contactEmail: "hello@eduprime.africa",
} as const;

/**
 * The EduPrime palette, as plain hex, mirrored by `.eduprime` in eduprime.css.
 * Kept here too so React components (the logo, OG cards) can reach a colour
 * without parsing a stylesheet.
 *
 * Cool where EasyWay is warm: indigo is competence and depth, the periwinkle
 * "beam" is the one bright thing on the page, mint is "verified / paid / live".
 */
export const EDUPRIME_COLORS = {
  ink: "#0B1020",
  primary: "#4338CA",
  primaryBright: "#6366F1",
  beam: "#8B7CFF",
  mint: "#10B981",
  amber: "#F59E0B",
  spectrumFrom: "#4338CA",
  spectrumMid: "#8B7CFF",
  spectrumTo: "#22D3EE",
} as const;

/**
 * The value grid on the landing page and, trimmed, the console's empty states.
 * Deliberately honest — a school owner reading this has heard every SaaS
 * promise, and the ones that survive contact are the specific ones.
 */
export const EDUPRIME_PILLARS = [
  {
    key: "isolation",
    title: "One deployment, walled schools",
    body: "Every query is tenant-scoped underneath — a forgotten filter throws in development instead of leaking a rival's register in production. No school can read another, and that is enforced, not promised.",
  },
  {
    key: "whitelabel",
    title: "Their name on the door",
    body: "Point a domain at us and a school's students see that school — its logo, its colour, its wording — end to end. The square emblem stays ours; nothing else does.",
  },
  {
    key: "billing",
    title: "A bill they can argue with",
    body: "Five of six meters are pass-throughs of an invoice the platform already receives — AI tokens, live minutes, storage, email, requests. The margin is a stated multiple, not a number someone picked.",
  },
  {
    key: "api",
    title: "An API from the first minute",
    body: "Scoped keys, test and live environments, cursor paging, a hash-stored secret shown exactly once. `identity:read` is always granted so a partner can prove the key works before writing a line.",
  },
  {
    key: "classroom",
    title: "The classroom is included",
    body: "Live rooms on a real SFU, auto-recording to a library, Kahoot-style quizzes, an AI tandem partner. A school switches these on per-cohort; it does not integrate them.",
  },
  {
    key: "onboarding",
    title: "White-glove onboarding",
    body: "An operator creates the tenant, points the domain, issues the key and sets which features are live — in one console, in an afternoon. No self-service sprawl, no half-configured accounts.",
  },
] as const;

export const EDUPRIME_STEPS = [
  { n: 1, title: "Create the tenant", body: "Name, slug, domain. The tenant and its credit ledger are created in one transaction — no school starts life without a balance to meter against." },
  { n: 2, title: "Point the domain", body: "A CNAME at us. From then on every public page — signup, the branch list, certificate checks — knows which school it belongs to from the hostname alone." },
  { n: 3, title: "Issue an API key", body: "Test first. Choose scopes. The secret is shown once and stored as a sha256 hash; there is no “show again” and there cannot be one." },
  { n: 4, title: "Switch on what they bought", body: "Exam booking, external bodies, live-class-gated games — toggled per school from a request, by an operator, never self-served." },
] as const;

/**
 * The hosts that ARE EduPrime rather than a school.
 *
 * Read from `PLATFORM_HOSTS` (comma-separated) so the real domain is set in
 * Vercel, not baked into a commit. The defaults cover the intended production
 * domain and local development; an unknown host is never EduPrime, it is a
 * school — the safe direction, matching resolveTenantId's own bias.
 */
const DEFAULT_PLATFORM_HOSTS = [
  "eduprime.africa",
  "www.eduprime.africa",
  "eduprime.localhost",
  "platform.localhost",
];

export function platformHosts(): string[] {
  const fromEnv = (process.env.PLATFORM_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  return fromEnv.length ? fromEnv : DEFAULT_PLATFORM_HOSTS;
}

/** Bare host, already lowercased and port-stripped (see hostOf). */
export function isPlatformHost(host: string | null | undefined): boolean {
  if (!host) return false;
  return platformHosts().includes(host.toLowerCase());
}
