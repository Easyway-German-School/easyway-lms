/**
 * The noise a quiz game makes.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS SYNTHESISED RATHER THAN A FOLDER OF MP3s
 * ---------------------------------------------------------------------------
 * Three reasons, in order of how much they matter here.
 *
 *   1. LICENCE. Every recognisable game-show loop on the internet belongs to
 *      somebody. A school running this on a projector in front of paying
 *      students is a commercial performance, and "we found it on a free sounds
 *      site" is not a licence. Oscillators owe nobody anything.
 *   2. WEIGHT. A lobby bed long enough not to loop audibly is megabytes, and
 *      this is a classroom on Nigerian mobile data where the lesson has already
 *      started. This file is a few kilobytes and starts instantly.
 *   3. TIMING. The countdown has to stay in step with a clock the SERVER owns,
 *      including on a laptop whose clock is wrong. Scheduling notes against
 *      `AudioContext.currentTime` keeps the pulse honest; a fixed-length
 *      recording drifts away from the timer on screen, and a countdown whose
 *      music finishes before the numbers do is worse than silence.
 *
 * ---------------------------------------------------------------------------
 * THE RULES IT PLAYS BY
 * ---------------------------------------------------------------------------
 * NOTHING HERE MAY EVER THROW. It is decoration on top of a lesson. A browser
 * with audio disabled, an iPad in silent mode, a locked-down school laptop —
 * every one of those must produce a silent, working game rather than a broken
 * one, so every entry point is wrapped and failure is simply quiet.
 *
 * AUTOPLAY IS NOT A BUG TO WORK AROUND. Browsers refuse to make noise until the
 * user has interacted, and they are right to. `unlock()` is called from the
 * tutor's own click on "Start" — a real gesture, on the host machine only. The
 * student phones stay silent by design: thirty phones playing a countdown out
 * of sync is not atmosphere, it is a fire alarm. Phones get haptics instead.
 */

type Ctx = AudioContext & { __easywayMaster?: GainNode };

const STORAGE_KEY = "easyway-quiz-sound";

let ctx: Ctx | null = null;
let master: GainNode | null = null;
let muted = false;
let lobbyTimer: number | null = null;
let lobbyStep = 0;

/* -------------------------------------------------------------------------- */
/* Setup                                                                      */
/* -------------------------------------------------------------------------- */

function readMuted(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "off";
  } catch {
    // Private browsing. Sound on for this session is the friendlier default:
    // a tutor who wants it off can press the button again.
    return false;
  }
}

/**
 * Create the audio context, or wake a suspended one.
 *
 * Must be called from inside a real user gesture. Safari in particular starts
 * every context suspended and only `resume()`s inside a click, so this is
 * called again on each host action rather than once at mount.
 */
export function unlock(): void {
  try {
    if (typeof window === "undefined") return;
    if (!ctx) {
      const AudioCtor: typeof AudioContext | undefined =
        window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtor) return;

      muted = readMuted();
      ctx = new AudioCtor() as Ctx;
      master = ctx.createGain();
      // Deliberately not 1. This comes out of a classroom projector's speakers,
      // which are usually already at maximum, and a sting that makes a room
      // flinch gets the sound switched off permanently after one lesson.
      master.gain.value = muted ? 0 : 0.28;
      master.connect(ctx.destination);
    }
    if (ctx.state === "suspended") void ctx.resume().catch(() => {});
  } catch {
    ctx = null;
    master = null;
  }
}

export function isMuted(): boolean {
  if (typeof window === "undefined") return true;
  return ctx ? muted : readMuted();
}

export function setMuted(next: boolean): void {
  muted = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, next ? "off" : "on");
  } catch {
    // Not persisting a preference is survivable; failing to apply it is not.
  }
  if (!master || !ctx) return;
  try {
    // Ramped rather than set: a gain jump on a live oscillator is an audible
    // click, which on a projector sounds like the equipment failing.
    master.gain.cancelScheduledValues(ctx.currentTime);
    master.gain.setTargetAtTime(next ? 0 : 0.28, ctx.currentTime, 0.02);
  } catch {
    // Ignore.
  }
  if (next) stopLobby();
}

/* -------------------------------------------------------------------------- */
/* One note                                                                   */
/* -------------------------------------------------------------------------- */

type NoteOptions = {
  freq: number;
  /** Seconds from now. */
  at?: number;
  duration?: number;
  type?: OscillatorType;
  gain?: number;
  /** Slide to this frequency across the note. Used by the stings. */
  glideTo?: number;
};

/**
 * A single tone with an envelope.
 *
 * The envelope is the whole point: a raw oscillator switched on and off clicks
 * at both ends, because the waveform is almost never at zero when it stops.
 * The short attack and exponential release are what make these read as
 * instrument notes rather than as faults.
 */
function note({ freq, at = 0, duration = 0.18, type = "sine", gain = 0.5, glideTo }: NoteOptions): void {
  if (!ctx || !master) return;
  try {
    const start = ctx.currentTime + at;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    if (glideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, glideTo), start + duration);

    env.gain.setValueAtTime(0.0001, start);
    env.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), start + 0.012);
    env.gain.exponentialRampToValueAtTime(0.0001, start + duration);

    osc.connect(env);
    env.connect(master);
    osc.start(start);
    osc.stop(start + duration + 0.05);
  } catch {
    // Ignore.
  }
}

/* -------------------------------------------------------------------------- */
/* The cues                                                                   */
/* -------------------------------------------------------------------------- */

/** A4-based intervals, so everything below is in one key and cannot clash. */
const A3 = 220;
const C4 = 261.63;
const D4 = 293.66;
const E4 = 329.63;
const G4 = 392.0;
const A4 = 440;
const C5 = 523.25;
const D5 = 587.33;
const E5 = 659.25;
const G5 = 783.99;
const A5 = 880;

/**
 * The lobby bed: a slow four-note figure that never resolves.
 *
 * Unresolved on purpose. A loop that lands on its root sounds finished, and a
 * room whose music keeps finishing every four seconds starts watching the
 * clock. This one keeps leaning forward until the tutor starts the game.
 */
const LOBBY_FIGURE = [A3, E4, G4, D4, A3, E4, C5, G4];

export function startLobby(): void {
  if (!ctx || lobbyTimer !== null) return;
  lobbyStep = 0;
  const beat = () => {
    const freq = LOBBY_FIGURE[lobbyStep % LOBBY_FIGURE.length];
    note({ freq, duration: 0.42, type: "triangle", gain: 0.16 });
    // A fifth above, quieter, every other beat — enough movement that the
    // eight-note figure does not announce itself as an eight-note figure.
    if (lobbyStep % 2 === 0) note({ freq: freq * 1.5, at: 0.21, duration: 0.3, type: "sine", gain: 0.07 });
    lobbyStep += 1;
  };
  beat();
  lobbyTimer = window.setInterval(beat, 460);
}

export function stopLobby(): void {
  if (lobbyTimer === null) return;
  window.clearInterval(lobbyTimer);
  lobbyTimer = null;
}

/** The game starting: three rising notes, then the room goes quiet. */
export function startCue(): void {
  stopLobby();
  note({ freq: C5, duration: 0.14, type: "triangle", gain: 0.4 });
  note({ freq: E5, at: 0.13, duration: 0.14, type: "triangle", gain: 0.4 });
  note({ freq: G5, at: 0.26, duration: 0.34, type: "triangle", gain: 0.45 });
}

/**
 * One pulse of the countdown.
 *
 * `urgent` is the last five seconds: higher, sharper, and the caller speeds up
 * the interval. This is the single most effective sound in the format — it is
 * what makes a room that has answered look up at the ones who have not.
 */
export function tick(urgent = false): void {
  note({
    freq: urgent ? A4 : A3,
    duration: urgent ? 0.09 : 0.07,
    type: urgent ? "square" : "triangle",
    gain: urgent ? 0.16 : 0.09,
  });
}

/** Right. A major arpeggio, up. */
export function correctCue(): void {
  note({ freq: C5, duration: 0.12, type: "triangle", gain: 0.42 });
  note({ freq: E5, at: 0.1, duration: 0.12, type: "triangle", gain: 0.42 });
  note({ freq: G5, at: 0.2, duration: 0.28, type: "triangle", gain: 0.46 });
  note({ freq: C5 * 2, at: 0.3, duration: 0.36, type: "sine", gain: 0.3 });
}

/**
 * Wrong. A short fall — and deliberately NOT a comedy buzzer.
 *
 * This lands on a teenager who has just got a German question wrong in front
 * of their whole class. A parping error tone is funny once and then it is the
 * sound of being laughed at, and the student who hears it three times stops
 * answering rather than risk a fourth. Low, brief, over.
 */
export function wrongCue(): void {
  note({ freq: D4, duration: 0.16, type: "sine", gain: 0.26, glideTo: A3 });
}

/** Nobody answered in time. Softer still — nothing to be ashamed of. */
export function timeoutCue(): void {
  note({ freq: C4, duration: 0.3, type: "sine", gain: 0.18, glideTo: A3 });
}

/** The table appears. A quick upward flourish under the movement arrows. */
export function standingsCue(): void {
  const run = [C5, D5, E5, G5, A5];
  run.forEach((freq, index) => {
    note({ freq, at: index * 0.055, duration: 0.16, type: "triangle", gain: 0.24 });
  });
}

/** The podium. The one moment in the game allowed to be loud. */
export function finaleCue(): void {
  stopLobby();
  const fanfare: Array<[number, number]> = [
    [C5, 0],
    [E5, 0.12],
    [G5, 0.24],
    [C5 * 2, 0.36],
    [G5, 0.52],
    [C5 * 2, 0.62],
  ];
  for (const [freq, at] of fanfare) {
    note({ freq, at, duration: at > 0.5 ? 0.7 : 0.2, type: "triangle", gain: 0.45 });
    note({ freq: freq / 2, at, duration: at > 0.5 ? 0.7 : 0.2, type: "sine", gain: 0.2 });
  }
}

/** Everything off, for unmount. */
export function dispose(): void {
  stopLobby();
  try {
    void ctx?.close();
  } catch {
    // Ignore.
  }
  ctx = null;
  master = null;
}

/* -------------------------------------------------------------------------- */
/* Phones                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * A buzz, not a noise.
 *
 * The phones stay silent — see the header. But a student looking at the board
 * still needs to know their tap registered, and a vibration says so without
 * adding to the room. Unsupported on iOS Safari, which is fine: the button
 * also changes state, and this was never the only feedback.
 */
export function buzz(pattern: number | number[] = 18): void {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // Ignore.
  }
}
