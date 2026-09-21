"use client";

/* eslint-disable @next/next/no-img-element */

/**
 * YOUR MATERIALS, WITHOUT LEAVING THE LESSON.
 *
 * A tutor says "open the worksheet from Tuesday" and, until now, the only way to
 * do that was to leave the call — the class kept running in a corner tile, but
 * the student was reading in a different tab with half their attention on
 * whether they had been dropped.
 *
 * This panel puts the student's own material shelf inside the classroom. It
 * opens beside the video (a sheet on the right on a laptop, full screen on a
 * phone); pictures open in the shared image viewer, PDFs / recordings / audio
 * open in a reader that sits over the call with the class still visible and
 * audible behind it. It is entirely local to one person — nothing here is sent
 * to the room, so what you open is yours alone. Close it and you are back in
 * the lesson exactly where you were.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { currentInstallEnv } from "@/lib/client/platform";
import { motion } from "framer-motion";
import {
  AudioIcon,
  BroadcastIcon,
  CrossIcon,
  DocumentIcon,
  DownloadIcon,
  ExternalLinkIcon,
  FilmIcon,
  ImageIcon,
  PackageIcon,
  SearchIcon,
} from "@/components/icons";
import { useLightbox } from "@/components/ImageLightbox";
import { parseAudioLink, parseEmbed } from "@/lib/media-embed";
import type { RoomRole } from "@/lib/live-classroom";
import type { PresentedMaterial } from "@/lib/live-room-protocol";

type RawMaterial = Record<string, unknown>;

export type Kind = "image" | "pdf" | "video" | "audio" | "embed-video" | "embed-audio" | "doc";

export type Material = {
  id: string;
  title: string;
  description: string | null;
  url: string;
  type: string;
  kind: Kind;
  course: string | null;
};

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|bmp|heic|heif|svg)(\?|#|$)/i;
const VIDEO_EXT = /\.(mp4|webm|ogv|mov|m4v)(\?|#|$)/i;
const AUDIO_EXT = /\.(mp3|m4a|aac|wav|ogg|oga|opus|flac|weba)(\?|#|$)/i;

function str(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function classify(type: string, url: string): Kind {
  const t = type.toLowerCase();
  if (t === "video/embed") return "embed-video";
  if (t === "audio/embed") return "embed-audio";
  if (t.startsWith("image/") || IMAGE_EXT.test(url)) return "image";
  if (t.includes("pdf") || /\.pdf(\?|#|$)/i.test(url)) return "pdf";
  if (t.startsWith("video/") || t === "video" || VIDEO_EXT.test(url)) return "video";
  if (t.startsWith("audio/") || t === "audio" || AUDIO_EXT.test(url)) return "audio";
  // A pasted link with no usable type — treat a known video/audio host as embed.
  if (/^https?:/i.test(url)) {
    if (parseEmbed(url)) return "embed-video";
    if (parseAudioLink(url)) return "embed-audio";
  }
  return "doc";
}

function normalise(raw: RawMaterial): Material | null {
  const id = str(raw.id);
  const url = str(raw.fileUrl) || str(raw.filePath) || str(raw.url);
  if (!id || !url) return null;
  const resolvedUrl = /^(https?:|blob:|data:)/i.test(url) || url.startsWith("/") ? url : `/${url}`;
  const type = str(raw.fileType) || str(raw.mimeType);
  const kindHint = str(raw.kind);
  let kind = classify(type, resolvedUrl);
  if (kind === "doc" && kindHint === "video") kind = "video";
  if (kind === "doc" && kindHint === "audio") kind = "audio";
  const courseRel = raw.course as { title?: unknown } | null | undefined;
  return {
    id,
    title: str(raw.title) || "Untitled",
    description: str(raw.description) || null,
    url: resolvedUrl,
    type,
    kind,
    course: str(raw.courseName) || (courseRel && str(courseRel.title)) || null,
  };
}

const KIND_META: Record<Kind, { label: string; Icon: typeof DocumentIcon }> = {
  image: { label: "Image", Icon: ImageIcon },
  pdf: { label: "PDF", Icon: DocumentIcon },
  video: { label: "Video", Icon: FilmIcon },
  audio: { label: "Audio", Icon: AudioIcon },
  "embed-video": { label: "Video", Icon: FilmIcon },
  "embed-audio": { label: "Audio", Icon: AudioIcon },
  doc: { label: "File", Icon: PackageIcon },
};

export default function LiveMaterialsPanel({
  role,
  presented,
  onPresent,
}: {
  role: RoomRole;
  /** What's currently pushed to the whole class, or null. Tutor's own state. */
  presented: PresentedMaterial;
  /** Tutor only — pass null to stop presenting. */
  onPresent: (material: PresentedMaterial) => void;
}) {
  const { open: openImage } = useLightbox();
  const [materials, setMaterials] = useState<Material[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [reader, setReader] = useState<Material | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const endpoint = role === "tutor" ? "/api/lecturer/materials" : "/api/student/materials";
        const res = await fetch(endpoint, { cache: "no-store" });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (res.status === 401) {
          setError("Sign in to see your materials.");
          return;
        }
        if (res.status === 403) {
          setError(str(data.message) || "Your materials unlock once your deposit is in.");
          return;
        }
        if (!res.ok) {
          setError(str(data.error) || "Could not load your materials.");
          return;
        }
        const list = Array.isArray(data.materials) ? (data.materials as RawMaterial[]) : [];
        setMaterials(list.map(normalise).filter((m): m is Material => m !== null));
      } catch {
        if (!cancelled) setError("Could not reach your materials.");
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [role]);

  const filtered = useMemo(() => {
    const list = materials ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (m) =>
        m.title.toLowerCase().includes(q) ||
        (m.course ?? "").toLowerCase().includes(q) ||
        (m.description ?? "").toLowerCase().includes(q),
    );
  }, [materials, query]);

  function onOpen(material: Material) {
    if (material.kind === "image") {
      openImage({ src: material.url, alt: material.title, caption: material.course ?? undefined });
      return;
    }
    setReader(material);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-2 flex items-center gap-2 rounded-xl bg-white/5 px-3 py-2">
        <SearchIcon className="h-4 w-4 shrink-0 text-slate-400" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search your materials"
          className="min-w-0 flex-1 bg-transparent text-sm text-white placeholder:text-slate-500 focus:outline-none"
        />
      </div>
      <p className="mb-2 px-1 text-[11px] text-slate-500">
        {role === "tutor"
          ? "Only you see what you open — the broadcast icon shows one to the whole class instead."
          : "Only you can see what you open here."}
      </p>

      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-0.5">
        {error ? (
          <p className="rounded-xl bg-white/5 px-3 py-4 text-sm text-slate-300">{error}</p>
        ) : materials === null ? (
          <p className="px-1 py-4 text-sm text-slate-500">Loading…</p>
        ) : filtered.length === 0 ? (
          <p className="rounded-xl bg-white/5 px-3 py-4 text-sm text-slate-400">
            {materials.length === 0
              ? "No materials at your level yet. Your tutor's uploads will show up here."
              : "Nothing matches that search."}
          </p>
        ) : (
          filtered.map((material) => {
            const { label, Icon } = KIND_META[material.kind];
            const isPresenting = presented?.id === material.id;
            return (
              <div
                key={material.id}
                className={`flex items-start gap-1.5 rounded-xl px-1.5 py-1.5 transition ${
                  isPresenting ? "bg-[var(--accent)]/20" : "bg-white/5 hover:bg-white/10"
                }`}
              >
                <button
                  type="button"
                  onClick={() => onOpen(material)}
                  className="flex min-w-0 flex-1 items-start gap-3 rounded-lg px-1.5 py-1 text-left"
                >
                  <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white/10 text-slate-200">
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-white">{material.title}</span>
                    <span className="mt-0.5 block truncate text-[11px] text-slate-400">
                      {isPresenting ? "Presenting to the class" : label}
                      {material.course ? ` · ${material.course}` : ""}
                    </span>
                  </span>
                </button>
                {role === "tutor" ? (
                  <button
                    type="button"
                    onClick={() =>
                      onPresent(
                        isPresenting
                          ? null
                          : { id: material.id, title: material.title, kind: material.kind, url: material.url, course: material.course },
                      )
                    }
                    title={isPresenting ? "Stop presenting to the class" : "Present to the class"}
                    aria-label={isPresenting ? "Stop presenting to the class" : "Present to the class"}
                    className={`mt-0.5 shrink-0 rounded-lg p-2 transition ${
                      isPresenting
                        ? "bg-[var(--accent)] text-white hover:brightness-110"
                        : "text-slate-400 hover:bg-white/15 hover:text-white"
                    }`}
                  >
                    <BroadcastIcon className="h-4 w-4" />
                  </button>
                ) : null}
              </div>
            );
          })
        )}
      </div>

      {reader ? <MaterialReader material={reader} onClose={() => setReader(null)} /> : null}
    </div>
  );
}

function MaterialReader({ material, onClose }: { material: Material; onClose: () => void }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!mounted) return null;

  const overlay = (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      className="fixed inset-0 z-[120] flex"
    >
      {/* The class stays visible and audible through this side; a tap here closes. */}
      <button
        type="button"
        onClick={onClose}
        aria-label="Back to the class"
        className="hidden flex-1 cursor-default bg-black/30 sm:block"
      />
      <motion.div
        initial={{ x: "100%" }}
        animate={{ x: 0 }}
        exit={{ x: "100%" }}
        transition={{ type: "spring", stiffness: 320, damping: 34 }}
        className="flex h-full w-full flex-col bg-slate-950 text-white shadow-2xl sm:max-w-3xl"
      >
        <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{material.title}</p>
            {material.course ? <p className="truncate text-[11px] text-slate-400">{material.course}</p> : null}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <a
              href={material.url}
              target="_blank"
              rel="noreferrer"
              className="rounded-full bg-white/10 p-2 text-white transition hover:bg-white/20"
              title="Open in a new tab"
              aria-label="Open in a new tab"
            >
              <ExternalLinkIcon className="h-4 w-4" />
            </a>
            {material.kind !== "embed-video" && material.kind !== "embed-audio" ? (
              <a
                href={material.url}
                download
                className="rounded-full bg-white/10 p-2 text-white transition hover:bg-white/20"
                title="Download"
                aria-label="Download"
              >
                <DownloadIcon className="h-4 w-4" />
              </a>
            ) : null}
            <button
              type="button"
              onClick={onClose}
              className="rounded-full bg-white/10 p-2 text-white transition hover:bg-white/20"
              title="Close (Esc)"
              aria-label="Close"
            >
              <CrossIcon className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 bg-black">
          <ReaderBody material={material} />
        </div>
      </motion.div>
    </motion.div>
  );

  return createPortal(overlay, document.body);
}

/**
 * A PDF inside the class.
 *
 * On iPhone, Safari draws a PDF in an iframe as a single still page: page one
 * shows, the rest cannot be scrolled to, and nothing says so — a student sees
 * "the slides stopped at page 1". Everywhere else the iframe is a real scrolling
 * viewer, so it stays as it was. On iOS the same iframe is kept (page one is
 * still useful and shows instantly) with a clear bar underneath that opens the
 * whole file in Safari's own PDF viewer, in a new tab, so the class keeps
 * running behind it. The header already has an "open in a new tab" icon, but an
 * unlabelled icon is not something a student finds in the middle of a lesson.
 */
function PdfBody({ material }: { material: Material }) {
  // Read once on the client. This component only mounts after a tap, never during
  // server render, so there is no hydration mismatch to guard against.
  const isIos = useMemo(() => currentInstallEnv().ios, []);
  return (
    <div className="flex h-full w-full flex-col">
      <iframe src={`${material.url}#view=FitH`} title={material.title} className="min-h-0 w-full flex-1 border-0 bg-white" />
      {isIos ? (
        <a
          href={material.url}
          target="_blank"
          rel="noreferrer"
          className="flex shrink-0 items-center justify-center gap-2 bg-[var(--accent)] px-4 py-3 text-sm font-bold text-white"
        >
          <ExternalLinkIcon className="h-4 w-4" />
          Only page 1 shows here. Tap to open the full PDF
        </a>
      ) : null}
    </div>
  );
}

function ReaderBody({ material }: { material: Material }) {
  if (material.kind === "pdf") {
    return <PdfBody material={material} />;
  }
  if (material.kind === "video") {
    return (
      <video src={material.url} controls autoPlay playsInline className="h-full w-full bg-black">
        <track kind="captions" />
      </video>
    );
  }
  if (material.kind === "embed-video") {
    const parsed = parseEmbed(material.url);
    if (parsed) {
      return (
        <iframe
          src={parsed.embedUrl}
          title={material.title}
          className="h-full w-full border-0"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      );
    }
  }
  if (material.kind === "audio") {
    return (
      <div className="grid h-full place-items-center p-6">
        <audio src={material.url} controls autoPlay className="w-full max-w-md" />
      </div>
    );
  }
  if (material.kind === "embed-audio") {
    const parsed = parseAudioLink(material.url);
    if (parsed) {
      return (
        <div className="grid h-full place-items-center p-6">
          <iframe src={parsed.embedUrl} title={material.title} className="h-40 w-full max-w-lg border-0" allow="autoplay" />
        </div>
      );
    }
  }
  // Word / slides / spreadsheets and anything else the browser will not render.
  return (
    <div className="grid h-full place-items-center p-8 text-center">
      <div className="max-w-xs space-y-3 text-slate-300">
        <PackageIcon className="mx-auto h-10 w-10 text-slate-500" />
        <p className="text-sm">This file opens in your device's own viewer.</p>
        <a
          href={material.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-900"
        >
          <ExternalLinkIcon className="h-4 w-4" /> Open the file
        </a>
        <p className="text-[11px] text-slate-500">Your class keeps running while it is open.</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

/**
 * WHAT REPLACES SCREEN-SHARING A TEXTBOOK PAGE.
 *
 * Rendered unconditionally in the class, not inside the Materials tab — a
 * presented material has to reach a student who is looking at Chat or Hands
 * or nothing at all, the same way a shared screen would. It opens itself the
 * instant `presented` changes to a new item (no click required, because the
 * whole point is to stand in for a screen share that also just appears), and
 * stays reachable afterward through this banner in case someone closes it.
 *
 * Images skip the reader and go straight to the shared lightbox — it already
 * has zoom, download and a proper close, and duplicating that here would be
 * a worse version of it.
 */
export function PresentedMaterialBanner({
  presented,
  role,
  onStopPresenting,
}: {
  presented: PresentedMaterial;
  role: RoomRole;
  onStopPresenting: () => void;
}) {
  const { open: openImage } = useLightbox();
  const [readerOpen, setReaderOpen] = useState(false);
  const autoOpenedIdRef = useRef<string | null>(null);

  const material: Material | null = presented
    ? {
        id: presented.id,
        title: presented.title,
        description: null,
        url: presented.url,
        type: "",
        kind: presented.kind as Kind,
        course: presented.course,
      }
    : null;

  function view(target: Material) {
    if (target.kind === "image") {
      openImage({ src: target.url, alt: target.title, caption: target.course ?? undefined });
    } else {
      setReaderOpen(true);
    }
  }

  useEffect(() => {
    if (!material || autoOpenedIdRef.current === material.id) return;
    autoOpenedIdRef.current = material.id;
    view(material);
    // `view` closes over state setters only — safe to omit, and including it
    // would re-run this on every render since it is a new function each time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [material?.id]);

  useEffect(() => {
    if (!presented) setReaderOpen(false);
  }, [presented]);

  if (!material) return null;

  return (
    <>
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-[var(--accent)]/40 bg-[var(--accent)]/15 px-5 py-3 text-sm text-white">
        <BroadcastIcon className="h-5 w-5 shrink-0" />
        <p className="min-w-0 flex-1 truncate leading-6">
          {role === "tutor" ? "You are showing the class " : "Your tutor is showing "}
          <span className="font-semibold">{material.title}</span>
        </p>
        <button
          type="button"
          onClick={() => view(material)}
          className="shrink-0 rounded-xl bg-white/10 px-3 py-2 text-xs font-semibold text-white transition hover:bg-white/20"
        >
          View
        </button>
        {role === "tutor" ? (
          <button
            type="button"
            onClick={onStopPresenting}
            className="shrink-0 rounded-xl bg-white px-3 py-2 text-xs font-semibold text-[var(--accent)] transition hover:brightness-95"
          >
            Stop presenting
          </button>
        ) : null}
      </div>

      {readerOpen && material.kind !== "image" ? (
        <MaterialReader material={material} onClose={() => setReaderOpen(false)} />
      ) : null}
    </>
  );
}
