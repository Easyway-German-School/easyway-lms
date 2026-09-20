import { beforeEach, describe, expect, it, vi } from "vitest";

const putMedia = vi.fn();
const sweepExpired = vi.fn(async () => ({ cleared: 0 }));
const wouldExceedCap = vi.fn(async (_bytes: number) => false);
vi.mock("@/lib/offline/store", () => ({
  OFFLINE_CAP_BYTES: 1e12,
  putMedia: (...args: unknown[]) => putMedia(...args),
  sweepExpired: () => sweepExpired(),
  wouldExceedCap: (bytes: number) => wouldExceedCap(bytes),
}));

import { downloadVideoForOffline, OfflineCapError, OfflineDeviceFullError } from "./download";
import type { LibraryVideo } from "@/lib/video-library";

const video = {
  id: "vid1",
  title: "A1 lesson",
  kind: "recording",
  level: "A1",
  durationSeconds: 60,
  isPrivate: false,
  lecturerName: "Tutor",
  recordedAt: null,
  expiresAt: null,
  embedUrl: null,
  thumbnailUrl: null,
  fileUrl: "/api/files/recordings/a1.mp4",
} as unknown as LibraryVideo;

const BUCKET = "https://bucket.example/recordings/a1.mp4?X-Amz-Signature=abc";
const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
const bytes = () => new Response(new Uint8Array([1, 2, 3, 4]), { status: 200, headers: { "Content-Type": "video/mp4" } });

/** A body that yields one chunk, then errors — a connection dropping mid-file. */
const brokenStream = () => {
  let pulls = 0;
  return new Response(
    new ReadableStream({
      pull(controller) {
        if (pulls++ === 0) controller.enqueue(new Uint8Array([1, 2]));
        else controller.error(new TypeError("network dropped"));
      },
    }),
    { status: 200 },
  );
};

describe("downloadVideoForOffline", () => {
  const calls: Array<{ url: string; credentials?: RequestCredentials }> = [];
  let handler: (url: string) => Response | Promise<Response>;

  beforeEach(() => {
    calls.length = 0;
    putMedia.mockReset();
    sweepExpired.mockClear();
    wouldExceedCap.mockReset();
    wouldExceedCap.mockResolvedValue(false);
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      calls.push({ url, credentials: init?.credentials });
      return handler(url);
    });
  });

  it("pulls straight from the bucket and never touches the byte proxy", async () => {
    handler = (url) => (url.includes("signed=1") ? json({ url: BUCKET }) : bytes());
    await downloadVideoForOffline(video);
    expect(calls.map((c) => c.url)).toEqual(["/api/files/recordings/a1.mp4?signed=1", BUCKET]);
    expect(calls[1].credentials).toBe("omit");
    expect(putMedia).toHaveBeenCalledTimes(1);
  });

  it("falls back to the proxy when the bucket blocks the browser (CORS)", async () => {
    handler = (url) => {
      if (url.includes("signed=1")) return json({ url: BUCKET });
      if (url === BUCKET) throw new TypeError("Failed to fetch");
      return bytes();
    };
    await downloadVideoForOffline(video);
    expect(calls.at(-1)?.url).toBe("/api/files/recordings/a1.mp4?proxy=1");
    expect(putMedia).toHaveBeenCalledTimes(1);
  });

  it("uses the proxy when the key is not eligible for a direct link", async () => {
    handler = (url) => (url.includes("signed=1") ? json({ url: null }) : bytes());
    await downloadVideoForOffline(video);
    expect(calls.map((c) => c.url)).toEqual([
      "/api/files/recordings/a1.mp4?signed=1",
      "/api/files/recordings/a1.mp4?proxy=1",
    ]);
  });

  it("does not silently re-download through the proxy after a mid-file failure", async () => {
    handler = (url) => (url.includes("signed=1") ? json({ url: BUCKET }) : brokenStream());
    await expect(downloadVideoForOffline(video)).rejects.toThrow();
    expect(calls.some((c) => c.url.includes("proxy=1"))).toBe(false);
    expect(putMedia).not.toHaveBeenCalled();
  });

  it("sweeps expired recordings before checking the cap, so dead files never block a download", async () => {
    const order: string[] = [];
    sweepExpired.mockImplementationOnce(async () => {
      order.push("sweep");
      return { cleared: 3 };
    });
    wouldExceedCap.mockImplementation(async () => {
      order.push("cap");
      return false;
    });
    handler = (url) => (url.includes("signed=1") ? json({ url: BUCKET }) : bytes());
    await downloadVideoForOffline(video);
    expect(order[0]).toBe("sweep");
    expect(order[1]).toBe("cap");
  });

  it("refuses with an OfflineCapError when the library is already at the cap", async () => {
    wouldExceedCap.mockResolvedValue(true);
    handler = () => bytes();
    await expect(downloadVideoForOffline(video)).rejects.toBeInstanceOf(OfflineCapError);
    expect(calls).toHaveLength(0);
    expect(putMedia).not.toHaveBeenCalled();
  });

  it("turns the browser's QuotaExceededError into a plain 'phone is full' error", async () => {
    handler = (url) => (url.includes("signed=1") ? json({ url: BUCKET }) : bytes());
    putMedia.mockRejectedValueOnce(new DOMException("The quota has been exceeded.", "QuotaExceededError"));
    const failure = await downloadVideoForOffline(video).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(OfflineDeviceFullError);
    // Same family as the cap error, so the UI shows the "Open my downloads" link for both.
    expect(failure).toBeInstanceOf(OfflineCapError);
    expect((failure as Error).message).toMatch(/out of storage/i);
  });

  it("lets any other write failure through unchanged", async () => {
    handler = (url) => (url.includes("signed=1") ? json({ url: BUCKET }) : bytes());
    putMedia.mockRejectedValueOnce(new Error("disk on fire"));
    await expect(downloadVideoForOffline(video)).rejects.toThrow("disk on fire");
  });
});
