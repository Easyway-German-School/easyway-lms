/**
 * Verifies the live classroom can actually connect.
 *
 * This deliberately mints the token the same way `/api/live/session` does —
 * through the SDK, off the system clock — because that is the path that breaks
 * when the machine's time drifts. A token minted any other way would prove the
 * credentials are good while saying nothing about whether a class can start.
 */
import { AccessToken, RoomServiceClient } from "livekit-server-sdk";
import { liveKitConfigured, missingLiveKitConfig, cohortRoomName } from "../src/lib/live-classroom";
import { mbPerHour, recordingObjectKey, recordingPublicUrl, recordingStorage, recordingVariant } from "../src/lib/recording";
import { planRetention, RETENTION } from "../src/lib/retention";
import { activeTransport } from "../src/lib/mailer";

/** Real UTC in epoch seconds, from a server rather than this machine. */
async function trueNow(): Promise<number> {
  const res = await fetch("https://www.google.com", { method: "HEAD" });
  return Math.floor(new Date(res.headers.get("date")!).getTime() / 1000);
}

async function main() {
  const url = process.env.LIVEKIT_URL || "";
  console.log("LIVEKIT_URL     :", url.replace(/^(wss:\/\/.{14}).*/, "$1…"));
  console.log("configured()    :", liveKitConfigured());

  /**
   * Naming the missing variable is the entire point of this line.
   *
   * The first live demo failed because production had the key and the secret
   * but not the URL, and nothing anywhere said so — the classroom just quietly
   * became a different, broken product. Run this against a deployment's
   * environment before a class and that is a one-line answer.
   */
  const missing = missingLiveKitConfig();
  if (missing.length > 0) {
    console.error("MISSING         :", missing.join(", ") + " — no class can start until these are set");
    process.exitCode = 1;
    return;
  }

  const drift = Math.floor(Date.now() / 1000) - (await trueNow());
  console.log("clock drift     :", `${drift}s vs real UTC ${Math.abs(drift) < 120 ? "— OK" : "— TOO FAR, tokens will be rejected"}`);

  const room = cohortRoomName({ branchName: "Abuja", level: "A1", sessionSlot: "morning" });
  console.log("sample room     :", room);

  // Exactly what the app does for a student joining a class.
  const at = new AccessToken(process.env.LIVEKIT_API_KEY!, process.env.LIVEKIT_API_SECRET!, {
    identity: "verify-script",
    ttl: 60,
  });
  at.addGrant({ roomJoin: true, room, canPublish: true, canSubscribe: true });
  const token = await at.toJwt();
  console.log("SDK token       :", token.split(".").length === 3 ? `valid JWT (${token.length} chars)` : "MALFORMED");

  const httpUrl = url.replace(/^wss:/, "https:").replace(/^ws:/, "http:");
  const svc = new RoomServiceClient(httpUrl, process.env.LIVEKIT_API_KEY!, process.env.LIVEKIT_API_SECRET!);
  const rooms = await svc.listRooms();
  console.log("server accepted : YES — SDK credentials valid, " + rooms.length + " active room(s)");

  // Prove a class can actually be opened, then clean up after ourselves.
  const created = await svc.createRoom({ name: room, emptyTimeout: 60 });
  console.log("room created    : YES — " + created.name + " (sid " + created.sid + ")");
  await svc.deleteRoom(room);
  console.log("room deleted    : YES — test room cleaned up");

  // --- recording -----------------------------------------------------------
  const storage = recordingStorage();
  console.log("");
  const variant = recordingVariant();
  console.log("recording       :", storage ? `configured (${variant})` : "OFF — classes stream but are not captured");
  console.log("  profile       :", `${variant} — ~${mbPerHour(variant)} MB/hour, ~${((mbPerHour(variant) * 1500) / 1024).toFixed(0)} GB per branch-year`);
  if (storage) {
    console.log("  bucket        :", storage.bucket + (storage.endpoint ? ` @ ${storage.endpoint}` : ""));
    console.log("  sample key    :", recordingObjectKey({ branchName: "Abuja", level: "A1", roomName: room }));
    console.log("  playback url  :", recordingPublicUrl(recordingObjectKey({ branchName: "Abuja", level: "A1", roomName: room }), storage));
  } else {
    console.log("  needed        : RECORDING_S3_BUCKET, RECORDING_S3_ACCESS_KEY, RECORDING_S3_SECRET");
  }

  // --- retention -----------------------------------------------------------
  const plan = await planRetention();
  console.log("");
  console.log("retention       :", `${plan.verdicts.length} recording(s) considered`);
  console.log("  policy        :", `protect ${RETENTION.protectedDays}d, reclaim if unwatched ${RETENTION.idleWindowDays}d`);
  console.log("  reclaimable   :", `${plan.reclaimable} (${(plan.bytesReclaimable / 1024 / 1024).toFixed(1)} MB)`);
  for (const verdict of plan.verdicts.slice(0, 5)) {
    console.log(`    ${verdict.decision === "reclaim" ? "RECLAIM" : "keep   "} ${verdict.title} — ${verdict.reason}`);
  }

  // --- email ---------------------------------------------------------------
  console.log("");
  console.log("email transport :", activeTransport());
  if (activeTransport() === "none") {
    console.log("  needed        : SMTP_USER + SMTP_PASS (EMAIL_PROVIDER=zoho fills in host/port)");
  }
}

main().catch((err) => {
  console.error("FAILED:", err?.message || err);
  process.exit(1);
});
