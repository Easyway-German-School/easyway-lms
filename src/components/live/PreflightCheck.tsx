"use client";

/**
 * Find out the camera is blank BEFORE the lesson, not during it.
 *
 * ---------------------------------------------------------------------------
 * WHY
 * ---------------------------------------------------------------------------
 * A student whose camera fails mid-class has three bad options: interrupt the
 * tutor, leave and rejoin, or sit there dark for ninety minutes. Almost all of
 * them pick the third, and the school never finds out — the class "went fine".
 *
 * Moving the same failure thirty seconds earlier changes everything about it.
 * In the lobby there is nobody to interrupt, there is time to read an
 * instruction, and there is a button to try again.
 *
 * ---------------------------------------------------------------------------
 * WHY THERE IS A LEVEL METER
 * ---------------------------------------------------------------------------
 * Permission granted is not the same as working. A muted headset, a mic
 * disabled in Windows settings, the wrong input selected — all of these grant
 * permission happily and produce silence. The bar moving is the only proof
 * that sound is actually arriving, and it is the one check students perform
 * without being asked, because a bar that does not move is obvious.
 *
 * ---------------------------------------------------------------------------
 * WHY THE STREAM IS STOPPED BEFORE JOINING
 * ---------------------------------------------------------------------------
 * Some Windows camera drivers allow exactly one consumer. Leaving the preview
 * running would hand LiveKit a device that is already busy — turning a working
 * camera into "NotReadableError" at the worst possible moment. So the preview
 * releases everything the instant it is finished with.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertIcon, CameraIcon, CheckCircleIcon, MicIcon, RefreshIcon } from "@/components/icons";
import { mediaErrorMessage } from "./media-errors";

type DeviceState = "checking" | "ok" | "failed";

export type PreflightResult = { camera: DeviceState; microphone: DeviceState };

export default function PreflightCheck({
  wantsVideo,
  onResult,
}: {
  /** Audio-only students are never asked for a camera, so it is never checked. */
  wantsVideo: boolean;
  onResult?: (result: PreflightResult) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);

  const [camera, setCamera] = useState<DeviceState>(wantsVideo ? "checking" : "ok");
  const [microphone, setMicrophone] = useState<DeviceState>("checking");
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [micError, setMicError] = useState<string | null>(null);
  const [level, setLevel] = useState(0);
  const [attempt, setAttempt] = useState(0);

  /** Release every device and timer this component grabbed. */
  const teardown = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      teardown();
      setLevel(0);
      setCameraError(null);
      setMicError(null);
      setMicrophone("checking");
      if (wantsVideo) setCamera("checking");

      /**
       * Asked for separately, on purpose. A single combined request fails
       * whole when either device is missing, so a student with no webcam would
       * be told their microphone failed too — and would go looking in exactly
       * the wrong place.
       */
      let micStream: MediaStream | null = null;
      try {
        micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (cancelled) {
          micStream.getTracks().forEach((t) => t.stop());
          return;
        }
        setMicrophone("ok");
      } catch (error) {
        if (cancelled) return;
        setMicrophone("failed");
        setMicError(mediaErrorMessage(error, "microphone"));
      }

      let camStream: MediaStream | null = null;
      if (wantsVideo) {
        try {
          camStream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 360 } });
          if (cancelled) {
            camStream.getTracks().forEach((t) => t.stop());
            micStream?.getTracks().forEach((t) => t.stop());
            return;
          }
          setCamera("ok");
        } catch (error) {
          if (cancelled) return;
          setCamera("failed");
          setCameraError(mediaErrorMessage(error, "camera"));
        }
      }

      const combined = new MediaStream([
        ...(micStream?.getAudioTracks() ?? []),
        ...(camStream?.getVideoTracks() ?? []),
      ]);
      streamRef.current = combined;

      if (videoRef.current && camStream) {
        videoRef.current.srcObject = combined;
        videoRef.current.play().catch(() => {});
      }

      // The level meter. Cheap, and the only honest proof the mic works.
      if (micStream && micStream.getAudioTracks().length > 0) {
        try {
          const context = new AudioContext();
          audioContextRef.current = context;
          const analyser = context.createAnalyser();
          analyser.fftSize = 512;
          context.createMediaStreamSource(micStream).connect(analyser);
          const data = new Uint8Array(analyser.frequencyBinCount);

          const tick = () => {
            analyser.getByteTimeDomainData(data);
            // Peak deviation from silence (128), scaled to something visible.
            let peak = 0;
            for (const sample of data) peak = Math.max(peak, Math.abs(sample - 128));
            setLevel(Math.min(100, (peak / 128) * 260));
            rafRef.current = requestAnimationFrame(tick);
          };
          tick();
        } catch {
          // No meter is survivable; the tick above is a nicety, not the check.
        }
      }
    }

    run();
    return () => {
      cancelled = true;
      teardown();
    };
  }, [wantsVideo, attempt, teardown]);

  useEffect(() => {
    onResult?.({ camera, microphone });
  }, [camera, microphone, onResult]);

  const allGood = microphone === "ok" && (!wantsVideo || camera === "ok");

  return (
    <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Check your camera and microphone</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Thirty seconds here saves finding out mid-lesson.
          </p>
        </div>
        <button
          onClick={() => setAttempt((n) => n + 1)}
          className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] px-4 py-2 text-sm font-semibold text-[var(--foreground)] transition hover:bg-[var(--surface-alt)]"
        >
          <RefreshIcon className="h-4 w-4" />
          Try again
        </button>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <div className="relative aspect-video overflow-hidden rounded-2xl bg-slate-900">
          <video ref={videoRef} autoPlay playsInline muted className="h-full w-full scale-x-[-1] object-cover" />
          {camera !== "ok" || !wantsVideo ? (
            <div className="absolute inset-0 grid place-items-center bg-slate-900 text-center text-xs text-slate-400">
              {!wantsVideo
                ? "Audio-only — no camera needed"
                : camera === "checking"
                  ? "Asking for your camera…"
                  : "No picture"}
            </div>
          ) : null}
        </div>

        <div className="space-y-3">
          <Row
            icon={<CameraIcon className="h-4 w-4" />}
            label="Camera"
            state={wantsVideo ? camera : "ok"}
            detail={!wantsVideo ? "Not needed in audio-only" : undefined}
          />
          <Row icon={<MicIcon className="h-4 w-4" />} label="Microphone" state={microphone} />

          <div>
            <p className="mb-1.5 text-xs font-medium text-[var(--muted)]">
              {microphone === "ok" ? "Say something — the bar should move" : "Waiting for your microphone"}
            </p>
            <div className="h-2.5 overflow-hidden rounded-full bg-[var(--surface-alt)]">
              <div
                className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-75"
                style={{ width: `${level}%` }}
              />
            </div>
          </div>

          {allGood ? (
            <p className="flex items-center gap-2 text-sm font-medium text-emerald-600">
              <CheckCircleIcon className="h-4 w-4" />
              You are ready to join.
            </p>
          ) : null}
        </div>
      </div>

      {micError || cameraError ? (
        <div className="mt-4 space-y-2">
          {[micError, cameraError].filter(Boolean).map((message) => (
            <div
              key={message}
              className="flex items-start gap-2.5 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900"
            >
              <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />
              <p>{message}</p>
            </div>
          ))}
          <p className="px-1 text-xs text-[var(--muted)]">
            You can still join without a camera — your tutor will hear you, and you will see and hear the class.
          </p>
        </div>
      ) : null}
    </div>
  );
}

function Row({
  icon,
  label,
  state,
  detail,
}: {
  icon: React.ReactNode;
  label: string;
  state: DeviceState;
  detail?: string;
}) {
  const tone =
    state === "ok" ? "text-emerald-600" : state === "failed" ? "text-rose-600" : "text-[var(--muted)]";
  const word = state === "ok" ? "Working" : state === "failed" ? "Blocked" : "Checking…";

  return (
    <div className="flex items-center justify-between rounded-2xl bg-[var(--surface-alt)] px-4 py-3">
      <span className="flex items-center gap-2.5 text-sm font-medium text-[var(--foreground)]">
        {icon}
        {label}
      </span>
      <span className={`text-sm font-semibold ${tone}`}>{detail ?? word}</span>
    </div>
  );
}
