/**
 * The self-hosted real-time companion to /api/portal/updates and
 * /api/live/state — see src/lib/portal-updates.ts and src/lib/live-state.ts
 * for the shared query logic (the SAME functions this file calls on a timer
 * are what the Vercel routes call per poll) and src/lib/push-auth.ts for how
 * a browser proves who it is without the session cookie, which cannot cross
 * to this server's own host/port.
 *
 * The CLIENT side (PortalUpdates.tsx, push-client.ts, portal-state.ts,
 * useLiveClass.tsx) is wired unconditionally — it is this PROCESS that must
 * actually be running, reachable over WSS, and named by
 * NEXT_PUBLIC_PUSH_SERVER_URL for any of that to do anything. Until all
 * three are true, push-client.ts's `connectPushUpdates` is a true no-op and
 * every client falls back to its normal HTTP poll — see README.md in this
 * folder for the deploy steps.
 *
 * Runs with the same "trusted caller" posture as scripts/standalone-cron.ts:
 * no Next.js, no HTTP framework. Its own auth is the push-token scheme,
 * not a bearer header — see push-auth.ts.
 *
 * WHY A SINGLE CENTRAL TICK, NOT ONE TIMER PER CONNECTION: the point of this
 * service is to stop paying a Vercel invocation per poll; it must not just
 * move that same per-connection polling cost onto this box uncoordinated.
 * One tick fans out to every connected user in parallel, and a user with no
 * open socket costs nothing between connections.
 */
import { WebSocketServer, WebSocket } from "ws";
import { runUnscoped } from "../src/lib/tenant/context";
import { verifyPushToken } from "../src/lib/push-auth";
import { loadPortalUpdates, type PortalUpdatesResult } from "../src/lib/portal-updates";
import { loadLiveState, type LiveStateResult } from "../src/lib/live-state";
import { typingFeedFor } from "../src/lib/community-typing";
import { prisma } from "../src/lib/prisma";

const PORT = Number(process.env.PUSH_SERVER_PORT ?? 8081);
/** How often a connected user's updates are checked. Matches the "feels instant" bar the 8-12s HTTP poll set, not tighter — this is a replacement for that poll, not a reason to hit the DB harder than it did. */
const POLL_INTERVAL_MS = Number(process.env.PUSH_POLL_INTERVAL_MS ?? 10_000);
/**
 * Typing is the one feed that genuinely needs faster delivery than the main
 * tick — a ping only lives 7s (see community-typing.ts), and the client used
 * to poll this one as fast as 2.5s for exactly that reason. A SEPARATE,
 * faster loop rather than folding it into `tick()`: it is a different
 * question (per-channel, not per-user state) with a different freshness
 * bar, and `typingFeedFor` is a single cheap indexed read with its own 30s
 * room-scope cache — cheap enough to ask this often for every connected
 * user, which is the whole trade this box exists to make (DB load instead
 * of per-poll Vercel invocations).
 */
const TYPING_INTERVAL_MS = Number(process.env.PUSH_TYPING_INTERVAL_MS ?? 3_000);
const AUTH_TIMEOUT_MS = 10_000;

const secret = process.env.NEXTAUTH_SECRET;
if (!secret) {
  console.error("push-server: NEXTAUTH_SECRET is not set — cannot verify any client. Refusing to start.");
  process.exit(1);
}

type ClientState = {
  socket: WebSocket;
  userId: string;
  role: string | null;
  since: Date;
  /** Last typing-feed signature sent to THIS socket, so an unchanged "nobody typing" doesn't repeat every 3s. */
  typingSignature: string;
};
const clients = new Set<ClientState>();

function typingSignatureOf(feed: { enabled: boolean; rooms: { channelId: string; typers: { id: string }[] }[] }): string {
  return (
    (feed.enabled ? "on" : "off") +
    "|" +
    feed.rooms.map((room) => `${room.channelId}:${room.typers.map((t) => t.id).join(",")}`).join("|")
  );
}

function send(socket: WebSocket, payload: unknown) {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
}

async function tick(): Promise<void> {
  const byUser = new Map<string, ClientState[]>();
  for (const client of clients) {
    const list = byUser.get(client.userId) ?? [];
    list.push(client);
    byUser.set(client.userId, list);
  }

  await Promise.all(
    [...byUser.entries()].map(async ([userId, states]) => {
      // All sockets for one user share one cursor — the earliest `since` among
      // them, so a second tab that just connected doesn't miss what the first
      // tab already has delivered.
      const since = states.reduce((earliest, s) => (s.since < earliest ? s.since : earliest), states[0]!.since);
      let result: PortalUpdatesResult;
      let live: LiveStateResult | null;
      try {
        [result, live] = await runUnscoped("push-server fan-out tick", () =>
          Promise.all([
            loadPortalUpdates({ userId, role: states[0]!.role, since }),
            // Same "is my class live" query /api/live/state answers — sent on
            // every tick alongside portal updates rather than its own timer,
            // so a connected browser can retire that poll too.
            loadLiveState(userId).catch((error) => {
              console.error(`push-server: live-state failed for user ${userId}:`, error);
              return null;
            }),
          ]),
        );
      } catch (error) {
        console.error(`push-server: tick failed for user ${userId}:`, error);
        return;
      }
      const now = new Date(result.now);
      for (const client of states) {
        // Always sent, not just when `updates` is non-empty: `unread` is a
        // fresh snapshot every tick (e.g. read in another tab), not a delta,
        // and a client gating its HTTP backstop off entirely on push health
        // must still see it change without waiting for an actual new message.
        send(client.socket, { type: "update", ...result, live });
        client.since = now;
      }
    }),
  );
}

async function typingTick(): Promise<void> {
  const byUser = new Map<string, ClientState[]>();
  for (const client of clients) {
    const list = byUser.get(client.userId) ?? [];
    list.push(client);
    byUser.set(client.userId, list);
  }

  await Promise.all(
    [...byUser.entries()].map(async ([userId, states]) => {
      let feed: Awaited<ReturnType<typeof typingFeedFor>>;
      try {
        feed = await runUnscoped("push-server typing tick", () =>
          typingFeedFor({ userId, role: states[0]!.role ?? "" }),
        );
      } catch (error) {
        console.error(`push-server: typing tick failed for user ${userId}:`, error);
        return;
      }
      const signature = typingSignatureOf(feed);
      for (const client of states) {
        // Unlike the main tick, this one DOES skip unchanged sends — at a 3s
        // cadence the overwhelming majority of ticks are "still nobody
        // typing", and this is purely a visual indicator with no cursor to
        // keep correct, so there is no reason to pay the message for it.
        if (client.typingSignature === signature) continue;
        client.typingSignature = signature;
        send(client.socket, { type: "typing", ...feed });
      }
    }),
  );
}

const wss = new WebSocketServer({ port: PORT });

wss.on("connection", (socket) => {
  let authed = false;
  const authTimer = setTimeout(() => {
    if (!authed) socket.close(4001, "auth timeout");
  }, AUTH_TIMEOUT_MS);

  socket.once("message", async (raw) => {
    clearTimeout(authTimer);
    let message: unknown;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      socket.close(4002, "bad message");
      return;
    }
    if (
      !message ||
      typeof message !== "object" ||
      (message as { type?: unknown }).type !== "auth" ||
      typeof (message as { token?: unknown }).token !== "string"
    ) {
      socket.close(4002, "expected an auth message first");
      return;
    }

    const verdict = verifyPushToken((message as { token: string }).token, secret!);
    if (!verdict.ok) {
      socket.close(4003, verdict.reason);
      return;
    }

    // The role comes from the database, never from the client's own claim —
    // a forged "role":"admin" in the auth message must not widen what this
    // connection can see. verifyPushToken already proved the user id itself.
    const user = await runUnscoped("push-server auth lookup", () =>
      prisma.user.findUnique({ where: { id: verdict.userId }, select: { role: true } }),
    );
    if (!user) {
      socket.close(4004, "unknown user");
      return;
    }

    authed = true;
    const state: ClientState = { socket, userId: verdict.userId, role: user.role, since: new Date(), typingSignature: "" };
    clients.add(state);
    send(socket, { type: "ready" });
    socket.on("close", () => clients.delete(state));
    socket.on("error", () => clients.delete(state));
  });
});

const timer = setInterval(() => {
  tick().catch((error) => console.error("push-server: tick crashed:", error));
}, POLL_INTERVAL_MS);

const typingTimer = setInterval(() => {
  typingTick().catch((error) => console.error("push-server: typing tick crashed:", error));
}, TYPING_INTERVAL_MS);

console.log(
  `push-server listening on :${PORT}, polling connected users every ${POLL_INTERVAL_MS}ms (typing every ${TYPING_INTERVAL_MS}ms)`,
);

function shutdown() {
  clearInterval(timer);
  clearInterval(typingTimer);
  wss.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2_000).unref();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
