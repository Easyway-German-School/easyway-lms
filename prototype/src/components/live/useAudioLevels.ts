"use client";

/**
 * How loud each person in the room is, right now.
 *
 * ---------------------------------------------------------------------------
 * WHY NOT ONE ANALYSER PER PERSON
 * ---------------------------------------------------------------------------
 * livekit-client ships `createAudioAnalyser`, which gives a true real-time RMS
 * off the media track — and it creates a brand new AudioContext every call.
 * Browsers cap a page at roughly six of those, so wiring one per participant
 * would work beautifully in a demo with three people and throw
 * "NotSupportedError" in a class of forty. So there is exactly one analyser, on
 * the local microphone, and everybody else is read from the level the SFU
 * already reports.
 *
 * That split is not a compromise on the part that matters. Your own meter is
 * the one a student stares at to answer "is this thing on?", and that one is
 * sample-accurate. Everyone else's is a speaking indicator, and a speaking
 * indicator does not need to resolve a syllable.
 *
 * ---------------------------------------------------------------------------
 * WHY THE SMOOTHING IS ASYMMETRIC
 * ---------------------------------------------------------------------------
 * Server speaker updates arrive a couple of times a second and drop straight to
 * zero between them. Rendered raw, a bar chart of that flickers like a fault
 * light. So the level rises almost immediately (speech should look instant) and
 * falls slowly (a gap between two words is not the end of a sentence). Attack
 * fast, release slow — the same shape a hardware VU meter has, for the same
 * reason.
 *
 * ---------------------------------------------------------------------------
 * WHY IT IS NOT REACT STATE
 * ---------------------------------------------------------------------------
 * Twelve updates a second through `useState` in the classroom component would
 * re-render every tile, every control and the chat panel twelve times a second
 * for the whole lesson. The levels live in a small external store instead and
 * each meter subscribes to its own identity, so a person speaking re-renders
 * their own five bars and nothing else on the page moves.
 */

import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import {
  LocalParticipant,
  Track,
  createAudioAnalyser,
  type Participant,
  type Room,
} from "livekit-client";

/** How often levels are recomputed. ~12fps: enough to read, cheap to run. */
const TICK_MS = 80;
/** Rise coefficient. High, so speech lights the bar on the first frame. */
const ATTACK = 0.55;
/** Fall coefficient. Low, so the bar sags rather than snapping to nothing. */
const RELEASE = 0.14;
/** Below this a level counts as silence and is pinned to zero. */
const FLOOR = 0.02;

export class AudioLevelStore {
  private levels = new Map<string, number>();
  private listeners = new Map<string, Set<() => void>>();

  get(identity: string): number {
    return this.levels.get(identity) ?? 0;
  }

  subscribe(identity: string, listener: () => void): () => void {
    const set = this.listeners.get(identity) ?? new Set();
    set.add(listener);
    this.listeners.set(identity, set);
    return () => {
      set.delete(listener);
      if (set.size === 0) this.listeners.delete(identity);
    };
  }

  /**
   * Rounded to two decimals before it is stored, which is what makes the
   * "did it change" check below actually reject anything. Raw floats from an
   * analyser differ in the eighth decimal on every single tick, so an exact
   * comparison would notify on every tick for every participant and undo the
   * entire point of the store.
   */
  set(identity: string, value: number): void {
    const next = Math.round(Math.min(1, Math.max(0, value)) * 100) / 100;
    if (this.levels.get(identity) === next) return;
    this.levels.set(identity, next);
    this.listeners.get(identity)?.forEach((listener) => listener());
  }

  /** Everyone currently being metered, so the ticker can prune the leavers. */
  identities(): string[] {
    return Array.from(this.levels.keys());
  }

  /** Somebody left. Their meter must not stay frozen at whatever it last read. */
  forget(identity: string): void {
    if (!this.levels.has(identity)) return;
    this.levels.delete(identity);
    this.listeners.get(identity)?.forEach((listener) => listener());
  }

  /** Whoever is loudest at this instant, or null when the room is quiet. */
  loudest(): { identity: string; level: number } | null {
    let best: { identity: string; level: number } | null = null;
    this.levels.forEach((level, identity) => {
      if (level > FLOOR && (!best || level > best.level)) best = { identity, level };
    });
    return best;
  }
}

/**
 * Runs the meter for a room and hands back the store to read it from.
 *
 * `revision` is the classroom's room-event counter: it is what re-runs the
 * local-analyser effect when the microphone is muted, unmuted or replaced, and
 * what keeps the participant list the ticker walks up to date.
 */
export function useAudioLevels(room: Room | null, revision: number): AudioLevelStore {
  const store = useMemo(() => new AudioLevelStore(), []);
  const analyserRef = useRef<{ calculateVolume: () => number; cleanup: () => Promise<void> } | null>(null);

  /**
   * The local analyser, rebuilt whenever the published microphone track
   * changes. Muting unpublishes the track, and an analyser left attached to a
   * dead track reads a constant zero — which looks identical to "your
   * microphone is broken", the single most alarming thing this meter could say
   * wrongly.
   */
  const localTrack = room?.localParticipant.getTrackPublication(Track.Source.Microphone)?.track ?? null;

  useEffect(() => {
    if (!localTrack) return;
    let analyser: { calculateVolume: () => number; cleanup: () => Promise<void> } | null = null;
    try {
      analyser = createAudioAnalyser(localTrack as never, { smoothingTimeConstant: 0.5 });
      analyserRef.current = analyser;
    } catch {
      // No Web Audio on this browser, or the context cap was hit. The server
      // level below still covers the local participant, just more coarsely.
      analyserRef.current = null;
    }
    return () => {
      analyserRef.current = null;
      void analyser?.cleanup().catch(() => {});
    };
  }, [localTrack]);

  useEffect(() => {
    if (!room) return;

    const timer = window.setInterval(() => {
      const everyone: Participant[] = [room.localParticipant, ...Array.from(room.remoteParticipants.values())];
      const present = new Set<string>();

      for (const participant of everyone) {
        present.add(participant.identity);

        let raw: number;
        if (participant instanceof LocalParticipant && analyserRef.current) {
          // A muted microphone is silent by definition. Reading the analyser
          // anyway would show the room a bar for somebody nobody can hear.
          raw = participant.isMicrophoneEnabled ? analyserRef.current.calculateVolume() : 0;
        } else {
          raw = participant.isMicrophoneEnabled ? participant.audioLevel : 0;
        }

        // Speech sits low on a linear scale — a normal voice reads about 0.1.
        // The square root opens the bottom of the range out so an ordinary
        // sentence moves the meter instead of nudging it.
        const scaled = Math.min(1, Math.sqrt(Math.max(0, raw)) * 1.6);
        const previous = store.get(participant.identity);
        const coefficient = scaled > previous ? ATTACK : RELEASE;
        const next = previous + (scaled - previous) * coefficient;
        store.set(participant.identity, next < FLOOR ? 0 : next);
      }

      // Whoever has gone. Left alone, a departed participant's last level
      // would keep a green light glowing over an empty tile.
      for (const identity of store.identities()) {
        if (!present.has(identity)) store.forget(identity);
      }
    }, TICK_MS);

    return () => window.clearInterval(timer);
  }, [room, store, revision]);

  return store;
}

/** One participant's level, subscribed to on its own so nothing else re-renders. */
export function useAudioLevel(store: AudioLevelStore, identity: string): number {
  const subscribe = useCallback(
    (listener: () => void) => store.subscribe(identity, listener),
    [store, identity],
  );
  const get = useCallback(() => store.get(identity), [store, identity]);
  // The server snapshot is 0: there is no audio during server rendering, and
  // returning anything else would hydrate a meter that is mid-swing.
  return useSyncExternalStore(subscribe, get, () => 0);
}
