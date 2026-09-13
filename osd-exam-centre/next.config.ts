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
};

export default nextConfig;
