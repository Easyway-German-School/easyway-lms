import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import "./globals.css";
import { Providers } from "./providers";
import PageContainer from "@/components/PageContainer";
import { LiveCallProvider } from "@/components/live/LiveCallContext";
import LiveCallDock from "@/components/live/LiveCallDock";
import { brandingCss } from "@/lib/tenant/branding";
import { brandingForHost } from "@/lib/tenant/branding-server";
import { hostOf } from "@/lib/tenant/resolve";

export const metadata: Metadata = {
  title: "Easyway German Language School",
  description: "Web-based learner portal for Easyway German Language School",
  // Points at app/manifest.ts. This one line is what turns the site into an
  // installable app — without it the browser never offers "Add to home screen".
  manifest: "/manifest.webmanifest",
  /**
   * iOS ignores the manifest almost entirely.
   *
   * Safari reads none of `display`, `theme_color` or `short_name` from it — an
   * iPhone user adding the portal to their home screen would get a tab in
   * Safari chrome, not an app. These three meta tags are the only way to say
   * the same things to iOS, so they are not redundant with the manifest above.
   *
   * `statusBarStyle: "default"` keeps the clock and battery legible over the
   * light canvas. "black-translucent" would run the page under the notch, and
   * the portal's sticky header has no safe-area padding to survive that.
   */
  appleWebApp: {
    capable: true,
    title: "EasyWay",
    statusBarStyle: "default",
  },
  // The square emblem, not the horizontal lockup — the lockup is illegible at
  // 16px. Sizes are declared so browsers pick without downscaling the 512.
  icons: {
    icon: [
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    // Flattened onto white: iOS renders PNG transparency as black.
    apple: { url: "/apple-icon.png", sizes: "180x180" },
  },
};

/**
 * `themeColor` belongs here and not in `metadata`.
 *
 * Next moved it to the viewport export several versions ago; leaving it in
 * `metadata` logs a build warning and emits nothing, which is a silent way to
 * lose the coloured status bar on an installed Android app. Two entries so the
 * bar follows the student's chosen theme instead of staying daylight teal
 * behind a dark portal — the manifest can only carry one, and this overrides it.
 */
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#0D7C7E" },
    { media: "(prefers-color-scheme: dark)", color: "#0B1220" },
  ],
};

/**
 * Applied before React hydrates, and before the first paint.
 *
 * The theme used to be set in a `useEffect`, which meant the server sent a
 * class-less <html>, the browser painted the default, and only then did the
 * chosen theme snap in. On a slow connection that is a full second of the
 * wrong palette — and because `theme-light` was never on the server's markup,
 * a student who had picked dark spent every navigation watching the page
 * flash white first.
 *
 * Inline and synchronous on purpose: it has to run before the body is painted,
 * so it cannot be a module.
 */
const THEME_BOOT = `(function(){try{
var t=localStorage.getItem('easyway-theme');
if(t!=='light'&&t!=='dark'&&t!=='custom'){t='light'}
document.documentElement.classList.add('theme-'+t);
}catch(e){document.documentElement.classList.add('theme-light')}})();`;

/**
 * Must match `STYLE_ID` in `BrandingProvider.tsx`. The provider looks this id
 * up by `document.getElementById` and updates its `textContent` on SPA
 * navigation rather than appending a second tag — if the ids ever disagree,
 * the page ends up with two competing stylesheets whose winner is decided by
 * DOM order.
 */
const TENANT_BRANDING_STYLE_ID = "tenant-branding";

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  /**
   * Resolved server-side so the FIRST paint already carries a tenant's brand
   * colour — `BrandingProvider`'s own docblock names this exact move as the
   * deferred half of white-labelling, priced at "opts the whole app out of
   * static rendering" and left undone while EasyWay was the only tenant (null
   * brand columns render identically either way). Now that a school can
   * actually have a colour, the trade is worth taking.
   *
   * `BrandingProvider` is untouched: it still fetches client-side for SPA
   * navigation and the 60s staleness window, and it updates this same style
   * tag by id rather than duplicating it.
   */
  const host = hostOf(await headers());
  const branding = await brandingForHost(host);
  const brandingStyle = brandingCss(branding.primaryColor);

  return (
    <html lang="en" className="h-full antialiased" suppressHydrationWarning>
      <head>
        {/*
          The legacy iOS standalone flag, written by hand.

          `appleWebApp.capable` in the metadata above no longer emits this:
          Next now writes `mobile-web-app-capable` instead, because Chrome
          deprecated the apple- prefixed name. Recent WebKit accepts the new
          name, but older iOS reads ONLY this one — and on an iPhone that does
          not see it, "Add to Home Screen" produces a Safari tab with browser
          chrome rather than a standalone app. A duplicate meta tag costs
          nothing; a portal that does not open as an app on half the school's
          iPhones costs the feature.
        */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
        {/* Empty when the tenant has no colour set (EasyWay's own case) — the
            HTML stays byte-identical to before this existed. */}
        {brandingStyle && (
          <style id={TENANT_BRANDING_STYLE_ID} dangerouslySetInnerHTML={{ __html: brandingStyle }} />
        )}
      </head>
      {/* `app-canvas`, not `bg-[var(--background)]`: the latter compiles to
          background-color and throws the gradient away. See globals.css. */}
      <body className="app-canvas min-h-full flex flex-col text-[var(--foreground)] transition-colors duration-300">
        <Providers>
          {/*
            Mounted here, above every route, so a live class survives client-
            side navigation. Layouts don't remount when the page inside them
            changes, so as long as `LiveCallDock` keeps rendering the same
            `LiveKitClassroom` instance, the Room connection it holds never
            tears down — see `LiveCallContext` for the full reasoning.
          */}
          <LiveCallProvider>
            <PageContainer>{children}</PageContainer>
            <LiveCallDock />
          </LiveCallProvider>
        </Providers>
      </body>
    </html>
  );
}
