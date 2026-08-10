"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import LecturerShell from "@/components/LecturerShell";
import VideoLibrary from "@/components/video/VideoLibrary";
import BrandLoader from "@/components/BrandLoader";
import type { LibraryVideo } from "@/lib/video-library";

type TutorVideo = LibraryVideo & { mine: boolean };

type Payload = {
  videos: TutorVideo[];
  levels: string[];
  unassigned: boolean;
  mineCount?: number;
  message?: string;
};

/**
 * The tutor's recording library.
 *
 * Same shelf layout the students have had since it was built — deliberately,
 * because it is the same content and a tutor should not have to learn a second
 * interface to watch back the class they themselves taught. What differs is
 * the scope (their assigned levels, not one student's level), the badge on
 * their own tapes, and the player, which does not track a watch position
 * because a tutor has no Student row to hang one off.
 */
export default function LecturerRecordingsPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [onlyMine, setOnlyMine] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/lecturer/videos", { cache: "no-store" });
        const body = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setError(body?.message || body?.error || "Could not load your recordings");
          return;
        }
        setData(body);
      } catch {
        if (!cancelled) setError("Could not load your recordings");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <LecturerShell>
        <BrandLoader fill size="lg" title="Einen Moment…" message="Opening your recordings." />
      </LecturerShell>
    );
  }

  const videos = data?.videos ?? [];
  const shown = onlyMine ? videos.filter((video) => video.mine) : videos;

  return (
    <LecturerShell>
      <div className="mx-auto max-w-7xl space-y-6 p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.24em] text-[var(--accent)]">Tutor</p>
            <h1 className="text-3xl font-black tracking-tight">Recordings</h1>
            <p className="mt-2 text-sm text-[var(--muted)]">
              {data?.levels?.length
                ? `Every class tape and lesson video at ${data.levels.join(", ")}. Recordings appear the same day they are taught.`
                : "Class tapes and lesson videos for the levels you teach."}
            </p>
          </div>

          {videos.some((video) => video.mine) && (
            <label className="flex cursor-pointer items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm font-semibold">
              <input
                type="checkbox"
                checked={onlyMine}
                onChange={(event) => setOnlyMine(event.target.checked)}
                className="h-4 w-4 accent-[var(--accent)]"
              />
              Only classes I taught
              <span className="text-xs text-[var(--muted)]">({data?.mineCount ?? 0})</span>
            </label>
          )}
        </div>

        {error && (
          <div className="rounded-3xl border border-red-300 bg-red-50 p-5 text-sm text-red-700">{error}</div>
        )}

        {data?.unassigned && (
          <div className="rounded-3xl border border-amber-300 bg-amber-50 p-5 text-sm text-amber-800">
            {data.message ?? "The office has not assigned you a level yet."}
          </div>
        )}

        {!error && !data?.unassigned && (
          <VideoLibrary
            videos={shown}
            level={data?.levels?.[0] ?? null}
            // Tutors get their own player. The student one writes to
            // /api/student/videos/progress, which 404s for an account with no
            // Student row — it would fail silently on every heartbeat.
            watchHref={(id) => `/lecturer/recordings/${id}`}
          />
        )}
      </div>
    </LecturerShell>
  );
}
