import type { Metadata, Viewport } from "next";
import "../eduprime.css";
import { EDUPRIME } from "@/lib/platform/brand";

/**
 * The EduPrime shell for everything under `/platform` — the operator console at
 * `/platform` and the billing view at `/platform/billing`.
 *
 * This layout nests inside the app's root layout (which still paints the theme
 * boot script and the shared providers), and does two things on top of it:
 *
 *  1. Loads `eduprime.css`, whose `.eduprime` block overrides the EasyWay
 *     school palette with the platform's own blue/purple one — scoped, so no
 *     student portal is touched.
 *  2. Replaces the page metadata. Root layout titles every page "Easyway
 *     German Language School"; these screens belong to a different product run
 *     by a different person, so they say so — in the tab, in a shared link, in
 *     the favicon.
 *
 * Deeper-segment metadata overrides the root's in Next, so nothing here has to
 * reach up and edit `app/layout.tsx`.
 */

export const metadata: Metadata = {
  title: {
    default: `${EDUPRIME.name} — ${EDUPRIME.tagline}`,
    template: `%s · ${EDUPRIME.name}`,
  },
  description: EDUPRIME.blurb,
  applicationName: EDUPRIME.name,
  manifest: "/platform/site.webmanifest",
  icons: {
    icon: [{ url: "/platform/favicon.svg", type: "image/svg+xml" }],
    shortcut: ["/platform/favicon.svg"],
    apple: [{ url: "/platform/favicon.svg" }],
  },
  openGraph: {
    title: `${EDUPRIME.name} — ${EDUPRIME.tagline}`,
    description: EDUPRIME.blurb,
    siteName: EDUPRIME.name,
    type: "website",
    images: [{ url: "/platform/og.svg", width: 1200, height: 630, alt: EDUPRIME.name }],
  },
  twitter: {
    card: "summary_large_image",
    title: `${EDUPRIME.name} — ${EDUPRIME.tagline}`,
    description: EDUPRIME.blurb,
    images: ["/platform/og.svg"],
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#2563EB" },
    { media: "(prefers-color-scheme: dark)", color: "#0c1120" },
  ],
};

export default function PlatformLayout({ children }: { children: React.ReactNode }) {
  return <div className="eduprime app-canvas min-h-screen">{children}</div>;
}
