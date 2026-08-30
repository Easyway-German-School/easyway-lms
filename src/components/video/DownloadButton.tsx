"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CheckCircleIcon, DownloadIcon, TrashIcon } from "@/components/icons";
import { useIsInstalledApp } from "@/lib/client/standalone";
import { getMedia, deleteMedia } from "@/lib/offline/store";
import { downloadVideoForOffline, formatBytes, expiryLabel, OfflineCapError } from "@/lib/offline/download";
import type { LibraryVideo } from "@/lib/video-library";

/**
 * "Save for offline" on a class recording or lesson video.
 *
 * Shows a real control only inside the installed app AND only for students who
 * have no other way to rewatch on a bad line (online / hybrid / private —
 * `canDownload`, decided by the caller from `canDownloadOffline`). Everywhere
 * else it's the install nudge, because that is the whole point: the offline
 * library is why you put the app on your phone.
 */
type State =
  | { phase: "idle" }
  | { phase: "downloading"; fraction: number; received: number; total: number }
  | { phase: "done"; sizeBytes: number; expiresAt: number | null }
  | { phase: "error"; message: string };

export default function DownloadButton({
  video,
  canDownload,
  variant = "full",
}: {
  video: LibraryVideo;
  canDownload: boolean;
  variant?: "full" | "compact";
}) {
  const installed = useIsInstalledApp();
  const [state, setState] = useState<State>({ phase: "idle" });
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let alive = true;
    getMedia(video.id).then((row) => {
      if (alive && row) setState({ phase: "done", sizeBytes: row.sizeBytes, expiresAt: row.expiresAt });
    });
    return () => {
      alive = false;
      abortRef.current?.abort();
    };
  }, [video.id]);

  const start = useCallback(async () => {
    const controller = new AbortController();
    abortRef.current = controller;
    setState({ phase: "downloading", fraction: 0, received: 0, total: 0 });
    try {
      await downloadVideoForOffline(video, {
        signal: controller.signal,
        onProgress: (fraction, received, total) =>
          setState({ phase: "downloading", fraction, received, total }),
      });
      const row = await getMedia(video.id);
      setState({ phase: "done", sizeBytes: row?.sizeBytes ?? 0, expiresAt: row?.expiresAt ?? null });
    } catch (error) {
      if (controller.signal.aborted) {
        setState({ phase: "idle" });
        return;
      }
      const message =
        error instanceof OfflineCapError
          ? error.message
          : error instanceof Error
            ? error.message
            : "Download failed — try again on a better connection.";
      setState({ phase: "error", message });
    } finally {
      abortRef.current = null;
    }
  }, [video]);

  const remove = useCallback(async () => {
    await deleteMedia(video.id);
    setState({ phase: "idle" });
  }, [video.id]);

  // Hosted elsewhere — nothing to save.
  if (video.embedUrl) {
    if (variant === "compact") return null;
    return (
      <p className="text-xs text-slate-400">
        Hosted on {video.embedLabel ?? "another site"} — watch it online.
      </p>
    );
  }

  // Not the installed app: the marketing lever.
  if (!installed) {
    if (variant === "compact") return null;
    return (
      <div className="rounded-2xl border border-[#FF6600]/30 bg-[#FF6600]/10 p-4 text-sm">
        <p className="font-semibold text-[var(--foreground)]">Watch this offline</p>
        <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
          Install the EasyWay app and you can download this class to your phone — it plays with no signal, on the
          train, anywhere. Downloads only work inside the app.
        </p>
      </div>
    );
  }

  // Installed, but this student doesn't get video downloads (physical group).
  if (!canDownload) return null;

  if (variant === "compact") {
    if (state.phase === "done") {
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
          <CheckCircleIcon className="h-3 w-3" /> Saved
        </span>
      );
    }
    if (state.phase === "downloading") {
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-semibold text-white">
          {Math.round(state.fraction * 100)}%
        </span>
      );
    }
    return (
      <button
        type="button"
        onClick={(event) => {
          event.preventDefault();
          void start();
        }}
        aria-label="Download for offline"
        className="inline-flex items-center gap-1 rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-semibold text-white transition hover:bg-white/25"
      >
        <DownloadIcon className="h-3 w-3" /> Save
      </button>
    );
  }

  // Full control.
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm">
      {state.phase === "idle" && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-semibold text-[var(--foreground)]">Save for offline</p>
            <p className="mt-0.5 text-xs text-[var(--muted)]">
              Keeps a copy on this device.{" "}
              {video.expiresAt ? "It goes when the recording leaves your library." : "Stays until you delete it."}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void start()}
            className="inline-flex items-center gap-2 rounded-full bg-[var(--accent)] px-5 py-2 text-sm font-semibold text-white transition hover:brightness-110"
          >
            <DownloadIcon className="h-4 w-4" /> Download
          </button>
        </div>
      )}

      {state.phase === "downloading" && (
        <div>
          <div className="flex items-center justify-between text-xs font-medium text-[var(--muted)]">
            <span>
              Downloading… {Math.round(state.fraction * 100)}%
              {state.total ? ` · ${formatBytes(state.received)} / ${formatBytes(state.total)}` : ""}
            </span>
            <button type="button" onClick={() => abortRef.current?.abort()} className="text-[var(--accent)]">
              Cancel
            </button>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--surface-alt)]">
            <div
              className="h-full bg-[var(--accent)] transition-[width]"
              style={{ width: `${Math.max(3, Math.round(state.fraction * 100))}%` }}
            />
          </div>
        </div>
      )}

      {state.phase === "done" && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="inline-flex items-center gap-1.5 font-semibold text-emerald-600">
              <CheckCircleIcon className="h-4 w-4" /> Saved to this device
            </p>
            <p className="mt-0.5 text-xs text-[var(--muted)]">
              {formatBytes(state.sizeBytes)}
              {state.expiresAt ? ` · ${expiryLabel(state.expiresAt)}` : ""} ·{" "}
              <Link href="/materials/offline" className="text-[var(--accent)] underline">
                offline library
              </Link>
            </p>
          </div>
          <button
            type="button"
            onClick={() => void remove()}
            className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] px-4 py-1.5 text-xs font-semibold text-[var(--muted)] transition hover:text-[var(--foreground)]"
          >
            <TrashIcon className="h-3.5 w-3.5" /> Remove
          </button>
        </div>
      )}

      {state.phase === "error" && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-red-600">{state.message}</p>
          <button
            type="button"
            onClick={() => void start()}
            className="rounded-full bg-[var(--accent)] px-4 py-1.5 text-xs font-semibold text-white"
          >
            Try again
          </button>
        </div>
      )}
    </div>
  );
}
