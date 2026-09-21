import { describe, expect, it } from "vitest";
import { parseFeeReminderSettings } from "./fee-reminder-settings";

describe("parseFeeReminderSettings", () => {
  it("is ON for a school that has never opened the screen", () => {
    for (const value of [undefined, null, "junk", 7, [], {}]) {
      const s = parseFeeReminderSettings(value);
      expect([s.emails, s.notifications, s.becca], String(value)).toEqual([true, true, true]);
    }
  });

  it("switches a channel off only for a literal false", () => {
    const s = parseFeeReminderSettings({ emails: false, notifications: "no", becca: 0 });
    expect(s.emails).toBe(false);
    // A malformed value must never silence reminders by accident.
    expect(s.notifications).toBe(true);
    expect(s.becca).toBe(true);
  });

  it("carries who last changed it, and when", () => {
    const s = parseFeeReminderSettings({ becca: false, updatedAt: "2026-09-21T10:00:00.000Z", updatedByName: "Jason" });
    expect(s.updatedAt).toBe("2026-09-21T10:00:00.000Z");
    expect(s.updatedByName).toBe("Jason");
  });
});
