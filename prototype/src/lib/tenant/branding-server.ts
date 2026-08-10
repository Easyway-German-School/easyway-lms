import { guardedPrisma } from "@/lib/prisma";
import {
  DEFAULT_BRANDING,
  isSafeColor,
  isSafeLogo,
  type Branding,
} from "@/lib/tenant/branding";

/**
 * THE DATABASE HALF, KEPT SEPARATE FROM THE PURE HALF ON PURPOSE.
 *
 * `branding.ts` next door holds the type, the defaults, the two guards and the
 * colour maths, and imports nothing. This file is the only part that touches
 * Prisma — and that separation is load-bearing rather than tidy.
 *
 * When these lived in one file, `BrandingProvider` (a client component) needed
 * the type and the defaults, so importing them pulled `@/lib/prisma` into the
 * browser bundle, which pulled `tenant/context`, which imports
 * `node:async_hooks`. The build failed outright with an unhandled-scheme error.
 * `tsc --noEmit` passed the whole time: TypeScript has no opinion about which
 * runtime a module ends up in, so the only thing that catches this is a real
 * build. Anything importable from a "use client" file belongs next door.
 */

/**
 * A two-letter monogram for a tenant that has supplied no artwork.
 *
 * Prefers a capital inside the first word, so a camel-cased name like
 * "BrightStar" reads "BS" rather than "BR"; otherwise it takes the initial of
 * each word. Two letters at most — three in a 44px square is a smudge, and the
 * emblem is the real fallback anyway.
 */
function initialsOf(name: string): string {
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length === 0) return DEFAULT_BRANDING.initials;

  const inner = words[0].match(/[A-Z]/g);
  if (words.length === 1 && inner && inner.length >= 2) {
    return inner.slice(0, 2).join("");
  }

  return (
    words
      .map((word) => word[0])
      .join("")
      .toUpperCase()
      .slice(0, 2) || DEFAULT_BRANDING.initials
  );
}

/**
 * Resolved branding per host, cached briefly.
 *
 * Same reasoning as the tenant-id cache next door: this is read on essentially
 * every page load, and a domain's branding changes roughly never — but it does
 * change, and a school that has just been given its logo should see it within
 * the minute rather than after a redeploy.
 */
const cache = new Map<string, { value: Branding; at: number }>();
const TTL_MS = 60_000;

export function forgetBranding(): void {
  cache.clear();
}

export async function brandingForHost(host: string): Promise<Branding> {
  const key = host.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

  /**
   * Unscoped on purpose, and safe: this runs before anybody is signed in — it
   * is what decides whose sign-in page is being shown — and it selects only the
   * three columns that are, by definition, meant to be seen by the public.
   */
  const tenant = await guardedPrisma.tenant.findFirst({
    where: { domain: key, status: "active" },
    select: { name: true, brandName: true, logoUrl: true, primaryColor: true },
  });

  const displayName = tenant ? tenant.brandName?.trim() || tenant.name : "";

  const value: Branding = tenant
    ? {
        name: displayName,
        logoUrl: isSafeLogo(tenant.logoUrl) ? tenant.logoUrl : DEFAULT_BRANDING.logoUrl,
        /**
         * A custom lockup is NOT reused as the square mark. They are different
         * shapes — a horizontal lockup squeezed into a 44px collapsed sidebar
         * is an unreadable smear — so a tenant with only a lockup keeps the
         * generic mark rather than getting a broken one.
         */
        markUrl: DEFAULT_BRANDING.markUrl,
        /**
         * Derived only for a real tenant. EasyWay's own is the carried "EW" in
         * DEFAULT_BRANDING, which word initials would have got wrong.
         */
        initials: initialsOf(displayName),
        primaryColor: isSafeColor(tenant.primaryColor) ? tenant.primaryColor.trim() : null,
      }
    : DEFAULT_BRANDING;

  cache.set(key, { value, at: Date.now() });
  return value;
}

