"use client";

import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { Room, RoomEvent, Track, type Participant, type RemoteParticipant } from "livekit-client";
import EgressHelper from "@livekit/egress-sdk";
import { useRoomInteractions } from "@/components/live/useRoomInteractions";
import { roleOfMetadata } from "@/lib/live-room-protocol";

/**
 * The recording's own eyes — a custom LiveKit RoomComposite egress template,
 * not a page any student or tutor ever opens. LiveKit's egress service loads
 * this in a headless browser, connects it to the room as a hidden
 * participant (`getLiveKitURL()`/`getAccessToken()` read the `url`/`token`
 * query params egress appends), and captures whatever this page renders and
 * plays as the video file.
 *
 * WHY THIS EXISTS rather than the built-in `layout: "speaker"` template:
 * the built-in templates only know generic loudness-based active-speaker
 * detection. This classroom already has a richer, TAUGHT concept of who the
 * room is looking at — `useRoomInteractions`'s `floor` (see
 * useRoomInteractions.ts's own "WHERE THE GREEN LIGHT GOES" comment) — and no
 * built-in template can know about it. The rule this page renders, matching
 * what was asked for:
 *
 *   - Nobody sharing, nobody holding the floor  → tutor only, full frame.
 *   - Tutor shares their screen                 → screen share is the main
 *     view; the tutor (and the floor-holder, if that's a different person)
 *     appear as small labelled boxes.
 *   - Tutor gives a student the floor            → tutor stays the main
 *     view, the floor-holder gets a small labelled box, same as their
 *     camera would if they were screen-sharing.
 *
 * AUDIO: this project does not have `@livekit/components-react` installed
 * (React 19 peer-dep conflict — see [[project-live-classroom]]), so there is
 * no `<RoomAudioRenderer>` to reach for. The egress service only captures
 * what this page's browser tab actually plays — so EVERY remote
 * participant's microphone is attached to a hidden `<audio>` element below,
 * regardless of whether they are visually on screen. Skipping that would
 * make the recording silent for anyone not in a box, which would also break
 * the transcription pipeline this whole feature feeds — see
 * [[project-class-notes-pipeline]].
 */
export default function EgressTemplatePage() {
  // Created inside an effect, not during render — `Room` touches browser-only
  // APIs, and this component still goes through a server render pass for its
  // initial HTML like any other "use client" page. LiveKitClassroom.tsx's own
  // `new Room()` call lives inside a `useEffect` for the same reason; this
  // mirrors that rather than the lazy-ref-init shortcut, which would run on
  // the server too.
  const [room, setRoom] = useState<Room | null>(null);
  const [failed, setFailed] = useState(false);
  // Topology only (participants/tracks) — NOT ActiveSpeakersChanged, which
  // fires many times a second while anyone talks. `useRoomInteractions`'s own
  // `floor` state does not depend on this at all (it comes from a data-channel
  // listener), so there is no cost to keeping this coarse.
  const [topologyRevision, bumpTopology] = useReducer((n: number) => n + 1, 0);
  const startedRef = useRef(false);

  useEffect(() => {
    let disposed = false;
    const instance = new Room();

    instance
      .on(RoomEvent.ParticipantConnected, bumpTopology)
      .on(RoomEvent.ParticipantDisconnected, bumpTopology)
      .on(RoomEvent.TrackSubscribed, bumpTopology)
      .on(RoomEvent.TrackUnsubscribed, bumpTopology)
      .on(RoomEvent.TrackMuted, bumpTopology)
      .on(RoomEvent.TrackUnmuted, bumpTopology)
      .on(RoomEvent.LocalTrackPublished, bumpTopology)
      .on(RoomEvent.LocalTrackUnpublished, bumpTopology);

    // `getLiveKitURL()`/`getAccessToken()` throw SYNCHRONOUSLY when the
    // `url`/`token` query params egress is supposed to supply are missing —
    // which they always will be for anyone (a crawler, a curious visitor)
    // who opens this URL directly rather than LiveKit's own egress service.
    // A throw here happens as an argument to `.connect()`, before there is
    // any promise to `.catch()` — wrapping the whole thing is what turns
    // that into the same graceful "waiting" state as a connection failure,
    // instead of an uncaught exception. Found by hitting this URL bare in
    // production right after deploying it.
    try {
      const url = EgressHelper.getLiveKitURL();
      const token = EgressHelper.getAccessToken();
      instance
        .connect(url, token)
        .then(() => {
          if (disposed) return;
          EgressHelper.setRoom(instance);
          setRoom(instance);
          bumpTopology();
        })
        .catch((error) => {
          console.error("[egress-template] could not connect to the room:", error);
          if (!disposed) setFailed(true);
        });
    } catch (error) {
      console.error("[egress-template] missing url/token query params:", error);
      setFailed(true);
    }

    return () => {
      disposed = true;
      instance.disconnect();
    };
    // Runs exactly once: EgressHelper reads the url/token query params once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const interactions = useRoomInteractions(room, "student", topologyRevision);

  const remoteParticipants = useMemo(
    () => (room ? Array.from(room.remoteParticipants.values()) : []),
    // `room.remoteParticipants` is a Map that mutates in place — topologyRevision
    // is the real, intentional dependency here, not a missing one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [room, topologyRevision],
  );

  const tutor = remoteParticipants.find((participant) => roleOfMetadata(participant.metadata) === "tutor") ?? null;
  const screenSharer =
    remoteParticipants.find((participant) => Boolean(participant.getTrackPublication(Track.Source.ScreenShare)?.track)) ?? null;
  const floorHolder = interactions.floor
    ? remoteParticipants.find((participant) => participant.identity === interactions.floor) ?? null
    : null;

  type Tile = { participant: RemoteParticipant; source: Track.Source };
  let main: Tile | null = null;
  const side: Tile[] = [];

  if (screenSharer) {
    main = { participant: screenSharer, source: Track.Source.ScreenShare };
    if (tutor && tutor.identity !== screenSharer.identity) side.push({ participant: tutor, source: Track.Source.Camera });
    if (floorHolder && floorHolder.identity !== screenSharer.identity && floorHolder.identity !== tutor?.identity) {
      side.push({ participant: floorHolder, source: Track.Source.Camera });
    }
  } else if (tutor) {
    main = { participant: tutor, source: Track.Source.Camera };
    if (floorHolder && floorHolder.identity !== tutor.identity) side.push({ participant: floorHolder, source: Track.Source.Camera });
  }

  // Start once we're connected — this page has nothing more to wait for; a
  // few frames of "waiting for the tutor" before they publish video is a far
  // better failure mode than never starting the capture at all.
  useEffect(() => {
    if (room && !startedRef.current) {
      startedRef.current = true;
      EgressHelper.startRecording();
    }
  }, [room]);

  if (failed) {
    return <Backdrop label="Reconnecting…" />;
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "#0b0b0e", overflow: "hidden" }}>
      {main ? (
        <VideoTile participant={main.participant} source={main.source} full />
      ) : (
        <Backdrop label="Waiting for the tutor to join…" />
      )}

      {side.length > 0 ? (
        <div
          style={{
            position: "absolute",
            top: 24,
            right: 24,
            display: "flex",
            flexDirection: "column",
            gap: 16,
            width: "22%",
            minWidth: 200,
            maxWidth: 320,
          }}
        >
          {side.map((tile) => (
            <VideoTile key={tile.participant.identity} participant={tile.participant} source={tile.source} />
          ))}
        </div>
      ) : null}

      {/* Audio only — see the module comment. Every remote voice, whether or
          not that person has a box on screen right now. */}
      {remoteParticipants.map((participant) => (
        <ParticipantAudio key={`audio-${participant.identity}`} participant={participant} revision={topologyRevision} />
      ))}
    </div>
  );
}

function Backdrop({ label }: { label: string }) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#8a8a93",
        fontFamily: "system-ui, sans-serif",
        fontSize: 22,
      }}
    >
      {label}
    </div>
  );
}

/** One labelled video box. `full` fills the frame; otherwise it's a small side tile. */
function VideoTile({ participant, source, full = false }: { participant: Participant; source: Track.Source; full?: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const publication = participant.getTrackPublication(source);
  const track = publication?.track;

  useEffect(() => {
    const element = videoRef.current;
    if (!element || !track) return;
    track.attach(element);
    return () => {
      track.detach(element);
    };
  }, [track]);

  const name = participant.name || participant.identity;

  return (
    <div
      style={{
        position: full ? "absolute" : "relative",
        inset: full ? 0 : undefined,
        width: full ? "100%" : "100%",
        aspectRatio: full ? undefined : "16 / 9",
        borderRadius: full ? 0 : 16,
        overflow: "hidden",
        background: "#16161c",
        boxShadow: full ? "none" : "0 8px 24px rgba(0,0,0,0.45)",
      }}
    >
      {track ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          style={{
            width: "100%",
            height: "100%",
            objectFit: source === Track.Source.ScreenShare ? "contain" : "cover",
            background: "#16161c",
          }}
        />
      ) : (
        <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#5a5a63", fontFamily: "system-ui, sans-serif" }}>
          {name}
        </div>
      )}
      <div
        style={{
          position: "absolute",
          left: 10,
          bottom: 10,
          padding: "4px 10px",
          borderRadius: 999,
          background: "rgba(0,0,0,0.55)",
          color: "#fff",
          fontSize: full ? 15 : 12,
          fontWeight: 600,
          fontFamily: "system-ui, sans-serif",
        }}
      >
        {name}
      </div>
    </div>
  );
}

/** Hidden playback for one participant's microphone. Visual is optional; audio in the recording is not. */
function ParticipantAudio({ participant, revision }: { participant: RemoteParticipant; revision: number }) {
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    const publication = participant.getTrackPublication(Track.Source.Microphone);
    const track = publication?.track;
    const element = audioRef.current;
    if (!element || !track) return;
    track.attach(element);
    return () => {
      track.detach(element);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [participant, revision]);

  return <audio ref={audioRef} autoPlay />;
}
