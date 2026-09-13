import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // This app is deliberately its own Vercel project / its own deploy — see
  // README.md for why it lives in this folder instead of inside prototype/.
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**" },
    ],
  },
  /**
   * Pin the root to THIS folder. Without this, Next/Turbopack walks up to
   * the monorepo's outer package-lock.json (the worktree root, which is the
   * EasyWay LMS checkout) and starts treating ITS convention files —
   * src/instrumentation.ts, src/proxy.ts — as belonging to this app, which
   * then fail to resolve because their imports point at the LMS's own
   * src/lib files. This app has nothing to do with that tree.
   */
  turbopack: {
    root: path.join(__dirname),
  },
  outputFileTracingRoot: path.join(__dirname),

  /**
   * Baseline security headers — this app collects passport data and takes
   * payments, so "browser defaults" isn't quite enough. Not a full CSP
   * (that would need auditing every inline style/script this app uses,
   * including the Tailwind runtime and any future third-party embed); these
   * four cost nothing and close off a handful of well-known attack classes
   * outright.
   */
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // Stop the browser guessing a content type for an uploaded file
          // and rendering it as something more dangerous than declared.
          { key: "X-Content-Type-Options", value: "nosniff" },
          // No embedding this site in someone else's <iframe> — there is no
          // legitimate reason to frame a payment/registration flow.
          { key: "X-Frame-Options", value: "DENY" },
          // Don't leak the full URL (which can carry a booking reference) to
          // a third-party site a candidate clicks through to.
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
