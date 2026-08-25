"use client";

export const dynamic = "force-dynamic";

import Link from "next/link";
import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import StudentShell from "@/components/StudentShell";
import BrandLoader from "@/components/BrandLoader";
import VideoThumb from "@/components/video/VideoThumb";
import CinemaPlayer from "@/components/video/CinemaPlayer";
import ClassNotesPanel from "@/components/video/ClassNotesPanel";
import MyNotesEditor from "@/components/video/MyNotesEditor";
import { ArrowLeftIcon } from "@/components/icons";
import {
  formatDuration,
  isEffectivelyComplete,
  watchPercent,
  type LibraryVideo,
} from "@/lib/video-library";
import { celebrateLessonComplete } from "@/components/LessonCompleteCelebration";

/** How often the player checkpoints, in seconds of playback. */
const SAVE_EVERY_SECONDS = 15;

export default function WatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const videoRef = useRef<HTMLVideoElement>(null);
  const lastSavedRef = useRef(0);
  const [videos, setVideos] = useState<LibraryVideo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lockedMessage, setLockedMessage] = useState<string | null>(null);
  const [resumedFrom, setResumedFrom] = useState<number | null>(null);

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
      })
        .then((res) => res.json())
        .then((data) => {
          if (data?.celebrate) {
            celebrateLessonComplete({
              title: "Video complete",
              message: data.title ? `You finished “${data.title}.”` : "You watched the whole thing.",
            });
          }
        })
        .catch(() => {
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

        <div className="relative overflow-hidden rounded-3xl bg-black shadow-[0_30px_80px_-20px_rgba(0,0,0,0.6)] ring-1 ring-white/10">
          {video.embedUrl ? (
            // A linked video plays in the provider's own player — there is no
            // <video> element here for CinemaPlayer to wrap, so the embed gets
            // a plain iframe and a strip naming where it came from instead.
            <>
              <iframe
                src={video.embedUrl}
                title={video.title}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
                allowFullScreen
                referrerPolicy="strict-origin-when-cross-origin"
                className="aspect-video w-full border-0 bg-black"
              />
              <div className="flex flex-wrap items-center gap-3 border-t border-white/10 bg-gradient-to-b from-black/40 to-black/70 p-4 backdrop-blur">
                <span className="text-xs font-medium text-slate-400">
                  Playing from {video.embedLabel ?? "an external source"}
                </span>
                <a
                  href={video.fileUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="ml-auto inline-flex items-center gap-2 rounded-lg bg-white/10 px-4 py-2 text-xs font-semibold text-white transition hover:bg-white/20"
                >
                  Open on {video.embedLabel ?? "the original site"}
                </a>
              </div>
            </>
          ) : (
            <CinemaPlayer
              ref={videoRef}
              src={video.fileUrl}
              poster={video.thumbnailUrl}
              title={video.title}
              onLoadedMetadata={handleLoadedMetadata}
              onTimeUpdate={handleTimeUpdate}
              onPause={() => flush()}
              onEnded={() => flush()}
              className="aspect-video w-full"
            />
          )}
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

        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900 via-slate-950 to-black p-6 text-white shadow-xl">
          {/* A soft brand-colour wash in the corner — the one thing a plain
              dark card is missing to read as "cinematic" rather than "empty". */}
          <div className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-[#FF6600]/20 blur-3xl" />
          <div className="relative flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-2xl font-semibold tracking-tight">{video.title}</h1>
              <p className="mt-1.5 text-sm text-slate-300">
                {[
                  video.kind === "recording" ? (video.isPrivate ? "Private lesson recording" : "Class recording") : "Lesson video",
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
              <span className="shrink-0 rounded-full bg-emerald-500/15 px-3 py-1.5 text-xs font-semibold text-emerald-300 ring-1 ring-emerald-400/30">
                Watched
              </span>
            ) : watchPercent(video) > 0 ? (
              <span className="shrink-0 rounded-full bg-[#FF6600]/15 px-3 py-1.5 text-xs font-semibold text-[#ffb27a] ring-1 ring-[#FF6600]/30">
                {watchPercent(video)}% watched
              </span>
            ) : null}
          </div>

          {video.description ? (
            <p className="relative mt-4 max-w-3xl text-sm leading-7 text-slate-300">{video.description}</p>
          ) : null}
        </div>

        {/* The AI-generated summary/vocabulary/transcript only ever exists for a
            recording — a tutor's uploaded lesson video was never transcribed.
            The personal notepad has no such dependency (it seeds from the AI
            summary when one exists and starts blank otherwise), so it is
            offered on every video — online, private, AND a physical
            student's assigned lesson videos alike. */}
        {video.kind === "recording" ? (
          <ClassNotesPanel
            materialId={video.id}
            onSeekTo={(seconds) => {
              const element = videoRef.current;
              if (!element) return;
              element.currentTime = seconds;
              void element.play();
            }}
          />
        ) : null}
        <MyNotesEditor materialId={video.id} />

        {upNext.length > 0 ? (
          <div className="space-y-3">
            <h2 className="text-lg font-semibold">Up next</h2>
            <div className="-mx-6 flex snap-x gap-4 overflow-x-auto px-6 pb-2 sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 lg:grid-cols-3">
              {upNext.map((item) => (
                <Link
                  key={item.id}
                  href={`/materials/watch/${item.id}`}
                  className="group w-64 shrink-0 snap-start overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] transition duration-300 hover:-translate-y-1 hover:shadow-2xl sm:w-auto"
                >
                  <div className="relative aspect-video overflow-hidden bg-slate-900">
                    <div className="h-full w-full transition duration-300 group-hover:scale-110">
                      <VideoThumb video={item} />
                    </div>
                    <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 transition group-hover:opacity-100" />
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
