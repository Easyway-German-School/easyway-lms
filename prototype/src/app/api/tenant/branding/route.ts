import { NextRequest, NextResponse } from "next/server";
import { brandingCss } from "@/lib/tenant/branding";
import { brandingForHost } from "@/lib/tenant/branding-server";

export const dynamic = "force-dynamic";

/**
 * Whose school is this, and what colour is it.
 *
 * Unauthenticated on purpose. Everything here is on the sign-in page by
 * definition — a school's name, its logo and its brand colour are what a
 * visitor sees before they have an account, so gating them behind a session
 * would mean the login screen could never be branded, which is the one screen
 * where branding does the most work.
 *
 * The hostname decides, and only the hostname. A caller cannot ask for another
 * tenant's branding by passing an id, because there is no parameter to pass:
 * the answer is a function of where the request arrived, which the client does
 * not get to choose.
 */
export async function GET(request: NextRequest) {
  const host = (
    request.headers.get("x-forwarded-host") ||
    request.headers.get("host") ||
    ""
  )
    .split(":")[0]
    .toLowerCase();

  const branding = await brandingForHost(host);

  return NextResponse.json(
    {
      name: branding.name,
      logoUrl: branding.logoUrl,
      markUrl: branding.markUrl,
      css: brandingCss(branding.primaryColor),
    },
    {
      /**
       * Cached at the edge for a minute, matching the server-side cache in
       * branding.ts. Every page in the product asks for this, and a school's
       * colour is not worth a database round trip per navigation.
       */
      headers: { "Cache-Control": "public, max-age=60, stale-while-revalidate=300" },
    },
  );
}
