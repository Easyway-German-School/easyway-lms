/**
 * What a tutor can do to somebody else's connection.
 *
 * A token's `roomAdmin` grant (minted in `/api/live/session`) has said since day
 * one that "only a tutor can mute others, remove a participant, or end the
 * class" — but a client-side grant is a permission LiveKit's server will honour
 * if asked. Nothing asked. A student who ignored "you don't have the floor"
 * could simply keep talking, and a disruptive one could only be dealt with by
 * the tutor ending the whole class. This is the asking part: server-to-server
 * calls against LiveKit's room API, gated by the same tutor check as everything
 * else in the classroom.
 *
 * Mirrors the `egressClient()` pattern in `lib/recording.ts` — same env vars,
 * same URL-scheme swap (LiveKit's HTTP APIs speak https/http, not wss/ws).
 */

import { RoomServiceClient, TrackSource } from "livekit-server-sdk";

export function roomServiceClient(): RoomServiceClient | null {
  const url = process.env.LIVEKIT_URL;
  const key = process.env.LIVEKIT_API_KEY;
  const secret = process.env.LIVEKIT_API_SECRET;
  if (!url || !key || !secret) return null;
  return new RoomServiceClient(url.replace(/^wss:/, "https:").replace(/^ws:/, "http:"), key, secret);
}

/** Whether a participant's token metadata claims the tutor role. Same shape `roleOfMetadata` reads client-side. */
function isTutorMetadata(metadata: string): boolean {
  try {
    return JSON.parse(metadata || "{}")?.role === "tutor";
  } catch {
    return false;
  }
}

/**
 * Mute one participant's own microphone.
 *
 * Requires the track's own sid, which the client never sends us — asking the
 * browser "which sid is your mic" is one more thing a forged request could lie
 * about. `listParticipants` is the source of truth instead: whatever LiveKit's
 * server itself currently has published for that identity.
 */
export async function muteParticipantMic(client: RoomServiceClient, room: string, identity: string): Promise<boolean> {
  const participant = await client.getParticipant(room, identity);
  const micTrack = participant.tracks.find((track) => track.source === TrackSource.MICROPHONE);
  if (!micTrack || micTrack.muted) return false;
  await client.mutePublishedTrack(room, identity, micTrack.sid, true);
  return true;
}

/**
 * Mute every microphone in the room except the tutors'.
 *
 * A tutor's own mic is exempt on purpose — "mute everyone" in every video
 * product means "mute my class", not "mute myself mid-sentence". Muted
 * students can always unmute themselves again afterwards; this is a reset for
 * a noisy room, not a lock.
 */
export async function muteAllStudents(client: RoomServiceClient, room: string, callerIdentity: string): Promise<string[]> {
  const participants = await client.listParticipants(room);
  const muted: string[] = [];

  for (const participant of participants) {
    if (participant.identity === callerIdentity) continue;
    if (isTutorMetadata(participant.metadata)) continue;
    const micTrack = participant.tracks.find((track) => track.source === TrackSource.MICROPHONE);
    if (!micTrack || micTrack.muted) continue;
    await client.mutePublishedTrack(room, participant.identity, micTrack.sid, true);
    muted.push(participant.identity);
  }

  return muted;
}

/**
 * Disconnect a participant.
 *
 * `livekit-client` reports the client's own `DisconnectReason.PARTICIPANT_REMOVED`
 * for this, which is what lets the classroom show "removed" rather than the
 * more alarming (and wrong) "your connection dropped".
 */
export async function removeParticipantFromRoom(client: RoomServiceClient, room: string, identity: string): Promise<void> {
  await client.removeParticipant(room, identity);
}
