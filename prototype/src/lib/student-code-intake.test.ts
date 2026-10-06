import { describe, expect, it, vi } from "vitest";

const { update, findMany } = vi.hoisted(() => ({ update: vi.fn(), findMany: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { student: { update, findMany } } }));

import { generateStudentCode, realignStudentCode } from "./student-code";

const sep26 = new Date(2026, 8, 26);

describe("student code follows the intake, not the signup date", () => {
  it("issues OCT for someone who signs up in September for October", async () => {
    findMany.mockResolvedValue([]);
    const code = await generateStudentCode({ level: "A1", batch: "October", branch: { mode: "online" }, now: sep26 });
    expect(code).toBe("EW/2026/A1/OCT/N001");
  });

  it("rolls the year for a December signup into January", async () => {
    findMany.mockResolvedValue([]);
    const code = await generateStudentCode({ level: "A1", batch: "January", branch: { name: "Lagos" }, now: new Date(2026, 11, 10) });
    expect(code).toBe("EW/2027/A1/JAN/L001");
  });

  it("keeps the current year for a mid-course import", async () => {
    findMany.mockResolvedValue([]);
    const code = await generateStudentCode({ level: "B1", batch: "March", branch: { name: "Lagos" }, now: sep26 });
    expect(code).toBe("EW/2026/B1/MAR/L001");
  });

  it("realigns SEP -> OCT before the intake starts, keeping the number", async () => {
    update.mockResolvedValue({});
    const code = await realignStudentCode(
      { id: "s1", studentCode: "EW/2026/A1/SEP/N214", admission: { batch: "October" }, createdAt: sep26 },
      new Date(2026, 8, 30),
    );
    expect(code).toBe("EW/2026/A1/OCT/N214");
    expect(update).toHaveBeenCalledWith({ where: { id: "s1" }, data: { studentCode: "EW/2026/A1/OCT/N214" } });
  });

  it("never touches a code once its batch has begun", async () => {
    update.mockClear();
    const code = await realignStudentCode(
      { id: "s2", studentCode: "EW/2026/A1/SEP/N100", admission: { batch: "October" }, createdAt: sep26 },
      new Date(2026, 9, 5),
    );
    expect(code).toBeNull();
    expect(update).not.toHaveBeenCalled();
  });
});
