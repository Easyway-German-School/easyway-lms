import type { MetadataRoute } from "next";

/**
 * What makes this an installable app rather than a bookmark.
 *
 * There was no manifest at all, which is why nobody could pin the portal to a
 * home screen: `public/sw.js` existed and registered fine, but a service
 * worker only buys you push notifications. The install prompt — Android's "Add
 * to home screen", Chrome's desktop install button, the iOS standalone shell —
 * is gated on a manifest with a name, a start_url, a display mode and an icon
 * of at least 192px. Miss any one of those and the browser silently declines
 * to offer installation, with no error anywhere to explain why.
 *
 * ONE MANIFEST FOR THREE PORTALS, and that is deliberate. `start_url` is "/",
 * which is a server component that redirects by role (see app/page.tsx and
 * homePathForRole) — so the student who installs it opens on /dashboard, the
 * tutor on /lecturer/dashboard and the admin on /admin, from the same icon.
 * Three separate manifests would mean three installable apps and a person with
 * two roles having to guess which icon is theirs.
 *
 * `id` is pinned explicitly. Without it the browser derives an identity from
 * start_url, so changing start_url later would orphan every existing install
 * and quietly present itself as a second, different app.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "EasyWay German Language School",
    // What actually fits under an icon. Anything past ~12 characters is
    // ellipsised on an Android home screen, so the long name never shows there.
    short_name: "EasyWay",
    description:
      "Your German classes, timetable, live lessons, materials and results — for students, tutors and staff at EasyWay German Language School.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    // The teal is the brand's anchor colour and it tints the Android status bar
    // and the desktop title bar. The orange is the accent — it is loud enough
    // as a button and would be unbearable as a whole window chrome.
    theme_color: "#0D7C7E",
    // Matches the app canvas so the splash screen does not flash white before
    // the first paint on a cold start.
    background_color: "#F5F5F5",
    lang: "en",
    dir: "ltr",
    categories: ["education", "productivity"],
    /**
     * TWO SETS, and the split is the whole point.
     *
     * `any` is the original full-bleed sticker, used wherever the icon is
     * shown as-is — a browser tab, the desktop install dialog, a task
     * switcher. Nothing crops it, so the banner survives and reads.
     *
     * `maskable` is the generated pair from scripts/build-app-icons.mjs: the
     * emblem alone, no text, floating in the middle 62% of an opaque teal
     * square. Android crops a home-screen icon to whatever shape the launcher
     * prefers and guarantees only the centre 80% — so the launcher eats the
     * teal margin instead of the mortarboard. Measured: the artwork's furthest
     * pixel sits at radius 200.8px against the 204.8px the safe circle allows.
     *
     * Listing only `any` was costing the icon anyway: with no maskable
     * candidate Android shrinks the art into a white circle, which is what
     * makes an installed web app look like a bookmark instead of an app.
     */
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/apple-icon.png", sizes: "180x180", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    /**
     * Long-press shortcuts on the installed icon.
     *
     * Deliberately student-side only. Shortcuts are not permission-aware — the
     * OS renders whatever is listed here to whoever installed the app — so a
     * tutor long-pressing would be shown links they cannot open. These four are
     * the pages any signed-in student uses weekly, and each one redirects to
     * sign-in cleanly when tapped by somebody who is not one.
     */
    shortcuts: [
      { name: "My timetable", short_name: "Classes", url: "/calendar" },
      { name: "Live class", short_name: "Live", url: "/live" },
      { name: "Materials", short_name: "Materials", url: "/materials" },
      { name: "Notifications", short_name: "Alerts", url: "/notifications" },
    ],
  };
}
