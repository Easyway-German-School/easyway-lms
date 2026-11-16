"use client";

/**
 * Browser-side connection to the self-hosted push server (push-server/server.ts).
 *
 * OFF BY DEFAULT. `NEXT_PUBLIC_PUSH_SERVER_URL` is unset in every environment
 * today, and `connectPushUpdates` below does nothing at all when it is unset
 * — not "degrades gracefully", literally returns without touching the
 * network. Nothing about today's polling changes until that env var is
 * deliberately set AFTER push-server is deployed and proven. See
 * push-server/README.md for that decision.
 *
 * When it IS set: fetches a short-lived token from /api/portal/push-token
 * (see push-auth.ts for why a token, not the session cookie), opens a
 * WebSocket, and calls `onUpdate` for each update the server pushes.
 * Reconnects with backoff on any drop — a flaky mobile link must not mean
 * "notifications silently stop"; it falls back to nothing worse than what
 * polling already tolerates, because the caller is expected to keep polling
 * as a backstop until this proves itself (see PortalUpdates.tsx).
 */
import type { PortalUpdatesResult } from "@/lib/portal-updates";

export type PushUpdateHandler = (result: PortalUpdatesResult) => void;
/**
 * "open" fires once the server has actually accepted the auth token (its
 * `{type:"ready"}` reply), not just on the raw socket opening — that is the
 * earliest point a caller can safely treat this link as live and back its
 * own polling off. "closed" fires on any drop, including the very first
 * connection attempt failing, so a caller defaults to its normal poll
 * cadence until this says otherwise.
 */
export type PushStatusHandler = (status: "open" | "closed") => void;

const RECONNECT_BASE_MS = 2_000;
const RECONNECT_MAX_MS = 30_000;

export type PushConnection = { close: () => void };

export function pushServerUrl(): string | null {
  const url = process.env.NEXT_PUBLIC_PUSH_SERVER_URL;
  return url && url.trim() ? url.trim() : null;
}

export function connectPushUpdates(onUpdate: PushUpdateHandler, onStatus?: PushStatusHandler): PushConnection {
  const maybeUrl = pushServerUrl();
  if (!maybeUrl) return { close: () => {} };
  const url: string = maybeUrl; // narrowed once, so the nested `open()` closure below sees `string`, not `string | null`

  let closed = false;
  let socket: WebSocket | null = null;
  let reconnectDelay = RECONNECT_BASE_MS;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  async function open() {
    if (closed) return;
    let token: string;
    try {
      const response = await fetch("/api/portal/push-token", { cache: "no-store" });
      if (!response.ok) throw new Error(`push-token ${response.status}`);
      token = ((await response.json()) as { token: string }).token;
    } catch {
      scheduleReconnect();
      return;
    }
    if (closed) return;

    socket = new WebSocket(url);
    socket.addEventListener("open", () => {
      socket?.send(JSON.stringify({ type: "auth", token }));
    });
    socket.addEventListener("message", (event) => {
      let payload: unknown;
      try {
        payload = JSON.parse(typeof event.data === "string" ? event.data : "");
      } catch {
        return;
      }
      if (!payload || typeof payload !== "object") return;
      const type = (payload as { type?: unknown }).type;
      if (type === "ready") {
        reconnectDelay = RECONNECT_BASE_MS; // a successful auth means the link is good again
        onStatus?.("open");
      } else if (type === "update") {
        onUpdate(payload as PortalUpdatesResult);
      }
    });
    socket.addEventListener("close", () => {
      onStatus?.("closed");
      scheduleReconnect();
    });
    socket.addEventListener("error", () => socket?.close());
  }

  function scheduleReconnect() {
    if (closed) return;
    reconnectTimer = setTimeout(() => {
      reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS);
      open();
    }, reconnectDelay);
  }

  open();

  return {
    close: () => {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      socket?.close();
    },
  };
}
