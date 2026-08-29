import type { QualityMode, RoomRole } from "@/lib/live-classroom";

/**
 * The shape `/api/live/session` hands back, and the shape the persistent
 * call dock needs to keep a session alive across navigation.
 *
 * Lives here (not in the `/live` page) so both the page and
 * `LiveCallContext` can import it without one owning the other.
 */
export type LiveSession = {
  provider: "livekit";
  token: string | null;
  url: string | null;
  roomName: string;
  displayName: string;
  role: RoomRole;
  level: string;
  sessionSlot: string;
  branchName: string | null;
  isOnlineBranch: boolean;
  initialQuality: QualityMode;
  participantName: string;
  liveSessionId: string | null;
  joinCode: string | null;
  startedAt: string | null;
  tutorName: string | null;
  isPrivate: boolean;
  heartbeatMs: number;
};
