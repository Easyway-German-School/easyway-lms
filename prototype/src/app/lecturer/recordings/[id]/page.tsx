"use client";

export const dynamic = "force-dynamic";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import LecturerShell from "@/components/LecturerShell";
import BrandLoader from "@/components/BrandLoader";
import { formatDuration, type LibraryVideo } from "@/lib/video-library";

type TutorVideo = LibraryVideo & { mine: boolean };

/**
 * The tutor's player.
 *
 * Deliberately NOT the student player at /materials/watch/[id]. That one posts
 * a watch position to /api/student/videos/progress on a heartbeat and on
 * unload, and `VideoProgress` hangs off a Student row — a tutor has none, so
 * every one of those writes would fail, silently, for the whole lesson. Rather
 * than teach the student player about a second kind of viewer, the tutor gets
 * a plain player: no resume, no progress bar, nothing to write.
 */
export default function LecturerRecordingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [video, setVideo] = useState<TutorVideo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // The same endpoint the shelf reads. One extra request would need its
        // own authorisation logic, and this list is already scoped to exactly
        // what this tutor may watch — so a video that is not in it is a video
        // they may not open, and "not found" is the correct answer.
        const res = await fetch("/api/lecturer/videos", { cache: "no-store" });
        const body = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setError(body?.message || body?.error || "Could not load this recording");
          return;
        }
        const match = (body.videos as TutorVideo[] | undefined)?.find((entry) => entry.id === id) ?? null;
        if (!match) {
          setError("That recording is not one of yours, or it has been removed.");
          return;
        }
        setVideo(match);
      } catch {
        if (!cancelled) setError("Could not load this recording");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (loading) {
    return (
      <LecturerShell>
        <BrandLoader fill size="lg" title="Einen Moment…" message="Opening the recording." />
      </LecturerShell>
    );
  }

  return (
    <LecturerShell>
      <div className="mx-auto max-w-5xl space-y-5 p-6">
        <Link href="/lecturer/recordings" className="text-sm font-semibold text-[var(--accent)] hover:underline">
          ← All recordings
        </Link>

        {error ? (
          <div className="rounded-3xl border border-red-300 bg-red-50 p-6 text-sm text-red-700">{error}</div>
        ) : video ? (
          <>
            <div className="overflow-hidden rounded-3xl bg-slate-950">
              <video
                src={video.fileUrl}
                poster={video.thumbnailUrl ?? undefined}
                controls
                playsInline
                // Not autoplay: a tutor may open this in a staff room, and a
                // class recording starting itself at full volume is the kind of
                // thing that makes people stop using a feature.
                preload="metadata"
                className="aspect-video w-full bg-black"
              />
            </div>

            <div>
              <h1 className="text-2xl font-black tracking-tight">{video.title}</h1>
              <p className="mt-1.5 text-sm text-[var(--muted)]">
                {[
                  video.kind === "recording" ? "Class tape" : "Lesson video",
                  video.level,
                  video.courseTitle,
                  video.lecturerName,
                  formatDuration(video.durationSeconds),
                  video.recordedAt ? new Date(video.recordedAt).toLocaleDateString("en-GB") : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
                {video.mine ? " · you taught this" : ""}
              </p>
              {video.description && (
                <p className="mt-4 whitespace-pre-line text-sm leading-6 text-[var(--foreground)]">
                  {video.description}
                </p>
              )}
            </div>
          </>
        ) : null}
      </div>
    </LecturerShell>
  );
}
