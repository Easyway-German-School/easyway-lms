"use client";

/**
 * SILENT SUPERVISION — the office watching a live class without joining it.
 *
 * This connects to the LiveKit room with a token minted by
 * `/api/admin/live/observe`: `hidden`, subscribe-only, no data channel. The
 * consequences are all the SFU's to enforce, not this component's —
 *
 *   - the tutor and students are never told an observer arrived (no join
 *     sound, the room's headcount does not move, no tile appears);
 *   - there is nothing here that publishes a camera, a microphone, a chat
 *     line or a reaction, and the token would refuse it if there were;
 *   - opening this panel writes nothing to the class's records — no
 *     attendance, no LiveClassSession, no recording.
 *
 * So this file is deliberately thin: attach every remote video worth showing,
 * attach every remote microphone (a supervisor is here for the audio above
 * all), and get out of the way. No controls, because there is nothing an
 * observer is allowed to do.
 *
 * The banner is not decoration. An admin who forgets they are invisible is one
 * misread situation away from acting on something they were never seen to
 * witness — it stays on screen the whole time.
 */

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { Room, RoomEvent, Track, type Participant, type RemoteParticipant } from "livekit-client";
import { createPortal } from "react-dom";
import BrandLoader from "@/components/BrandLoader";
import { EyeIcon, ExitIcon, ScreenShareIcon, SpeakerOffIcon } from "@/components/icons";
import { roleOfMetadata } from "@/lib/live-room-protocol";

type Props = {
  roomName: string;
  title: string;
  onClose: () => void;
};

type Phase = "loading" | "connecting" | "watching" | "ended" | "failed";

export default function AdminObserver({ roomName, title, onClose }: Props) {
  const roomRef = useRef<Room | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState<string>("");
  const [audioBlocked, setAudioBlocked] = useState(false);
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
      .on(RoomEvent.AudioPlaybackStatusChanged, () => {
        if (!cancelled) setAudioBlocked(!room.canPlaybackAudio);
      })
      .on(RoomEvent.Disconnected, () => {
        // The class ended, or our 3-hour token ran out. Either way there is
        // nothing left to watch — say so rather than freezing on a black grid.
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
        const res = await fetch(`/api/admin/live/observe?room=${encodeURIComponent(roomName)}`, {
          cache: "no-store",
        });
        const data = await res.json().catch(() => ({}) as { url?: string; token?: string; error?: string });
        if (cancelled) return;
        if (!res.ok || !data.url || !data.token) {
          setError(data.error || "Could not open a supervision session for that class.");
          setPhase("failed");
          return;
        }
        setPhase("connecting");
        await room.connect(data.url, data.token);
        if (cancelled) return;
        setPhase("watching");
        bumpTopology();
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
  }, [roomName]);

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
    <div className="fixed inset-0 z-[60] flex flex-col bg-slate-950 text-white">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-5 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-amber-500/15 text-amber-300">
            <EyeIcon className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{title}</p>
            <p className="text-xs text-slate-400">
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
        <button
          onClick={onClose}
          className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-white/10 px-4 py-2 text-sm font-semibold transition hover:bg-white/20"
        >
          <ExitIcon className="h-4 w-4" />
          Stop watching
        </button>
      </div>

      {/* Silent-supervision banner — always on, never dismissible. */}
      <div className="flex items-center gap-2.5 bg-amber-500/15 px-5 py-2 text-xs font-medium text-amber-200">
        <EyeIcon className="h-4 w-4 shrink-0" />
        <span>
          You are watching silently. The tutor and students have <span className="font-bold">not</span> been told
          you are here — you are not in their participant list and no one was pinged. This visit is recorded in the
          audit trail.
        </span>
      </div>

      {audioBlocked && phase === "watching" ? (
        <button
          onClick={enableAudio}
          className="flex w-full items-center justify-center gap-3 bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-white transition hover:brightness-110"
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
            <div className="max-w-md rounded-2xl border border-white/10 bg-white/5 p-6 text-center text-sm text-slate-300">
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
                <div className="grid h-full place-items-center rounded-2xl bg-slate-900 text-sm text-slate-400">
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

  useEffect(() => {
    const el = videoRef.current;
    const screenPub = participant.getTrackPublication(Track.Source.ScreenShare);
    const cameraPub = participant.getTrackPublication(Track.Source.Camera);
    const pub = source === Track.Source.ScreenShare ? screenPub : screenPub?.track ? screenPub : cameraPub;
    if (el && pub?.track) {
      pub.track.attach(el);
      setHasVideo(true);
      return () => {
        pub.track?.detach(el);
      };
    }
    setHasVideo(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [participant, source, revision]);

  const name = participant.name || participant.identity;
  const isScreen = source === Track.Source.ScreenShare;

  return (
    <div
      className={`relative overflow-hidden rounded-2xl bg-slate-900 ring-1 ring-white/10 ${
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
        <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-slate-800 to-slate-900">
          <div
            className={`grid place-items-center rounded-full bg-white/10 font-semibold text-white ${
              full ? "h-20 w-20 text-2xl" : "h-9 w-9 text-xs"
            }`}
          >
            {name.slice(0, 1).toUpperCase()}
          </div>
        </div>
      ) : null}
      <div className="absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-gradient-to-t from-black/80 to-transparent px-2 py-1.5">
        {isScreen ? <ScreenShareIcon className="h-3 w-3 shrink-0 text-slate-300" /> : null}
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

  useEffect(() => {
    const pub = participant.getTrackPublication(Track.Source.Microphone);
    const el = audioRef.current;
    if (el && pub?.track) {
      pub.track.attach(el);
      return () => {
        pub.track?.detach(el);
      };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [participant, revision]);

  return <audio ref={audioRef} autoPlay />;
}
