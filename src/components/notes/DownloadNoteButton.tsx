"use client";

import { useEffect, useState } from "react";
import { CheckCircleIcon, DownloadIcon } from "@/components/icons";
import { useIsInstalledApp } from "@/lib/client/standalone";
import { getNote, putNote, deleteNote, type OfflineNoteKind } from "@/lib/offline/store";

/**
 * "Keep this note offline" — saves the rendered note payload into IndexedDB so
 * it reads with no signal from `/materials/offline`. Installed app only; that
 * is the upsell for physical students too ("install to pocket your notes").
 */
export default function DownloadNoteButton({
  kind,
  materialId,
  title,
  payload,
}: {
  kind: OfflineNoteKind;
  materialId: string;
  title: string;
  payload: unknown;
}) {
  const installed = useIsInstalledApp();
  const [saved, setSaved] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    getNote(kind, materialId).then((row) => {
      if (alive) setSaved(Boolean(row));
    });
    return () => {
      alive = false;
    };
  }, [kind, materialId]);

  if (!installed) {
    return (
      <p className="rounded-xl border border-[#FF6600]/30 bg-[#FF6600]/10 px-3 py-2 text-xs text-[var(--muted)]">
        Install the EasyWay app to keep this on your phone for offline reading.
      </p>
    );
  }

  if (saved === null) return null;

  if (saved) {
    return (
      <button
        type="button"
        onClick={async () => {
          await deleteNote(kind, materialId);
          setSaved(false);
        }}
        className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] px-4 py-1.5 text-xs font-semibold text-emerald-600"
      >
        <CheckCircleIcon className="h-3.5 w-3.5" /> Saved offline · remove
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={async () => {
        await putNote({ kind, materialId, title, payload });
        setSaved(true);
      }}
      className="inline-flex items-center gap-1.5 rounded-full bg-[var(--accent)] px-4 py-1.5 text-xs font-semibold text-white transition hover:brightness-110"
    >
      <DownloadIcon className="h-3.5 w-3.5" /> Save offline
    </button>
  );
}
