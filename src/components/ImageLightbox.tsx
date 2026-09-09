"use client";

/* eslint-disable @next/next/no-img-element */

/**
 * ONE PLACE A PICTURE OPENS, EVERYWHERE IN THE APP.
 *
 * Before this, tapping a photo — a screenshot on the help desk, a picture in a
 * chat bubble, a student's dossier headshot — navigated the browser straight to
 * the raw `/api/files/…` URL. That is a dead end: the portal is gone, the back
 * button is the only way home, and on a phone it looks like the app crashed.
 *
 * `LightboxProvider` sits above every route (see app/providers.tsx) and owns a
 * single full-screen viewer that behaves the way people already expect a photo
 * to behave in a messaging app: dark backdrop, tap outside or press Esc to
 * close, swipe / arrow between the pictures that were opened together, pinch or
 * tap to zoom, and a download button. Nothing about it changes the page you
 * were on — close it and you are exactly where you left off.
 *
 * Callers use either `useLightbox().open(...)` directly or the `<ZoomableImage>`
 * drop-in, which is an ordinary `<img>` that opens itself on click.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { ChevronLeftIcon, ChevronRightIcon, CrossIcon, DownloadIcon, ExternalLinkIcon } from "@/components/icons";

export type LightboxItem = {
  src: string;
  alt?: string;
  /** Filename for the download button; falls back to the last path segment. */
  downloadName?: string;
  /** Shown under the image. */
  caption?: string;
};

type OpenInput = string | LightboxItem;

type LightboxApi = {
  /**
   * Open the viewer. Pass one image or a gallery; `startIndex` picks which of a
   * gallery to show first.
   */
  open: (input: OpenInput | OpenInput[], startIndex?: number) => void;
  close: () => void;
};

const LightboxContext = createContext<LightboxApi | null>(null);

function normalise(input: OpenInput): LightboxItem {
  return typeof input === "string" ? { src: input } : input;
}

function nameFromSrc(src: string): string {
  try {
    const path = new URL(src, "http://x").pathname;
    const last = path.split("/").filter(Boolean).pop();
    return last ? decodeURIComponent(last) : "image";
  } catch {
    return "image";
  }
}

/**
 * Always safe to call. Outside a `LightboxProvider` (should not happen inside
 * the portals, but SSR and stray trees exist) it degrades to opening the image
 * in a new tab rather than throwing.
 */
export function useLightbox(): LightboxApi {
  const ctx = useContext(LightboxContext);
  return useMemo<LightboxApi>(() => {
    if (ctx) return ctx;
    return {
      open: (input) => {
        const first = normalise(Array.isArray(input) ? input[0] : input);
        if (first?.src && typeof window !== "undefined") {
          window.open(first.src, "_blank", "noopener,noreferrer");
        }
      },
      close: () => {},
    };
  }, [ctx]);
}

export function LightboxProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<{ items: LightboxItem[]; index: number } | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const open = useCallback<LightboxApi["open"]>((input, startIndex = 0) => {
    const items = (Array.isArray(input) ? input : [input])
      .map(normalise)
      .filter((item) => Boolean(item?.src));
    if (items.length === 0) return;
    const index = Math.min(Math.max(startIndex, 0), items.length - 1);
    setState({ items, index });
  }, []);

  const close = useCallback(() => setState(null), []);

  const api = useMemo<LightboxApi>(() => ({ open, close }), [open, close]);

  return (
    <LightboxContext.Provider value={api}>
      {children}
      {mounted && state
        ? createPortal(
            <LightboxOverlay
              items={state.items}
              index={state.index}
              onIndex={(next) => setState((prev) => (prev ? { ...prev, index: next } : prev))}
              onClose={close}
            />,
            document.body,
          )
        : null}
    </LightboxContext.Provider>
  );
}

function LightboxOverlay({
  items,
  index,
  onIndex,
  onClose,
}: {
  items: LightboxItem[];
  index: number;
  onIndex: (next: number) => void;
  onClose: () => void;
}) {
  const item = items[index];
  const hasGallery = items.length > 1;
  const [zoomed, setZoomed] = useState(false);
  const [failed, setFailed] = useState(false);
  const touchStartX = useRef<number | null>(null);

  const go = useCallback(
    (delta: number) => {
      setZoomed(false);
      setFailed(false);
      onIndex((index + delta + items.length) % items.length);
    },
    [index, items.length, onIndex],
  );

  // Reset the transient per-image state whenever the image itself changes.
  useEffect(() => {
    setZoomed(false);
    setFailed(false);
  }, [item?.src]);

  // Keyboard: Esc closes, arrows page a gallery. Bound to the document because
  // the overlay is not a focus trap — a keystroke should work the instant it
  // is on screen without the user tabbing into it first.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
      else if (event.key === "ArrowLeft" && hasGallery) go(-1);
      else if (event.key === "ArrowRight" && hasGallery) go(1);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [go, hasGallery, onClose]);

  // Hold the page still behind the overlay.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  if (!item) return null;

  const downloadName = item.downloadName || nameFromSrc(item.src);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.16 }}
      className="fixed inset-0 z-[200] flex flex-col bg-black/90 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={item.alt || "Image viewer"}
    >
      {/* Top bar — filename / counter on the left, actions on the right. */}
      <div
        className="flex items-center justify-between gap-3 px-4 py-3 text-white"
        onClick={(event) => event.stopPropagation()}
      >
        <p className="min-w-0 truncate text-sm font-medium text-white/80">
          {hasGallery ? `${index + 1} / ${items.length}` : ""}
          {hasGallery && (item.caption || item.alt) ? " · " : ""}
          {item.caption || item.alt || (!hasGallery ? downloadName : "")}
        </p>
        <div className="flex shrink-0 items-center gap-1.5">
          <a
            href={item.src}
            download={downloadName}
            className="rounded-full bg-white/10 p-2 text-white transition hover:bg-white/20"
            aria-label="Download image"
            title="Download"
          >
            <DownloadIcon className="h-5 w-5" />
          </a>
          <a
            href={item.src}
            target="_blank"
            rel="noreferrer"
            className="rounded-full bg-white/10 p-2 text-white transition hover:bg-white/20"
            aria-label="Open image in a new tab"
            title="Open original"
          >
            <ExternalLinkIcon className="h-5 w-5" />
          </a>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-white/10 p-2 text-white transition hover:bg-white/20"
            aria-label="Close"
            title="Close (Esc)"
          >
            <CrossIcon className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* Image stage. */}
      <div
        className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden px-4 pb-6"
        onClick={onClose}
        onTouchStart={(event) => {
          touchStartX.current = event.touches[0]?.clientX ?? null;
        }}
        onTouchEnd={(event) => {
          if (touchStartX.current == null || !hasGallery || zoomed) return;
          const delta = (event.changedTouches[0]?.clientX ?? 0) - touchStartX.current;
          if (Math.abs(delta) > 60) go(delta < 0 ? 1 : -1);
          touchStartX.current = null;
        }}
      >
        {hasGallery ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              go(-1);
            }}
            className="absolute left-2 top-1/2 z-10 -translate-y-1/2 rounded-full bg-white/10 p-2.5 text-white transition hover:bg-white/25 sm:left-4"
            aria-label="Previous image"
          >
            <ChevronLeftIcon className="h-6 w-6" />
          </button>
        ) : null}

        {failed ? (
          <div className="rounded-2xl bg-white/5 px-6 py-8 text-center text-sm text-white/70">
            <p>That image could not be loaded.</p>
            <a href={item.src} target="_blank" rel="noreferrer" className="mt-2 inline-block font-semibold text-white underline">
              Open it directly
            </a>
          </div>
        ) : (
          <motion.img
            key={item.src}
            src={item.src}
            alt={item.alt || ""}
            onError={() => setFailed(true)}
            onClick={(event) => {
              event.stopPropagation();
              setZoomed((value) => !value);
            }}
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.16 }}
            className={`max-h-full max-w-full select-none rounded-lg object-contain shadow-2xl transition-transform duration-200 ${
              zoomed ? "scale-[1.8] cursor-zoom-out" : "cursor-zoom-in"
            }`}
            style={{ touchAction: "pinch-zoom" }}
            draggable={false}
          />
        )}

        {hasGallery ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              go(1);
            }}
            className="absolute right-2 top-1/2 z-10 -translate-y-1/2 rounded-full bg-white/10 p-2.5 text-white transition hover:bg-white/25 sm:right-4"
            aria-label="Next image"
          >
            <ChevronRightIcon className="h-6 w-6" />
          </button>
        ) : null}
      </div>

      {/* Gallery filmstrip. */}
      {hasGallery ? (
        <div
          className="flex shrink-0 items-center justify-center gap-2 overflow-x-auto px-4 pb-4"
          onClick={(event) => event.stopPropagation()}
        >
          {items.map((thumb, thumbIndex) => (
            <button
              key={`${thumb.src}-${thumbIndex}`}
              type="button"
              onClick={() => {
                setZoomed(false);
                setFailed(false);
                onIndex(thumbIndex);
              }}
              className={`h-14 w-14 shrink-0 overflow-hidden rounded-lg border-2 transition ${
                thumbIndex === index ? "border-white" : "border-transparent opacity-60 hover:opacity-100"
              }`}
              aria-label={`Show image ${thumbIndex + 1}`}
              aria-current={thumbIndex === index}
            >
              <img src={thumb.src} alt="" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      ) : null}
    </motion.div>
  );
}

/**
 * A drop-in `<img>` that opens itself in the lightbox on click. Pass a
 * `gallery` (and this image's `galleryIndex`) to make the arrows page through a
 * set — a message with several screenshots, say.
 */
export function ZoomableImage({
  src,
  alt,
  downloadName,
  caption,
  gallery,
  galleryIndex,
  className,
  onClick,
  ...rest
}: React.ImgHTMLAttributes<HTMLImageElement> & {
  src: string;
  downloadName?: string;
  caption?: string;
  gallery?: LightboxItem[];
  galleryIndex?: number;
}) {
  const { open } = useLightbox();
  return (
    <img
      src={src}
      alt={alt || ""}
      className={`cursor-zoom-in ${className || ""}`}
      onClick={(event) => {
        event.preventDefault();
        // Chat bubbles and cards often have their own click handlers behind the
        // picture — opening the viewer must not also trigger those.
        event.stopPropagation();
        onClick?.(event);
        if (gallery && gallery.length > 0) open(gallery, galleryIndex ?? 0);
        else open({ src, alt: typeof alt === "string" ? alt : undefined, downloadName, caption });
      }}
      {...rest}
    />
  );
}
