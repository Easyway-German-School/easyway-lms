"use client";

import { FilmIcon, PlayIcon } from "@/components/icons";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import VideoThumb from "@/components/video/VideoThumb";
import {
  buildShelves,
  formatDuration,
  pickBillboard,
  watchPercent,
  type LibraryVideo,
  type VideoShelf,
} from "@/lib/video-library";

/**
 * The class video library.
 *
 * Rendered on a dark canvas inside the otherwise-light portal. That is a
 * deliberate break from the design system rather than an oversight: a video
 * shelf reads badly on white, and every student already knows what this layout
 * means the moment they see it. The break is contained — it stops at the
 * rounded edge of this panel.
 */

function ShelfRow({ shelf, previewOnHover }: { shelf: VideoShelf; previewOnHover: boolean }) {
  const scrollerRef = useRef<HTMLDivElement>(null);

  const scrollBy = (direction: 1 | -1) => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    scroller.scrollBy({ left: direction * scroller.clientWidth * 0.8, behavior: "smooth" });
  };

  return (
    <section className="space-y-3">
      <div className="flex items-end justify-between gap-4 px-1">
        <div>
          <h3 className="text-lg font-semibold text-white">{shelf.title}</h3>
          {shelf.subtitle ? <p className="mt-0.5 text-xs text-slate-400">{shelf.subtitle}</p> : null}
        </div>
        <div className="hidden shrink-0 gap-1.5 sm:flex">
          <button
            onClick={() => scrollBy(-1)}
            aria-label={`Scroll ${shelf.title} left`}
            className="grid h-8 w-8 place-items-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
          >
            ‹
          </button>
          <button
            onClick={() => scrollBy(1)}
            aria-label={`Scroll ${shelf.title} right`}
            className="grid h-8 w-8 place-items-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
          >
            ›
          </button>
        </div>
      </div>

      <div
        ref={scrollerRef}
        className="flex gap-3 overflow-x-auto pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {shelf.videos.map((video) => {
          const percent = watchPercent(video);
          return (
            <Link
              key={`${shelf.id}-${video.id}`}
              href={`/materials/watch/${video.id}`}
              className="group relative w-52 shrink-0 sm:w-64"
            >
              <div className="relative aspect-video overflow-hidden rounded-xl bg-slate-800 ring-1 ring-white/10 transition duration-200 group-hover:scale-[1.04] group-hover:ring-white/40">
                <VideoThumb video={video} previewOnHover={previewOnHover} />

                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 transition group-hover:opacity-100" />
                <div className="absolute inset-0 grid place-items-center opacity-0 transition group-hover:opacity-100">
                  <span className="grid h-11 w-11 place-items-center rounded-full bg-white/90 text-slate-900"><PlayIcon className="h-6 w-6" /></span>
                </div>

                {video.durationSeconds ? (
                  <span className="absolute right-1.5 top-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-white">
                    {formatDuration(video.durationSeconds)}
                  </span>
                ) : null}
                {video.kind === "recording" ? (
                  <span className="absolute left-1.5 top-1.5 rounded bg-[#FF6600] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                    Class tape
                  </span>
                ) : null}

                {percent > 0 ? (
                  <div className="absolute inset-x-0 bottom-0 h-1 bg-white/25">
                    <div className="h-full bg-[#FF6600]" style={{ width: `${percent}%` }} />
                  </div>
                ) : null}
              </div>

              <p className="mt-2 truncate text-sm font-medium text-slate-100">{video.title}</p>
              <p className="truncate text-xs text-slate-400">
                {[video.episodeNumber ? `Episode ${video.episodeNumber}` : null, video.lecturerName, video.level]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

export default function VideoLibrary({ videos, level }: { videos: LibraryVideo[]; level?: string | null }) {
  const [query, setQuery] = useState("");
  // Off by default, and labelled honestly. Netflix autoplays previews because
  // bandwidth is free for its audience; here it is the scarce thing the rest
  // of this feature exists to protect. It stays available for anyone on fibre.
  const [previewOnHover, setPreviewOnHover] = useState(false);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return videos;
    return videos.filter((video) =>
      [video.title, video.description, video.series, video.courseTitle, video.lecturerName]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(term)),
    );
  }, [videos, query]);

  const shelves = useMemo(() => buildShelves(filtered, level), [filtered, level]);
  const billboard = useMemo(() => pickBillboard(filtered), [filtered]);

  if (videos.length === 0) {
    return (
      <div className="rounded-3xl bg-slate-950 p-12 text-center text-slate-300">
        <FilmIcon className="mx-auto h-10 w-10 text-[var(--muted)]" />
        <p className="mt-4 text-lg font-semibold text-white">Your video library is empty for now</p>
        <p className="mx-auto mt-2 max-w-md text-sm text-slate-400">
          Class recordings appear here the same day they are taught, and your tutors add lesson videos as the level goes on.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-3xl bg-slate-950">
      {billboard ? (
        <div className="relative">
          <div className="relative h-[280px] w-full overflow-hidden sm:h-[400px]">
            <VideoThumb video={billboard} className="scale-105 blur-[1px] brightness-[0.45]" />
            <div className="absolute inset-0 bg-gradient-to-r from-slate-950 via-slate-950/70 to-transparent" />
            <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-slate-950 to-transparent" />
          </div>

          <div className="absolute inset-0 flex flex-col justify-end p-6 sm:p-10">
            <div className="max-w-xl">
              <p className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#FF6600]">
                {billboard.kind === "recording" ? "Latest class recording" : "Featured lesson"}
              </p>
              <h2 className="mt-2 text-2xl font-bold leading-tight text-white sm:text-4xl">{billboard.title}</h2>
              <p className="mt-2 text-xs text-slate-300">
                {[
                  billboard.level,
                  billboard.lecturerName,
                  formatDuration(billboard.durationSeconds),
                  billboard.recordedAt ? new Date(billboard.recordedAt).toLocaleDateString() : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              {billboard.description ? (
                <p className="mt-3 line-clamp-3 text-sm leading-6 text-slate-300">{billboard.description}</p>
              ) : null}

              <div className="mt-5 flex flex-wrap items-center gap-3">
                <Link
                  href={`/materials/watch/${billboard.id}`}
                  className="inline-flex items-center gap-2 rounded-lg bg-white px-7 py-2.5 text-sm font-bold text-slate-900 transition hover:bg-white/85"
                >
                  <PlayIcon className="h-5 w-5" /> {billboard.positionSeconds > 30 ? "Resume" : "Play"}
                </Link>
                <span className="rounded-lg bg-white/15 px-5 py-2.5 text-sm font-semibold text-white">
                  {watchPercent(billboard) > 0 ? `${watchPercent(billboard)}% watched` : "Not started"}
                </span>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <div className="space-y-8 p-5 sm:p-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search your videos…"
            className="w-full max-w-sm rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder:text-slate-500 focus:border-white/30 focus:outline-none"
          />
          <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-400">
            <input
              type="checkbox"
              checked={previewOnHover}
              onChange={(event) => setPreviewOnHover(event.target.checked)}
              className="h-4 w-4 accent-[#FF6600]"
            />
            Play previews on hover <span className="text-slate-500">(uses more data)</span>
          </label>
        </div>

        {shelves.length === 0 ? (
          <p className="py-10 text-center text-sm text-slate-400">Nothing matches “{query}”.</p>
        ) : (
          shelves.map((shelf) => <ShelfRow key={shelf.id} shelf={shelf} previewOnHover={previewOnHover} />)
        )}
      </div>
    </div>
  );
}
