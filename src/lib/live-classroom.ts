/**
 * The live classroom, and why it is built the way it is.
 *
 * Students told us the same thing over and over: video on Zoom freezes on a
 * Nigerian connection. That is not a bandwidth problem you fix by asking people
 * to buy more data — it is an architecture problem. A conference that sends one
 * quality to everybody runs at the speed of its worst participant.
 *
 * So classes run on LiveKit, an open-source SFU (Apache-2.0). The four things
 * that actually stop the freezing:
 *
 *   1. SIMULCAST — every publisher sends several quality layers at once, and
 *      the server forwards each viewer the layer their link can carry. One
 *      student on 3G no longer drags the whole class down.
 *   2. ADAPTIVE STREAM + DYNACAST — the server stops sending video nobody is
 *      looking at, and stops the publisher encoding layers nobody subscribes
 *      to. Uplink is the scarce resource on Nigerian mobile, and this is the
 *      only thing that gives it back.
 *   3. OPUS RED + DTX — audio packets are sent with redundancy, and silence is
 *      not sent at all. Speech survives 20–30% packet loss. In a language
 *      class, audio *is* the lesson; video is a nice-to-have.
 *   4. SELECTIVE SUBSCRIPTION — a 40-student room subscribes to the speaker
 *      and the tutor, not to 40 video streams.
 *
 * None of that is vendored into this repo. LiveKit runs as a service; we hold
 * a client and a token minter. Moving from their cloud to a self-hosted server
 * in Lagos is a change of LIVEKIT_URL and nothing else.
 *
 * This module is shared between server and browser, so it must not import
 * `livekit-server-sdk` (server-only) or `livekit-client` (browser-only).
 */

/** Which backend the room will actually use. There is now only one. */
export type LiveProvider = "livekit";

/**
 * The three variables a classroom cannot open without:
 *   LIVEKIT_URL         wss://your-project.livekit.cloud   (or your own server)
 *   LIVEKIT_API_KEY
 *   LIVEKIT_API_SECRET
 */
const REQUIRED_VARS = ["LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET"] as const;

/**
 * WHY THERE IS NO LONGER A FALLBACK PROVIDER.
 *
 * There used to be one, and the reasoning read well: a half-configured
 * deployment should still be able to hold a class, so a missing variable
 * quietly swapped the room for a `meet.jit.si` iframe. "The video page is on
 * the old provider" sounds obviously better than "the video page is broken".
 *
 * It is not, and the first live demo proved it. Production had
 * LIVEKIT_API_KEY and LIVEKIT_API_SECRET but no LIVEKIT_URL, so every class
 * silently landed on the fallback — and the fallback could not work, because
 * this app sends `Permissions-Policy: camera=(self), microphone=(self)`, which
 * grants those features to THIS origin and to no cross-origin frame. Jitsi's
 * chat and hand-raise are data, so they worked perfectly; its camera, its
 * microphone and its screen share were dead on arrival. The result was the
 * worst possible failure mode: a room that says "connected", looks like a
 * normal video call, has none of the school's branding, records nothing, and
 * cannot see or hear anybody. Nobody watching that could tell it was a missing
 * environment variable.
 *
 * A silent downgrade to a path nobody tests is not resilience. It is a way of
 * turning a five-second configuration fix into an unexplainable product
 * failure in front of real students. So a misconfigured deployment now says
 * exactly which variable is missing and refuses to pretend, which is the
 * behaviour that would have made the demo a two-minute fix.
 */
export function missingLiveKitConfig(): string[] {
  return REQUIRED_VARS.filter((name) => !String(process.env[name] ?? "").trim());
}

export function liveKitConfigured(): boolean {
  return missingLiveKitConfig().length === 0;
}

export function liveProvider(): LiveProvider {
  return "livekit";
}

function slug(value: string): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * A cohort's permanent room.
 *
 * Derived from branch + level + slot rather than stored, so a class is
 * joinable even when no ClassSession row was generated for today — a tutor
 * holding an unscheduled catch-up should not hit a dead end. Everyone in the
 * same cohort computes the same string, which is the whole trick.
 *
 * `ClassSession.roomName` overrides this when a tutor pins a specific room.
 */
export function cohortRoomName({
  branchName,
  level,
  sessionSlot,
}: {
  branchName?: string | null;
  level?: string | null;
  sessionSlot?: string | null;
}): string {
  const branch = slug(branchName || "easyway");
  const lvl = slug(level || "a1");
  const slot = slug(sessionSlot || "morning");
  return `ew-${branch}-${lvl}-${slot}`;
}

/** A one-to-one private class gets its own room, keyed on the booking. */
export function privateRoomName(privateClassId: string): string {
  return `ew-private-${slug(privateClassId)}`;
}

/**
 * Human label for a room, for the page header and the Jitsi fallback subject.
 */
export function roomDisplayName({
  branchName,
  level,
  sessionSlot,
}: {
  branchName?: string | null;
  level?: string | null;
  sessionSlot?: string | null;
}): string {
  const slot = String(sessionSlot || "morning");
  return `${branchName || "EasyWay"} · ${String(level || "A1").toUpperCase()} · ${slot.charAt(0).toUpperCase()}${slot.slice(1)}`;
}

// ---------------------------------------------------------------------------
// Quality modes
//
// Four rungs rather than a slider. A slider asks a student to guess a bitrate;
// a named mode tells them what they get and what it costs. The classroom picks
// the opening rung from what they told us at signup and lets them move.
// ---------------------------------------------------------------------------

export type QualityMode = "high" | "medium" | "low" | "audio";

export type QualityModeSpec = {
  value: QualityMode;
  label: string;
  /** What the student actually experiences. */
  description: string;
  /** Rough downstream cost, so "Data saver" is a number and not a vibe. */
  dataHint: string;
  /** Whether the student's own camera publishes in this mode. */
  publishesVideo: boolean;
  /** Height of the video layer we ask the server for. */
  maxHeight: number;
};

export const QUALITY_MODES: QualityModeSpec[] = [
  {
    value: "high",
    label: "Sharp",
    description: "Full video for everyone on screen. Best on fibre or a strong Wi-Fi.",
    dataHint: "~1.2 GB per 2-hour class",
    publishesVideo: true,
    maxHeight: 720,
  },
  {
    value: "medium",
    label: "Balanced",
    description: "Clear enough to read the board, light enough for most connections.",
    dataHint: "~500 MB per 2-hour class",
    publishesVideo: true,
    maxHeight: 360,
  },
  {
    value: "low",
    label: "Data saver",
    description: "Small video, full audio. Holds up on mobile data.",
    dataHint: "~180 MB per 2-hour class",
    publishesVideo: true,
    maxHeight: 180,
  },
  {
    value: "audio",
    label: "Audio only",
    description: "No video at all. The lesson still works — and the recording has the video.",
    dataHint: "~40 MB per 2-hour class",
    publishesVideo: false,
    maxHeight: 0,
  },
];

export function qualitySpec(mode: QualityMode): QualityModeSpec {
  return QUALITY_MODES.find((spec) => spec.value === mode) ?? QUALITY_MODES[1];
}

/**
 * Which rungs this person is offered.
 *
 * **A tutor gets one: Sharp.** Not a restriction for its own sake — the tutor is
 * the only publisher the whole room is subscribed to, so a tutor who drops to
 * Data saver hands every student in the class a 180p lesson to save one person's
 * bandwidth. That is the wrong trade in every direction, and it is the kind of
 * setting somebody changes once "to test something" and never changes back.
 *
 * Students keep all four. They are the ones on mobile data, they are the ones
 * whose own downlink is the constraint, and turning their own tile down costs
 * nobody else anything.
 *
 * The tutor still is not stuck with a frozen picture: `adaptiveStream` and
 * `dynacast` keep negotiating underneath, and the layer a student actually
 * receives is still chosen per-student by the server. This governs the menu, not
 * the transport.
 */
export function qualityModesFor(role: RoomRole): QualityModeSpec[] {
  if (role === "tutor") return QUALITY_MODES.filter((spec) => spec.value === "high");
  return QUALITY_MODES;
}

/** Where this person's classroom opens. A tutor always opens Sharp. */
export function initialQualityFor(role: RoomRole, preferred: QualityMode): QualityMode {
  const allowed = qualityModesFor(role);
  return allowed.some((spec) => spec.value === preferred) ? preferred : allowed[0].value;
}

/**
 * What a student is allowed to do in the room.
 *
 * A tutor publishes and moderates; a student publishes their own camera and
 * mic but cannot mute the room or end the class. Enforced when the token is
 * minted, not in the UI — a hidden button is not a permission.
 */
export type RoomRole = "tutor" | "student";
