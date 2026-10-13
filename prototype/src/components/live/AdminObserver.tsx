"use client";

/**
 * SILENT SUPERVISION, AND ITS ONE ESCAPE HATCH — the office watching a live
 * class without joining it, with a deliberate way to stop being silent for a
 * moment when something needs to be said.
 *
 * WATCHING connects with a token minted by `/api/admin/live/observe`:
 * `hidden`, subscribe-only, no data channel. The consequences are all the
 * SFU's to enforce, not this component's —
 *
 *   - the tutor and students are never told an observer arrived (no join
 *     sound, the room's headcount does not move, no tile appears);
 *   - there is nothing here that publishes a camera, a microphone, a chat
 *     line or a reaction, and the token would refuse it if there were;
 *   - opening this panel writes nothing to the class's records — no
 *     attendance, no LiveClassSession, no recording.
 *
 * SPEAKING is the opposite connection, minted by `/api/admin/live/speak`: not
 * hidden, camera and microphone allowed. It exists for the message that
 * cannot wait for the lesson to end — a schedule change, an emergency, a
 * reminder that must land now — without the class learning WHICH member of
 * staff delivered it. Two things make that safe rather than merely quiet:
 *
 *   - the token connects under a fixed institutional name ("The Office"),
 *     never the admin's own, so nothing the room shows gives them away;
 *   - the class gets a signal — an `officeNotice` data message — the instant
 *     that connection lands, BEFORE a camera or microphone turns on, so
 *     "The Office" arriving reads as an announcement about to happen, not as
 *     someone talking over the tutor uninvited.
 *
 * Switching between the two is a full reconnect under a different identity,
 * not a permission flip on one token — LiveKit's `hidden` grant is fixed at
 * mint time, and there is no way to become visible mid-connection even if
 * there were a reason to want one.
 */

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  LocalParticipant,
  Room,
  RoomEvent,
  Track,
  type Participant,
  type RemoteParticipant,
  type RemoteTrackPublication,
} from "livekit-client";
import { createPortal } from "react-dom";
import BrandLoader from "@/components/BrandLoader";
import { CINEMA } from "@/components/live/LiveKitClassroom";
import {
  BroadcastMessageIcon,
  CameraIcon,
  EyeIcon,
  ExitIcon,
  MicIcon,
  MicOffIcon,
  ScreenShareIcon,
  SpeakerOffIcon,
} from "@/components/icons";
import { encodeMessage, roleOfMetadata } from "@/lib/live-room-protocol";

type Props = {
  roomName: string;
  title: string;
  onClose: () => void;
};

type Phase = "loading" | "connecting" | "watching" | "ended" | "failed";
/** Which token this panel is currently connected under — see the file banner above. */
type Mode = "watch" | "speak";

const MODE_ENDPOINT: Record<Mode, string> = {
  watch: "/api/admin/live/observe",
  speak: "/api/admin/live/speak",
};

export default function AdminObserver({ roomName, title, onClose }: Props) {
  const roomRef = useRef<Room | null>(null);
  const [mode, setMode] = useState<Mode>("watch");
  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState<string>("");
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [micOn, setMicOn] = useState(false);
  const [camOn, setCamOn] = useState(false);
  // Participants/tracks live on the Room object; events bump this and we re-read.
  const [topology, bumpTopology] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    let cancelled = false;
    const room = new Room({
      adaptiveStream: true,
      dynacast: true,
    });
    roomRef.current = room;

    room
      .on(RoomEvent.ParticipantConnected, bumpTopology)
      .on(RoomEvent.ParticipantDisconnected, bumpTopology)
      .on(RoomEvent.TrackSubscribed, bumpTopology)
      .on(RoomEvent.TrackUnsubscribed, bumpTopology)
      .on(RoomEvent.TrackMuted, bumpTopology)
      .on(RoomEvent.TrackUnmuted, bumpTopology)
      .on(RoomEvent.LocalTrackPublished, bumpTopology)
      .on(RoomEvent.LocalTrackUnpublished, bumpTopology)
      .on(RoomEvent.AudioPlaybackStatusChanged, () => {
        if (!cancelled) setAudioBlocked(!room.canPlaybackAudio);
      })
      .on(RoomEvent.Disconnected, () => {
        // The class ended, or our token ran out. Either way there is nothing
        // left here — say so rather than freezing on a black grid. (Not fired
        // by our own mode-switch: that tears the whole Room down in cleanup
        // below and never leaves this handler a moment to fire against it.)
        if (!cancelled) setPhase("ended");
      })
      .on(RoomEvent.Reconnecting, () => {
        if (!cancelled) setPhase("connecting");
      })
      .on(RoomEvent.Reconnected, () => {
        if (!cancelled) setPhase("watching");
      });

    (async () => {
      try {
        const res = await fetch(`${MODE_ENDPOINT[mode]}?room=${encodeURIComponent(roomName)}`, {
          cache: "no-store",
        });
        const data = await res.json().catch(() => ({}) as { url?: string; token?: string; error?: string });
        if (cancelled) return;
        if (!res.ok || !data.url || !data.token) {
          setError(
            data.error ||
              (mode === "speak"
                ? "Could not open a connection to speak in that class."
                : "Could not open a supervision session for that class."),
          );
          setPhase("failed");
          return;
        }
        setPhase("connecting");
        await room.connect(data.url, data.token);
        if (cancelled) return;
        setPhase("watching");
        bumpTopology();

        if (mode === "speak") {
          // Signal first, unmute later — the whole reason this is two steps.
          // Best-effort: a dropped notice must not block the admin from going
          // ahead and speaking anyway.
          await room.localParticipant.publishData(encodeMessage({ t: "officeNotice" }), { reliable: true }).catch(() => {});
        }

        // Browsers hold remote audio until a gesture. The click that opened
        // this panel usually counts; if it did not, the banner offers a tap.
        try {
          await room.startAudio();
        } catch {
          // Expected without a qualifying gesture — handled by `audioBlocked`.
        }
        if (!cancelled) setAudioBlocked(!room.canPlaybackAudio);
      } catch (connectError) {
        if (cancelled) return;
        console.error("Admin observer connect failed", connectError);
        setError(connectError instanceof Error ? connectError.message : "Could not connect to that class.");
        setPhase("failed");
      }
    })();

    return () => {
      cancelled = true;
      room.disconnect();
      roomRef.current = null;
    };
  }, [roomName, mode]);

  /**
   * Switch to the anonymous, visible connection and signal the class.
   *
   * Reset here, in the click handler, rather than in the connect effect: a
   * fresh connection never inherits the previous one's mic/camera state, and
   * the class must never see a leftover "on" from before this specific
   * connection actually published — but the reset is a response to the
   * admin's own click, not a side effect of the room synchronizing.
   */
  const startSpeaking = useCallback(() => {
    setMicOn(false);
    setCamOn(false);
    setPhase("loading");
    setMode("speak");
  }, []);

  /** Drop the camera/mic connection and go back to watching silently. */
  const stopSpeaking = useCallback(() => {
    setMicOn(false);
    setCamOn(false);
    setPhase("loading");
    setMode("watch");
  }, []);

  /** Re-send the "one moment" signal without a reconnect — for a room that missed it, or a second thing to say. */
  const resendNotice = useCallback(() => {
    roomRef.current?.localParticipant
      .publishData(encodeMessage({ t: "officeNotice" }), { reliable: true })
      .catch(() => {});
  }, []);

  const toggleMic = useCallback(async () => {
    const room = roomRef.current;
    if (!room || mode !== "speak") return;
    const next = !micOn;
    try {
      await room.localParticipant.setMicrophoneEnabled(next);
      setMicOn(next);
    } catch (toggleError) {
      console.error("Admin announcement mic toggle failed", toggleError);
    }
  }, [mode, micOn]);

  const toggleCam = useCallback(async () => {
    const room = roomRef.current;
    if (!room || mode !== "speak") return;
    const next = !camOn;
    try {
      await room.localParticipant.setCameraEnabled(next);
      setCamOn(next);
    } catch (toggleError) {
      console.error("Admin announcement camera toggle failed", toggleError);
    }
  }, [mode, camOn]);

  // Close on Escape, like any full-screen overlay.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const room = roomRef.current;
  const remotes = useMemo<RemoteParticipant[]>(
    () => (room ? Array.from(room.remoteParticipants.values()) : []),
    // `remoteParticipants` mutates in place — `topology` is the real dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [room, topology],
  );

  const tutor = remotes.find((p) => roleOfMetadata(p.metadata) === "tutor") ?? null;
  const screenSharer =
    remotes.find((p) => Boolean(p.getTrackPublication(Track.Source.ScreenShare)?.track)) ?? null;

  // Main view: a shared screen if there is one, else the tutor, else whoever is
  // first in the room. Everyone else goes in the strip. Same rule the recording
  // uses, minus the taught floor concept (an observer does not need it).
  const mainTile = screenSharer
    ? { participant: screenSharer, source: Track.Source.ScreenShare as Track.Source }
    : tutor
      ? { participant: tutor, source: Track.Source.Camera as Track.Source }
      : remotes[0]
        ? { participant: remotes[0], source: Track.Source.Camera as Track.Source }
        : null;

  const stripTiles = remotes
    .filter((p) => p.identity !== mainTile?.participant.identity)
    .map((p) => ({ participant: p, source: Track.Source.Camera as Track.Source }));

  const enableAudio = useCallback(() => {
    roomRef.current
      ?.startAudio()
      .then(() => setAudioBlocked(false))
      .catch(() => {});
  }, []);

  const overlay = (
    <div
      className="fixed inset-0 z-[60] flex flex-col text-white"
      // Same multi-layer dark gradient the cinema redesign uses for the
      // classroom's own immersive ground (see LiveKitClassroom.tsx) — this
      // overlay is always full-screen, so it is always "immersive".
      style={{
        background:
          "radial-gradient(1100px 620px at 6% -10%, rgba(63,195,198,0.16), transparent 55%), radial-gradient(900px 560px at 98% -4%, rgba(255,122,26,0.12), transparent 55%), linear-gradient(180deg, #030607 0%, #050b0c 45%, #04090a 100%)",
      }}
    >
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.08] px-5 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <span
            className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${
              mode === "speak" ? "bg-[#D9A64E]/20 text-[#D9A64E]" : "bg-[#D9A64E]/15 text-[#D9A64E]"
            }`}
          >
            {mode === "speak" ? <BroadcastMessageIcon className="h-5 w-5" /> : <EyeIcon className="h-5 w-5" />}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{title}</p>
            <p className="text-xs text-[#9A9690]">
              Room {roomName} ·{" "}
              {phase === "watching"
                ? `${remotes.length} in the class`
                : phase === "connecting"
                  ? "connecting…"
                  : phase === "ended"
                    ? "class ended"
                    : phase === "failed"
                      ? "could not connect"
                      : "opening…"}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {phase === "watching" ? (
            mode === "watch" ? (
              <button
                onClick={startSpeaking}
                className={`inline-flex items-center gap-2 rounded-xl ${CINEMA.ctaBg} px-4 py-2 text-sm font-semibold text-white shadow-lg transition hover:brightness-110`}
              >
                <BroadcastMessageIcon className="h-4 w-4" />
                Speak to the class
              </button>
            ) : (
              <button
                onClick={stopSpeaking}
                className="inline-flex items-center gap-2 rounded-xl bg-white/10 px-4 py-2 text-sm font-semibold transition hover:bg-white/20"
              >
                <EyeIcon className="h-4 w-4" />
                Back to watching silently
              </button>
            )
          ) : null}
          <button
            onClick={onClose}
            className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-white/10 px-4 py-2 text-sm font-semibold transition hover:bg-white/20"
          >
            <ExitIcon className="h-4 w-4" />
            {mode === "speak" ? "Leave" : "Stop watching"}
          </button>
        </div>
      </div>

      {/* Mode banner — always on, never dismissible. What it says is the whole point.
          Amber here is the palette's "being handled" tone, same as a device
          notice in the classroom itself — this is an ongoing state, not a problem. */}
      {mode === "watch" ? (
        <div className="flex items-center gap-2.5 bg-[#D9A64E]/15 px-5 py-2 text-xs font-medium text-[#E8C988]">
          <EyeIcon className="h-4 w-4 shrink-0" />
          <span>
            You are watching silently. The tutor and students have <span className="font-bold">not</span> been told
            you are here — you are not in their participant list and no one was pinged. This visit is recorded in the
            audit trail.
          </span>
        </div>
      ) : (
        <div className="flex items-center gap-2.5 bg-[#D9A64E] px-5 py-2 text-xs font-medium text-white">
          <BroadcastMessageIcon className="h-4 w-4 shrink-0" />
          <span>
            You are visible now, connected as <span className="font-bold">&ldquo;The Office&rdquo;</span> — the class
            can see and hear you, but your own name is never shown. A signal was sent the moment you connected; turn
            on your mic or camera below when you are ready to speak. This is logged in the audit trail every time.
          </span>
        </div>
      )}

      {phase === "watching" && mode === "speak" ? (
        <div className={`flex flex-wrap items-center gap-2 border-b border-white/[0.08] ${CINEMA.tileBg} px-5 py-3`}>
          <button
            onClick={toggleMic}
            className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition hover:brightness-110 ${
              micOn ? `${CINEMA.ctaBg} text-white` : "bg-white/10 text-white hover:bg-white/20"
            }`}
          >
            {micOn ? <MicIcon className="h-4 w-4" /> : <MicOffIcon className="h-4 w-4" />}
            {micOn ? "Mic on" : "Mic off"}
          </button>
          <button
            onClick={toggleCam}
            className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition hover:brightness-110 ${
              camOn ? `${CINEMA.ctaBg} text-white` : "bg-white/10 text-white hover:bg-white/20"
            }`}
          >
            <CameraIcon className="h-4 w-4" />
            {camOn ? "Camera on" : "Camera off"}
          </button>
          <button
            onClick={resendNotice}
            className="ml-auto inline-flex items-center gap-2 rounded-xl bg-white/10 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/20"
          >
            <BroadcastMessageIcon className="h-4 w-4" />
            Signal again
          </button>
        </div>
      ) : null}

      {audioBlocked && phase === "watching" ? (
        <button
          onClick={enableAudio}
          className={`flex w-full items-center justify-center gap-3 ${CINEMA.ctaBg} px-5 py-3 text-sm font-semibold text-white shadow-lg transition hover:brightness-110`}
        >
          <SpeakerOffIcon className="h-5 w-5" />
          Tap to turn on the sound
        </button>
      ) : null}

      {/* Body */}
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {phase === "loading" || phase === "connecting" ? (
          <div className="grid h-full place-items-center">
            <BrandLoader size="md" title="Verbindung…" message="Joining the class quietly." />
          </div>
        ) : phase === "failed" ? (
          <div className="grid h-full place-items-center p-6">
            <div className="max-w-md rounded-2xl border border-rose-400/30 bg-rose-500/10 p-6 text-center text-sm text-rose-200">
              <p className="font-semibold">Could not open supervision</p>
              <p className="mt-2">{error}</p>
              <button
                onClick={onClose}
                className="mt-4 rounded-xl bg-white/10 px-5 py-2 text-xs font-semibold text-white transition hover:bg-white/20"
              >
                Close
              </button>
            </div>
          </div>
        ) : phase === "ended" ? (
          <div className="grid h-full place-items-center p-6">
            <div className={`max-w-md rounded-2xl border border-white/[0.08] ${CINEMA.tileBg} p-6 text-center text-sm text-[#9A9690]`}>
              <p className="font-semibold text-white">This class has ended</p>
              <p className="mt-2">There is nothing more to watch here.</p>
              <button
                onClick={onClose}
                className="mt-4 rounded-xl bg-white/10 px-5 py-2 text-xs font-semibold text-white transition hover:bg-white/20"
              >
                Back to live classes
              </button>
            </div>
          </div>
        ) : (
          <div className="flex h-full flex-col gap-3 p-4">
            <div className="relative min-h-0 flex-1">
              {mainTile ? (
                <VideoTile participant={mainTile.participant} source={mainTile.source} revision={topology} full />
              ) : (
                <div className={`grid h-full place-items-center rounded-2xl ${CINEMA.tileBg} text-sm text-[#9A9690]`}>
                  Nobody has their camera on yet — the audio is still live.
                </div>
              )}
            </div>

            {stripTiles.length > 0 ? (
              <div className="flex shrink-0 gap-3 overflow-x-auto pb-1">
                {stripTiles.map((tile) => (
                  <div key={tile.participant.identity} className="h-28 w-44 shrink-0">
                    <VideoTile participant={tile.participant} source={tile.source} revision={topology} />
                  </div>
                ))}
              </div>
            ) : null}

            {/*
              What the class sees of "The Office" — shown to the admin so
              going live is never a surprise about framing or lighting. Not
              rendered until the camera actually publishes, matching the class's
              own view exactly.
            */}
            {mode === "speak" && camOn && room ? (
              <div className="pointer-events-none absolute bottom-4 right-4 h-28 w-44 overflow-hidden rounded-2xl ring-2 ring-[#D9A64E]">
                <VideoTile participant={room.localParticipant} source={Track.Source.Camera} revision={topology} />
              </div>
            ) : null}
          </div>
        )}

        {/* Every remote microphone, whether or not that person has a tile. A
            supervisor is here for the audio first. */}
        {phase === "watching"
          ? remotes.map((participant) => (
              <ParticipantAudio key={`audio-${participant.identity}`} participant={participant} revision={topology} />
            ))
          : null}
      </div>
    </div>
  );

  // Rendered to <body> so the admin sidebar/scroll container can't clip it.
  if (typeof document === "undefined") return null;
  return createPortal(overlay, document.body);
}

/** One labelled video box. `full` fills its parent; otherwise it fills the strip cell. */
function VideoTile({
  participant,
  source,
  revision,
  full = false,
}: {
  participant: Participant;
  source: Track.Source;
  revision: number;
  full?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [hasVideo, setHasVideo] = useState(false);
  const [videoWaiting, setVideoWaiting] = useState(false);
  const [retryingVideo, setRetryingVideo] = useState(false);
  /**
   * `revision` bumps on ANY topology event from ANY participant (see its
   * `.on(...)` list above this component) — a mute, a join, a screen-share
   * start three tiles away. This effect has to re-run on every bump because
   * THIS tile's own publication can change too, but most bumps have nothing
   * to do with this tile's actual track. Re-running used to mean
   * `track.detach(el)` then `track.attach(el)` on the SAME still-valid
   * track — a real, if brief, blank frame each time, visible as a blink.
   * With more participants' mics/cameras active there are simply more
   * topology events per second, so the blinking scaled with room size —
   * exactly the pattern reported. Guard on the actual track object: only
   * detach/reattach when the track THIS tile should show has genuinely
   * changed, not on every unrelated bump.
   */
  const attachedTrackRef = useRef<Track | null>(null);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    let waitTimer: number | null = null;

    function clearWaitTimer() {
      if (waitTimer !== null) {
        window.clearTimeout(waitTimer);
        waitTimer = null;
      }
    }

    function markPlaying() {
      clearWaitTimer();
      setVideoWaiting(false);
    }

    function markWaiting() {
      clearWaitTimer();
      waitTimer = window.setTimeout(() => setVideoWaiting(true), 1_500);
    }

    setVideoWaiting(false);
    waitTimer = window.setTimeout(() => setVideoWaiting(true), 4_000);
    el.addEventListener("loadeddata", markPlaying);
    el.addEventListener("playing", markPlaying);
    el.addEventListener("waiting", markWaiting);
    el.addEventListener("stalled", markWaiting);
    return () => {
      clearWaitTimer();
      el.removeEventListener("loadeddata", markPlaying);
      el.removeEventListener("playing", markPlaying);
      el.removeEventListener("waiting", markWaiting);
      el.removeEventListener("stalled", markWaiting);
    };
  }, [participant, source, revision]);
  

  useEffect(() => {
    const el = videoRef.current;
    const screenPub = participant.getTrackPublication(Track.Source.ScreenShare);
    const cameraPub = participant.getTrackPublication(Track.Source.Camera);
    const pub = source === Track.Source.ScreenShare ? screenPub : screenPub?.track ? screenPub : cameraPub;
    const track = pub?.track ?? null;

    if (el && track) {
      setHasVideo(true);
      if (attachedTrackRef.current === track) return; // same track already attached — nothing to do
      track.attach(el);
      attachedTrackRef.current = track;
      return () => {
        if (attachedTrackRef.current === track) {
          track.detach(el);
          attachedTrackRef.current = null;
        }
      };
    }
    attachedTrackRef.current = null;
    setHasVideo(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [participant, source, revision]);

  const screenPub = participant.getTrackPublication(Track.Source.ScreenShare);
  const cameraPub = participant.getTrackPublication(Track.Source.Camera);
  const publication = participant instanceof LocalParticipant
    ? undefined
    : ((source === Track.Source.ScreenShare ? screenPub : screenPub?.track ? screenPub : cameraPub) as
        | RemoteTrackPublication
        | undefined);

  async function retryVideo() {
    if (!publication || retryingVideo) return;
    setRetryingVideo(true);
    setVideoWaiting(false);
    try {
      await publication.setEnabled(false);
      await new Promise<void>((resolve) => window.setTimeout(resolve, 500));
      await publication.setEnabled(true);
    } catch (retryError) {
      console.error("Admin observer video resubscribe failed", retryError);
      setVideoWaiting(true);
    } finally {
      setRetryingVideo(false);
    }
  }

  const name = participant.name || participant.identity;
  const isScreen = source === Track.Source.ScreenShare;

  return (
    <div
      className={`relative overflow-hidden rounded-2xl ${CINEMA.tileBg} ring-1 ring-white/10 ${
        full ? "h-full w-full" : "h-full w-full"
      }`}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className={`h-full w-full ${isScreen ? "object-contain" : "object-cover"} ${hasVideo ? "" : "hidden"}`}
      />
      {!hasVideo ? (
        <div className={`flex h-full w-full items-center justify-center ${CINEMA.tileBg}`}>
          <div
            className={`grid place-items-center rounded-full bg-white/10 font-semibold text-white ${
              full ? "h-20 w-20 text-2xl" : "h-9 w-9 text-xs"
            }`}
          >
            {name.slice(0, 1).toUpperCase()}
          </div>
        </div>
      ) : null}
      {hasVideo && videoWaiting ? (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-950/80 p-4 text-center">
          <div>
            <p className="text-sm font-medium text-white">Video isn&apos;t arriving yet</p>
            <p className="mt-1 text-xs text-slate-300">
              Audio may still work. This can happen if the sender&apos;s connection is weak.
            </p>
            {publication ? (
              <button
                onClick={retryVideo}
                disabled={retryingVideo || publication.isMuted}
                className="mt-3 rounded-lg bg-white/15 px-3 py-2 text-xs font-semibold text-white transition hover:bg-white/25 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {retryingVideo ? "Reconnecting video…" : "Try video again"}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
      <div className="absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-gradient-to-t from-black/80 to-transparent px-2 py-1.5">
        {isScreen ? <ScreenShareIcon className="h-3 w-3 shrink-0 text-[#9A9690]" /> : null}
        <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-white">
          {name}
          {isScreen ? " — screen" : ""}
        </span>
        {roleOfMetadata(participant.metadata) === "tutor" ? (
          <span className="shrink-0 rounded-full bg-[var(--accent)] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white">
            Tutor
          </span>
        ) : null}
      </div>
    </div>
  );
}

/** Hidden playback for one participant's microphone. */
function ParticipantAudio({ participant, revision }: { participant: RemoteParticipant; revision: number }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  // Same guard as VideoTile, same reason: `revision` bumps on every
  // participant's mute/unmute, not just this one's — without this, a busy
  // room re-attaches a perfectly fine audio track constantly.
  const attachedTrackRef = useRef<Track | null>(null);

  useEffect(() => {
    const pub = participant.getTrackPublication(Track.Source.Microphone);
    const el = audioRef.current;
    const track = pub?.track ?? null;
    if (el && track) {
      if (attachedTrackRef.current === track) return;
      track.attach(el);
      attachedTrackRef.current = track;
      return () => {
        if (attachedTrackRef.current === track) {
          track.detach(el);
          attachedTrackRef.current = null;
        }
      };
    }
    attachedTrackRef.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [participant, revision]);

  return <audio ref={audioRef} autoPlay />;
}
