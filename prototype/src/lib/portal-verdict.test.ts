import { describe, expect, it } from "vitest";
import { STALE_AFTER_MS, judgeWitness, portalVerdict, renderedLockOf } from "./portal-verdict";

const open = { hasAccess: true, lockReason: null } as const;

describe("portalVerdict", () => {
  it("is open only when neither gate holds the student", () => {
    expect(portalVerdict(open, true)).toMatchObject({ open: true, key: "open", locks: [] });
  });

  it("reports the photo wall for a PAID student — the case the admin mirror used to miss", () => {
    const verdict = portalVerdict(open, false);
    expect(verdict.open).toBe(false);
    expect(verdict.key).toBe("photo_missing");
    expect(verdict.locks[0].fix).toMatch(/camera/i);
  });

  it("reports the payment reason with the photo wall together", () => {
    const verdict = portalVerdict({ hasAccess: false, lockReason: "unsettled_balance" }, false);
    expect(verdict.locks.map((lock) => lock.code)).toEqual(["photo_missing", "unsettled_balance"]);
    expect(verdict.key).toBe("photo_missing+unsettled_balance");
  });

  it("falls back to unpaid_deposit when the gate is shut but gave no reason", () => {
    expect(portalVerdict({ hasAccess: false, lockReason: null }, true).key).toBe("unpaid_deposit");
  });

  it("gives the same key regardless of the order the locks were found in", () => {
    expect(portalVerdict({ hasAccess: false, lockReason: "upcoming_batch" }, false).key).toBe(
      "photo_missing+upcoming_batch",
    );
  });
});

describe("renderedLockOf", () => {
  it("mirrors the shell: the tuition/batch screen wins over the photo screen", () => {
    expect(renderedLockOf({ routeLocked: true, photoLocked: true, lockReason: "unsettled_balance" })).toBe("payment");
    expect(renderedLockOf({ routeLocked: true, photoLocked: false, lockReason: "upcoming_batch" })).toBe("batch");
    expect(renderedLockOf({ routeLocked: false, photoLocked: true, lockReason: null })).toBe("photo");
    expect(renderedLockOf({ routeLocked: false, photoLocked: false, lockReason: null })).toBe("none");
  });
});

describe("judgeWitness", () => {
  const now = 10_000_000;
  const fresh = (hasAccess: boolean, hasPhoto: boolean) =>
    portalVerdict({ hasAccess, lockReason: hasAccess ? null : "unpaid_deposit" }, hasPhoto);

  it("is fine when the screen matches what the client was told and the server agrees", () => {
    expect(
      judgeWitness({ receivedLocks: ["photo_missing"], rendered: "photo", computedAt: now - 5_000 }, fresh(true, false), now),
    ).toEqual({ kind: "ok" });
  });

  it("is fine to render no lock on an ungated page even when locks exist", () => {
    expect(
      judgeWitness({ receivedLocks: ["unpaid_deposit"], rendered: "none", computedAt: now - 1_000 }, fresh(false, true), now),
    ).toEqual({ kind: "ok" });
  });

  it("flags a lock screen the client's own verdict did not justify (render drift)", () => {
    const result = judgeWitness({ receivedLocks: [], rendered: "photo", computedAt: now - 1_000 }, fresh(true, true), now);
    expect(result.kind).toBe("render");
  });

  it("flags a payment screen shown to a client told the portal was open", () => {
    expect(judgeWitness({ receivedLocks: [], rendered: "payment", computedAt: now }, fresh(true, true), now).kind).toBe("render");
  });

  it("flags a client stuck on an old locked verdict once the database has moved on (stale)", () => {
    const result = judgeWitness(
      { receivedLocks: ["unpaid_deposit"], rendered: "payment", computedAt: now - (STALE_AFTER_MS + 30_000) },
      fresh(true, true),
      now,
    );
    expect(result.kind).toBe("stale");
    if (result.kind === "stale") expect(result.ageSeconds).toBeGreaterThan(90);
  });

  it("does NOT flag a difference inside the race window — a payment that landed a moment ago", () => {
    expect(
      judgeWitness({ receivedLocks: ["unpaid_deposit"], rendered: "payment", computedAt: now - 20_000 }, fresh(true, true), now),
    ).toEqual({ kind: "ok" });
  });

  it("treats a report with reordered lock codes as the same verdict", () => {
    expect(
      judgeWitness(
        { receivedLocks: ["unpaid_deposit", "photo_missing"], rendered: "payment", computedAt: now - (STALE_AFTER_MS + 5_000) },
        portalVerdict({ hasAccess: false, lockReason: "unpaid_deposit" }, false),
        now,
      ),
    ).toEqual({ kind: "ok" });
  });
});
