"use client";

import Link from "next/link";
import { useIsInstalledApp, useIsOnline } from "@/lib/client/standalone";

/**
 * A slim bar that appears in the installed app the moment the connection
 * drops, pointing at the one thing that still works — the downloads shelf.
 *
 * Only in the installed app: a browser tab that goes offline is just a broken
 * tab, and there is nothing useful to offer it. Renders nothing while online.
 */
export default function OfflineBanner() {
  const installed = useIsInstalledApp();
  const online = useIsOnline();

  if (!installed || online) return null;

  return (
    <div className="sticky top-0 z-50 flex items-center justify-between gap-3 bg-[var(--foreground)] px-4 py-2 text-xs font-semibold text-[var(--background)]">
      <span>You are offline — live class and new materials are paused.</span>
      <Link href="/materials/offline" className="shrink-0 rounded-full bg-[var(--background)]/20 px-3 py-1">
        Open downloads
      </Link>
    </div>
  );
}
