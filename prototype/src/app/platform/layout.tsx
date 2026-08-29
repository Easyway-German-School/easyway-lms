import type { Metadata, Viewport } from "next";
import "../eduprime.css";
import { EDUPRIME } from "@/lib/platform/brand";

/**
 * The EduPrime shell for everything under `/platform` — the marketing site at
 * `/platform` and the operator console at `/platform/console`.
 *
 * This layout nests inside the app's root layout (which still paints the theme
 * boot script and the shared providers), and does two things on top of it:
 *
 *  1. Loads `eduprime.css`, whose `.eduprime` block overrides the EasyWay
 *     school palette with the platform's own indigo one — scoped, so no
 *     student portal is touched.
 *  2. Replaces the page metadata. Root layout titles every page "Easyway
 *     German Language School"; these pages are a different product sold to a
 *     different person, so they say so — in the tab, in a shared link, in the
 *     favicon.
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
    { media: "(prefers-color-scheme: light)", color: "#4338CA" },
    { media: "(prefers-color-scheme: dark)", color: "#0B1020" },
  ],
};

export default function PlatformLayout({ children }: { children: React.ReactNode }) {
  return <div className="eduprime app-canvas min-h-screen">{children}</div>;
}
