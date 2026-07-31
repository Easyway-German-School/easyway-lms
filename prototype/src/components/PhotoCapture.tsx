"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Webcam from "react-webcam";

import { CameraIcon, CheckCircleIcon, CrossIcon, UploadIcon } from "@/components/icons";
import { validateImageFile } from "@/lib/upload";

/**
 * The signup photo: upload a file, or take one on the spot.
 *
 * The camera half is `react-webcam` rather than hand-written `getUserMedia`.
 * That is a deliberate build-versus-borrow call: the plumbing looks trivial
 * until you meet the real cases — a stream that must be torn down on unmount or
 * the phone's camera light stays on, iOS Safari needing `playsInline` or the
 * video goes fullscreen, permission states that differ across browsers,
 * front/back camera switching, devices that report a camera and then fail to
 * open it. `react-webcam` is the well-trodden open-source answer to exactly
 * that list, so the code here is only about the parts that are ours: the face
 * guide, the countdown, and handing a real `File` to the existing upload path.
 *
 * That last point matters. Capture produces a JPEG data URL; it is converted to
 * a `File` before it leaves this component, so `uploadImage()` and the signup
 * submit see no difference between a photo taken here and one picked off the
 * disk. There is exactly one upload path.
 *
 * The framing is borrowed from passport and authenticator flows on purpose —
 * an oval guide, a live ring, a countdown — because those are the visual cues
 * people already read as "this is an identity photo, sit up straight".
 */

const VIDEO_CONSTRAINTS: MediaTrackConstraints = {
  facingMode: "user",
  width: { ideal: 960 },
  height: { ideal: 960 },
};

type Mode = "choose" | "camera" | "upload";

function dataUrlToFile(dataUrl: string, filename: string): File | null {
  const [header, payload] = dataUrl.split(",");
  if (!payload) return null;
  const mime = /data:(.*?);/.exec(header)?.[1] ?? "image/jpeg";
  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], filename, { type: mime });
}

export default function PhotoCapture({
  onChange,
  disabled = false,
}: {
  /** Fires with the chosen photo, or null when it is cleared. */
  onChange: (file: File | null) => void;
  disabled?: boolean;
}) {
  const [mode, setMode] = useState<Mode>("choose");
  const [preview, setPreview] = useState<string | null>(null);
  const [previewName, setPreviewName] = useState<string>("");
  const [error, setError] = useState("");
  const [cameraReady, setCameraReady] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);

  const webcamRef = useRef<Webcam>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Object URLs from an uploaded file have to be released by hand, and the one
  // being released is never the one currently rendered — hence the ref.
  const objectUrlRef = useRef<string | null>(null);

  const releaseObjectUrl = useCallback(() => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  }, []);

  useEffect(() => releaseObjectUrl, [releaseObjectUrl]);

  const accept = useCallback(
    (file: File, previewUrl: string, isObjectUrl: boolean) => {
      releaseObjectUrl();
      if (isObjectUrl) objectUrlRef.current = previewUrl;
      setPreview(previewUrl);
      setPreviewName(file.name);
      setError("");
      onChange(file);
    },
    [onChange, releaseObjectUrl],
  );

  const capture = useCallback(() => {
    const shot = webcamRef.current?.getScreenshot();
    if (!shot) {
      setError("The camera did not return an image. Try once more.");
      return;
    }
    const file = dataUrlToFile(shot, `capture-${Date.now()}.jpg`);
    if (!file) {
      setError("That capture could not be saved. Try once more.");
      return;
    }
    accept(file, shot, false);
    setMode("choose");
  }, [accept]);

  // The countdown. A photo that fires the instant you tap the button catches
  // everyone mid-reach for the button.
  useEffect(() => {
    if (countdown === null) return;
    if (countdown === 0) {
      setCountdown(null);
      capture();
      return;
    }
    const timer = window.setTimeout(() => setCountdown((n) => (n === null ? null : n - 1)), 800);
    return () => window.clearTimeout(timer);
  }, [countdown, capture]);

  function handleFile(file: File | undefined) {
    if (!file) return;
    const problem = validateImageFile(file);
    if (problem) {
      setError(problem);
      return;
    }
    accept(file, URL.createObjectURL(file), true);
  }

  function clear() {
    releaseObjectUrl();
    setPreview(null);
    setPreviewName("");
    setCountdown(null);
    onChange(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function openCamera() {
    setError("");
    setCameraReady(false);
    setCountdown(null);
    setMode("camera");
  }

  // ---- The taken/chosen photo ------------------------------------------
  if (preview) {
    return (
      <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <div className="relative mx-auto h-32 w-32 shrink-0 overflow-hidden rounded-full ring-4 ring-[var(--accent)]/30 sm:mx-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview} alt="Your profile photo" className="h-full w-full object-cover" />
          </div>
          <div className="min-w-0 flex-1 text-center sm:text-left">
            <p className="inline-flex items-center gap-2 text-sm font-bold text-[var(--success)]">
              <CheckCircleIcon className="h-4 w-4" /> Photo ready
            </p>
            <p className="mt-1 truncate text-xs text-[var(--muted)]">{previewName}</p>
            <div className="mt-3 flex flex-wrap justify-center gap-2 sm:justify-start">
              <button
                type="button"
                onClick={() => {
                  clear();
                  openCamera();
                }}
                disabled={disabled}
                className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] px-4 py-2 text-xs font-bold text-[var(--foreground)] transition hover:border-[var(--accent)]/50 disabled:opacity-50"
              >
                <CameraIcon className="h-4 w-4" /> Retake
              </button>
              <button
                type="button"
                onClick={clear}
                disabled={disabled}
                className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] px-4 py-2 text-xs font-bold text-[var(--muted)] transition hover:text-[var(--foreground)] disabled:opacity-50"
              >
                <CrossIcon className="h-4 w-4" /> Remove
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ---- Live camera -------------------------------------------------------
  if (mode === "camera") {
    return (
      <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <div className="relative mx-auto aspect-square w-full max-w-sm overflow-hidden rounded-3xl bg-black">
          <Webcam
            ref={webcamRef}
            audio={false}
            mirrored
            screenshotFormat="image/jpeg"
            screenshotQuality={0.92}
            videoConstraints={VIDEO_CONSTRAINTS}
            onUserMedia={() => setCameraReady(true)}
            onUserMediaError={(mediaError) => {
              setCameraReady(false);
              const name = typeof mediaError === "string" ? mediaError : mediaError?.name;
              setError(
                name === "NotAllowedError"
                  ? "Camera permission was blocked. Allow it in your browser's address bar, or upload a photo instead."
                  : name === "NotFoundError"
                    ? "No camera was found on this device. Upload a photo instead."
                    : "The camera could not be opened. Upload a photo instead.",
              );
            }}
            className="h-full w-full object-cover"
          />

          {/* The face guide. Two ellipses and a sweeping ring — it tells people
              where to put their face without a paragraph asking them to. */}
          <div aria-hidden className="pointer-events-none absolute inset-0">
            <svg viewBox="0 0 200 200" className="h-full w-full">
              <defs>
                <mask id="ewcapture-mask">
                  <rect width="200" height="200" fill="white" />
                  <ellipse cx="100" cy="94" rx="52" ry="66" fill="black" />
                </mask>
              </defs>
              <rect width="200" height="200" fill="rgba(4,20,20,0.55)" mask="url(#ewcapture-mask)" />
              <ellipse
                cx="100"
                cy="94"
                rx="52"
                ry="66"
                fill="none"
                stroke={cameraReady ? "#FF8A33" : "rgba(255,255,255,0.35)"}
                strokeWidth="1.4"
                strokeDasharray="7 6"
                className={cameraReady ? "ew-guide-spin" : undefined}
                style={{ transformOrigin: "100px 94px" }}
              />
              <ellipse cx="100" cy="94" rx="45" ry="58" fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth="0.6" />
            </svg>
          </div>

          {countdown !== null && (
            <div className="absolute inset-0 grid place-items-center">
              <span
                key={countdown}
                className="ew-fade-up text-[5rem] font-black text-white drop-shadow-[0_4px_24px_rgba(0,0,0,0.6)]"
              >
                {countdown === 0 ? "" : countdown}
              </span>
            </div>
          )}

          {!cameraReady && !error && (
            <div className="absolute inset-x-0 bottom-4 text-center text-xs font-semibold text-white/80">
              Starting your camera…
            </div>
          )}
        </div>

        {error ? (
          <p className="mt-3 rounded-2xl bg-[var(--danger-soft)] px-4 py-3 text-center text-xs font-semibold text-[var(--danger)]">
            {error}
          </p>
        ) : (
          <p className="mt-3 text-center text-xs text-[var(--muted)]">
            Face the light, fill the oval, and look straight at the camera — this photo goes on your student record.
          </p>
        )}

        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <button
            type="button"
            onClick={() => setCountdown(3)}
            disabled={!cameraReady || countdown !== null || disabled}
            className="inline-flex items-center gap-2 rounded-full bg-[var(--accent)] px-6 py-3 text-sm font-bold text-white shadow-lg transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <CameraIcon className="h-4 w-4" />
            {countdown !== null ? "Hold still…" : "Take photo"}
          </button>
          <button
            type="button"
            onClick={() => {
              setCountdown(null);
              setMode("choose");
            }}
            className="rounded-full border border-[var(--border)] px-5 py-3 text-sm font-bold text-[var(--muted)] transition hover:text-[var(--foreground)]"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  // ---- Nothing chosen yet -------------------------------------------------
  return (
    <div className="rounded-3xl border border-dashed border-[var(--border-strong)] bg-[var(--surface-alt)] p-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <button
          type="button"
          onClick={openCamera}
          disabled={disabled}
          className="group flex items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 text-left transition hover:border-[var(--accent)]/50 hover:shadow-lg disabled:opacity-50"
        >
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-[var(--accent-soft)] text-[var(--accent)]">
            <CameraIcon className="h-5 w-5" />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-bold text-[var(--foreground)]">Take a photo now</span>
            <span className="block text-xs text-[var(--muted)]">Use your camera — nothing to find on your phone</span>
          </span>
        </button>

        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled}
          className="group flex items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 text-left transition hover:border-[var(--accent)]/50 hover:shadow-lg disabled:opacity-50"
        >
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-[var(--accent-soft)] text-[var(--accent)]">
            <UploadIcon className="h-5 w-5" />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-bold text-[var(--foreground)]">Upload a photo</span>
            <span className="block text-xs text-[var(--muted)]">JPG or PNG, up to 5MB</span>
          </span>
        </button>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={(event) => handleFile(event.target.files?.[0])}
      />

      {error ? (
        <p className="mt-3 rounded-2xl bg-[var(--danger-soft)] px-4 py-3 text-xs font-semibold text-[var(--danger)]">
          {error}
        </p>
      ) : (
        <p className="mt-3 text-xs text-[var(--muted)]">
          A photo is required — it identifies you on the register, in class and on your certificate.
        </p>
      )}
    </div>
  );
}
