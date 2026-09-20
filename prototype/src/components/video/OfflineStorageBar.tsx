"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { DownloadIcon } from "@/components/icons";
import { useIsInstalledApp } from "@/lib/client/standalone";
import { sweepExpired, usage } from "@/lib/offline/store";
import { formatBytes } from "@/lib/offline/download";

/**
 * "Your downloads" — the one always-visible door to the offline shelf.
 *
 * The shelf at /materials/offline is where a student deletes a download, but
 * nothing on the library page used to lead there, so a student whose library
 * hit the size limit had no way to find what to remove. This bar sits above the
 * shelves in the installed app and shows how full the device is.
 *
 * Also the place expired recordings get swept on app use: opening the library
 * clears anything past its 2-week window, so it stops counting against the cap.
 * Renders nothing until there is at least one download (or outside the app).
 */
export default function OfflineStorageBar() {
  const installed = useIsInstalledApp();
  const [space, setSpace] = useState<{ bytes: number; count: number; capBytes: number } | null>(null);

  useEffect(() => {
    if (!installed) return;
    let alive = true;
    (async () => {
      await sweepExpired();
      const use = await usage();
      if (alive) setSpace({ bytes: use.bytes, count: use.count, capBytes: use.capBytes });
    })();
    return () => {
      alive = false;
    };
  }, [installed]);

  if (!installed || !space || space.count === 0) return null;

  const pct = space.capBytes > 0 ? Math.min(100, Math.round((space.bytes / space.capBytes) * 100)) : 0;
  const nearFull = pct >= 90;

  return (
    <Link
      href="/materials/offline"
      className="block rounded-2xl border border-white/10 bg-white/5 p-4 transition hover:bg-white/10"
    >
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="inline-flex items-center gap-2 font-semibold text-white">
          <DownloadIcon className="h-4 w-4" /> Your downloads
        </span>
        <span className={`text-xs font-medium ${nearFull ? "text-amber-300" : "text-slate-400"}`}>
          {space.count} saved · {formatBytes(space.bytes)} of {formatBytes(space.capBytes)}
        </span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
        <div
          className={`h-full ${nearFull ? "bg-amber-400" : "bg-[#FF6600]"}`}
          style={{ width: `${Math.max(2, pct)}%` }}
        />
      </div>
      <p className="mt-2 text-xs text-slate-400">
        {nearFull ? "Almost full — tap here to remove classes you have finished with." : "Tap to watch or remove them."}
      </p>
    </Link>
  );
}
