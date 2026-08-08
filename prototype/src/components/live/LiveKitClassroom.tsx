"use client";

import {
  CameraIcon,
  CommunityIcon,
  ExpandIcon,
  HandIcon,
  MicIcon,
  MicOffIcon,
  ScreenShareIcon,
  ShrinkIcon,
  SpeakerOffIcon,
} from "@/components/icons";
import BrandLoader from "@/components/BrandLoader";
import { ROOM_MODE_COPY } from "@/lib/live-room-protocol";
import { useRoomInteractions } from "./useRoomInteractions";
import { mediaErrorMessage } from "./media-errors";
import {
  ChatPanel,
  FloorBanner,
  HandQueue,
  ModeSwitch,
  ReactionBar,
  ReactionLayer,
} from "./ClassroomInteractions";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ConnectionQuality,
  LocalParticipant,
  Participant,
  RemoteParticipant,
  Room,
  RoomEvent,
  Track,
  VideoPresets,
  type RemoteTrackPublication,
  type TrackPublication,
} from "livekit-client";
import { qualityModesFor, qualitySpec, type QualityMode, type RoomRole } from "@/lib/live-classroom";

type LiveKitClassroomProps = {
  url: string;
  token: string;
  roomName: string;
  displayName: string;
  role: RoomRole;
  initialQuality: QualityMode;
  onLeave: () => void;
};

type Status = "connecting" | "connected" | "reconnecting" | "disconnected" | "failed";

/**
 * How big we render each remote tile, per quality mode.
 *
 * This is not only cosmetic. With `adaptiveStream` on, LiveKit picks which
 * simulcast layer to pull for a video element from the element's ON-SCREEN
 * SIZE. So a smaller tile literally requests fewer bits from the server. Data
 * saver is implemented by making the video smaller, which is both the honest
 * mechanism and the one the SFU is designed around.
 */
const TILE_SIZE: Record<QualityMode, string> = {
  high: "h-40 w-56",
  medium: "h-28 w-40",
  low: "h-20 w-28",
  audio: "h-20 w-28",
};

function isTutor(participant: Participant): boolean {
  try {
    return JSON.parse(participant.metadata || "{}")?.role === "tutor";
  } catch {
    return false;
  }
}

/**
 * Attaches a participant's published tracks to real media elements.
 *
 * Written by hand rather than pulled from @livekit/components-react: the
 * prebuilt kit brings its own design system, which would have to be fought
 * back into EasyWay's, and it conflicts with this project's React version.
 */
function ParticipantTile({
  participant,
  mode,
  large,
  isSpeaking,
  revision,
}: {
  participant: Participant;
  mode: QualityMode;
  large?: boolean;
  isSpeaking?: boolean;
  /**
   * Bumped by every room event. It is a dependency of the attach effect, and
   * that is the whole point — see the comment inside.
   */
  revision: number;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [hasVideo, setHasVideo] = useState(false);

  const showVideo = qualitySpec(mode).maxHeight > 0;

  useEffect(() => {
    const videoEl = videoRef.current;
    const audioEl = audioRef.current;

    function attach() {
      const cameraPub = participant.getTrackPublication(Track.Source.Camera);
      const screenPub = participant.getTrackPublication(Track.Source.ScreenShare);
      // A shared screen is what the class is looking at, so it wins over the
      // tutor's face whenever both are live.
      const videoPub = screenPub?.track ? screenPub : cameraPub;

      if (videoEl && showVideo && videoPub?.track) {
        videoPub.track.attach(videoEl);
        setHasVideo(true);
      } else {
        setHasVideo(false);
      }

      // The local participant must never hear themselves.
      if (audioEl && !(participant instanceof LocalParticipant)) {
        const micPub = participant.getTrackPublication(Track.Source.Microphone);
        if (micPub?.track) micPub.track.attach(audioEl);
      }
    }

    attach();

    /**
     * WHY `revision` IS A DEPENDENCY — this is the blank-camera bug.
     *
     * `trackPublished` is a REMOTE participant event. A LocalParticipant emits
     * `localTrackPublished` instead, so none of the listeners below ever fired
     * for your own tile. And the ordering is merciless: the room reports
     * Connected, this tile mounts and calls `attach()` while there is still no
     * camera track to attach, and only then does `setCameraEnabled(true)`
     * resolve and publish one. Room events did force a re-render — but a
     * re-render does not re-run an effect whose dependencies have not changed,
     * so `attach()` was never called again and the student stared at their own
     * black rectangle for the whole lesson.
     *
     * Depending on `revision` re-runs this on every room event, which is the
     * cheap and reliable version of the fix. `track.attach(el)` on an element
     * it is already attached to is a no-op, so re-running costs nothing.
     */
    participant.on("trackSubscribed", attach);
    participant.on("trackUnsubscribed", attach);
    participant.on("trackMuted", attach);
    participant.on("trackUnmuted", attach);
    participant.on("trackPublished", attach);
    participant.on("localTrackPublished", attach);
    participant.on("localTrackUnpublished", attach);

    return () => {
      participant.off("trackSubscribed", attach);
      participant.off("trackUnsubscribed", attach);
      participant.off("trackMuted", attach);
      participant.off("trackUnmuted", attach);
      participant.off("trackPublished", attach);
      participant.off("localTrackPublished", attach);
      participant.off("localTrackUnpublished", attach);
      if (videoEl) {
        participant.getTrackPublication(Track.Source.Camera)?.track?.detach(videoEl);
        participant.getTrackPublication(Track.Source.ScreenShare)?.track?.detach(videoEl);
      }
      if (audioEl) participant.getTrackPublication(Track.Source.Microphone)?.track?.detach(audioEl);
    };
  }, [participant, showVideo, revision]);

  const micMuted = !participant.isMicrophoneEnabled;
  const tutor = isTutor(participant);
  const initials = (participant.name || participant.identity || "?").slice(0, 1).toUpperCase();

  return (
    <div
      className={`relative overflow-hidden rounded-2xl bg-slate-900 ring-2 transition ${
        isSpeaking ? "ring-[var(--accent)]" : "ring-white/10"
      } ${large ? "aspect-video w-full" : TILE_SIZE[mode]}`}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={participant instanceof LocalParticipant}
        className={`h-full w-full object-cover ${hasVideo ? "" : "hidden"}`}
      />
      <audio ref={audioRef} autoPlay />

      {/*
        The mark sits on the main stage only — once per screen, not once per
        tile. It is also the one piece of branding that survives into the
        recording, since the tape is a composite of what the room looked like.
      */}
      {large ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src="/logo-mark.png"
          alt=""
          aria-hidden="true"
          className="pointer-events-none absolute right-3 top-3 h-8 w-8 object-contain opacity-70 drop-shadow-[0_2px_6px_rgba(0,0,0,0.6)]"
        />
      ) : null}

      {!hasVideo ? (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-gradient-to-br from-slate-800 to-slate-900">
          <div className={`grid place-items-center rounded-full bg-[var(--accent)]/20 font-semibold text-white ${large ? "h-20 w-20 text-3xl" : "h-10 w-10 text-sm"}`}>
            {initials}
          </div>
          {!showVideo && large ? <p className="text-xs text-slate-400">Audio-only mode</p> : null}
        </div>
      ) : null}

      <div className="absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-gradient-to-t from-black/80 to-transparent px-2 py-1.5">
        {micMuted ? <SpeakerOffIcon className="h-3.5 w-3.5 shrink-0 text-rose-400" /> : null}
        <span className="truncate text-[11px] font-medium text-white">
          {participant instanceof LocalParticipant ? "You" : participant.name || participant.identity}
        </span>
        {tutor ? (
          <span className="rounded-full bg-[var(--accent)] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white">Tutor</span>
        ) : null}
      </div>
    </div>
  );
}

const QUALITY_PILL: Record<ConnectionQuality, { label: string; className: string }> = {
  [ConnectionQuality.Excellent]: { label: "Strong", className: "bg-emerald-500/15 text-emerald-300" },
  [ConnectionQuality.Good]: { label: "Good", className: "bg-emerald-500/15 text-emerald-300" },
  [ConnectionQuality.Poor]: { label: "Weak — try Data saver", className: "bg-amber-500/15 text-amber-300" },
  [ConnectionQuality.Lost]: { label: "Connection lost", className: "bg-rose-500/15 text-rose-300" },
  [ConnectionQuality.Unknown]: { label: "Checking…", className: "bg-white/10 text-slate-300" },
};

/**
 * Automatic downgrade, and the three rules that stop it becoming its own
 * problem.
 *
 * The connection pill used to say "Weak — try Data saver" and then leave the
 * student to find a dropdown mid-lesson — which is exactly the moment they are
 * least able to, because the picture they would be navigating by is frozen. So
 * a link that stays bad now drops a rung on its own.
 *
 *   1. It only ever steps DOWN, one rung at a time. Recovering is the
 *      student's call: a connection that has just come back is the last thing
 *      to gamble 720p on.
 *   2. A manual choice suspends it. A student who has just decided something
 *      should not be argued with by the UI two seconds later.
 *   3. Every step says what it did and offers to put it back, because a
 *      picture that quietly degrades itself reads as a broken app.
 *
 * The ladder is whatever rungs this person actually has, so a tutor — who has
 * only Sharp — is never stepped down at all. That is the intended consequence of
 * `qualityModesFor()`, not an oversight: a tutor's layer is the whole room's
 * ceiling, so the school fixes the tutor's line rather than the class's picture.
 */
/** How long the link must stay bad before we act. A flap is not a failure. */
const POOR_HOLD_MS = 10_000;
/** Gap between automatic steps, so a wobble cannot fall straight to audio. */
const AUTO_STEP_COOLDOWN_MS = 15_000;
/** After a manual choice, leave the student alone for this long. */
const MANUAL_OVERRIDE_MS = 90_000;
/** How long a new speaker must hold the floor before the stage moves to them. */
const STAGE_DWELL_MS = 1500;

export default function LiveKitClassroom({
  url,
  token,
  roomName,
  displayName,
  role,
  initialQuality,
  onLeave,
}: LiveKitClassroomProps) {
  const roomRef = useRef<Room | null>(null);
  const [status, setStatus] = useState<Status>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<QualityMode>(initialQuality);
  const [micOn, setMicOn] = useState(true);
  const [cameraOn, setCameraOn] = useState(qualitySpec(initialQuality).publishesVideo);
  const [screenSharing, setScreenSharing] = useState(false);
  const [quality, setQuality] = useState<ConnectionQuality>(ConnectionQuality.Unknown);
  const [autoNotice, setAutoNotice] = useState<{ from: QualityMode; to: QualityMode } | null>(null);
  // A tutor's list is one item long, which is what makes the ladder below a
  // no-op for them without needing a special case.
  const availableModes = qualityModesFor(role);
  const ladderRef = useRef<QualityMode[]>(availableModes.map((spec) => spec.value));
  const [deviceNotice, setDeviceNotice] = useState<string | null>(null);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [stageIdentity, setStageIdentity] = useState<string | null>(null);
  const [immersive, setImmersive] = useState(false);
  const [panel, setPanel] = useState<"hands" | "chat" | null>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  // Room state lives on the Room object, not in React. Rather than mirroring it
  // (and drifting), events bump this counter and the component re-reads. Tiles
  // take it as a prop so their attach effect re-runs — see ParticipantTile.
  const [revision, forceRender] = useState(0);
  const bump = useCallback(() => forceRender((n) => n + 1), []);

  // The downgrade ticker reads all of its inputs from refs. It has to run on a
  // clock rather than on the quality event — "Poor for ten seconds" is not
  // something an event that fires on *change* can tell you — and a ticker that
  // re-subscribed every time the mode or the quality moved would keep resetting
  // its own timers.
  const modeRef = useRef<QualityMode>(initialQuality);
  const statusRef = useRef<Status>("connecting");
  const poorSinceRef = useRef<number | null>(null);
  const lastAutoStepRef = useRef(0);
  const manualUntilRef = useRef(0);
  const applyModeRef = useRef<(next: QualityMode, source: "manual" | "auto") => void>(() => {});

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  // When the link went bad, or null if it is currently fine.
  useEffect(() => {
    const bad = quality === ConnectionQuality.Poor || quality === ConnectionQuality.Lost;
    poorSinceRef.current = bad ? poorSinceRef.current ?? Date.now() : null;
  }, [quality]);

  useEffect(() => {
    let cancelled = false;

    const room = new Room({
      // The three settings that carry the whole low-bandwidth story.
      adaptiveStream: true,
      dynacast: true,
      videoCaptureDefaults: {
        // Capture at 360p, not 720p. On a mid-range Android the encoder is as
        // much of a bottleneck as the network, and nobody in a language class
        // needs to see pores.
        resolution: VideoPresets.h360.resolution,
      },
      publishDefaults: {
        simulcast: true,
        // Two layers, not three. Three costs the publisher upload bandwidth
        // that Nigerian mobile does not have to spare.
        videoSimulcastLayers: [VideoPresets.h180, VideoPresets.h360],
        // VP8 rather than VP9/AV1: it is hardware-accelerated on the cheap
        // Android phones most of our students actually join on.
        videoCodec: "vp8",
        // Audio is the lesson. DTX stops sending during silence, RED sends
        // redundant packets so speech survives heavy loss.
        dtx: true,
        red: true,
      },
      disconnectOnPageLeave: true,
    });

    roomRef.current = room;

    room
      .on(RoomEvent.Connected, () => {
        if (cancelled) return;
        setStatus("connected");
        bump();
      })
      .on(RoomEvent.Reconnecting, () => setStatus("reconnecting"))
      .on(RoomEvent.Reconnected, () => setStatus("connected"))
      .on(RoomEvent.Disconnected, () => setStatus("disconnected"))
      .on(RoomEvent.ParticipantConnected, bump)
      .on(RoomEvent.ParticipantDisconnected, bump)
      .on(RoomEvent.TrackSubscribed, bump)
      .on(RoomEvent.TrackUnsubscribed, bump)
      .on(RoomEvent.TrackMuted, bump)
      .on(RoomEvent.TrackUnmuted, bump)
      .on(RoomEvent.ActiveSpeakersChanged, bump)
      .on(RoomEvent.LocalTrackPublished, bump)
      .on(RoomEvent.LocalTrackUnpublished, bump)
      .on(RoomEvent.AudioPlaybackStatusChanged, () => setAudioBlocked(!room.canPlaybackAudio))
      .on(RoomEvent.ConnectionQualityChanged, (connectionQuality, participant) => {
        // Only our own link matters for the pill — a classmate's bad network
        // is the SFU's problem to absorb, not something to alarm us about.
        if (participant?.identity === room.localParticipant.identity) setQuality(connectionQuality);
      });

    (async () => {
      try {
        await room.connect(url, token);
      } catch (connectError) {
        if (cancelled) return;
        console.error("LiveKit connect failed", connectError);
        setError(connectError instanceof Error ? connectError.message : "Could not join the classroom");
        setStatus("failed");
        return;
      }
      if (cancelled) return;

      /**
       * Devices are attempted SEPARATELY, and neither one failing ends the
       * class.
       *
       * Both used to sit in the same try block as `connect()`, so a student who
       * declined the camera prompt — or had no camera at all — got "Could not
       * join the classroom" and was thrown out of a lesson they could have
       * attended perfectly well by voice. A missing camera is an inconvenience;
       * a missing lesson is not.
       */
      try {
        await room.localParticipant.setMicrophoneEnabled(true);
        setMicOn(true);
      } catch (micError) {
        console.error("Microphone failed", micError);
        setMicOn(false);
        setDeviceNotice(mediaErrorMessage(micError, "microphone"));
      }

      // Audio-only students never turn a camera on, so it is never asked for
      // — which also means the browser never prompts for camera permission.
      if (qualitySpec(initialQuality).publishesVideo && !cancelled) {
        try {
          await room.localParticipant.setCameraEnabled(true);
          setCameraOn(true);
        } catch (cameraError) {
          console.error("Camera failed", cameraError);
          setCameraOn(false);
          setDeviceNotice(mediaErrorMessage(cameraError, "camera"));
        }
      }

      /**
       * Mobile browsers refuse to play remote audio until a user gesture, and
       * "the class is silent" is the single worst first impression this page can
       * make. The Join click usually counts, but the connect is async and Safari
       * does not always honour it that far out — so if playback is still
       * blocked, the banner below gives them something to tap.
       */
      try {
        await room.startAudio();
      } catch {
        // Expected when there has been no qualifying gesture. The banner
        // handles it; there is nothing to log.
      }
      if (!cancelled) {
        setAudioBlocked(!room.canPlaybackAudio);
        bump();
      }
    })();

    return () => {
      cancelled = true;
      room.disconnect();
      roomRef.current = null;
    };
  }, [url, token, initialQuality, bump]);

  // Switching mode re-negotiates what the server sends us. Video publications
  // are disabled outright in audio mode; in every other mode the tile size
  // does the work via adaptive stream.
  const applyMode = useCallback(async (next: QualityMode, source: "manual" | "auto") => {
    if (source === "manual") {
      // Rule 2: the student has just told us what they want. Stop guessing.
      manualUntilRef.current = Date.now() + MANUAL_OVERRIDE_MS;
      setAutoNotice(null);
    }

    setMode(next);
    const room = roomRef.current;
    if (!room) return;

    const spec = qualitySpec(next);
    const wantsVideo = spec.maxHeight > 0;

    room.remoteParticipants.forEach((participant: RemoteParticipant) => {
      participant.trackPublications.forEach((publication: TrackPublication) => {
        if (publication.kind === Track.Kind.Video) {
          (publication as RemoteTrackPublication).setEnabled(wantsVideo);
        }
      });
    });

    if (!spec.publishesVideo && cameraOn) {
      await room.localParticipant.setCameraEnabled(false);
      setCameraOn(false);
    }
  }, [cameraOn]);

  useEffect(() => {
    applyModeRef.current = applyMode;
  }, [applyMode]);

  /** Everything the student drives goes through here, so it counts as manual. */
  const changeMode = useCallback((next: QualityMode) => applyMode(next, "manual"), [applyMode]);

  useEffect(() => {
    const timer = setInterval(() => {
      const now = Date.now();
      // A reconnect reports Lost, but it is a dropped socket rather than a slow
      // link — downgrading someone for it would punish them for a blip.
      if (statusRef.current !== "connected") return;
      if (poorSinceRef.current === null) return;
      if (now - poorSinceRef.current < POOR_HOLD_MS) return;
      if (now < manualUntilRef.current) return;
      if (now - lastAutoStepRef.current < AUTO_STEP_COOLDOWN_MS) return;

      const current = modeRef.current;
      const ladder = ladderRef.current;
      const next = ladder[ladder.indexOf(current) + 1];
      // Nothing left to give up — the bottom rung, or a tutor, who has one rung.
      if (!next) return;

      lastAutoStepRef.current = now;
      // Give the new rung a fair hearing before judging it too.
      poorSinceRef.current = now;
      setAutoNotice({ from: current, to: next });
      applyModeRef.current(next, "auto");
    }, 2_000);

    return () => clearInterval(timer);
  }, []);

  // The banner is an explanation, not a dialog. It says its piece and goes.
  useEffect(() => {
    if (!autoNotice) return;
    const timer = setTimeout(() => setAutoNotice(null), 12_000);
    return () => clearTimeout(timer);
  }, [autoNotice]);

  const toggleMic = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;
    const next = !micOn;
    try {
      await room.localParticipant.setMicrophoneEnabled(next);
      setMicOn(next);
      setDeviceNotice(null);
    } catch (micError) {
      setDeviceNotice(mediaErrorMessage(micError, "microphone"));
    }
  }, [micOn]);

  const toggleCamera = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;
    const next = !cameraOn;
    // Turning the camera on in audio-only mode is contradictory, so it lifts
    // the student into Data saver rather than silently doing nothing.
    if (next && !qualitySpec(mode).publishesVideo) await changeMode("low");
    try {
      await room.localParticipant.setCameraEnabled(next);
      setCameraOn(next);
      setDeviceNotice(null);
    } catch (cameraError) {
      // The button stays off and says why, rather than looking like it worked.
      setCameraOn(false);
      setDeviceNotice(mediaErrorMessage(cameraError, "camera"));
    }
  }, [cameraOn, mode, changeMode]);

  const toggleScreenShare = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;
    const next = !screenSharing;
    await room.localParticipant.setScreenShareEnabled(next);
    setScreenSharing(next);
  }, [screenSharing]);

  const leave = useCallback(() => {
    roomRef.current?.disconnect();
    onLeave();
  }, [onLeave]);

  const interactions = useRoomInteractions(roomRef.current, role, revision);

  /**
   * Edge-to-edge.
   *
   * Two mechanisms, because one is not enough. The CSS overlay is what actually
   * makes it immersive and it works everywhere — including iOS Safari, which
   * refuses element fullscreen entirely and would otherwise be left out of the
   * one feature that most changes how the product feels. The native Fullscreen
   * API is layered on top where it exists, because it also hides the browser's
   * own chrome, which CSS cannot touch.
   *
   * The native call is allowed to fail silently: a rejected promise here means
   * the browser said no, and the overlay has already done the important part.
   */
  const toggleImmersive = useCallback(() => {
    const next = !immersive;
    setImmersive(next);

    if (next) {
      shellRef.current?.requestFullscreen?.().catch(() => {});
    } else if (document.fullscreenElement) {
      document.exitFullscreen?.().catch(() => {});
    }
  }, [immersive]);

  // Leaving fullscreen with Escape bypasses our button entirely, so the overlay
  // has to follow the browser rather than the other way round.
  useEffect(() => {
    function onFullscreenChange() {
      if (!document.fullscreenElement) setImmersive(false);
    }
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  // Opening chat clears its badge; leaving it open keeps it clear.
  useEffect(() => {
    if (panel === "chat") interactions.markChatRead();
  }, [panel, interactions.chat.length, interactions.markChatRead]); // eslint-disable-line react-hooks/exhaustive-deps

  const room = roomRef.current;
  const participants: Participant[] = room
    ? [room.localParticipant, ...Array.from(room.remoteParticipants.values())]
    : [];
  const speakingIds = new Set((room?.activeSpeakers ?? []).map((participant) => participant.identity));

  // Who goes on the main stage: whoever is talking, else the tutor, else the
  // first person in the room. A language class is a conversation, so following
  // the speaker is right far more often than a fixed grid.
  const liveStage =
    participants.find((participant) => speakingIds.has(participant.identity) && participants.length > 1) ??
    participants.find((participant) => isTutor(participant)) ??
    participants[0];

  /**
   * The stage does not follow every noise.
   *
   * Raw active-speaker events fire on a cough, a chair, a "mm-hm" — and the
   * picture snapping to a new face four times in ten seconds is the single
   * cheapest-looking thing a video product can do. So a new speaker has to hold
   * the floor for `STAGE_DWELL_MS` before the stage moves to them.
   *
   * Debouncing matters more than the crossfade below. A hard cut you barely
   * notice beats a beautiful dissolve happening constantly.
   */
  useEffect(() => {
    const identity = liveStage?.identity;
    if (!identity || identity === stageIdentity) return;
    const timer = window.setTimeout(() => setStageIdentity(identity), STAGE_DWELL_MS);
    return () => window.clearTimeout(timer);
  }, [liveStage?.identity, stageIdentity]);

  const stageParticipant =
    participants.find((participant) => participant.identity === stageIdentity) ?? liveStage;
  const others = participants.filter((participant) => participant !== stageParticipant);

  const pill = QUALITY_PILL[quality];
  const myHandPosition = interactions.myHandRaised
    ? interactions.hands.findIndex((hand) => hand.mine) + 1
    : null;

  return (
    <div
      ref={shellRef}
      className={
        immersive
          ? // Edge-to-edge: content becomes the whole viewport and every piece of
            // portal chrome disappears behind it. This is the change that makes
            // it read as a product rather than a page in a dashboard.
            "fixed inset-0 z-50 flex flex-col gap-3 overflow-y-auto bg-slate-950 p-3 sm:p-4"
          : "space-y-4"
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-slate-900/90 px-5 py-3 text-white">
        <div className="flex min-w-0 items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-mark.png" alt="EasyWay" className="h-9 w-9 shrink-0 rounded-lg object-contain" />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{displayName}</p>
            <p className="text-xs text-slate-400">
              {participants.length} in the room · Room {roomName}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`rounded-full px-3 py-1 text-xs font-medium ${pill.className}`}>{pill.label}</span>
          {status === "reconnecting" ? (
            <span className="rounded-full bg-amber-500/15 px-3 py-1 text-xs font-medium text-amber-300">
              Reconnecting…
            </span>
          ) : null}
          <button
            onClick={toggleImmersive}
            aria-label={immersive ? "Leave full screen" : "Full screen"}
            title={immersive ? "Leave full screen" : "Full screen"}
            className="rounded-xl bg-white/10 p-2 text-white transition hover:bg-white/20"
          >
            {immersive ? <ShrinkIcon className="h-4 w-4" /> : <ExpandIcon className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/*
        Sound first, before anything else on the page. A muted classroom is not
        a degraded experience, it is no experience — and the fix is one tap that
        the student will never find on their own.
      */}
      {audioBlocked ? (
        <button
          onClick={() => roomRef.current?.startAudio().then(() => setAudioBlocked(false)).catch(() => {})}
          className="flex w-full items-center justify-center gap-3 rounded-2xl bg-[var(--accent)] px-5 py-4 text-sm font-semibold text-white shadow-lg transition hover:brightness-110"
        >
          <SpeakerOffIcon className="h-5 w-5" />
          Tap to turn on the sound
        </button>
      ) : null}

      {deviceNotice ? (
        <div className="flex flex-wrap items-start gap-3 rounded-2xl border border-amber-400/30 bg-amber-500/10 px-5 py-3 text-sm text-amber-200">
          <p className="min-w-0 flex-1 leading-6">{deviceNotice}</p>
          <button
            onClick={() => setDeviceNotice(null)}
            className="shrink-0 rounded-xl bg-white/10 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-white/20"
          >
            Dismiss
          </button>
        </div>
      ) : null}

      {autoNotice ? (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-amber-400/30 bg-amber-500/10 px-5 py-3 text-sm text-amber-200">
          <p className="min-w-0 flex-1 leading-6">
            Your connection was struggling, so we moved you from{" "}
            <span className="font-semibold">{qualitySpec(autoNotice.from).label}</span> to{" "}
            <span className="font-semibold">{qualitySpec(autoNotice.to).label}</span>.
            {autoNotice.to === "audio"
              ? " Your camera is off and the picture is gone, but you can still hear the lesson and still be heard."
              : " Your audio is untouched."}
          </p>
          <button
            onClick={() => changeMode(autoNotice.from)}
            className="shrink-0 rounded-xl bg-white/10 px-4 py-2 text-xs font-semibold text-white transition hover:bg-white/20"
          >
            Put it back
          </button>
        </div>
      ) : null}

      {status === "failed" ? (
        <div className="rounded-2xl border border-rose-400/30 bg-rose-500/10 p-6 text-sm text-rose-200">
          <p className="font-semibold">Could not join the classroom</p>
          <p className="mt-2">{error}</p>
        </div>
      ) : status === "connecting" ? (
        <div className="grid aspect-video w-full place-items-center rounded-3xl bg-slate-900">
          <BrandLoader size="md" title="Klassenzimmer wird geöffnet…" message="Connecting you to your class." />
        </div>
      ) : (
        <div className={`flex min-h-0 flex-1 gap-3 ${panel ? "lg:flex-row" : ""} flex-col`}>
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            {interactions.floor && interactions.floorName ? (
              <FloorBanner
                name={interactions.floorName}
                isMe={interactions.floor === room?.localParticipant.identity}
              />
            ) : null}

            {stageParticipant ? (
              <div className="relative">
                {/*
                  Crossfade rather than a hard cut. Combined with the dwell time
                  above, the stage now changes rarely and gently instead of
                  often and abruptly — the two together are what stop it feeling
                  cheap. `mode="popLayout"` lets the outgoing tile fade over the
                  incoming one; both attach the same track, which livekit-client
                  supports, so nothing goes black in between.
                */}
                <AnimatePresence mode="popLayout" initial={false}>
                  <motion.div
                    key={stageParticipant.identity}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.22, ease: "easeInOut" }}
                  >
                    <ParticipantTile
                      participant={stageParticipant}
                      mode={mode}
                      large
                      isSpeaking={speakingIds.has(stageParticipant.identity)}
                      revision={revision}
                    />
                  </motion.div>
                </AnimatePresence>

                {/* Over the video, so the tutor catches them without looking away. */}
                <ReactionLayer reactions={interactions.reactions} />
              </div>
            ) : null}

            {others.length > 0 ? (
              <div className="flex gap-3 overflow-x-auto pb-1">
                {others.map((participant) => (
                  <div key={participant.identity} className="shrink-0">
                    <ParticipantTile
                      participant={participant}
                      mode={mode}
                      isSpeaking={speakingIds.has(participant.identity)}
                      revision={revision}
                    />
                  </div>
                ))}
              </div>
            ) : (
              <p className="rounded-2xl bg-slate-900/60 px-5 py-4 text-sm text-slate-400">
                You are the first one here. The room stays open — others will appear as they join.
              </p>
            )}
          </div>

          {panel ? (
            <aside className="flex max-h-[26rem] min-h-0 w-full shrink-0 flex-col rounded-2xl bg-slate-900/90 p-3 lg:max-h-none lg:w-80">
              <div className="mb-2 flex items-center gap-1 rounded-xl bg-white/5 p-1">
                <button
                  onClick={() => setPanel("hands")}
                  className={`flex-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                    panel === "hands" ? "bg-white/15 text-white" : "text-slate-400 hover:text-white"
                  }`}
                >
                  Hands {interactions.hands.length > 0 ? `(${interactions.hands.length})` : ""}
                </button>
                <button
                  onClick={() => setPanel("chat")}
                  className={`flex-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                    panel === "chat" ? "bg-white/15 text-white" : "text-slate-400 hover:text-white"
                  }`}
                >
                  Chat
                </button>
                <button
                  onClick={() => setPanel(null)}
                  aria-label="Close panel"
                  className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-400 transition hover:text-white"
                >
                  ✕
                </button>
              </div>

              {panel === "hands" ? (
                <div className="min-h-0 flex-1 space-y-3 overflow-y-auto">
                  {role === "tutor" ? <ModeSwitch mode={interactions.mode} onChange={interactions.setMode} /> : null}
                  <HandQueue
                    hands={interactions.hands}
                    role={role}
                    floor={interactions.floor}
                    onGrantFloor={interactions.grantFloor}
                    onClearHands={interactions.clearHands}
                  />
                </div>
              ) : (
                <ChatPanel chat={interactions.chat} onSend={interactions.sendChat} />
              )}
            </aside>
          ) : null}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-slate-900/90 p-3">
        <button
          onClick={toggleMic}
          className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition ${
            micOn ? "bg-white/10 text-white hover:bg-white/20" : "bg-rose-500 text-white"
          }`}
        >
          {micOn ? <><MicIcon /> Mic on</> : <><MicOffIcon /> Mic off</>}
        </button>
        <button
          onClick={toggleCamera}
          className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition ${
            cameraOn ? "bg-white/10 text-white hover:bg-white/20" : "bg-white/5 text-slate-400 hover:bg-white/10"
          }`}
        >
          <CameraIcon /> {cameraOn ? "Camera on" : "Camera off"}
        </button>
        {role === "tutor" ? (
          <button
            onClick={toggleScreenShare}
            className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition ${
              screenSharing ? "bg-[var(--accent)] text-white" : "bg-white/10 text-white hover:bg-white/20"
            }`}
          >
            <ScreenShareIcon /> {screenSharing ? "Stop sharing" : "Share screen"}
          </button>
        ) : null}

        <button
          onClick={() => setPanel(panel === "hands" ? null : "hands")}
          className={`relative inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition ${
            panel === "hands" ? "bg-white/20 text-white" : "bg-white/10 text-white hover:bg-white/20"
          }`}
        >
          <HandIcon className="h-4 w-4" />
          Hands
          {interactions.hands.length > 0 ? (
            <span className="grid h-5 min-w-5 place-items-center rounded-full bg-amber-400 px-1 text-[10px] font-bold text-slate-900">
              {interactions.hands.length}
            </span>
          ) : null}
        </button>

        <button
          onClick={() => setPanel(panel === "chat" ? null : "chat")}
          className={`relative inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition ${
            panel === "chat" ? "bg-white/20 text-white" : "bg-white/10 text-white hover:bg-white/20"
          }`}
        >
          <CommunityIcon className="h-4 w-4" />
          Chat
          {interactions.unreadChat > 0 && panel !== "chat" ? (
            <span className="grid h-5 min-w-5 place-items-center rounded-full bg-[var(--accent)] px-1 text-[10px] font-bold text-white">
              {interactions.unreadChat}
            </span>
          ) : null}
        </button>

        <div className="ml-auto flex items-center gap-2">
          {availableModes.length > 1 ? (
            <>
              <label htmlFor="quality" className="text-xs font-medium text-slate-400">
                Video quality
              </label>
              <select
                id="quality"
                value={mode}
                onChange={(event) => changeMode(event.target.value as QualityMode)}
                className="rounded-xl bg-white/10 px-3 py-2 text-sm font-medium text-white"
              >
                {availableModes.map((spec) => (
                  <option key={spec.value} value={spec.value} className="text-slate-900">
                    {spec.label} · {spec.dataHint}
                  </option>
                ))}
              </select>
            </>
          ) : (
            // One rung means there is nothing to choose. A dropdown holding a
            // single option is a worse answer than a label.
            <span className="rounded-xl bg-white/5 px-3 py-2 text-xs font-medium text-slate-400">
              Teaching in {qualitySpec(mode).label}
            </span>
          )}
          <button onClick={leave} className="rounded-xl bg-rose-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-110">
            Leave
          </button>
        </div>
      </div>

      {/*
        The reaction bar gets its own row rather than joining the crowded
        control strip. These are the buttons a student presses most often
        during a lesson — and on a phone they must not be the ones that wrap
        off the end of a line.
      */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-slate-900/90 p-3">
        <ReactionBar
          onReact={interactions.react}
          onToggleHand={interactions.toggleHand}
          handRaised={interactions.myHandRaised}
          handPosition={myHandPosition}
        />
        <span className="text-[11px] font-medium text-slate-400">
          {ROOM_MODE_COPY[interactions.mode][role === "tutor" ? "tutor" : "student"]}
        </span>
      </div>

      <p className={`rounded-2xl bg-slate-900/60 px-5 py-3 text-xs leading-5 text-slate-400 ${immersive ? "hidden sm:block" : ""}`}>
        <span className="font-semibold text-slate-200">{qualitySpec(mode).label}:</span> {qualitySpec(mode).description} Roughly{" "}
        {qualitySpec(mode).dataHint.replace("~", "")}.{" "}
        {role === "tutor"
          ? "You always teach in Sharp, because the server sends each student the best layer their own connection can carry — turning yours down would turn it down for the whole class. Students pick their own setting."
          : "If your connection struggles we drop a level for you automatically — you can always put it back."}{" "}
        Audio stays full quality at every setting, and the class recording is always in your video library afterwards.
      </p>
    </div>
  );
}
