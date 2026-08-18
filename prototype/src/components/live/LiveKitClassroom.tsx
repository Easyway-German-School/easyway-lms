"use client";

import {
  CameraIcon,
  CommunityIcon,
  DeviceIcon,
  DotsVerticalIcon,
  ExitIcon,
  ExpandIcon,
  QuizIcon,
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
import { FloorLight, HandFlag, SpeakingWave } from "./SpeakingIndicators";
import { useAudioLevels, type AudioLevelStore } from "./useAudioLevels";
import { useRouter } from "next/navigation";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ConnectionQuality,
  DisconnectReason,
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

/**
 * HOW THIS PERSON'S LESSON ENDED, which is not the same question as whether it
 * ended. The end screen says four different things and offers four different
 * ways forward depending on this one field:
 *
 *   self    — they pressed Leave. The class may well still be running, so the
 *             screen offers a way straight back in.
 *   ended   — the tutor closed the class. There is nothing to go back to; the
 *             recording is the offer instead.
 *   dropped — the connection went and did not recover. The worst case to get
 *             wrong: telling somebody the class ended when their WiFi died is
 *             how a student stops trusting the portal.
 *   removed — the tutor removed them specifically. LiveKit hands back this
 *             exact fact as `DisconnectReason.PARTICIPANT_REMOVED`, which is
 *             what keeps it from being misreported as "dropped" — a student
 *             who was asked to leave should not be told their WiFi failed.
 *   switched — they (or someone with their login) opened this same class on
 *             another device. LiveKit refuses a second connection under one
 *             identity by disconnecting the first with `DUPLICATE_IDENTITY`,
 *             which is otherwise indistinguishable from "removed" — and
 *             telling somebody they were removed when they just switched to
 *             their phone is its own way of losing their trust.
 */
export type LeaveOutcome = {
  reason: "self" | "ended" | "dropped" | "removed" | "switched";
  /** How long this person was actually in the room, not how long the class ran. */
  durationMs: number;
};

type LiveKitClassroomProps = {
  url: string;
  token: string;
  roomName: string;
  displayName: string;
  role: RoomRole;
  initialQuality: QualityMode;
  onLeave: (outcome: LeaveOutcome) => void;
  /** So a tutor can jump straight to hosting a quiz for THIS class. Null for a room with no LiveClassSession row (e.g. an ad-hoc catch-up). */
  liveSessionId?: string | null;
  /**
   * Rendered as a small floating card instead of the full classroom when
   * true. The Room connection is unaffected either way — this only changes
   * which JSX branch is returned, never whether the room is open. Owned by
   * `LiveCallDock`, not by this component: minimizing must survive
   * navigation, which means the decision has to live above the route.
   */
  minimized?: boolean;
  /** Shown in full mode's header. Absent when the component isn't hosted inside a dock that supports minimizing. */
  onMinimize?: () => void;
  /** Shown in minimized mode's card. Restores full view and (if needed) navigates back to /live. */
  onExpand?: () => void;
  /** Wired to the minimized card's drag handle; the dock owns the actual position state. */
  onDragHandlePointerDown?: (event: React.PointerEvent) => void;
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
  revision: topologyRevision,
  levels,
  handPosition,
  light,
  viewerRole,
  moderationBusy,
  onMute,
  onRemove,
}: {
  participant: Participant;
  mode: QualityMode;
  large?: boolean;
  isSpeaking?: boolean;
  /**
   * Bumped by track/participant topology events only (publish, subscribe,
   * mute, connect, disconnect) — deliberately NOT by `ActiveSpeakersChanged`.
   * It is a dependency of the attach effect, and that is the whole point —
   * see the comment inside. If this ever gets wired back to something that
   * fires on every speaking event, every tile's video/audio element will
   * detach and reattach (a visible blink) each time anyone talks.
   */
  revision: number;
  levels: AudioLevelStore;
  /** 1-based place in the hand queue, or null for a hand that is down. */
  handPosition: number | null;
  /** Set on the ONE tile that currently owns the travelling green light. */
  light: { label: string; tone: "floor" | "speaking" } | null;
  /** Who is looking at this tile — the moderation menu only exists for a tutor. */
  viewerRole: RoomRole;
  /** Identities with a moderation action in flight, so a second tap cannot queue behind the first. */
  moderationBusy: Set<string>;
  onMute: (identity: string) => void;
  onRemove: (identity: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [hasVideo, setHasVideo] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // A menu left open when the finger lands somewhere else is a menu that
  // stays open forever on a phone, where there is no hover-away to close it.
  useEffect(() => {
    if (!menuOpen) return;
    function onOutside(event: MouseEvent | TouchEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
        setConfirmRemove(false);
      }
    }
    document.addEventListener("mousedown", onOutside);
    document.addEventListener("touchstart", onOutside);
    return () => {
      document.removeEventListener("mousedown", onOutside);
      document.removeEventListener("touchstart", onOutside);
    };
  }, [menuOpen]);

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
     * Depending on `topologyRevision` re-runs this on every topology event,
     * which is the cheap and reliable version of the fix. `track.attach(el)`
     * on an element it is already attached to is a no-op, so re-running costs
     * nothing — as long as it isn't re-running on every speaking tick too,
     * which is what `topologyRevision` (as opposed to the room's general
     * `revision`) exists to prevent.
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
  }, [participant, showVideo, topologyRevision]);

  const micMuted = !participant.isMicrophoneEnabled;
  const tutor = isTutor(participant);
  const initials = (participant.name || participant.identity || "?").slice(0, 1).toUpperCase();

  /**
   * Who a tutor is allowed to point this menu at.
   *
   * Not your own tile — Leave already does that job, and a mute/remove button
   * aimed at yourself is a trap, not a feature. Not another tutor's tile
   * either: the server enforces this too (`/api/live/moderate` rejects a
   * tutor-on-tutor target), but hiding the menu is what stops a co-teacher
   * from seeing a button that only ever errors.
   */
  const canModerate = viewerRole === "tutor" && !(participant instanceof LocalParticipant) && !tutor;
  const busy = moderationBusy.has(participant.identity);

  /**
   * The cubicle's own border says which of four things is true about the person
   * in it, in the order that matters when two are true at once: they have been
   * given the floor, they are waiting for it, they are talking, or none of the
   * above. Floor outranks hand because a tutor who has just called on somebody
   * should not still see them ringed as "waiting".
   */
  const ring = light?.tone === "floor"
    ? "ring-emerald-400 shadow-[0_0_0_4px_rgba(52,211,153,0.18)]"
    : handPosition !== null
      ? "ring-amber-400"
      : isSpeaking
        ? "ring-[var(--accent)]"
        : "ring-white/10";

  return (
    <div
      className={`relative overflow-hidden rounded-2xl bg-slate-900 ring-2 transition ${ring} ${
        large ? "aspect-video w-full" : TILE_SIZE[mode]
      }`}
    >
      {light ? <FloorLight label={light.label} tone={light.tone} /> : null}
      {handPosition !== null ? <HandFlag position={handPosition} /> : null}
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

        Moved off the top-right corner, which the raised-hand flag now owns. A
        logo overlapping a hand somebody is waiting behind is the wrong thing to
        keep in that corner, and the mark still lands in the recording here.
      */}
      {large ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src="/logo-mark.png"
          alt=""
          aria-hidden="true"
          className="pointer-events-none absolute bottom-10 right-3 h-8 w-8 object-contain opacity-70 drop-shadow-[0_2px_6px_rgba(0,0,0,0.6)]"
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
        {/*
          The meter replaces the microphone icon rather than sitting beside it,
          because they answer the same question and only one of them can be
          true. A muted mic shows the crossed speaker; a live one shows how loud
          this person is right now, which is the only version of "your
          microphone is working" a student will believe.
        */}
        {micMuted ? (
          <SpeakerOffIcon className="h-3.5 w-3.5 shrink-0 text-rose-400" />
        ) : (
          <SpeakingWave store={levels} identity={participant.identity} size={large ? "lg" : "sm"} />
        )}
        <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-white">
          {participant instanceof LocalParticipant ? "You" : participant.name || participant.identity}
        </span>
        {tutor ? (
          <span className="shrink-0 rounded-full bg-[var(--accent)] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white">Tutor</span>
        ) : null}

        {canModerate ? (
          <div ref={menuRef} className="relative shrink-0">
            <button
              onClick={() => setMenuOpen((open) => !open)}
              aria-label={`Moderate ${participant.name || participant.identity}`}
              disabled={busy}
              className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-white/80 transition hover:bg-white/15 hover:text-white disabled:opacity-40"
            >
              <DotsVerticalIcon className="h-4 w-4" />
            </button>
            {menuOpen ? (
              <div className="absolute bottom-full right-0 z-20 mb-1.5 w-44 overflow-hidden rounded-xl border border-white/10 bg-slate-900 py-1 text-left shadow-2xl">
                <button
                  onClick={() => {
                    onMute(participant.identity);
                    setMenuOpen(false);
                  }}
                  disabled={micMuted || busy}
                  className="flex w-full items-center gap-2 px-3 py-2 text-xs font-medium text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:text-slate-500 disabled:hover:bg-transparent"
                >
                  <SpeakerOffIcon className="h-3.5 w-3.5" />
                  {micMuted ? "Already muted" : "Mute microphone"}
                </button>
                <button
                  onClick={() => {
                    if (!confirmRemove) {
                      setConfirmRemove(true);
                      return;
                    }
                    onRemove(participant.identity);
                    setMenuOpen(false);
                    setConfirmRemove(false);
                  }}
                  disabled={busy}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-xs font-semibold transition hover:bg-rose-500/15 ${
                    confirmRemove ? "text-rose-300" : "text-rose-400"
                  }`}
                >
                  <ExitIcon className="h-3.5 w-3.5" />
                  {confirmRemove ? "Tap again to confirm" : "Remove from class"}
                </button>
              </div>
            ) : null}
          </div>
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
/**
 * The green light is allowed to move sooner than the stage does.
 *
 * Moving the picture is expensive — it changes what everyone is looking at, so
 * it waits. Moving a small light is cheap and is the thing you glance at to
 * follow a conversation, so it tracks nearly live. Different jobs, different
 * dwell times; giving them one constant made one of them wrong.
 */
const LIGHT_DWELL_MS = 600;
/** But it lingers before going dark, so a breath does not switch it off. */
const LIGHT_RELEASE_MS = 1400;
/**
 * How long a tile's speaking ring holds after the SFU stops reporting them.
 *
 * `room.activeSpeakers` is recomputed a few times a second and a normal
 * sentence has gaps in it — a comma, a breath, the word "um". Ringed straight
 * off `activeSpeakers` with no hold, every tile in a room flickered its border
 * on and off several times a second, which is the exact "too much blinking"
 * a video call should never produce. The ring turns on the instant the SFU
 * says somebody is speaking — that half has no delay, because a slow-to-light
 * ring is its own kind of wrong — and turns off only after this hold expires
 * with no further sign of them.
 */
const RING_RELEASE_MS = 550;

export default function LiveKitClassroom({
  url,
  token,
  roomName,
  displayName,
  role,
  initialQuality,
  onLeave,
  liveSessionId = null,
  minimized = false,
  onMinimize,
  onExpand,
  onDragHandlePointerDown,
}: LiveKitClassroomProps) {
  const router = useRouter();
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
  /** Which tile the travelling green light is parked on. */
  const [lightIdentity, setLightIdentity] = useState<string | null>(null);
  const [immersive, setImmersive] = useState(false);
  const [panel, setPanel] = useState<"hands" | "chat" | "switch" | null>(null);
  /**
   * A quiz the tutor has unlocked for this cohort, or null.
   *
   * Only ever set from the poll below — nothing here creates a game. The
   * gate that matters (a student can only ever join a game their own tutor
   * created for their own branch/level/session) lives entirely server-side
   * in `joinableGameForStudent`; this banner is discoverability, not the
   * lock. See `/api/live-quiz/join` GET.
   */
  const [quizGame, setQuizGame] = useState<{ id: string; title: string; phase: string; joined: boolean } | null>(
    null,
  );
  const [quizDismissed, setQuizDismissed] = useState(false);
  const shellRef = useRef<HTMLDivElement>(null);
  // Room state lives on the Room object, not in React. Rather than mirroring it
  // (and drifting), events bump this counter and the component re-reads.
  const [revision, forceRender] = useState(0);
  const bump = useCallback(() => forceRender((n) => n + 1), []);
  /**
   * A SEPARATE counter for track/participant topology only — publish,
   * subscribe, mute, connect, disconnect. Tiles take this one as a prop so
   * their attach effect re-runs — see ParticipantTile.
   *
   * It used to be the same counter as `revision`, which is also bumped by
   * `ActiveSpeakersChanged` — an event LiveKit fires many times a second
   * while anyone is talking. Since the attach effect's cleanup detaches the
   * video/audio element before every re-run, that meant every tile in the
   * room detached and reattached its media stream (a visible black flash)
   * on every speaking tick, for anyone at all speaking, not just the tile
   * whose track actually changed. Splitting it so only real topology events
   * re-run the attach effect keeps the fix for the blank-camera bug (see the
   * comment in ParticipantTile) without also re-triggering it on every
   * speaking event.
   */
  const [topologyRevision, forceTopologyRender] = useState(0);
  const bumpTopology = useCallback(() => forceTopologyRender((n) => n + 1), []);
  const bumpAll = useCallback(() => {
    bump();
    bumpTopology();
  }, [bump, bumpTopology]);

  /** Set while our own click is inside `setMicrophoneEnabled`, so the forced-mute listener below can tell a self-toggle from a tutor's mute. */
  const selfMicToggleRef = useRef(false);
  /** Tells the student their mic was muted by the tutor, or tells the tutor a moderation action failed. Same banner, different audience. */
  const [moderationNotice, setModerationNotice] = useState<string | null>(null);
  /** Identities (or "__all__") with a moderation request in flight. */
  const [moderationBusy, setModerationBusy] = useState<Set<string>>(() => new Set());
  /** Sticky, debounced "is this tile ringed as speaking" — see RING_RELEASE_MS. */
  const [ringIds, setRingIds] = useState<Set<string>>(() => new Set());
  const ringTimersRef = useRef<Map<string, number>>(new Map());

  /** When this person actually got in. Set on Connected, read by the end screen. */
  const joinedAtRef = useRef<number>(Date.now());
  /** A departure is reported once. Three paths lead here and they can race. */
  const leftRef = useRef(false);
  /**
   * A tutor's Leave does not just leave — it broadcasts `ended` and closes the
   * class for every student currently in the room. A single mis-tap used to be
   * enough to do that with no way back, which is exactly what happened during a
   * live test: a class ended on a student's phone before they had even properly
   * joined. So a tutor's first tap only arms the button; it has to be tapped
   * again to actually go through. A student's Leave only ever affects the
   * student, so it fires immediately — there is nothing to guard against.
   */
  const [confirmLeave, setConfirmLeave] = useState(false);
  const confirmLeaveTimerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (confirmLeaveTimerRef.current) window.clearTimeout(confirmLeaveTimerRef.current);
    },
    [],
  );

  const finish = useCallback(
    (reason: LeaveOutcome["reason"]) => {
      if (leftRef.current) return;
      leftRef.current = true;
      onLeave({ reason, durationMs: Date.now() - joinedAtRef.current });
    },
    [onLeave],
  );

  // Read by the room's event handlers, which are wired once at connect time and
  // must not re-subscribe every time the parent re-renders a new `onLeave`.
  const finishRef = useRef(finish);
  useEffect(() => {
    finishRef.current = finish;
  }, [finish]);

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
        // The clock the end screen reports starts here, not at mount: the
        // seconds spent negotiating a connection are not minutes of lesson.
        joinedAtRef.current = Date.now();
        setStatus("connected");
        bumpAll();
      })
      .on(RoomEvent.Reconnecting, () => setStatus("reconnecting"))
      .on(RoomEvent.Reconnected, () => setStatus("connected"))
      .on(RoomEvent.Disconnected, (reason) => {
        setStatus("disconnected");
        /**
         * `cancelled` is set by the cleanup below BEFORE it disconnects, so an
         * unmount cannot come through here — and `finish` refuses a second
         * call, so pressing Leave (which disconnects deliberately) does not
         * report the same departure twice.
         *
         * Anything left is a real drop, a tutor's removal, or a second device
         * taking over this identity, and the reason LiveKit hands back is how
         * those are told apart — `PARTICIPANT_REMOVED` is the one case where
         * "your connection dropped" would be an outright lie, and
         * `DUPLICATE_IDENTITY` is the one case where "removed" would be.
         */
        if (!cancelled) {
          finishRef.current(
            reason === DisconnectReason.PARTICIPANT_REMOVED
              ? "removed"
              : reason === DisconnectReason.DUPLICATE_IDENTITY
                ? "switched"
                : "dropped",
          );
        }
      })
      .on(RoomEvent.ParticipantConnected, bumpAll)
      .on(RoomEvent.ParticipantDisconnected, bumpAll)
      .on(RoomEvent.TrackSubscribed, bumpAll)
      .on(RoomEvent.TrackUnsubscribed, bumpAll)
      .on(RoomEvent.TrackMuted, bumpAll)
      .on(RoomEvent.TrackMuted, (publication, trackParticipant) => {
        // A server-forced mute (the tutor's Mute button) and a self-toggle both
        // fire this same event — `selfMicToggleRef` is the only way to tell
        // them apart, since LiveKit does not say who asked.
        if (
          trackParticipant.identity === room.localParticipant.identity &&
          publication.source === Track.Source.Microphone &&
          !selfMicToggleRef.current
        ) {
          setMicOn(false);
          setModerationNotice("Your microphone was muted by the tutor.");
        }
      })
      .on(RoomEvent.TrackUnmuted, bumpAll)
      // Deliberately plain `bump`, NOT `bumpAll` — see the comment on
      // `topologyRevision` above. This event fires many times a second while
      // anyone is speaking, and must never re-run a tile's media attach effect.
      .on(RoomEvent.ActiveSpeakersChanged, bump)
      .on(RoomEvent.LocalTrackPublished, bumpAll)
      .on(RoomEvent.LocalTrackUnpublished, bumpAll)
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
        bumpAll();
      }
    })();

    return () => {
      cancelled = true;
      room.disconnect();
      roomRef.current = null;
    };
  }, [url, token, initialQuality, bump, bumpAll]);

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
    selfMicToggleRef.current = true;
    try {
      await room.localParticipant.setMicrophoneEnabled(next);
      setMicOn(next);
      setDeviceNotice(null);
    } catch (micError) {
      setDeviceNotice(mediaErrorMessage(micError, "microphone"));
    } finally {
      selfMicToggleRef.current = false;
    }
  }, [micOn]);

  /**
   * The tutor's kebab-menu actions and the toolbar's Mute all, in one place.
   *
   * `identity` is omitted for `muteAll` — there is nobody to target, the
   * action is the room itself — which is also why its busy key is the literal
   * string `"__all__"` rather than an identity nothing owns.
   */
  const moderate = useCallback(
    async (action: "mute" | "muteAll" | "remove", identity?: string) => {
      const key = identity ?? "__all__";
      setModerationBusy((current) => new Set(current).add(key));
      try {
        const res = await fetch("/api/live/moderate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ roomName, action, identity }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}) as { message?: string; error?: string });
          setModerationNotice(data.message || data.error || "That action did not go through.");
        }
      } catch {
        setModerationNotice("Could not reach the server. Check your connection and try again.");
      } finally {
        setModerationBusy((current) => {
          const next = new Set(current);
          next.delete(key);
          return next;
        });
      }
    },
    [roomName],
  );

  const muteParticipant = useCallback((identity: string) => moderate("mute", identity), [moderate]);
  const removeParticipant = useCallback((identity: string) => moderate("remove", identity), [moderate]);
  const muteAll = useCallback(() => moderate("muteAll"), [moderate]);

  // The banner is an explanation, not a dialog — same lifecycle as autoNotice.
  useEffect(() => {
    if (!moderationNotice) return;
    const timer = setTimeout(() => setModerationNotice(null), 7_000);
    return () => clearTimeout(timer);
  }, [moderationNotice]);

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

  /**
   * Is there a quiz my tutor unlocked for this class? Students only.
   *
   * Polled rather than pushed over the data channel: a game can outlive the
   * poller anyway (it is a DB row students reach through `/play`, not a
   * LiveKit broadcast — see `lib/live-quiz.ts`), and polling means a student
   * who reconnects, or who was minimized when it started, finds out too.
   */
  useEffect(() => {
    if (role !== "student") return;
    let cancelled = false;

    async function poll() {
      try {
        const res = await fetch("/api/live-quiz/join", { cache: "no-store" });
        if (cancelled || !res.ok) return;
        const data = await res.json().catch(() => ({}) as { game?: typeof quizGame });
        setQuizGame(data.game ?? null);
      } catch {
        // A missed poll just means the banner waits for the next one.
      }
    }

    poll();
    const timer = window.setInterval(poll, 6_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [role]);

  // A new game (a different id than the one just dismissed) deserves a fresh
  // chance to be seen, so dismissal is keyed to the game rather than global.
  useEffect(() => {
    setQuizDismissed(false);
  }, [quizGame?.id]);

  const startQuizAsTutor = useCallback(() => {
    const query = liveSessionId ? `?liveSessionId=${encodeURIComponent(liveSessionId)}` : "";
    router.push(`/lecturer/live-quiz${query}`);
  }, [liveSessionId, router]);

  const interactions = useRoomInteractions(roomRef.current, role, revision);
  const levels = useAudioLevels(roomRef.current, topologyRevision);

  /**
   * Leaving, and why the tutor's version is awaited.
   *
   * A tutor pressing Leave ends the class for everybody, and the only thing
   * that tells the other thirty browsers so is a data message — which travels
   * over the same connection this function is about to close. Sending it and
   * disconnecting in the same tick loses it often enough to matter, and the
   * failure is invisible: the tutor's screen looks right while the class sits
   * in a room that will never speak again.
   */
  const leave = useCallback(async () => {
    if (role === "tutor") await interactions.announceEnd();
    roomRef.current?.disconnect();
    finish("self");
  }, [role, interactions, finish]);

  /**
   * What the Leave button actually calls. See `confirmLeave` above for why a
   * tutor needs two taps and a student needs one.
   */
  const handleLeaveClick = useCallback(() => {
    if (role !== "tutor") {
      leave();
      return;
    }
    if (confirmLeaveTimerRef.current) {
      window.clearTimeout(confirmLeaveTimerRef.current);
      confirmLeaveTimerRef.current = null;
    }
    if (!confirmLeave) {
      setConfirmLeave(true);
      // Arming resets on its own — a tutor who taps once, thinks better of it,
      // and walks away should not find the button still primed to end class
      // five minutes later because they brushed it on the way past.
      confirmLeaveTimerRef.current = window.setTimeout(() => setConfirmLeave(false), 4000);
      return;
    }
    setConfirmLeave(false);
    leave();
  }, [role, confirmLeave, leave]);

  /**
   * The tutor said it is over, so this browser stops being in a classroom.
   *
   * Deliberately not "show a banner and let them sit there": a room where the
   * teaching has stopped is indistinguishable from one where everybody has
   * their camera off, and that ambiguity is the thing the end screen exists to
   * remove.
   */
  useEffect(() => {
    if (!interactions.ended) return;
    roomRef.current?.disconnect();
    finish("ended");
  }, [interactions.ended, finish]);

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

  /**
   * The per-tile speaking ring, held for `RING_RELEASE_MS` past the last time
   * the SFU actually said this person was speaking.
   *
   * A sorted, joined string of the raw identities is the effect's dependency
   * rather than `speakingIds` itself, because `speakingIds` is a brand new Set
   * every render — an object dependency that never equals its previous value
   * would run this effect (and restart every hold timer) on every unrelated
   * re-render in the room, which defeats the entire point of holding.
   */
  const activeSpeakerKey = Array.from(speakingIds).sort().join(",");
  useEffect(() => {
    const raw = new Set(activeSpeakerKey ? activeSpeakerKey.split(",") : []);
    const timers = ringTimersRef.current;

    setRingIds((current) => {
      let changed = false;
      const next = new Set(current);

      raw.forEach((identity) => {
        if (!next.has(identity)) {
          next.add(identity);
          changed = true;
        }
        const pending = timers.get(identity);
        if (pending) {
          window.clearTimeout(pending);
          timers.delete(identity);
        }
      });

      next.forEach((identity) => {
        if (raw.has(identity) || timers.has(identity)) return;
        const timer = window.setTimeout(() => {
          setRingIds((cur) => {
            if (!cur.has(identity)) return cur;
            const trimmed = new Set(cur);
            trimmed.delete(identity);
            return trimmed;
          });
          timers.delete(identity);
        }, RING_RELEASE_MS);
        timers.set(identity, timer);
      });

      return changed ? next : current;
    });
  }, [activeSpeakerKey]);

  // Unmounting mid-lesson (a tab close, a route change) must not leave the
  // room's held-open timers firing setState against a gone component.
  useEffect(
    () => () => {
      ringTimersRef.current.forEach((timer) => window.clearTimeout(timer));
      ringTimersRef.current.clear();
    },
    [],
  );

  const stageParticipant =
    participants.find((participant) => participant.identity === stageIdentity) ?? liveStage;
  const others = participants.filter((participant) => participant !== stageParticipant);

  const pill = QUALITY_PILL[quality];
  const myHandPosition = interactions.myHandRaised
    ? interactions.hands.findIndex((hand) => hand.mine) + 1
    : null;

  /**
   * Queue position by identity, so a tile can wear its own number.
   *
   * Built from the same sorted list the panel renders, which is what keeps the
   * "3" on somebody's face and the "3" in the queue the same 3. Deriving it
   * separately is how those two drift apart.
   */
  const handPositions = new Map(interactions.hands.map((hand, index) => [hand.identity, index + 1]));

  /**
   * WHERE THE GREEN LIGHT GOES.
   *
   * Two sources, and the order between them is the point. A floor the tutor
   * granted is a DECISION and outranks everything — the light stays on that
   * person even while somebody else coughs, because the whole reason the floor
   * exists is to stop the room following whoever is loudest. Only when nobody
   * has been given the floor does the light fall back to tracking the active
   * speaker, which is what makes it useful in an ordinary open-floor lesson
   * where the tutor never touches the queue at all.
   *
   * `activeSpeakers` comes from the SFU already sorted by loudness, so index 0
   * is the person the room is actually listening to.
   */
  const speakerIdentity = room?.activeSpeakers?.[0]?.identity ?? null;
  const lightCandidate = interactions.floor ?? (participants.length > 1 ? speakerIdentity : null);

  /**
   * It arrives quickly and leaves slowly.
   *
   * A light that switched off in the gap between two sentences would blink
   * through a lesson; one that took as long as the stage to move would always
   * be pointing at the previous speaker. Hence two constants rather than one —
   * and a granted floor skips the wait entirely, because a tutor who has just
   * clicked "Call on" is owed an immediate answer.
   */
  useEffect(() => {
    if (lightCandidate === lightIdentity) return;
    const delay = lightCandidate === null ? LIGHT_RELEASE_MS : interactions.floor ? 0 : LIGHT_DWELL_MS;
    const timer = window.setTimeout(() => setLightIdentity(lightCandidate), delay);
    return () => window.clearTimeout(timer);
  }, [lightCandidate, lightIdentity, interactions.floor]);

  /** The label on the light, and which of its two looks it wears. */
  const lightFor = (participant: Participant) => {
    if (participant.identity !== lightIdentity) return null;
    const mine = participant.identity === room?.localParticipant.identity;
    if (interactions.floor === participant.identity) {
      return { label: mine ? "You have the floor" : "Has the floor", tone: "floor" as const };
    }
    return { label: mine ? "You are speaking" : "Speaking", tone: "speaking" as const };
  };

  /**
   * THE MINIMIZED CARD.
   *
   * Same Room, same connection — this is a different render branch of an
   * unmounted-nowhere component, not a different component. Deliberately
   * thin: a face, a mic toggle, restore, leave. Everything else (chat,
   * hands, screen share) is what the student is choosing to step away from;
   * cramming it into a 288×176 box would just make a worse version of the
   * full room instead of a clear "you are still in class" reminder.
   */
  if (minimized) {
    return (
      <div className="flex h-full w-full flex-col overflow-hidden rounded-2xl bg-slate-900 ring-1 ring-white/15">
        <div
          onPointerDown={onDragHandlePointerDown}
          className="flex shrink-0 cursor-grab touch-none items-center justify-between gap-2 bg-slate-950/90 px-2.5 py-1.5 active:cursor-grabbing"
        >
          <span className="flex min-w-0 items-center gap-1.5 text-[11px] font-medium text-white">
            <span className="relative flex h-1.5 w-1.5 shrink-0">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
            </span>
            <span className="truncate">{displayName}</span>
          </span>
          <div className="flex shrink-0 items-center gap-1">
            <button
              onPointerDown={(event) => event.stopPropagation()}
              onClick={onExpand}
              aria-label="Expand classroom"
              title="Expand"
              className="grid h-6 w-6 place-items-center rounded-md text-white/80 transition hover:bg-white/15 hover:text-white"
            >
              <ExpandIcon className="h-3.5 w-3.5" />
            </button>
            <button
              onPointerDown={(event) => event.stopPropagation()}
              onClick={handleLeaveClick}
              aria-label={role === "tutor" && confirmLeave ? "Tap again to end class for everyone" : "Leave class"}
              title={role === "tutor" && confirmLeave ? "Tap again to end class for everyone" : "Leave class"}
              className={`grid h-6 w-6 shrink-0 place-items-center rounded-md transition ${
                role === "tutor" && confirmLeave
                  ? "bg-rose-500 text-white"
                  : "text-rose-300 hover:bg-rose-500/20"
              }`}
            >
              <ExitIcon className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        <div className="relative min-h-0 flex-1 bg-black" onClick={onExpand} role="button" tabIndex={-1}>
          {stageParticipant ? (
            <ParticipantTile
              participant={stageParticipant}
              mode="low"
              large
              isSpeaking={ringIds.has(stageParticipant.identity)}
              revision={topologyRevision}
              levels={levels}
              handPosition={null}
              light={null}
              viewerRole={role}
              moderationBusy={moderationBusy}
              onMute={() => {}}
              onRemove={() => {}}
            />
          ) : (
            <div className="grid h-full place-items-center text-xs text-slate-400">Connecting…</div>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-center gap-2 bg-slate-950/70 px-2 py-1.5">
          <button
            onClick={toggleMic}
            aria-label={micOn ? "Mute microphone" : "Unmute microphone"}
            className={`grid h-7 w-7 place-items-center rounded-full transition ${
              micOn ? "bg-white/10 text-white hover:bg-white/20" : "bg-rose-500 text-white"
            }`}
          >
            {micOn ? <MicIcon className="h-3.5 w-3.5" /> : <MicOffIcon className="h-3.5 w-3.5" />}
          </button>
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${pill.className}`}>{pill.label}</span>
        </div>
      </div>
    );
  }

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
          {onMinimize ? (
            <button
              onClick={onMinimize}
              aria-label="Minimize classroom"
              title="Minimize — keep the class running while you use the rest of the portal"
              className="rounded-xl bg-white/10 p-2 text-white transition hover:bg-white/20"
            >
              <ShrinkIcon className="h-4 w-4" />
            </button>
          ) : null}
        </div>
      </div>

      {/*
        A tutor-unlocked quiz, surfaced right where a student's attention
        already is. Nothing here creates access — `/api/live-quiz/join` GET
        already refuses anyone whose branch/level/session doesn't match, so
        this banner can only ever appear for a game the student's own tutor
        started for their own class.
      */}
      {role === "student" && quizGame && quizGame.phase !== "ended" && !quizDismissed ? (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-[var(--accent)]/40 bg-[var(--accent)]/15 px-5 py-3 text-sm text-white">
          <QuizIcon className="h-5 w-5 shrink-0" />
          <p className="min-w-0 flex-1 leading-6">
            <span className="font-semibold">Your tutor started a quiz</span> — {quizGame.title}.{" "}
            {quizGame.joined ? "Jump back in." : "Tap to join from your phone."}
          </p>
          <button
            onClick={() => router.push("/play")}
            className="shrink-0 rounded-xl bg-white px-4 py-2 text-xs font-semibold text-[var(--accent)] transition hover:brightness-95"
          >
            {quizGame.joined ? "Back to quiz" : "Join quiz"}
          </button>
          <button
            onClick={() => setQuizDismissed(true)}
            aria-label="Dismiss"
            className="shrink-0 rounded-xl bg-white/10 px-3 py-2 text-xs font-semibold text-white transition hover:bg-white/20"
          >
            Later
          </button>
        </div>
      ) : null}

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

      {moderationNotice ? (
        <div className="flex flex-wrap items-start gap-3 rounded-2xl border border-rose-400/30 bg-rose-500/10 px-5 py-3 text-sm text-rose-200">
          <p className="min-w-0 flex-1 leading-6">{moderationNotice}</p>
          <button
            onClick={() => setModerationNotice(null)}
            className="shrink-0 rounded-xl bg-white/10 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-white/20"
          >
            Dismiss
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
                      isSpeaking={ringIds.has(stageParticipant.identity)}
                      revision={topologyRevision}
                      levels={levels}
                      handPosition={handPositions.get(stageParticipant.identity) ?? null}
                      light={lightFor(stageParticipant)}
                      viewerRole={role}
                      moderationBusy={moderationBusy}
                      onMute={muteParticipant}
                      onRemove={removeParticipant}
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
                      isSpeaking={ringIds.has(participant.identity)}
                      revision={topologyRevision}
                      levels={levels}
                      handPosition={handPositions.get(participant.identity) ?? null}
                      light={lightFor(participant)}
                      viewerRole={role}
                      moderationBusy={moderationBusy}
                      onMute={muteParticipant}
                      onRemove={removeParticipant}
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
                  onClick={() => setPanel("switch")}
                  className={`flex-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                    panel === "switch" ? "bg-white/15 text-white" : "text-slate-400 hover:text-white"
                  }`}
                >
                  Device
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
              ) : panel === "switch" ? (
                <SwitchDevicePanel />
              ) : (
                <ChatPanel chat={interactions.chat} onSend={interactions.sendChat} />
              )}
            </aside>
          ) : null}
        </div>
      )}

      {/*
        Pinned to the bottom of the scroll container in full screen —
        without this, a tall video stage plus an open side panel could push
        total content past the viewport, and this bar (Leave included) would
        scroll out of view with no way back to it short of scrolling blind.
        Only applied in immersive mode: outside it the PAGE scrolls, not this
        div, so `sticky` would pin it against the browser viewport instead
        and could overlap footer content that has nothing to do with class.
      */}
      <div
        className={`flex flex-wrap items-center gap-2 rounded-2xl bg-slate-900/90 p-3 ${
          immersive ? "sticky bottom-0 z-20 shadow-[0_-8px_24px_rgba(0,0,0,0.35)]" : ""
        }`}
      >
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

        <button
          onClick={() => setPanel(panel === "switch" ? null : "switch")}
          title="Continue this class on another device — a phone, say — without losing your seat."
          className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition ${
            panel === "switch" ? "bg-white/20 text-white" : "bg-white/10 text-white hover:bg-white/20"
          }`}
        >
          <DeviceIcon className="h-4 w-4" />
          Switch device
        </button>

        {role === "tutor" && others.length > 0 ? (
          <button
            onClick={muteAll}
            disabled={moderationBusy.has("__all__")}
            title="Mute every student's microphone. Nobody is locked out — anyone can unmute themselves again."
            className="inline-flex items-center gap-2 rounded-xl bg-white/10 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-white/20 disabled:opacity-50"
          >
            <MicOffIcon className="h-4 w-4" />
            {moderationBusy.has("__all__") ? "Muting…" : "Mute all"}
          </button>
        ) : null}

        {/*
          Students never see a way into the quiz from inside the call — this
          is the only door. Tapping it hands the tutor off to the existing
          host screen (`/lecturer/live-quiz`), which is where a game actually
          gets created; nothing here creates one itself. Leaving `/live`
          auto-minimizes the call instead of ending it, so the tutor keeps
          teaching in the corner of their screen while they set the quiz up.
        */}
        {role === "tutor" ? (
          <button
            onClick={startQuizAsTutor}
            title="Unlock the class quiz — students only ever see it once you start one here."
            className="inline-flex items-center gap-2 rounded-xl bg-white/10 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-white/20"
          >
            <QuizIcon className="h-4 w-4" />
            Quiz
          </button>
        ) : null}

        {/*
          `w-full` on mobile is what stops this row overflowing the screen: on
          a narrow viewport "Video quality" plus the (long-labelled) dropdown
          plus Leave do not fit on one line, and without a wrap this block —
          being a single flex item — does not shrink below its content's own
          width. It used to just run off the right edge, taking Leave with it.
          `flex-wrap` lets the pieces stack instead; `sm:` reverts to the
          original inline-right layout once there is room for it.
        */}
        <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:ml-auto sm:w-auto">
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
          <button
            onClick={handleLeaveClick}
            className="shrink-0 rounded-xl bg-rose-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-110"
          >
            {role === "tutor" && confirmLeave ? "Tap again to end for everyone" : "Leave"}
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

/**
 * Hand this class off to another device without losing your seat.
 *
 * No server round-trip is needed to know which class to point at — `/live`
 * always resolves "whichever class I'm signed in and currently in" from the
 * session, on any device. Opening it elsewhere connects a second LiveKit
 * participant under this same identity, and LiveKit's own duplicate-identity
 * handling steps this device aside automatically (see the `Disconnected`
 * handler above) — this panel only makes that easy to do on purpose, either
 * by scanning a code or by a push notification straight to the lock screen.
 */
function SwitchDevicePanel() {
  const [qr, setQr] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const QRCode = (await import("qrcode")).default;
        const url = `${window.location.origin}/live`;
        const dataUrl = await QRCode.toDataURL(url, { width: 220, margin: 1 });
        if (!cancelled) setQr(dataUrl);
      } catch (error) {
        console.error("Could not build the switch-device code", error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const sendLink = useCallback(async () => {
    setSending(true);
    try {
      const response = await fetch("/api/live/session/switch-device", { method: "POST" });
      const json = await response.json().catch(() => ({}));
      setSent(response.ok && json.sent > 0);
    } catch {
      setSent(false);
    } finally {
      setSending(false);
    }
  }, []);

  return (
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto text-sm text-slate-300">
      <p>
        Open this same class on another device — your phone, say — and it picks up right where you are now. This
        device steps aside on its own the moment the new one connects.
      </p>

      {qr ? (
        <div className="grid place-items-center rounded-2xl bg-white p-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr} alt="Scan to continue this class on another device" className="h-40 w-40" />
        </div>
      ) : (
        <div className="grid h-40 place-items-center text-xs text-slate-500">Building your code…</div>
      )}

      <button
        onClick={() => void sendLink()}
        disabled={sending || sent}
        className="w-full rounded-xl bg-white/10 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-white/20 disabled:opacity-60"
      >
        {sent ? "Sent — check your other device" : sending ? "Sending…" : "Send myself a link instead"}
      </button>
    </div>
  );
}
