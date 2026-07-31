"use client";

import { CameraIcon, MicIcon, MicOffIcon, ScreenShareIcon, SpeakerOffIcon } from "@/components/icons";

import { useCallback, useEffect, useRef, useState } from "react";
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
import { QUALITY_MODES, qualitySpec, type QualityMode, type RoomRole } from "@/lib/live-classroom";

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
}: {
  participant: Participant;
  mode: QualityMode;
  large?: boolean;
  isSpeaking?: boolean;
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
    participant.on("trackSubscribed", attach);
    participant.on("trackUnsubscribed", attach);
    participant.on("trackMuted", attach);
    participant.on("trackUnmuted", attach);
    participant.on("trackPublished", attach);

    return () => {
      participant.off("trackSubscribed", attach);
      participant.off("trackUnsubscribed", attach);
      participant.off("trackMuted", attach);
      participant.off("trackUnmuted", attach);
      participant.off("trackPublished", attach);
      if (videoEl) {
        participant.getTrackPublication(Track.Source.Camera)?.track?.detach(videoEl);
        participant.getTrackPublication(Track.Source.ScreenShare)?.track?.detach(videoEl);
      }
      if (audioEl) participant.getTrackPublication(Track.Source.Microphone)?.track?.detach(audioEl);
    };
  }, [participant, showVideo]);

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
  // Room state lives on the Room object, not in React. Rather than mirroring it
  // (and drifting), events bump this counter and the component re-reads.
  const [, forceRender] = useState(0);
  const bump = useCallback(() => forceRender((n) => n + 1), []);

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
      .on(RoomEvent.ConnectionQualityChanged, (connectionQuality, participant) => {
        // Only our own link matters for the pill — a classmate's bad network
        // is the SFU's problem to absorb, not something to alarm us about.
        if (participant?.identity === room.localParticipant.identity) setQuality(connectionQuality);
      });

    (async () => {
      try {
        await room.connect(url, token);
        if (cancelled) return;
        await room.localParticipant.setMicrophoneEnabled(true);
        // Audio-only students never turn a camera on, so it is never asked for
        // — which also means the browser never prompts for camera permission.
        if (qualitySpec(initialQuality).publishesVideo) {
          await room.localParticipant.setCameraEnabled(true);
        }
        if (!cancelled) bump();
      } catch (connectError) {
        if (cancelled) return;
        console.error("LiveKit connect failed", connectError);
        setError(connectError instanceof Error ? connectError.message : "Could not join the classroom");
        setStatus("failed");
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
  const changeMode = useCallback(async (next: QualityMode) => {
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

  const toggleMic = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;
    const next = !micOn;
    await room.localParticipant.setMicrophoneEnabled(next);
    setMicOn(next);
  }, [micOn]);

  const toggleCamera = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;
    const next = !cameraOn;
    // Turning the camera on in audio-only mode is contradictory, so it lifts
    // the student into Data saver rather than silently doing nothing.
    if (next && !qualitySpec(mode).publishesVideo) await changeMode("low");
    await room.localParticipant.setCameraEnabled(next);
    setCameraOn(next);
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

  const room = roomRef.current;
  const participants: Participant[] = room
    ? [room.localParticipant, ...Array.from(room.remoteParticipants.values())]
    : [];
  const speakingIds = new Set((room?.activeSpeakers ?? []).map((participant) => participant.identity));

  // Who goes on the main stage: whoever is talking, else the tutor, else the
  // first person in the room. A language class is a conversation, so following
  // the speaker is right far more often than a fixed grid.
  const stageParticipant =
    participants.find((participant) => speakingIds.has(participant.identity) && participants.length > 1) ??
    participants.find((participant) => isTutor(participant)) ??
    participants[0];
  const others = participants.filter((participant) => participant !== stageParticipant);

  const pill = QUALITY_PILL[quality];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-slate-900/90 px-5 py-3 text-white">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{displayName}</p>
          <p className="text-xs text-slate-400">
            {participants.length} in the room · Room {roomName}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`rounded-full px-3 py-1 text-xs font-medium ${pill.className}`}>{pill.label}</span>
          {status === "reconnecting" ? (
            <span className="rounded-full bg-amber-500/15 px-3 py-1 text-xs font-medium text-amber-300">
              Reconnecting…
            </span>
          ) : null}
        </div>
      </div>

      {status === "failed" ? (
        <div className="rounded-2xl border border-rose-400/30 bg-rose-500/10 p-6 text-sm text-rose-200">
          <p className="font-semibold">Could not join the classroom</p>
          <p className="mt-2">{error}</p>
        </div>
      ) : status === "connecting" ? (
        <div className="grid aspect-video w-full place-items-center rounded-3xl bg-slate-900 text-slate-400">
          Joining the classroom…
        </div>
      ) : (
        <>
          {stageParticipant ? (
            <ParticipantTile
              participant={stageParticipant}
              mode={mode}
              large
              isSpeaking={speakingIds.has(stageParticipant.identity)}
            />
          ) : null}

          {others.length > 0 ? (
            <div className="flex gap-3 overflow-x-auto pb-1">
              {others.map((participant) => (
                <div key={participant.identity} className="shrink-0">
                  <ParticipantTile
                    participant={participant}
                    mode={mode}
                    isSpeaking={speakingIds.has(participant.identity)}
                  />
                </div>
              ))}
            </div>
          ) : (
            <p className="rounded-2xl bg-slate-900/60 px-5 py-4 text-sm text-slate-400">
              You are the first one here. The room stays open — others will appear as they join.
            </p>
          )}
        </>
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

        <div className="ml-auto flex items-center gap-2">
          <label htmlFor="quality" className="text-xs font-medium text-slate-400">
            Video quality
          </label>
          <select
            id="quality"
            value={mode}
            onChange={(event) => changeMode(event.target.value as QualityMode)}
            className="rounded-xl bg-white/10 px-3 py-2 text-sm font-medium text-white"
          >
            {QUALITY_MODES.map((spec) => (
              <option key={spec.value} value={spec.value} className="text-slate-900">
                {spec.label} · {spec.dataHint}
              </option>
            ))}
          </select>
          <button onClick={leave} className="rounded-xl bg-rose-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-110">
            Leave
          </button>
        </div>
      </div>

      <p className="rounded-2xl bg-slate-900/60 px-5 py-3 text-xs leading-5 text-slate-400">
        <span className="font-semibold text-slate-200">{qualitySpec(mode).label}:</span> {qualitySpec(mode).description} Roughly{" "}
        {qualitySpec(mode).dataHint.replace("~", "")}. If the video stutters, drop a level — your audio stays full quality at every
        setting, and the class recording is always in your video library afterwards.
      </p>
    </div>
  );
}
