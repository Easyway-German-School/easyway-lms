"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { DEFAULT_BRANDING, type Branding } from "@/lib/tenant/branding";

/**
 * The tenant's name, logo and colour, made available to the whole tree.
 *
 * WHY THIS IS CLIENT-SIDE AND NOT RESOLVED IN THE ROOT LAYOUT. Resolving it on
 * the server would be strictly better — no flash, no extra request — but it
 * means calling `headers()` in the root layout, which opts every page in the
 * product out of static rendering. That is a real cost paid by every one of
 * this school's students on every navigation, in exchange for a benefit that
 * currently applies to zero tenants: the only tenant on the system has all
 * three brand columns null and therefore renders identically either way.
 *
 * So the trade is deliberate and it is written down here rather than
 * discovered later: a tenant WITH custom branding gets a brief moment of the
 * default palette before their own is applied. When a second tenant with real
 * branding actually exists, move this to the layout and take the dynamic
 * rendering hit — by then it will be buying something.
 */

const BrandingContext = createContext<Branding & { ready: boolean }>({
  ...DEFAULT_BRANDING,
  ready: false,
});

export function useBranding() {
  return useContext(BrandingContext);
}

const STYLE_ID = "tenant-branding";

export function BrandingProvider({ children }: { children: React.ReactNode }) {
  const [branding, setBranding] = useState<Branding & { ready: boolean }>({
    ...DEFAULT_BRANDING,
    ready: false,
  });

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const response = await fetch("/api/tenant/branding");
        if (!response.ok || cancelled) return;
        const data = await response.json();

        /**
         * The CSS is built on the server from a hex value that was validated
         * there. It is injected as a stylesheet rather than assigned property
         * by property because the palette spans two themes, and setting
         * `documentElement.style` would apply one of them to both.
         */
        if (typeof data.css === "string" && data.css) {
          let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
          if (!style) {
            style = document.createElement("style");
            style.id = STYLE_ID;
            document.head.appendChild(style);
          }
          style.textContent = data.css;
        }

        setBranding({
          name: data.name ?? DEFAULT_BRANDING.name,
          logoUrl: data.logoUrl ?? DEFAULT_BRANDING.logoUrl,
          markUrl: data.markUrl ?? DEFAULT_BRANDING.markUrl,
          primaryColor: null,
          ready: true,
        });
      } catch {
        /* The defaults are EasyWay's own, so a failure here is invisible. */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return <BrandingContext.Provider value={branding}>{children}</BrandingContext.Provider>;
}
