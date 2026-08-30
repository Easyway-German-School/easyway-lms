"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DownloadIcon } from "@/components/icons";
import { useIsInstalledApp } from "@/lib/client/standalone";
import { hasMedia } from "@/lib/offline/store";
import { downloadVideoForOffline, formatBytes, OfflineCapError } from "@/lib/offline/download";
import type { LibraryVideo } from "@/lib/video-library";

/**
 * "Download this week" — the smart-downloads button.
 *
 * One tap grabs every class recording from the last seven days that isn't
 * already on the device, in sequence, with a running byte total. Installed app
 * only (that's where offline downloads live at all). Hidden when there's
 * nothing new to fetch.
 */
const WEEK_MS = 7 * 24 * 3_600_000;

export default function WeekDownloadButton({ videos }: { videos: LibraryVideo[] }) {
  const installed = useIsInstalledApp();
  const [pending, setPending] = useState<LibraryVideo[] | null>(null);
  const [state, setState] = useState<
    | { phase: "idle" }
    | { phase: "running"; done: number; total: number; bytes: number; title: string }
    | { phase: "finished"; count: number; bytes: number }
    | { phase: "error"; message: string; done: number }
  >({ phase: "idle" });
  const abortRef = useRef<AbortController | null>(null);

  // Keyed on the ids only so the effect below doesn't re-run on every parent
  // render just because `videos` is a fresh array reference.
  const recordingIdsKey = useMemo(
    () => videos.filter((v) => v.kind === "recording" && !v.embedUrl).map((v) => v.id).join(","),
    [videos],
  );

  useEffect(() => {
    if (!installed) {
      setPending(null);
      return;
    }
    let alive = true;
    (async () => {
      const cutoff = Date.now() - WEEK_MS;
      const thisWeek = videos.filter(
        (v) =>
          v.kind === "recording" &&
          !v.embedUrl &&
          new Date(v.recordedAt || v.createdAt).getTime() >= cutoff,
      );
      const missing: LibraryVideo[] = [];
      for (const v of thisWeek) {
        if (!(await hasMedia(v.id))) missing.push(v);
      }
      if (alive) setPending(missing);
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recordingIdsKey stands in for `videos`
  }, [installed, recordingIdsKey]);

  const run = useCallback(async () => {
    if (!pending || pending.length === 0) return;
    const controller = new AbortController();
    abortRef.current = controller;
    let base = 0; // bytes from items already finished this run
    let lastReceived = 0;
    for (let i = 0; i < pending.length; i += 1) {
      const video = pending[i];
      lastReceived = 0;
      setState({ phase: "running", done: i, total: pending.length, bytes: base, title: video.title });
      try {
        await downloadVideoForOffline(video, {
          signal: controller.signal,
          onProgress: (_f, received) => {
            lastReceived = received;
            setState({ phase: "running", done: i, total: pending.length, bytes: base + received, title: video.title });
          },
        });
        base += lastReceived;
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
              : "A download failed.";
        setState({ phase: "error", message, done: i });
        return;
      }
    }
    setState({ phase: "finished", count: pending.length, bytes: base });
    setPending([]);
  }, [pending]);

  if (!installed || pending === null || pending.length === 0) {
    if (state.phase === "finished") {
      return (
        <p className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-xs font-medium text-emerald-300">
          This week&rsquo;s {state.count} class{state.count === 1 ? "" : "es"} saved for offline
          {state.bytes ? ` · ${formatBytes(state.bytes)}` : ""}.
        </p>
      );
    }
    return null;
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#FF6600]/30 bg-[#FF6600]/10 p-4">
      <div>
        <p className="text-sm font-semibold text-white">Download this week</p>
        <p className="mt-0.5 text-xs text-slate-300">
          {state.phase === "running"
            ? `Saving ${state.done + 1} of ${state.total} — ${state.title} · ${formatBytes(state.bytes)}`
            : state.phase === "error"
              ? state.message
              : `${pending.length} new class recording${pending.length === 1 ? "" : "s"} for offline watching.`}
        </p>
      </div>
      {state.phase === "running" ? (
        <button
          type="button"
          onClick={() => abortRef.current?.abort()}
          className="rounded-full bg-white/15 px-4 py-2 text-xs font-semibold text-white"
        >
          Stop
        </button>
      ) : (
        <button
          type="button"
          onClick={() => void run()}
          className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-2 text-sm font-bold text-slate-900 transition hover:bg-white/85"
        >
          <DownloadIcon className="h-4 w-4" /> {state.phase === "error" ? "Retry" : "Get them all"}
        </button>
      )}
    </div>
  );
}
