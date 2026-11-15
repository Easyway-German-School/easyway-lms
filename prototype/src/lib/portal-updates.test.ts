import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  channelFindMany: vi.fn(async () => [] as { id: string; name: string }[]),
  messageFindMany: vi.fn(async () => [] as any[]),
  notificationFindMany: vi.fn(async () => [] as any[]),
  resolveSpaceScope: vi.fn(async () => ({ spaceIds: [] as string[] })),
  unreadByChannel: vi.fn(async () => ({}) as Record<string, number>),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: mocks.userFindUnique },
    channel: { findMany: mocks.channelFindMany },
    message: { findMany: mocks.messageFindMany },
    notification: { findMany: mocks.notificationFindMany },
  },
}));
vi.mock("@/lib/community-spaces", () => ({ resolveSpaceScope: mocks.resolveSpaceScope }));
vi.mock("@/lib/community-unread", () => ({
  unreadByChannel: mocks.unreadByChannel,
  totalUnread: (byChannel: Record<string, number>) => Object.values(byChannel).reduce((a, b) => a + b, 0),
}));
vi.mock("@/lib/community-notify", () => ({ previewOf: (body: string) => body }));
vi.mock("@/lib/notification-destinations", () => ({ storedNotificationLink: (_kind: string, link: string | null) => link }));
vi.mock("@/lib/admin-roles", () => ({ normalizeAdminRole: (role: unknown) => role }));

import { clampSince, loadPortalUpdates } from "./portal-updates";

const NOW = new Date("2026-11-15T12:00:00.000Z");
const SINCE = new Date("2026-11-15T11:55:00.000Z");

beforeEach(() => {
  mocks.userFindUnique.mockReset().mockResolvedValue({ adminRole: null });
  mocks.channelFindMany.mockReset().mockResolvedValue([]);
  mocks.messageFindMany.mockReset().mockResolvedValue([]);
  mocks.notificationFindMany.mockReset().mockResolvedValue([]);
  mocks.resolveSpaceScope.mockReset().mockResolvedValue({ spaceIds: [] });
  mocks.unreadByChannel.mockReset().mockResolvedValue({});
});

describe("clampSince", () => {
  it("defaults to now with no cursor", () => {
    expect(clampSince(null, NOW)).toEqual(NOW);
    expect(clampSince(undefined, NOW)).toEqual(NOW);
  });

  it("defaults to now for an unparseable cursor", () => {
    expect(clampSince("not-a-date", NOW)).toEqual(NOW);
  });

  it("keeps a recent cursor as-is", () => {
    expect(clampSince(SINCE.toISOString(), NOW)).toEqual(SINCE);
  });

  it("clamps a cursor older than an hour up to the floor, never further back", () => {
    const ancient = new Date(NOW.getTime() - 10 * 60 * 60_000);
    expect(clampSince(ancient.toISOString(), NOW)).toEqual(new Date(NOW.getTime() - 60 * 60_000));
  });
});

describe("loadPortalUpdates", () => {
  it("skips the channel/message/unread queries entirely when the user has no spaces", async () => {
    const result = await loadPortalUpdates({ userId: "user-1", role: "student", since: SINCE });
    expect(mocks.channelFindMany).not.toHaveBeenCalled();
    expect(mocks.messageFindMany).not.toHaveBeenCalled();
    expect(mocks.unreadByChannel).not.toHaveBeenCalled();
    expect(result.updates).toEqual([]);
    expect(result.unread).toBe(0);
  });

  it("excludes the user's own messages and only reads messages newer than `since`, in their channels", async () => {
    mocks.resolveSpaceScope.mockResolvedValue({ spaceIds: ["space-1"] });
    mocks.channelFindMany.mockResolvedValue([{ id: "chan-1", name: "General" }]);
    await loadPortalUpdates({ userId: "user-1", role: "student", since: SINCE });
    expect(mocks.messageFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          channelId: { in: ["chan-1"] },
          createdAt: { gt: SINCE },
          hiddenAt: null,
          authorId: { not: "user-1" },
        }),
      }),
    );
  });

  it("only returns the bell's unread rows, newer than since", async () => {
    await loadPortalUpdates({ userId: "user-1", role: "student", since: SINCE });
    expect(mocks.notificationFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: "user-1", channel: "in-app", readAt: null, createdAt: { gt: SINCE } }),
      }),
    );
  });

  it("scopes an influencer admin's notifications to audience: null", async () => {
    mocks.userFindUnique.mockResolvedValue({ adminRole: "influencer" });
    await loadPortalUpdates({ userId: "admin-1", role: "admin", since: SINCE });
    expect(mocks.notificationFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ audience: null }) }),
    );
  });

  it("combines messages and notifications, newest first, capped at 8", async () => {
    mocks.resolveSpaceScope.mockResolvedValue({ spaceIds: ["space-1"] });
    mocks.channelFindMany.mockResolvedValue([{ id: "chan-1", name: "General" }]);
    mocks.messageFindMany.mockResolvedValue(
      Array.from({ length: 5 }, (_, i) => ({
        id: `m${i}`,
        channelId: "chan-1",
        body: "hi",
        attachmentUrl: null,
        attachmentType: null,
        createdAt: new Date(SINCE.getTime() + (i + 1) * 1000),
        author: { name: "Tutor" },
      })),
    );
    mocks.notificationFindMany.mockResolvedValue(
      Array.from({ length: 5 }, (_, i) => ({
        id: `n${i}`,
        title: "Fee due",
        message: "Pay now",
        kind: "fee",
        link: null,
        severity: "warning",
        createdAt: new Date(SINCE.getTime() + (i + 10) * 1000),
      })),
    );
    const result = await loadPortalUpdates({ userId: "user-1", role: "student", since: SINCE });
    expect(result.updates).toHaveLength(8);
    // Notifications were all stamped later than messages, so the newest-first cap keeps them all plus the 3 newest messages.
    expect(result.updates.filter((u) => u.source === "notification")).toHaveLength(5);
    expect(result.updates.filter((u) => u.source === "chat")).toHaveLength(3);
    expect(result.updates[0]!.id).toBe("notification:n4");
  });
});
