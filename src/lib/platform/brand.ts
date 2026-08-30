/**
 * EduPrime — the brand of the platform layer, kept apart from any school's.
 *
 * EasyWay is a *school*: a classroom brand, aimed at a learner. The platform
 * underneath it — the thing that lets a second, third, tenth school run on the
 * same deployment without ever seeing each other's data, and produces a bill
 * for doing so — is a different product, run by a different person (an
 * operator), and it needs its own name and its own visual language. That is
 * EduPrime: the operator console at `/platform` and the billing view at
 * `/platform/billing`.
 *
 * This module is pure constants + one host test. It is imported by the edge
 * proxy, so it must not pull in Prisma, `next/*` or anything Node-only.
 *
 * The story in the name: "Prime" as in the foundational layer, first-class,
 * primed and ready — and *prism*, one beam of light split cleanly into many
 * separated schools. The mark is a prism; see EduPrimeLogo.
 */

export const EDUPRIME = {
  name: "EduPrime",
  legalName: "EduPrime Platforms",
  tagline: "The platform your schools run on.",
  blurb:
    "White-label learning portals, isolated student data, live classrooms and usage-based billing — one platform, every school its own.",
  /** Where it lives once DNS is pointed. Display only. */
  primaryDomain: "eduprime.africa",
} as const;

/**
 * The EduPrime palette as plain hex, mirrored by `.eduprime` in eduprime.css.
 * Kept here too so React components (the logo) can reach a colour without
 * parsing a stylesheet.
 *
 * Blue + purple for the core (trust, depth); yellow into orange for the accent
 * (excitement, ease). The prism logo runs all three: blue and purple in the
 * body, a yellow beam, and blue / purple / orange rays out.
 */
export const EDUPRIME_COLORS = {
  ink: "#0d1220",
  primary: "#2563EB",
  purple: "#7C3AED",
  beam: "#FACC15",
  orange: "#F97316",
  spectrumFrom: "#2563EB",
  spectrumMid: "#7C3AED",
  spectrumTo: "#F97316",
} as const;

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
