import { describe, expect, it } from "vitest";
import { mergeStudentRecords, type MergeDb, type MergeParty, type MergeTx } from "./student-merge";

/**
 * The incident this pins (2026-09-19): the guarded Prisma client performs a
 * soft-delete through the BASE client, so a `delete` inside an interactive
 * transaction commits immediately even if the transaction later rolls back.
 * A timed-out merge therefore left the duplicate's student and login hidden
 * while its payment was still attached to them.
 *
 * The fake below reproduces exactly that: `db.*.delete` is recorded as
 * committed the moment it runs, whether or not a transaction is open, and a
 * rolled-back transaction discards only what happened on `tx`.
 */

type Log = string[];

function fakeDb(opts: { failInTx?: string; failDelete?: "charge" | "student" | "user" } = {}) {
  const committed: Log = [];
  let inTx = false;
  const deletedWhileInTx: string[] = [];

  const makeTx = (staged: Log): MergeTx => {
    const boom = (name: string) => {
      if (opts.failInTx === name) throw new Error(`simulated failure in ${name}`);
    };
    return {
      payment: { updateMany: async () => (boom("payment"), staged.push("tx:payments moved"), { count: 1 }) },
      invoice: { updateMany: async () => (boom("invoice"), staged.push("tx:invoices moved"), { count: 0 }) },
      paymentPlan: { updateMany: async () => (boom("paymentPlan"), staged.push("tx:plans moved"), { count: 0 }) },
      tuitionCharge: {
        // Keeper has A1; the duplicate has its own A1 (dropped) and a B1 (moved).
        findMany: async (a) =>
          a.where.studentId === "keeper"
            ? [{ id: "kc1", level: "A1" }]
            : [
                { id: "ac1", level: "A1" },
                { id: "ac2", level: "B1" },
              ],
        update: async () => void staged.push("tx:charge moved"),
      },
      parentStudent: {
        findMany: async () => [],
        update: async () => undefined,
        delete: async () => undefined,
      },
      student: {
        update: async (a) => void staged.push(`tx:student updated ${a.where.id}`),
      },
      studentProfile: { update: async () => undefined },
    };
  };

  const recordDelete = (what: string, kind: "charge" | "student" | "user") => async () => {
    if (inTx) deletedWhileInTx.push(what);
    if (opts.failDelete === kind) throw new Error(`simulated ${kind} delete failure`);
    committed.push(`delete:${what}`); // soft-delete commits immediately — the real behaviour
  };

  const db: MergeDb = {
    $transaction: async (fn) => {
      const staged: Log = [];
      inTx = true;
      try {
        const result = await fn(makeTx(staged));
        committed.push(...staged); // commit
        return result;
      } finally {
        inTx = false; // on a throw, `staged` is simply discarded — the rollback
      }
    },
    tuitionCharge: { delete: async (a) => recordDelete(`charge ${a.where.id}`, "charge")() },
    student: { delete: async (a) => recordDelete(`student ${a.where.id}`, "student")() },
    user: { delete: async (a) => recordDelete(`user ${a.where.id}`, "user")() },
  };
  return { db, committed, deletedWhileInTx };
}

const party = (id: string, over: Partial<MergeParty> = {}): MergeParty => ({
  id,
  studentCode: id === "keeper" ? "EW/2026/A1/OCT/N171" : "EW/2026/A1/SEP/N038",
  branchId: "branch-online",
  deliveryMode: "online",
  admission: { batch: id === "keeper" ? "October" : "September 2026", phone: "08031234391" },
  user: { id: `${id}-user`, email: `${id}@example.com` },
  profile: null,
  ...over,
});

describe("mergeStudentRecords", () => {
  it("moves the money first and retires the duplicate only after the commit", async () => {
    const { db, committed, deletedWhileInTx } = fakeDb();
    const outcome = await mergeStudentRecords(db, party("keeper"), party("dupe"), "2026-09-19T00:00:00.000Z");

    expect(outcome.payments).toBe(1);
    expect(outcome.chargesMoved).toBe(1); // the duplicate's B1
    expect(outcome.chargesDropped).toBe(1); // its A1 — the keeper already has one
    expect(outcome.retired).toBe(true);
    expect(outcome.cleanupErrors).toEqual([]);

    // No irreversible delete ran while the transaction was open…
    expect(deletedWhileInTx).toEqual([]);
    // …and every delete is ordered AFTER the last thing the transaction did.
    const lastTx = committed.map((e) => e.startsWith("tx:")).lastIndexOf(true);
    const firstDelete = committed.findIndex((e) => e.startsWith("delete:"));
    expect(firstDelete).toBeGreaterThan(lastTx);
    // Student is hidden before the login.
    expect(committed.indexOf("delete:student dupe")).toBeLessThan(committed.indexOf("delete:user dupe-user"));
  });

  it("deletes NOTHING when the transaction fails — the money never ends up on a hidden record", async () => {
    const { db, committed } = fakeDb({ failInTx: "paymentPlan" });
    await expect(mergeStudentRecords(db, party("keeper"), party("dupe"))).rejects.toThrow("simulated failure in paymentPlan");
    // The bug: this used to contain delete:* entries even though the moves rolled back.
    expect(committed).toEqual([]);
  });

  it("stamps the duplicate inside the transaction so an interrupted clean-up is recognisable", async () => {
    const { db, committed } = fakeDb();
    await mergeStudentRecords(db, party("keeper"), party("dupe"));
    expect(committed).toContain("tx:student updated dupe");
  });

  it("reports a failed login retirement without losing the merge", async () => {
    const { db, committed } = fakeDb({ failDelete: "user" });
    const outcome = await mergeStudentRecords(db, party("keeper"), party("dupe"));
    expect(committed).toContain("tx:payments moved"); // the money is safe
    expect(outcome.retired).toBe(false);
    expect(outcome.cleanupErrors.join(" ")).toContain("login");
  });

  it("never kills the login of a student it could not hide", async () => {
    const { db, committed } = fakeDb({ failDelete: "student" });
    const outcome = await mergeStudentRecords(db, party("keeper"), party("dupe"));
    expect(committed).not.toContain("delete:user dupe-user");
    expect(outcome.retired).toBe(false);
    expect(outcome.cleanupErrors.join(" ")).toContain("student");
  });

  it("fills the keeper's blanks but never overwrites what the keeper has", async () => {
    let written: Record<string, unknown> = {};
    const { db } = fakeDb();
    const original = db.$transaction;
    db.$transaction = async (fn, o) =>
      original(async (tx) => {
        const student = tx.student.update;
        tx.student.update = async (a) => {
          if (a.where.id === "keeper") written = a.data;
          return student(a);
        };
        return fn(tx);
      }, o);

    await mergeStudentRecords(db, party("keeper", { branchId: null, admission: { batch: "October" } }), party("dupe"), "2026-09-19T00:00:00.000Z");
    const admission = written.admission as Record<string, unknown>;
    expect(admission.batch).toBe("October"); // keeper's own wins
    expect(admission.phone).toBe("08031234391"); // blank filled from the duplicate
    expect(written.branchId).toBe("branch-online");
    expect(admission.mergedFrom).toEqual([
      { studentId: "dupe", studentCode: "EW/2026/A1/SEP/N038", email: "dupe@example.com", at: "2026-09-19T00:00:00.000Z" },
    ]);
  });
});
