import { EgressStatus } from "livekit-server-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The tail-loss scenarios, run through the REAL finaliseRecording against an in-memory stand-in for
 * the database. A crash or restart cuts one class into several files (parts); each must be judged
 * as part of the whole class, and a part held as "too short" must be rescued once a later part
 * proves the class was real.
 */

type Row = {
  id: string; egressId: string; roomName: string; tenantId: string; level: string; sessionSlot: string; branchId: string | null;
  privateClassId: string | null; status: string; startedAt: Date; endedAt?: Date; objectKey: string | null; fileUrl: string | null;
  durationSeconds: number | null; sizeBytes: number | null; materialId: string | null; keepForever: boolean;
  tutorDiscardRequestedAt?: Date | null;
};

const db = vi.hoisted(() => ({ recordings: [] as unknown[], materials: [] as { id: string; title: string }[], notified: [] as string[] }));

function matches(row: Record<string, unknown>, where: Record<string, unknown> = {}): boolean {
  return Object.entries(where).every(([key, cond]) => {
    const value = row[key];
    if (cond && typeof cond === "object" && !(cond instanceof Date)) {
      const c = cond as Record<string, unknown>;
      if ("not" in c) return value !== c.not;
      if ("gte" in c || "lt" in c) {
        const t = (value as Date).getTime();
        return (c.gte === undefined || t >= (c.gte as Date).getTime()) && (c.lt === undefined || t < (c.lt as Date).getTime());
      }
      if ("in" in c) return (c.in as unknown[]).includes(value);
    }
    return value === cond;
  });
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    classRecording: {
      findUnique: async ({ where }: { where: { egressId: string } }) => (db.recordings as Row[]).find((r) => r.egressId === where.egressId) ?? null,
      findFirst: async ({ where }: { where: Record<string, unknown> }) => (db.recordings as Row[]).find((r) => matches(r as never, where)) ?? null,
      findMany: async ({ where }: { where: Record<string, unknown> }) => (db.recordings as Row[]).filter((r) => matches(r as never, where)),
      update: async ({ where, data }: { where: { id: string }; data: Partial<Row> }) => {
        const row = (db.recordings as Row[]).find((r) => r.id === where.id)!;
        Object.assign(row, data);
        return row;
      },
    },
    material: {
      create: async ({ data }: { data: { title: string } }) => {
        const material = { id: `m${db.materials.length + 1}`, title: data.title };
        db.materials.push(material);
        return material;
      },
    },
    privateClass: { update: async () => ({}), findUnique: async () => null },
  },
}));
vi.mock("@/lib/notify", () => ({ KIND: { recordingFailed: "rf", materialPublished: "mp" }, notifyInBackground: (n: { dedupeKey: string }) => db.notified.push(n.dedupeKey) }));
vi.mock("@/lib/recording-thumbnail", () => ({ createRecordingThumbnail: async () => "/thumb.jpg" }));
const deleteRecordingObject = vi.hoisted(() => vi.fn(async () => true));
vi.mock("@/lib/recording", () => ({
  AUDIO_ENCODING: {}, CLASS_ENCODING: {}, buildFileOutput: () => ({}), egressClient: () => null, egressTemplateBaseUrl: () => null,
  recordingConfigured: () => true, recordingObjectKey: () => "k", recordingPublicUrl: (key: string) => `/api/files/${key}`,
  recordingStorage: () => ({}), recordingVariant: () => "video", verifyRecordingObject: async () => ({ ok: true }),
  deleteRecordingObject,
}));

import { finaliseRecording } from "./class-recorder";

const MIN = 60;
let n = 0;
function addHeld(over: Omit<Partial<Row>, "startedAt"> & { minutes?: number; startedAt: string }): Row {
  n += 1;
  const row: Row = {
    id: `r${n}`, egressId: `rec_${n}`, roomName: "ew-lagos-a1-morning-t-1", tenantId: "t", level: "a1", sessionSlot: "morning", branchId: null,
    privateClassId: null, status: "active", objectKey: `recordings/part-${n}.mp4`, fileUrl: null,
    durationSeconds: null, sizeBytes: null, materialId: null, keepForever: false, ...over,
    startedAt: new Date(over.startedAt), // after the spread, or the ISO string in `over` would win
  } as unknown as Row;
  delete (row as Partial<Row> & { minutes?: number }).minutes;
  db.recordings.push(row);
  return row;
}

/** What the recorder (or LiveKit) reports when a part finishes. */
function finish(row: Row, minutes: number) {
  return finaliseRecording({
    egressId: row.egressId, status: EgressStatus.EGRESS_COMPLETE,
    fileResults: [{ filename: row.objectKey!, duration: BigInt(minutes * MIN) * BigInt(1_000_000_000), size: BigInt(minutes * 3_000_000) }],
  });
}

beforeEach(() => { db.recordings.length = 0; db.materials.length = 0; db.notified.length = 0; n = 0; deleteRecordingObject.mockClear(); });

describe("a class cut into parts is judged as a whole", () => {
  it("THE BUG: a crash 25 minutes before the end — the 25-minute tail is kept, not purged", async () => {
    const first = addHeld({ minutes: 0, startedAt: "2026-10-05T09:00:00Z" });
    const tail = addHeld({ minutes: 0, startedAt: "2026-10-05T11:35:00Z" });

    expect(await finish(first, 155)).toBe("created"); // 155 min: kept on its own
    expect(first.materialId).not.toBeNull();

    expect(await finish(tail, 25)).toBe("created");
    expect(tail.materialId).not.toBeNull(); // before the fix this stayed null and was purged after 48 h
    expect(db.materials).toHaveLength(2);
  });

  it("a short FIRST part is rescued when the later part proves the class was real", async () => {
    const first = addHeld({ minutes: 0, startedAt: "2026-10-05T09:00:00Z" });
    const second = addHeld({ minutes: 0, startedAt: "2026-10-05T09:35:00Z" });

    expect(await finish(first, 20)).toBe("created");
    expect(first.materialId).toBeNull(); // 20 min alone: held (the class could still turn out short)
    expect(first.status).toBe("completed");

    expect(await finish(second, 120)).toBe("created");
    expect(second.materialId).not.toBeNull();
    expect(first.materialId).not.toBeNull(); // rescued: the whole class is 140 min
    expect(db.materials).toHaveLength(2);
  });

  it("two short parts that add up to a real class: the second rescues the first", async () => {
    const first = addHeld({ minutes: 0, startedAt: "2026-10-05T09:00:00Z" });
    const second = addHeld({ minutes: 0, startedAt: "2026-10-05T09:30:00Z" });
    await finish(first, 20);
    expect(first.materialId).toBeNull();
    await finish(second, 15); // 35 min total
    expect(second.materialId).not.toBeNull();
    expect(first.materialId).not.toBeNull();
  });

  it("a genuinely short class (parts add up to under 30 minutes) is still held, not shown", async () => {
    const first = addHeld({ minutes: 0, startedAt: "2026-10-05T09:00:00Z" });
    const second = addHeld({ minutes: 0, startedAt: "2026-10-05T09:15:00Z" });
    await finish(first, 10);
    await finish(second, 15); // 25 min total
    expect(first.materialId).toBeNull();
    expect(second.materialId).toBeNull();
    expect(db.materials).toHaveLength(0);
  });

  it("does not mix up different rooms or different days", async () => {
    const mine = addHeld({ minutes: 0, startedAt: "2026-10-05T09:00:00Z" });
    addHeld({ minutes: 0, startedAt: "2026-10-05T09:00:00Z", roomName: "ew-abuja-a1-morning-t-2", status: "completed", durationSeconds: 200 * MIN, materialId: "mx" });
    addHeld({ minutes: 0, startedAt: "2026-10-04T09:00:00Z", status: "completed", durationSeconds: 200 * MIN, materialId: "my" });
    await finish(mine, 20);
    expect(mine.materialId).toBeNull(); // the long classes in OTHER rooms/days must not rescue this one
  });

  it("finalising the same part twice does not create a second shelf entry", async () => {
    const first = addHeld({ minutes: 0, startedAt: "2026-10-05T09:00:00Z" });
    await finish(first, 120);
    expect(await finish(first, 120)).toBe("already");
    expect(db.materials).toHaveLength(1);
  });

  it("a private lesson is never judged by class length", async () => {
    const lesson = addHeld({ minutes: 0, startedAt: "2026-10-05T09:00:00Z", privateClassId: "p1" });
    await finish(lesson, 20);
    expect(lesson.materialId).not.toBeNull();
  });

  it("the tutor's own end-of-class 'delete it' choice is honoured, even for a class long enough to otherwise be kept", async () => {
    const row = addHeld({
      minutes: 0,
      startedAt: "2026-10-05T09:00:00Z",
      tutorDiscardRequestedAt: new Date("2026-10-05T09:05:00Z"),
    });
    expect(await finish(row, 120)).toBe("discarded");
    expect(row.status).toBe("purged");
    expect(row.materialId).toBeNull();
    expect(db.materials).toHaveLength(0);
    expect(deleteRecordingObject).toHaveBeenCalledWith(row.objectKey);
  });

  it("the tutor's 'delete it' choice is skipped for a private lesson", async () => {
    const lesson = addHeld({
      minutes: 0,
      startedAt: "2026-10-05T09:00:00Z",
      privateClassId: "p1",
      tutorDiscardRequestedAt: new Date("2026-10-05T09:05:00Z"),
    });
    await finish(lesson, 20);
    expect(lesson.materialId).not.toBeNull();
    expect(deleteRecordingObject).not.toHaveBeenCalled();
  });
});
