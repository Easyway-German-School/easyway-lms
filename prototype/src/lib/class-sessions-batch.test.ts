import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A batch's calendar is its own.
 *
 * September and October of the same sitting overlap for a month, and the weekend
 * sitting meets the very same Saturdays for both. ClassSession rows (postponed,
 * cancelled, topic) used to be keyed without the batch, so a postponement saved
 * for one landed on the other's calendar. These pin the rule that fixes it: a
 * batch reads its OWN rows plus the old shared ones, and never another batch's.
 */

type Row = {
  date: Date;
  timeSlot: string;
  batch: string;
  status: string;
  postponedTo: Date | null;
  topic: string | null;
  notes: string | null;
  startTime: string | null;
  endTime: string | null;
  lecturerId: string | null;
  lecturer: null;
  material: null;
};

const db = vi.hoisted(() => ({ rows: [] as unknown[], lastWhere: null as unknown, upserts: [] as unknown[] }));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    classSession: {
      // Behaves like the database: honours the batch filter the code asks for.
      findMany: vi.fn(async ({ where }: { where: { batch: { in: string[] } } }) => {
        db.lastWhere = where;
        return (db.rows as Row[]).filter((row) => where.batch.in.includes(row.batch));
      }),
      upsert: vi.fn(async (args: unknown) => {
        db.upserts.push(args);
        return {};
      }),
    },
    schoolHoliday: { findMany: vi.fn(async () => []) },
  },
}));
vi.mock("@/lib/schedule-pattern-server", () => ({ readSchedulePatternSettings: vi.fn(async () => null) }));

import { dayKey, ensureClassSessionForLiveStart, getMergedSchedule } from "./class-sessions";
import { generatePersonalizedSchedule } from "./schedule";

const NOW = new Date("2026-10-05T10:00:00Z");
const REGISTERED = new Date("2026-08-20T10:00:00Z");

/** A real generated class day for a weekend batch, so the override lines up with the skeleton. */
function aSaturday(batch: string): Date {
  const generated = generatePersonalizedSchedule({
    level: "A1",
    batch,
    registeredAt: REGISTERED,
    now: NOW,
    months: 3,
    sessionSlot: "weekend",
    patternSettings: null,
  } as never);
  return dayKey(generated.months[1].sessions[1].date);
}

const row = (date: Date, batch: string, extra: Partial<Row> = {}): Row => ({
  date,
  timeSlot: "weekend",
  batch,
  status: "scheduled",
  postponedTo: null,
  topic: null,
  notes: null,
  startTime: null,
  endTime: null,
  lecturerId: null,
  lecturer: null,
  material: null,
  ...extra,
});

async function calendarFor(batch: string | null, date: Date) {
  const merged = await getMergedSchedule({
    branchId: "b1",
    level: "A1",
    batch,
    registeredAt: REGISTERED,
    sessionSlot: "weekend",
    now: NOW,
    months: 3,
  });
  return merged.months.flatMap((m) => m.sessions).find((s) => dayKey(s.date).getTime() === date.getTime());
}

beforeEach(() => {
  db.rows = [];
  db.upserts = [];
  db.lastWhere = null;
});

describe("a batch's calendar is its own", () => {
  it("a postponement saved for the October batch is NOT on the September calendar", async () => {
    // Both weekend batches meet this same Saturday.
    const saturday = aSaturday("September");
    db.rows = [
      row(saturday, "October", { status: "postponed", postponedTo: new Date("2026-11-14T00:00:00Z"), topic: "Oct only" }),
    ];

    const september = await calendarFor("September", saturday);
    expect(september?.status).toBe("scheduled");
    expect(september?.topic).toBeNull();
    expect(september?.edited).toBe(false);

    const october = await calendarFor("October", saturday);
    expect(october?.status).toBe("postponed");
    expect(october?.topic).toBe("Oct only");
  });

  it("only ever asks the database for its own batch's rows and the shared ones", async () => {
    await calendarFor("October", aSaturday("October"));
    expect(db.lastWhere).toMatchObject({ batch: { in: ["October", ""] } });

    await calendarFor(null, aSaturday("October"));
    expect(db.lastWhere).toMatchObject({ batch: { in: [""] } });
  });

  it("an old shared row (batch '') still applies to every batch — nothing already scheduled changes", async () => {
    const saturday = aSaturday("September");
    db.rows = [row(saturday, "", { status: "cancelled", notes: "Public event" })];

    expect((await calendarFor("September", saturday))?.status).toBe("cancelled");
    expect((await calendarFor("October", saturday))?.status).toBe("cancelled");
    // …and says so, so the editor can warn that saving will split it.
    expect((await calendarFor("September", saturday))?.shared).toBe(true);
  });

  it("a batch's own row wins over the shared one for that batch only", async () => {
    const saturday = aSaturday("September");
    db.rows = [
      row(saturday, "", { status: "cancelled" }),
      row(saturday, "September", { status: "scheduled", topic: "Back on" }),
    ];

    const september = await calendarFor("September", saturday);
    expect(september?.status).toBe("scheduled");
    expect(september?.topic).toBe("Back on");
    expect(september?.shared).toBe(false);

    // October never made its own row, so it still inherits the shared cancellation.
    expect((await calendarFor("October", saturday))?.status).toBe("cancelled");
  });

  it("an added one-off class for one batch does not appear on the other batch's calendar", async () => {
    const extra = new Date("2026-10-31T00:00:00Z"); // a day the skeleton never generated
    db.rows = [row(extra, "September", { topic: "Extra revision" })];

    const merged = async (batch: string) =>
      (
        await getMergedSchedule({
          branchId: "b1",
          level: "A1",
          batch,
          registeredAt: REGISTERED,
          sessionSlot: "weekend",
          now: NOW,
          months: 3,
        })
      ).months.flatMap((m) => m.sessions);

    expect((await merged("September")).some((s) => s.topic === "Extra revision")).toBe(true);
    expect((await merged("October")).some((s) => s.topic === "Extra revision")).toBe(false);
  });
});

describe("a class started from the live room is recorded for its batch", () => {
  it("keys the backfill row on the batch", async () => {
    await ensureClassSessionForLiveStart({
      branchId: "b1",
      level: "a1",
      sessionSlot: "morning",
      date: NOW,
      batch: "october",
    });
    const call = db.upserts[0] as { where: { branchId_level_date_timeSlot_batch: { batch: string } }; create: { batch: string } };
    expect(call.where.branchId_level_date_timeSlot_batch.batch).toBe("October");
    expect(call.create.batch).toBe("October");
  });

  it("falls back to the shared row when the class has no batch", async () => {
    await ensureClassSessionForLiveStart({ branchId: "b1", level: "A1", sessionSlot: "morning", date: NOW });
    const call = db.upserts[0] as { where: { branchId_level_date_timeSlot_batch: { batch: string } } };
    expect(call.where.branchId_level_date_timeSlot_batch.batch).toBe("");
  });
});
