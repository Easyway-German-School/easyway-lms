"use client";

/**
 * The downloads shelf — everything this device is holding for offline.
 *
 * DELIBERATELY NOT WRAPPED IN StudentShell. The shell reads the session and
 * renders per-user navigation; this page has to open with no network and,
 * often, before any session has rehydrated. So it carries its own tiny chrome
 * and reads nothing but IndexedDB. That is also what lets the service worker
 * cache it and serve it offline without caching anybody's private data (see
 * public/sw.js).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import BrandLogo from "@/components/BrandLogo";
import { ArrowLeftIcon, PlayIcon, TrashIcon, PencilIcon } from "@/components/icons";
import {
  deleteMedia,
  deleteNote,
  getMedia,
  listMedia,
  listNotes,
  sweepExpired,
  takeLastClearedCount,
  usage,
  type OfflineMediaRow,
  type OfflineNote,
} from "@/lib/offline/store";
import { formatBytes, expiryLabel, formatDuration } from "@/lib/offline/download";

export default function OfflineLibraryPage() {
  const [media, setMedia] = useState<OfflineMediaRow[] | null>(null);
  const [notes, setNotes] = useState<OfflineNote[]>([]);
  const [space, setSpace] = useState<{ bytes: number; count: number; capBytes: number }>({
    bytes: 0,
    count: 0,
    capBytes: 0,
  });
  const [cleared, setCleared] = useState(0);
  const [playing, setPlaying] = useState<{ id: string; url: string; title: string } | null>(null);

  const refresh = useCallback(async () => {
    const [rows, noteRows, use] = await Promise.all([listMedia(), listNotes(), usage()]);
    setMedia(rows);
    setNotes(noteRows);
    setSpace({ bytes: use.bytes, count: use.count, capBytes: use.capBytes });
  }, []);

  useEffect(() => {
    (async () => {
      await sweepExpired();
      setCleared(await takeLastClearedCount());
      await refresh();
    })();
  }, [refresh]);

  const play = useCallback(async (id: string, title: string) => {
    const row = await getMedia(id);
    if (!row) return;
    setPlaying((prev) => {
      if (prev) URL.revokeObjectURL(prev.url);
      return { id, url: URL.createObjectURL(row.blob), title };
    });
  }, []);

  useEffect(() => {
    return () => {
      if (playing) URL.revokeObjectURL(playing.url);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const removeMedia = useCallback(
    async (id: string) => {
      if (playing?.id === id) {
        URL.revokeObjectURL(playing.url);
        setPlaying(null);
      }
      await deleteMedia(id);
      await refresh();
    },
    [playing, refresh],
  );

  const removeNote = useCallback(
    async (note: OfflineNote) => {
      await deleteNote(note.kind, note.materialId);
      await refresh();
    },
    [refresh],
  );

  const classes = useMemo(() => (media ?? []).filter((row) => row.meta.kind === "recording"), [media]);
  const lessons = useMemo(() => (media ?? []).filter((row) => row.meta.kind === "video"), [media]);

  const usedPct = space.capBytes > 0 ? Math.min(100, Math.round((space.bytes / space.capBytes) * 100)) : 0;
  const empty = media !== null && media.length === 0 && notes.length === 0;

  return (
    <main className="min-h-screen bg-[var(--background)] px-5 py-8 text-[var(--foreground)]">
      <div className="mx-auto max-w-3xl space-y-6">
        <header className="flex items-center justify-between gap-3">
          <Link
            href="/materials"
            className="inline-flex items-center gap-2 text-sm font-medium text-[var(--muted)] transition hover:text-[var(--foreground)]"
          >
            <ArrowLeftIcon /> Library
          </Link>
          <BrandLogo variant="mark" className="h-8 w-8" />
        </header>

        <div>
          <p className="text-xs font-bold uppercase tracking-[0.24em] text-[var(--accent)]">Offline</p>
          <h1 className="mt-2 text-2xl font-bold">Your downloads</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Saved on this device. Plays with no connection. Class recordings clear themselves when their 2-week
            window ends — your notes never do.
          </p>
        </div>

        {cleared > 0 ? (
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-alt)] px-4 py-3 text-sm text-[var(--muted)]">
            {cleared === 1 ? "1 old class recording was" : `${cleared} old class recordings were`} cleared to save
            space. The notes are still here.
          </div>
        ) : null}

        {space.count > 0 ? (
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
            <div className="flex items-center justify-between text-xs font-medium text-[var(--muted)]">
              <span>
                {space.count} download{space.count === 1 ? "" : "s"} · {formatBytes(space.bytes)}
              </span>
              <span>{formatBytes(space.capBytes)} limit</span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--surface-alt)]">
              <div className="h-full bg-[var(--accent)]" style={{ width: `${Math.max(2, usedPct)}%` }} />
            </div>
          </div>
        ) : null}

        {playing ? (
          <div className="overflow-hidden rounded-3xl bg-black ring-1 ring-white/10">
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video src={playing.url} controls autoPlay className="aspect-video w-full" />
            <div className="flex items-center justify-between gap-3 bg-black/60 px-4 py-2 text-xs text-white">
              <span className="truncate">{playing.title}</span>
              <button
                type="button"
                onClick={() => {
                  URL.revokeObjectURL(playing.url);
                  setPlaying(null);
                }}
                className="shrink-0 rounded-full bg-white/15 px-3 py-1 font-semibold"
              >
                Close
              </button>
            </div>
          </div>
        ) : null}

        {media === null ? (
          <p className="text-sm text-[var(--muted)]">Loading your downloads…</p>
        ) : empty ? (
          <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-10 text-center">
            <p className="text-base font-semibold">Nothing downloaded yet</p>
            <p className="mt-2 text-sm text-[var(--muted)]">
              Open a class or a note in the app and tap <strong>Download</strong> — it will be here to watch or read
              with no signal.
            </p>
            <Link
              href="/materials"
              className="mt-5 inline-flex rounded-full bg-[var(--accent)] px-6 py-2.5 text-sm font-semibold text-white"
            >
              Go to the library
            </Link>
          </div>
        ) : (
          <div className="space-y-8">
            <Shelf title="Downloaded classes" rows={classes} onPlay={play} onRemoveMedia={removeMedia} />
            <Shelf title="Downloaded lessons" rows={lessons} onPlay={play} onRemoveMedia={removeMedia} />

            {notes.length > 0 ? (
              <section className="space-y-3">
                <h2 className="text-lg font-semibold">Notes</h2>
                <div className="space-y-2">
                  {notes.map((note) => (
                    <div
                      key={note.key}
                      className="flex items-start justify-between gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4"
                    >
                      <div className="min-w-0">
                        <p className="inline-flex items-center gap-1.5 font-semibold text-[var(--foreground)]">
                          <PencilIcon className="h-3.5 w-3.5 text-[var(--muted)]" />
                          {note.title}
                        </p>
                        <p className="mt-0.5 text-xs text-[var(--muted)]">
                          {note.kind === "class" ? "Class recap" : "Ready-made note"} · saved{" "}
                          {new Date(note.downloadedAt).toLocaleDateString()}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void removeNote(note)}
                        aria-label={`Remove ${note.title}`}
                        className="shrink-0 rounded-lg p-1.5 text-[var(--muted)] transition hover:text-[var(--foreground)]"
                      >
                        <TrashIcon className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-[var(--muted)]">
                  Notes render from the copy saved on this device — open one from the list above once you are back
                  online for the live version.
                </p>
              </section>
            ) : null}
          </div>
        )}
      </div>
    </main>
  );
}

function Shelf({
  title,
  rows,
  onPlay,
  onRemoveMedia,
}: {
  title: string;
  rows: OfflineMediaRow[];
  onPlay: (id: string, title: string) => void;
  onRemoveMedia: (id: string) => void;
}) {
  if (rows.length === 0) return null;
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="space-y-2">
        {rows.map((row) => {
          const expiry = expiryLabel(row.expiresAt);
          return (
            <div
              key={row.materialId}
              className="flex items-center justify-between gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3"
            >
              <button
                type="button"
                onClick={() => onPlay(row.materialId, row.meta.title)}
                className="flex min-w-0 flex-1 items-center gap-3 text-left"
              >
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[var(--accent)]/15 text-[var(--accent)]">
                  <PlayIcon className="h-5 w-5" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate font-medium text-[var(--foreground)]">{row.meta.title}</span>
                  <span className="block truncate text-xs text-[var(--muted)]">
                    {[
                      row.meta.level,
                      row.meta.durationSeconds ? formatDuration(row.meta.durationSeconds) : null,
                      formatBytes(row.sizeBytes),
                      expiry || null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => onRemoveMedia(row.materialId)}
                aria-label={`Remove ${row.meta.title}`}
                className="shrink-0 rounded-lg p-1.5 text-[var(--muted)] transition hover:text-[var(--foreground)]"
              >
                <TrashIcon className="h-4 w-4" />
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
