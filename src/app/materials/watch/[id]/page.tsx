"use client";

export const dynamic = "force-dynamic";

import Link from "next/link";
import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import StudentShell from "@/components/StudentShell";
import BrandLoader from "@/components/BrandLoader";
import VideoThumb from "@/components/video/VideoThumb";
import EmbeddedVideoPlayer from "@/components/EmbeddedVideoPlayer";
import { ArrowLeftIcon, DownloadIcon } from "@/components/icons";
import {
  formatDuration,
  isEffectivelyComplete,
  watchPercent,
  type LibraryVideo,
} from "@/lib/video-library";

/** How often the player checkpoints, in seconds of playback. */
const SAVE_EVERY_SECONDS = 15;

/**
 * Language learners rewatch at half speed to catch a word and at 1.5× to
 * revise. Both are worth a button.
 */
const SPEEDS = [0.75, 1, 1.25, 1.5] as const;

export default function WatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const videoRef = useRef<HTMLVideoElement>(null);
  const lastSavedRef = useRef(0);
  const [videos, setVideos] = useState<LibraryVideo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lockedMessage, setLockedMessage] = useState<string | null>(null);
  const [resumedFrom, setResumedFrom] = useState<number | null>(null);
  const [speed, setSpeed] = useState<number>(1);

  const video = useMemo(() => videos.find((item) => item.id === id) ?? null, [videos, id]);

  // What to watch next: the rest of this series in order, otherwise the newest
  // videos at this level. A student who just watched Tuesday's class should be
  // one click from Wednesday's.
  const upNext = useMemo(() => {
    if (!video) return [];
    const sameSeries = videos
      .filter((item) => item.id !== video.id && item.series && item.series === video.series)
      .sort((a, b) => (a.episodeNumber ?? 0) - (b.episodeNumber ?? 0));
    if (sameSeries.length > 0) return sameSeries.slice(0, 6);
    return videos
      .filter((item) => item.id !== video.id && item.kind === video.kind)
      .sort(
        (a, b) =>
          new Date(b.recordedAt || b.createdAt).getTime() - new Date(a.recordedAt || a.createdAt).getTime(),
      )
      .slice(0, 6);
  }, [videos, video]);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/student/videos", { cache: "no-store" });
        const data = await res.json().catch(() => ({}));
        if (res.status === 403) {
          setLockedMessage(data.message || "Pay your deposit to unlock the video library.");
          return;
        }
        if (!res.ok) {
          setError(data.error || "Could not load this video.");
          return;
        }
        setVideos(data.videos || []);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Could not load this video.");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const saveProgress = useCallback(
    (positionSeconds: number, durationSeconds: number, useBeacon = false) => {
      if (!id || positionSeconds <= 0) return;
      const payload = JSON.stringify({ materialId: id, positionSeconds, durationSeconds });

      // On unload a normal fetch is cancelled with the page. sendBeacon is the
      // only thing that reliably survives, and losing the last checkpoint is
      // exactly the case this feature exists to prevent.
      if (useBeacon && typeof navigator !== "undefined" && navigator.sendBeacon) {
        navigator.sendBeacon("/api/student/videos/progress", new Blob([payload], { type: "application/json" }));
        return;
      }

      void fetch("/api/student/videos/progress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
        keepalive: true,
      }).catch(() => {
        // A dropped checkpoint is not worth interrupting playback over — the
        // next one is fifteen seconds away.
      });
    },
    [id],
  );

  // Resume where they stopped. Skipped when they had all but finished it, so
  // rewatching does not dump them at the closing seconds.
  const handleLoadedMetadata = useCallback(() => {
    const element = videoRef.current;
    if (!element || !video) return;
    const start = video.positionSeconds;
    if (start > 30 && !isEffectivelyComplete(start, element.duration || video.durationSeconds)) {
      element.currentTime = start;
      setResumedFrom(start);
    }
    // The upload usually has no duration; the player is the first thing that
    // actually knows it, so it reports it once here.
    if (!video.durationSeconds && Number.isFinite(element.duration)) {
      saveProgress(Math.max(1, Math.floor(element.currentTime)), Math.floor(element.duration));
    }
  }, [video, saveProgress]);

  const handleTimeUpdate = useCallback(() => {
    const element = videoRef.current;
    if (!element) return;
    const current = Math.floor(element.currentTime);
    if (current - lastSavedRef.current >= SAVE_EVERY_SECONDS) {
      lastSavedRef.current = current;
      saveProgress(current, Math.floor(element.duration || 0));
    }
  }, [saveProgress]);

  const flush = useCallback(
    (useBeacon = false) => {
      const element = videoRef.current;
      if (!element) return;
      saveProgress(Math.floor(element.currentTime), Math.floor(element.duration || 0), useBeacon);
    },
    [saveProgress],
  );

  useEffect(() => {
    const onHide = () => flush(true);
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onHide);
      flush(true);
    };
  }, [flush]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = speed;
  }, [speed]);

  const body = (() => {
    if (loading) return <BrandLoader size="lg" title="Video wird geladen…" message="Loading your video." />;

    if (lockedMessage) {
      return (
        <div className="rounded-3xl border border-amber-300 bg-amber-50 p-8 text-sm text-amber-900">
          <p className="text-base font-semibold">The video library is locked</p>
          <p className="mt-2">{lockedMessage}</p>
          <Link href="/programs" className="mt-5 inline-flex rounded-full bg-[var(--accent)] px-6 py-2.5 text-sm font-semibold text-white">
            Pay tuition now
          </Link>
        </div>
      );
    }

    if (error || !video) {
      return (
        <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-10 text-center">
          <p className="text-lg font-semibold">{error ? "Something went wrong" : "We could not find that video"}</p>
          <p className="mt-2 text-sm text-[var(--muted)]">
            {error || "It may have been removed, or it belongs to a different level."}
          </p>
          <Link href="/materials" className="mt-6 inline-flex rounded-full bg-[var(--accent)] px-6 py-2.5 text-sm font-semibold text-white">
            Back to the library
          </Link>
        </div>
      );
    }

    return (
      <div className="space-y-6">
        <Link href="/materials" className="inline-flex items-center gap-2 text-sm font-medium text-[var(--muted)] transition hover:text-[var(--foreground)]">
          <ArrowLeftIcon /> Back to the library
        </Link>

        {/* Check if video is embedded or regular file */}
        {video.fileType === 'video/embedded' ? (
          <EmbeddedVideoPlayer
            title={video.title}
            url={video.fileUrl}
            description={video.description}
          />
        ) : (
          <>
            <div className="overflow-hidden rounded-3xl bg-slate-950">
              <video
                ref={videoRef}
                src={video.fileUrl}
                poster={video.thumbnailUrl ?? undefined}
                controls
                playsInline
                preload="metadata"
                onLoadedMetadata={handleLoadedMetadata}
                onTimeUpdate={handleTimeUpdate}
                onPause={() => flush()}
                onEnded={() => flush()}
                className="aspect-video w-full bg-black"
              />

              <div className="flex flex-wrap items-center gap-3 border-t border-white/10 p-4">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-medium text-slate-400">Speed</span>
                  {SPEEDS.map((option) => (
                    <button
                      key={option}
                      onClick={() => setSpeed(option)}
                      className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold transition ${
                        speed === option ? "bg-white text-slate-900" : "bg-white/10 text-white hover:bg-white/20"
                      }`}
                    >
                      {option}×
                    </button>
                  ))}
                </div>

                {/* On an unreliable connection, downloading once and watching
                    offline beats streaming three times. */}
                <a
                  href={video.fileUrl}
                  download
                  className="ml-auto inline-flex items-center gap-2 rounded-lg bg-white/10 px-4 py-2 text-xs font-semibold text-white transition hover:bg-white/20"
                >
                  <DownloadIcon className="h-4 w-4" /> Download to watch offline
                </a>
              </div>
            </div>

            {resumedFrom ? (
              <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-[var(--accent)]/25 bg-[var(--accent-soft)] px-5 py-3 text-sm">
                <span className="text-[var(--foreground)]">
                  Resumed from <strong>{formatDuration(resumedFrom)}</strong> — where you stopped last time.
                </span>
                <button
                  onClick={() => {
                    if (videoRef.current) videoRef.current.currentTime = 0;
                    setResumedFrom(null);
                  }}
                  className="rounded-full border border-[var(--border)] bg-white px-4 py-1.5 text-xs font-semibold text-[var(--foreground)]"
                >
                  Start from the beginning
                </button>
              </div>
            ) : null}
          </>
        )}

        <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-2xl font-semibold">{video.title}</h1>
              <p className="mt-1 text-sm text-[var(--muted)]">
                {[
                  video.kind === "recording" ? "Class recording" : "Lesson video",
                  video.level,
                  video.lecturerName,
                  video.series ? `${video.series}${video.episodeNumber ? ` · Episode ${video.episodeNumber}` : ""}` : null,
                  video.recordedAt ? new Date(video.recordedAt).toLocaleDateString() : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
            {video.completed ? (
              <span className="rounded-full bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-700">Watched</span>
            ) : watchPercent(video) > 0 ? (
              <span className="rounded-full bg-[var(--accent-soft)] px-3 py-1.5 text-xs font-semibold text-[var(--accent)]">
                {watchPercent(video)}% watched
              </span>
            ) : null}
          </div>

          {video.description ? (
            <p className="mt-4 text-sm leading-7 text-[var(--muted)]">{video.description}</p>
          ) : null}
        </div>

        {upNext.length > 0 ? (
          <div className="space-y-3">
            <h2 className="text-lg font-semibold">Up next</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {upNext.map((item) => (
                <Link
                  key={item.id}
                  href={`/materials/watch/${item.id}`}
                  className="group overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] transition hover:shadow-lg"
                >
                  <div className="relative aspect-video bg-slate-900">
                    <VideoThumb video={item} />
                    {item.durationSeconds ? (
                      <span className="absolute right-1.5 top-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-white">
                        {formatDuration(item.durationSeconds)}
                      </span>
                    ) : null}
                    {watchPercent(item) > 0 ? (
                      <div className="absolute inset-x-0 bottom-0 h-1 bg-white/25">
                        <div className="h-full bg-[#FF6600]" style={{ width: `${watchPercent(item)}%` }} />
                      </div>
                    ) : null}
                  </div>
                  <div className="p-3">
                    <p className="truncate text-sm font-medium">{item.title}</p>
                    <p className="truncate text-xs text-[var(--muted)]">
                      {[item.episodeNumber ? `Episode ${item.episodeNumber}` : null, item.lecturerName]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    );
  })();

  return (
    <StudentShell>
      <div className="min-h-screen bg-[var(--background)] px-6 py-10 text-[var(--foreground)]">
        <div className="mx-auto max-w-5xl">{body}</div>
      </div>
    </StudentShell>
  );
}
