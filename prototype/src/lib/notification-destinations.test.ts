import { describe, expect, it } from "vitest";

import { resolveNotificationHop } from "@/lib/notification-destinations";

describe("resolveNotificationHop community deep links", () => {
  it("keeps a channel link clickable when the reader is already on Community", () => {
    expect(
      resolveNotificationHop({
        kind: "announcement",
        link: "/community?channel=room-123&message=message-456",
        currentPath: "/community",
      }),
    ).toMatchObject({
      href: "/community?channel=room-123&message=message-456",
      clickable: true,
    });
  });

  it("routes staff to the matching admin community room", () => {
    expect(
      resolveNotificationHop({
        kind: "community",
        link: "/community?channel=room-123&message=message-456",
        currentPath: "/admin/notifications",
      }),
    ).toMatchObject({
      href: "/admin/community?channel=room-123&message=message-456",
      clickable: true,
    });
  });

  it("still suppresses a link that only points to the page already open", () => {
    expect(
      resolveNotificationHop({
        kind: "community",
        link: "/community",
        currentPath: "/community",
      }).clickable,
    ).toBe(false);
  });
});
