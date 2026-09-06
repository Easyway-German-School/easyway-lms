"use client";

import { useEffect, useState } from "react";

/**
 * The "you can take that back" bar. Shown for a few seconds after a move,
 * postpone or cancel on the calendar — the thing that lets a tutor drag a dot
 * without first being sure, because a wrong drop is one click to reverse.
 *
 * The parent owns the action: it hands over a `run` that re-issues the inverse
 * request (old date, old status) and a `label` for what just happened.
 */

export type PendingUndo = {
  label: string;
  run: () => Promise<void>;
};

export default function UndoToast({
  undo,
  onClose,
}: {
  undo: PendingUndo | null;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!undo) return;
    const timer = setTimeout(onClose, 6000);
    return () => clearTimeout(timer);
  }, [undo, onClose]);

  if (!undo) return null;

  return (
    <div className="fixed inset-x-0 bottom-4 z-[80] flex justify-center px-4">
      <div className="flex items-center gap-4 rounded-full border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-sm shadow-lg">
        <span className="text-[var(--foreground)]">{undo.label}</span>
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await undo.run();
            } finally {
              setBusy(false);
              onClose();
            }
          }}
          className="font-bold text-[var(--accent)] hover:underline disabled:opacity-50"
        >
          {busy ? "Undoing…" : "Undo"}
        </button>
      </div>
    </div>
  );
}
