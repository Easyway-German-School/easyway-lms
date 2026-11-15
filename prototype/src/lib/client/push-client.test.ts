import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** A minimal stand-in for the browser WebSocket, just enough for push-client's needs. */
class FakeSocket {
  static instances: FakeSocket[] = [];
  listeners: Record<string, ((event: any) => void)[]> = {};
  sent: string[] = [];
  closed = false;
  constructor(public url: string) {
    FakeSocket.instances.push(this);
  }
  addEventListener(type: string, handler: (event: any) => void) {
    (this.listeners[type] ??= []).push(handler);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.closed = true;
    this.emit("close", {});
  }
  emit(type: string, event: any) {
    for (const handler of this.listeners[type] ?? []) handler(event);
  }
}

beforeEach(() => {
  FakeSocket.instances = [];
  vi.stubGlobal("WebSocket", FakeSocket as unknown as typeof WebSocket);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => ({ token: "tok-123" }) })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  delete process.env.NEXT_PUBLIC_PUSH_SERVER_URL;
});

describe("connectPushUpdates", () => {
  it("does nothing at all when NEXT_PUBLIC_PUSH_SERVER_URL is unset — no fetch, no socket", async () => {
    delete process.env.NEXT_PUBLIC_PUSH_SERVER_URL;
    const { connectPushUpdates } = await import("./push-client");
    const onUpdate = vi.fn();
    connectPushUpdates(onUpdate);
    await Promise.resolve();
    expect(fetch).not.toHaveBeenCalled();
    expect(FakeSocket.instances).toHaveLength(0);
  });

  it("fetches a token, opens a socket to the configured URL, and authenticates", async () => {
    process.env.NEXT_PUBLIC_PUSH_SERVER_URL = "ws://push.example:8081";
    const { connectPushUpdates } = await import("./push-client");
    connectPushUpdates(vi.fn());
    await Promise.resolve();
    await Promise.resolve();
    expect(fetch).toHaveBeenCalledWith("/api/portal/push-token", { cache: "no-store" });
    expect(FakeSocket.instances).toHaveLength(1);
    const socket = FakeSocket.instances[0]!;
    expect(socket.url).toBe("ws://push.example:8081");
    socket.emit("open", {});
    expect(socket.sent).toEqual([JSON.stringify({ type: "auth", token: "tok-123" })]);
  });

  it("calls onUpdate only for update-typed messages, ignoring others", async () => {
    process.env.NEXT_PUBLIC_PUSH_SERVER_URL = "ws://push.example:8081";
    const { connectPushUpdates } = await import("./push-client");
    const onUpdate = vi.fn();
    connectPushUpdates(onUpdate);
    await Promise.resolve();
    await Promise.resolve();
    const socket = FakeSocket.instances[0]!;
    socket.emit("message", { data: JSON.stringify({ type: "ready" }) });
    expect(onUpdate).not.toHaveBeenCalled();
    const payload = { type: "update", updates: [], unread: 2, now: "2026-11-15T12:00:00.000Z" };
    socket.emit("message", { data: JSON.stringify(payload) });
    expect(onUpdate).toHaveBeenCalledWith(payload);
  });

  it("stops reconnecting once closed by the caller", async () => {
    vi.useFakeTimers();
    process.env.NEXT_PUBLIC_PUSH_SERVER_URL = "ws://push.example:8081";
    const { connectPushUpdates } = await import("./push-client");
    const connection = connectPushUpdates(vi.fn());
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);
    expect(FakeSocket.instances).toHaveLength(1);
    connection.close();
    FakeSocket.instances[0]!.emit("close", {});
    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeSocket.instances).toHaveLength(1); // no reconnect attempt after close()
    vi.useRealTimers();
  });
});
