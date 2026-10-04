import { describe, expect, it } from "vitest";
import {
  buildLockedNotice,
  lockedNoticeDue,
  lockedNoticeKey,
  lockedStatus,
  parseLockedNoticeKey,
  type LockedFacts,
} from "./locked-notice";

const base: LockedFacts = {
  firstName: "Ada",
  level: "A1",
  reason: "unpaid_deposit",
  depositOutstanding: 40000,
  requiredDeposit: 90000,
  balanceOutstanding: 100000,
  tuitionFee: 150000,
  totalPaid: 50000,
  lockAt: null,
};

describe("lockedStatus", () => {
  it("says what is owed and what opens it, from the real figures", () => {
    const s = lockedStatus(base);
    expect(s.headline).toMatch(/waiting on your deposit/);
    expect(s.whatUnlocks).toContain("₦40,000");
    expect(s.whatUnlocks).toContain("₦90,000");
    expect(s.whatUnlocks).toContain("₦50,000");
  });

  it("names the balance and the date the pause began for a balance lock", () => {
    const s = lockedStatus({ ...base, reason: "unsettled_balance", lockAt: "2026-09-02T00:00:00Z" });
    expect(s.headline).toMatch(/paused while a balance is open/);
    expect(s.whatUnlocks).toContain("₦100,000");
    expect(s.whatUnlocks).toContain("2 September");
  });

  it("does not invent anything when the reason is unknown", () => {
    const s = lockedStatus({ ...base, reason: null, depositOutstanding: 0 });
    expect(s.whatUnlocks).not.toMatch(/₦/);
  });
});

describe("buildLockedNotice", () => {
  it("is personal, links to payments and never threatens", () => {
    const n = buildLockedNotice(base);
    expect(n.title).toBe("Ada, an update on your EasyWay portal");
    expect(n.html).toContain("Hallo Ada,");
    expect(n.html).toContain("/payments");
    expect(n.html).toContain("Reply to this email");
    expect(n.message + n.emailBody).not.toMatch(/deadline|last chance|final|suspend|expire/i);
  });

  it("escapes a hostile name", () => {
    expect(buildLockedNotice({ ...base, firstName: "<script>alert(1)</script>" }).html).not.toContain("<script>alert");
  });
});

describe("tracking", () => {
  it("round-trips the dedupe key", () => {
    const key = lockedNoticeKey("stu_9", "2026-10-04");
    expect(parseLockedNoticeKey(key)).toEqual({ studentId: "stu_9", day: "2026-10-04" });
    expect(parseLockedNoticeKey("next-level-invite:x:A2:2026-10-04")).toBeNull();
  });

  it("sends once, then waits a week before saying it again", () => {
    const now = new Date("2026-10-20T09:00:00Z");
    expect(lockedNoticeDue(null, now)).toBe("send");
    expect(lockedNoticeDue("2026-10-18T09:00:00Z", now)).toBe("already");
    expect(lockedNoticeDue("2026-10-10T09:00:00Z", now)).toBe("again");
  });
});
