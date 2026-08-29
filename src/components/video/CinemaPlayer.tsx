"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import {
  CheckIcon,
  ExpandIcon,
  PauseIcon,
  PictureInPictureIcon,
  PlayIcon,
  SettingsIcon,
  ShrinkIcon,
  SkipBackIcon,
  SkipForwardIcon,
  SpeakerIcon,
  SpeakerOffIcon,
} from "@/components/icons";
import { formatClock } from "@/lib/video-library";

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;
const SKIP_SECONDS = 10;
const HIDE_DELAY_MS = 2600;

export type CinemaPlayerProps = {
  src: string;
  poster?: string | null;
  title: string;
  className?: string;
  onLoadedMetadata?: (element: HTMLVideoElement) => void;
  onTimeUpdate?: (element: HTMLVideoElement) => void;
  onPause?: (element: HTMLVideoElement) => void;
  onEnded?: (element: HTMLVideoElement) => void;
};

/**
 * A cinema-grade player for our own hosted video — class recordings and
 * uploaded lesson videos alike.
 *
 * Deliberately not the browser's native `<video controls>`: those differ
 * across Chrome, Safari and Firefox, cannot be themed, and read as a plain
 * file playing rather than a product. Everything here — play state, the
 * scrub bar, volume, speed, fullscreen, picture-in-picture — is real
 * `<video>` element state mirrored into React, not a skin bolted on top.
 *
 * A linked embed (YouTube, Vimeo…) is a different animal — the provider's
 * iframe has its own player and this component does not attempt to wrap it;
 * the watch page branches to a plain iframe for that case instead.
 */
const CinemaPlayer = forwardRef<HTMLVideoElement, CinemaPlayerProps>(function CinemaPlayer(
  { src, poster, title, className = "", onLoadedMetadata, onTimeUpdate, onPause, onEnded },
  forwardedRef,
) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrubbingRef = useRef(false);

  useImperativeHandle(forwardedRef, () => videoRef.current as HTMLVideoElement);

  const [playing, setPlaying] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [speed, setSpeed] = useState<number>(1);
  const [fullscreen, setFullscreen] = useState(false);
  const [cssFullscreen, setCssFullscreen] = useState(false);
  const [pipActive, setPipActive] = useState(false);
  const [pipSupported, setPipSupported] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [speedMenuOpen, setSpeedMenuOpen] = useState(false);
  const [hoverPercent, setHoverPercent] = useState<number | null>(null);

  useEffect(() => {
    setPipSupported(typeof document !== "undefined" && document.pictureInPictureEnabled);
  }, []);

  // Controls stay up while paused, while the speed menu is open, or while the
  // scrub bar is held — hiding chrome mid-drag would fight the viewer's thumb.
  const wake = useCallback(() => {
    setShowControls(true);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => {
      if (scrubbingRef.current) return;
      const el = videoRef.current;
      if (el && !el.paused) setShowControls(false);
    }, HIDE_DELAY_MS);
  }, []);

  useEffect(() => {
    wake();
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
    };
  }, [wake]);

  const togglePlay = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    if (el.ended) el.currentTime = 0;
    if (el.paused || el.ended) void el.play().catch(() => {});
    else el.pause();
  }, []);

  const seekBy = useCallback((deltaSeconds: number) => {
    const el = videoRef.current;
    if (!el) return;
    const max = Number.isFinite(el.duration) ? el.duration : el.currentTime + Math.abs(deltaSeconds);
    el.currentTime = Math.min(Math.max(0, el.currentTime + deltaSeconds), max);
  }, []);

  const handleVideoClick = useCallback(() => {
    if (clickTimerRef.current) return;
    clickTimerRef.current = setTimeout(() => {
      togglePlay();
      clickTimerRef.current = null;
    }, 220);
  }, [togglePlay]);

  const toggleFullscreen = useCallback(() => {
    const container = containerRef.current;
    const video = videoRef.current;
    if (!container) return;
    if (document.fullscreenElement === container) {
      void document.exitFullscreen().catch(() => {});
      return;
    }
    if (cssFullscreen) {
      setCssFullscreen(false);
      return;
    }

    if (typeof container.requestFullscreen === "function") {
      void container.requestFullscreen().catch(() => setCssFullscreen(true));
    } else if (video && typeof (video as HTMLVideoElement & { webkitEnterFullscreen?: () => void }).webkitEnterFullscreen === "function") {
      (video as HTMLVideoElement & { webkitEnterFullscreen: () => void }).webkitEnterFullscreen();
    } else {
      setCssFullscreen(true);
    }
  }, [cssFullscreen]);

  const handleVideoDoubleClick = useCallback(() => {
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
    toggleFullscreen();
  }, [toggleFullscreen]);

  const handleLoadedMetadata = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    setDuration(Number.isFinite(el.duration) ? el.duration : 0);
    setVolume(el.volume);
    setMuted(el.muted);
    onLoadedMetadata?.(el);
  }, [onLoadedMetadata]);

  const handleTimeUpdate = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    if (!scrubbingRef.current) setCurrent(el.currentTime);
    if (el.buffered.length > 0) setBuffered(el.buffered.end(el.buffered.length - 1));
    onTimeUpdate?.(el);
  }, [onTimeUpdate]);

  const handlePlay = useCallback(() => {
    setPlaying(true);
    wake();
  }, [wake]);

  const handlePauseEvent = useCallback(() => {
    setPlaying(false);
    setShowControls(true);
    if (videoRef.current) onPause?.(videoRef.current);
  }, [onPause]);

  const handleEnded = useCallback(() => {
    setPlaying(false);
    setShowControls(true);
    if (videoRef.current) onEnded?.(videoRef.current);
  }, [onEnded]);

  const toggleMute = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    el.muted = !el.muted;
    if (!el.muted && el.volume === 0) el.volume = 0.5;
    setMuted(el.muted);
    setVolume(el.volume);
  }, []);

  const handleVolumeChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const el = videoRef.current;
    if (!el) return;
    const value = Number(event.target.value);
    el.volume = value;
    el.muted = value === 0;
    setVolume(value);
    setMuted(value === 0);
  }, []);

  const applySpeed = useCallback((value: number) => {
    const el = videoRef.current;
    if (el) el.playbackRate = value;
    setSpeed(value);
    setSpeedMenuOpen(false);
  }, []);

  const handleScrubChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const value = Number(event.target.value);
    setCurrent(value);
    const el = videoRef.current;
    if (el) el.currentTime = value;
    wake();
  }, [wake]);

  const handleScrubPointerDown = useCallback(() => {
    scrubbingRef.current = true;
    wake();
  }, [wake]);

  const handleScrubPointerUp = useCallback(() => {
    scrubbingRef.current = false;
    wake();
  }, [wake]);

  const handleScrubHover = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setHoverPercent(Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)));
  }, []);

  useEffect(() => {
    const onFullscreenChange = () => {
      const isNative = document.fullscreenElement === containerRef.current;
      setFullscreen(isNative);
      if (isNative) setCssFullscreen(false);
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  useEffect(() => {
    if (!cssFullscreen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setCssFullscreen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [cssFullscreen]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    const onEnter = () => setPipActive(true);
    const onLeave = () => setPipActive(false);
    const onWaiting = () => setBuffering(true);
    const onReady = () => setBuffering(false);
    el.addEventListener("enterpictureinpicture", onEnter);
    el.addEventListener("leavepictureinpicture", onLeave);
    el.addEventListener("waiting", onWaiting);
    el.addEventListener("playing", onReady);
    el.addEventListener("canplay", onReady);
    return () => {
      el.removeEventListener("enterpictureinpicture", onEnter);
      el.removeEventListener("leavepictureinpicture", onLeave);
      el.removeEventListener("waiting", onWaiting);
      el.removeEventListener("playing", onReady);
      el.removeEventListener("canplay", onReady);
    };
  }, []);

  const togglePip = useCallback(async () => {
    const el = videoRef.current;
    if (!el) return;
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await el.requestPictureInPicture();
    } catch {
      // Refused mid-load, or without a fresh-enough user gesture — nothing
      // useful to surface for a feature this minor.
    }
  }, []);

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      const el = videoRef.current;
      switch (event.key) {
        case " ":
        case "k":
          event.preventDefault();
          togglePlay();
          wake();
          break;
        case "ArrowLeft":
          event.preventDefault();
          seekBy(-5);
          wake();
          break;
        case "ArrowRight":
          event.preventDefault();
          seekBy(5);
          wake();
          break;
        case "ArrowUp":
          event.preventDefault();
          if (el) {
            const next = Math.min(1, el.volume + 0.05);
            el.volume = next;
            el.muted = false;
            setVolume(next);
            setMuted(false);
          }
          wake();
          break;
        case "ArrowDown":
          event.preventDefault();
          if (el) {
            const next = Math.max(0, el.volume - 0.05);
            el.volume = next;
            setVolume(next);
            if (next === 0) setMuted(true);
          }
          wake();
          break;
        case "m":
          toggleMute();
          break;
        case "f":
          toggleFullscreen();
          break;
        default:
          break;
      }
    },
    [togglePlay, seekBy, toggleMute, toggleFullscreen, wake],
  );

  const playedPercent = duration > 0 ? (current / duration) * 100 : 0;
  const bufferedPercent = duration > 0 ? (buffered / duration) * 100 : 0;
  const chromeVisible = showControls || !playing;

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onMouseMove={wake}
      onMouseLeave={() => {
        if (videoRef.current && !videoRef.current.paused) setShowControls(false);
      }}
      className={`cine-player relative overflow-hidden bg-black outline-none ${cssFullscreen ? "cine-player-css-fullscreen" : ""} ${className}`}
    >
      <video
        ref={videoRef}
        src={src}
        poster={poster ?? undefined}
        playsInline
        preload="metadata"
        disableRemotePlayback
        onClick={handleVideoClick}
        onDoubleClick={handleVideoDoubleClick}
        onContextMenu={(event) => event.preventDefault()}
        onLoadedMetadata={handleLoadedMetadata}
        onTimeUpdate={handleTimeUpdate}
        onPlay={handlePlay}
        onPause={handlePauseEvent}
        onEnded={handleEnded}
        onVolumeChange={() => {
          const el = videoRef.current;
          if (el) {
            setVolume(el.volume);
            setMuted(el.muted);
          }
        }}
        className="aspect-video w-full cursor-pointer bg-black"
      />

      {buffering ? (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <div className="cine-spin h-12 w-12 rounded-full border-[3px] border-white/25 border-t-white" />
        </div>
      ) : null}

      {!playing ? (
        <button
          type="button"
          onClick={togglePlay}
          aria-label="Play"
          className="absolute left-1/2 top-1/2 grid h-16 w-16 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-black/55 text-white ring-1 ring-white/25 backdrop-blur-sm transition hover:scale-105 hover:bg-black/70"
        >
          <PlayIcon className="h-8 w-8 translate-x-0.5" strokeWidth={1.6} />
        </button>
      ) : null}

      {/* Title, top-left — fades with the rest of the chrome. */}
      <div
        className={`pointer-events-none absolute inset-x-0 top-0 bg-gradient-to-b from-black/70 to-transparent px-4 pb-8 pt-4 transition-opacity duration-300 sm:px-5 ${
          chromeVisible ? "opacity-100" : "opacity-0"
        }`}
      >
        <p className="truncate text-sm font-semibold text-white/90 sm:text-base">{title}</p>
      </div>

      <div
        className={`absolute inset-x-0 bottom-0 transition-opacity duration-300 ${
          chromeVisible ? "opacity-100" : "opacity-0"
        } ${chromeVisible ? "" : "pointer-events-none"}`}
      >
        <div className="bg-gradient-to-t from-black/90 via-black/50 to-transparent px-3 pb-2.5 pt-10 sm:px-4">
          {/* Scrub bar */}
          <div
            className="group/bar relative -mt-1 mb-1 flex h-[18px] items-center"
            onMouseMove={handleScrubHover}
            onMouseLeave={() => setHoverPercent(null)}
          >
            <div className="pointer-events-none absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 overflow-hidden rounded-full bg-white/20">
              <div className="h-full bg-white/35" style={{ width: `${bufferedPercent}%` }} />
            </div>
            <input
              type="range"
              min={0}
              max={duration || 0}
              step={0.01}
              value={Math.min(current, duration || current)}
              onChange={handleScrubChange}
              onPointerDown={handleScrubPointerDown}
              onPointerUp={handleScrubPointerUp}
              aria-label="Seek"
              aria-valuetext={`${formatClock(current)} of ${formatClock(duration)}`}
              className="cine-scrub relative z-10"
              style={{
                background: `linear-gradient(to right, var(--cine-blue) 0%, var(--cine-yellow) ${playedPercent}%, transparent ${playedPercent}%, transparent 100%)`,
              }}
            />
            {hoverPercent !== null && duration > 0 ? (
              <div
                className="pointer-events-none absolute -top-8 -translate-x-1/2 rounded bg-black/85 px-1.5 py-1 text-[11px] font-medium text-white"
                style={{ left: `${hoverPercent * 100}%` }}
              >
                {formatClock(hoverPercent * duration)}
              </div>
            ) : null}
          </div>

          {/* Buttons */}
          <div className="flex flex-wrap items-center gap-1 sm:gap-1.5">
            <button
              type="button"
              onClick={togglePlay}
              aria-label={playing ? "Pause" : "Play"}
              className="grid h-9 w-9 place-items-center rounded-lg text-white transition hover:bg-white/10"
            >
              {playing ? <PauseIcon className="h-5 w-5" /> : <PlayIcon className="h-5 w-5" />}
            </button>
            <button
              type="button"
              onClick={() => seekBy(-SKIP_SECONDS)}
              aria-label={`Back ${SKIP_SECONDS} seconds`}
              className="hidden h-9 w-9 place-items-center rounded-lg text-white transition hover:bg-white/10 sm:grid"
            >
              <SkipBackIcon className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={() => seekBy(SKIP_SECONDS)}
              aria-label={`Forward ${SKIP_SECONDS} seconds`}
              className="hidden h-9 w-9 place-items-center rounded-lg text-white transition hover:bg-white/10 sm:grid"
            >
              <SkipForwardIcon className="h-5 w-5" />
            </button>

            <div className="group/vol flex items-center gap-0">
              <button
                type="button"
                onClick={toggleMute}
                aria-label={muted || volume === 0 ? "Unmute" : "Mute"}
                className="grid h-9 w-9 place-items-center rounded-lg text-white transition hover:bg-white/10"
              >
                {muted || volume === 0 ? <SpeakerOffIcon className="h-5 w-5" /> : <SpeakerIcon className="h-5 w-5" />}
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={muted ? 0 : volume}
                onChange={handleVolumeChange}
                aria-label="Volume"
                className="cine-slider w-0 opacity-0 transition-all duration-200 group-hover/vol:w-16 group-hover/vol:opacity-100 group-focus-within/vol:w-16 group-focus-within/vol:opacity-100 sm:w-14 sm:opacity-100"
                style={{
                  background: `linear-gradient(to right, var(--cine-blue) 0%, var(--cine-yellow) ${(muted ? 0 : volume) * 100}%, rgba(255,255,255,0.25) ${(muted ? 0 : volume) * 100}%, rgba(255,255,255,0.25) 100%)`,
                }}
              />
            </div>

            <span className="ml-1 whitespace-nowrap text-xs font-medium tabular-nums text-slate-300">
              {formatClock(current)} / {formatClock(duration)}
            </span>

            <div className="ml-auto flex items-center gap-1">
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setSpeedMenuOpen((open) => !open)}
                  aria-label="Playback speed"
                  aria-expanded={speedMenuOpen}
                  className={`grid h-9 min-w-9 place-items-center gap-1 rounded-lg px-1.5 text-white transition hover:bg-white/10 ${
                    speed !== 1 ? "text-[#fde047]" : ""
                  }`}
                >
                  {speed === 1 ? <SettingsIcon className="h-5 w-5" /> : <span className="text-xs font-bold">{speed}×</span>}
                </button>
                {speedMenuOpen ? (
                  <div className="absolute bottom-11 right-0 z-20 w-32 overflow-hidden rounded-xl bg-black/90 py-1 text-sm text-white shadow-2xl ring-1 ring-white/10 backdrop-blur">
                    <p className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Speed</p>
                    {SPEEDS.map((option) => (
                      <button
                        key={option}
                        type="button"
                        onClick={() => applySpeed(option)}
                        className="flex w-full items-center justify-between px-3 py-1.5 text-left transition hover:bg-white/10"
                      >
                        {option}×
                        {option === speed ? <CheckIcon className="h-3.5 w-3.5 text-[#fde047]" /> : null}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>

              {pipSupported ? (
                <button
                  type="button"
                  onClick={togglePip}
                  aria-label={pipActive ? "Exit mini player" : "Mini player"}
                  className={`hidden h-9 w-9 place-items-center rounded-lg text-white transition hover:bg-white/10 sm:grid ${
                    pipActive ? "text-[#38bdf8]" : ""
                  }`}
                >
                  <PictureInPictureIcon className="h-5 w-5" />
                </button>
              ) : null}

              <button
                type="button"
                onClick={toggleFullscreen}
                aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen"}
                className="grid h-9 w-9 place-items-center rounded-lg text-white transition hover:bg-white/10"
              >
                {fullscreen ? <ShrinkIcon className="h-5 w-5" /> : <ExpandIcon className="h-5 w-5" />}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});

export default CinemaPlayer;
