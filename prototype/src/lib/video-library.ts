/**
 * The class video library — shared vocabulary for the shelves.
 *
 * Shelves are computed rather than curated. Nobody at the school is going to
 * maintain a "featured" list every week, so a library that depends on someone
 * doing that would be empty by the second month. Everything here derives from
 * data the tutor already enters when uploading.
 *
 * No prisma import — the player and the shelves both read these types.
 */

export type VideoKind = "video" | "recording";

export type LibraryVideo = {
  id: string;
  title: string;
  description: string | null;
  fileUrl: string;
  thumbnailUrl: string | null;
  durationSeconds: number | null;
  kind: VideoKind;
  level: string | null;
  series: string | null;
  episodeNumber: number | null;
  courseTitle: string | null;
  lecturerName: string | null;
  recordedAt: string | null;
  createdAt: string;
  /** Where this student stopped, if they have started it. */
  positionSeconds: number;
  completed: boolean;
  /**
   * Set when the tutor linked the video rather than uploading it, and the
   * player must use an iframe. Null for anything we host ourselves — including
   * a linked bare .mp4, which is a real file and stays in a <video> so it keeps
   * scrubbing, speed control and the resume position. See lib/media-embed.ts.
   */
  embedUrl: string | null;
  /** "YouTube", "Vimeo"… — shown on the tile so the shelf is honest about it. */
  embedLabel: string | null;
};

export type VideoShelf = {
  /** Stable key for React and for deep links. */
  id: string;
  title: string;
  /** One line explaining why this shelf exists, shown under the title. */
  subtitle?: string;
  videos: LibraryVideo[];
};

/** Anything the browser can actually play in a <video> element. */
export function isPlayableVideo(fileType?: string | null): boolean {
  const type = String(fileType ?? "").toLowerCase();
  return type.startsWith("video/") || type === "video";
}

/**
 * `Material.kind` from the uploaded file, used when a tutor does not say.
 * A recording is only ever set explicitly — we cannot tell a taught lesson
 * from a captured class by its MIME type.
 */
export function deriveMaterialKind(fileType?: string | null): "video" | "document" {
  return isPlayableVideo(fileType) ? "video" : "document";
}

/**
 * Turn a stored path into something the player can request.
 *
 * Uploaded material is stored as a site-relative path (`/uploads/...`), but a
 * class recording lives in an object bucket and is stored as a full URL. The
 * naive `startsWith("/")` check turned the latter into `/https://...`, so every
 * auto-captured class would have rendered a tile that could never play.
 */
export function toPlayableUrl(path?: string | null): string {
  const value = String(path ?? "").trim();
  if (!value) return "";
  if (/^(https?:|blob:|data:)/i.test(value)) return value;
  return value.startsWith("/") ? value : `/${value}`;
}

export function formatDuration(seconds?: number | null): string {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  if (!total) return "";
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  const secs = total % 60;
  return minutes > 0 ? `${minutes}m` : `${secs}s`;
}

/** "4:07" or "1:02:33" — the clock readout in the player chrome, not the tile. */
export function formatClock(seconds?: number | null): string {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  return `${minutes}:${String(secs).padStart(2, "0")}`;
}

/** 0–100, for the red progress bar under a thumbnail. */
export function watchPercent(video: Pick<LibraryVideo, "positionSeconds" | "durationSeconds" | "completed">): number {
  if (video.completed) return 100;
  const duration = Number(video.durationSeconds) || 0;
  if (duration <= 0 || video.positionSeconds <= 0) return 0;
  return Math.min(100, Math.round((video.positionSeconds / duration) * 100));
}

/**
 * A video counts as "in progress" once past the opening moments and before the
 * end. The 30-second floor stops an accidental tap filling Continue watching
 * with videos nobody actually started.
 */
export function isInProgress(video: LibraryVideo): boolean {
  return !video.completed && video.positionSeconds > 30;
}

/** Treated as finished at 95% — nobody watches the credits. */
export const COMPLETION_THRESHOLD = 0.95;

export function isEffectivelyComplete(positionSeconds: number, durationSeconds?: number | null): boolean {
  const duration = Number(durationSeconds) || 0;
  if (duration <= 0) return false;
  return positionSeconds >= duration * COMPLETION_THRESHOLD;
}

/**
 * Build the shelves from a flat list.
 *
 * Order is the argument the whole page makes: what you were watching, what is
 * new, then the class tapes newest-first, then the tutor's own series, then
 * everything else. A student who missed Tuesday should find Tuesday without
 * scrolling.
 */
export function buildShelves(videos: LibraryVideo[], level?: string | null): VideoShelf[] {
  const shelves: VideoShelf[] = [];
  const byNewest = (a: LibraryVideo, b: LibraryVideo) =>
    new Date(b.recordedAt || b.createdAt).getTime() - new Date(a.recordedAt || a.createdAt).getTime();

  const continueWatching = videos.filter(isInProgress).sort(byNewest);
  if (continueWatching.length > 0) {
    shelves.push({
      id: "continue",
      title: "Continue watching",
      subtitle: "Picks up exactly where your connection dropped.",
      videos: continueWatching,
    });
  }

  const recordings = videos.filter((video) => video.kind === "recording").sort(byNewest);
  if (recordings.length > 0) {
    shelves.push({
      id: "recordings",
      title: level ? `${level} class recordings` : "Class recordings",
      subtitle: "Every live class, recorded. Missed one? It is here.",
      videos: recordings,
    });
  }

  // A series is a shelf. Tutors name their own, so the library grows shelves
  // as they upload rather than needing anyone to configure one.
  const seriesNames = Array.from(
    new Set(videos.filter((video) => video.series?.trim()).map((video) => video.series!.trim())),
  ).sort();

  for (const series of seriesNames) {
    const episodes = videos
      .filter((video) => video.series?.trim() === series)
      .sort((a, b) => (a.episodeNumber ?? 0) - (b.episodeNumber ?? 0) || byNewest(a, b));
    if (episodes.length > 0) {
      shelves.push({ id: `series-${series}`, title: series, videos: episodes });
    }
  }

  const lessons = videos
    .filter((video) => video.kind === "video" && !video.series?.trim())
    .sort(byNewest);
  if (lessons.length > 0) {
    shelves.push({
      id: "lessons",
      title: "Lesson videos",
      subtitle: "Prepared by your tutors, watch in any order.",
      videos: lessons,
    });
  }

  const finished = videos.filter((video) => video.completed).sort(byNewest);
  if (finished.length > 0) {
    shelves.push({
      id: "finished",
      title: "Watch again",
      subtitle: "Revision is where a language actually sticks.",
      videos: finished,
    });
  }

  return shelves;
}

/**
 * The billboard at the top of the library.
 *
 * Prefers something half-watched (finish what you started), then the newest
 * recording (the class you might have missed), then simply the newest thing.
 */
export function pickBillboard(videos: LibraryVideo[]): LibraryVideo | null {
  if (videos.length === 0) return null;
  const byNewest = (a: LibraryVideo, b: LibraryVideo) =>
    new Date(b.recordedAt || b.createdAt).getTime() - new Date(a.recordedAt || a.createdAt).getTime();

  return (
    videos.filter(isInProgress).sort(byNewest)[0] ??
    videos.filter((video) => video.kind === "recording").sort(byNewest)[0] ??
    [...videos].sort(byNewest)[0] ??
    null
  );
}
