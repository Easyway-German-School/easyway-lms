import { describe, expect, it } from "vitest";
import {
  CHASE_CATEGORIES,
  FOCUS_PRESETS,
  chaseCategoryOf,
  chasePriorityOf,
  computeAll,
  computeStudentFinance,
  summariseReceivables,
  type FinanceStudentInput,
} from "./receivables";
import {
  chaseMessage,
  chaseSheetHeaders,
  chaseSheetRow,
  noteHasAmount,
  portalStatusOf,
  sortChaseEntries,
} from "./chase";

const NOW = new Date("2026-09-21T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

function student(overrides: Partial<FinanceStudentInput> & { id: string }): FinanceStudentInput {
  return {
    level: "A1",
    status: "active",
    classType: "group",
    createdAt: new Date(NOW.getTime() - 30 * DAY),
    branch: { id: "lagos", name: "Lagos" },
    user: { name: "Ada Obi", email: "ada@example.com" },
    payments: [],
    ...overrides,
  };
}

/** Whatever the fee book says the A1 fee and deposit are — the tests must not hard-code prices. */
const probe = computeStudentFinance(student({ id: "probe" }), NOW);
const FEE = probe.tuitionFee;
const DEPOSIT = probe.requiredDeposit;

describe("chaseCategoryOf — who the office phones", () => {
  it("puts a student with no payment in 'nothing'", () => {
    const row = computeStudentFinance(student({ id: "a" }), NOW);
    expect(chaseCategoryOf(row)).toBe("nothing");
  });

  it("puts a student under the deposit in 'under_deposit'", () => {
    const row = computeStudentFinance(student({ id: "a", payments: [{ amount: Math.max(1, DEPOSIT - 1) }] }), NOW);
    expect(chaseCategoryOf(row)).toBe("under_deposit");
  });

  it("puts a part-payer past the deposit in 'balance'", () => {
    const row = computeStudentFinance(student({ id: "a", payments: [{ amount: DEPOSIT }] }), NOW);
    expect(FEE).toBeGreaterThan(DEPOSIT);
    expect(chaseCategoryOf(row)).toBe("balance");
  });

  it("leaves a paid-up student off the list", () => {
    const row = computeStudentFinance(student({ id: "a", payments: [{ amount: FEE }] }), NOW);
    expect(chaseCategoryOf(row)).toBeNull();
  });

  it("only chases ACTIVE students", () => {
    for (const status of ["graduated", "withdrawn", "paused"]) {
      const row = computeStudentFinance(student({ id: "a", status }), NOW);
      expect(chaseCategoryOf(row), status).toBeNull();
    }
  });

  it("does not count the registration fee as tuition — a ₦5,000 registration is still 'paid nothing'", () => {
    const row = computeStudentFinance(
      student({ id: "a", payments: [{ amount: 5_000, description: "Registration fee" }] }),
      NOW,
    );
    expect(chaseCategoryOf(row)).toBe("nothing");
  });
});

describe("the chase presets agree with the summary the Reminders tab shows", () => {
  const cohort: FinanceStudentInput[] = [
    student({ id: "n1" }),
    student({ id: "n2", createdAt: new Date(NOW.getTime() - 3 * DAY) }),
    student({ id: "u1", payments: [{ amount: Math.max(1, DEPOSIT - 1) }] }),
    student({ id: "b1", payments: [{ amount: DEPOSIT }] }),
    student({ id: "paid", payments: [{ amount: FEE }] }),
    student({ id: "gone", status: "withdrawn" }),
  ];
  const rows = computeAll(cohort, NOW);
  const summary = summariseReceivables(rows);
  const context = { now: NOW, startOfMonth: new Date("2026-09-01T00:00:00Z") };
  const rawOf = (id: string) => cohort.find((c) => c.id === id)!;

  it("counts each group exactly as the roster filter selects it", () => {
    const presetFor: Record<string, string> = {
      nothing: "chase_nothing",
      under_deposit: "chase_under_deposit",
      balance: "chase_balance",
      legacy: "chase_legacy",
    };
    for (const category of CHASE_CATEGORIES) {
      const matched = rows.filter((row) => FOCUS_PRESETS[presetFor[category]].matches(row, context, rawOf(row.id)));
      expect(matched, category).toHaveLength(summary.chase[category].students);
    }
    const all = rows.filter((row) => FOCUS_PRESETS.chase_all.matches(row, context, rawOf(row.id)));
    expect(all).toHaveLength(summary.chaseAll.students);
    expect(summary.chaseAll.students).toBe(4);
  });

  it("never lists a withdrawn or paid-up student", () => {
    const all = rows.filter((row) => FOCUS_PRESETS.chase_all.matches(row, context, rawOf(row.id)));
    expect(all.map((r) => r.id).sort()).toEqual(["b1", "n1", "n2", "u1"]);
  });
});

describe("chasePriorityOf — the order to ring in", () => {
  it("ranks a student overdue on the deposit above one who only just registered", () => {
    const overdue = computeStudentFinance(student({ id: "o" }), NOW);
    const fresh = computeStudentFinance(student({ id: "f", createdAt: new Date(NOW.getTime() - 2 * DAY) }), NOW);
    expect(chasePriorityOf(overdue, NOW)).toBeLessThan(chasePriorityOf(fresh, NOW));
  });

  it("puts 'access on hold' first of all", () => {
    const held = computeStudentFinance(
      student({
        id: "h",
        payments: [{ amount: DEPOSIT }],
        classesStartedAt: new Date(NOW.getTime() - 60 * DAY),
        createdAt: new Date(NOW.getTime() - 90 * DAY),
      }),
      NOW,
    );
    expect(held.lockActive).toBe(true);
    expect(chasePriorityOf(held, NOW)).toBe(1);
  });
});

describe("chaseMessage — every message states the student's own figure", () => {
  it("names the deposit and the full fee for someone who has paid nothing", () => {
    const row = computeStudentFinance(student({ id: "a" }), NOW);
    const { title, message } = chaseMessage({ firstName: "Ada", category: "nothing", finance: row });
    expect(title).toBe("Your seat is waiting");
    expect(message).toContain("Hi Ada");
    expect(message).toContain(`₦${row.owedOnDeposit.toLocaleString("en-NG")}`);
    expect(message).toContain(`₦${row.tuitionFee.toLocaleString("en-NG")}`);
  });

  it("thanks a part-payer for what they paid and says what is left to open classes", () => {
    const paid = Math.max(1, DEPOSIT - 1);
    const row = computeStudentFinance(student({ id: "a", payments: [{ amount: paid }] }), NOW);
    const { message } = chaseMessage({ firstName: "Ada", category: "under_deposit", finance: row });
    expect(message).toContain(`₦${paid.toLocaleString("en-NG")}`);
    expect(message).toContain(`₦${row.owedOnDeposit.toLocaleString("en-NG")}`);
  });

  it("appends the office's note after the figures, never before", () => {
    const row = computeStudentFinance(student({ id: "a" }), NOW);
    const { message } = chaseMessage({ firstName: "Ada", category: "nothing", finance: row, note: "Come and see us." });
    expect(message.endsWith("Come and see us.")).toBe(true);
    expect(message.indexOf("₦")).toBeLessThan(message.indexOf("Come and see us."));
  });

  it("refuses a hand-typed amount in the note", () => {
    expect(noteHasAmount("Pay 150,000 now")).toBe(true);
    expect(noteHasAmount("Pay 300000 by Friday")).toBe(true);
    expect(noteHasAmount("Come to the office and we will help.")).toBe(false);
  });

  it("does not say 'no seat' to someone waiting on a future intake — it says confirm", () => {
    const row = { ...computeStudentFinance(student({ id: "a" }), NOW), awaitingBatch: true, batchLabel: "October" };
    const { title, message } = chaseMessage({ firstName: "Ada", category: "nothing", finance: row });
    expect(title).toBe("Confirm your October seat");
    expect(message).toContain("before classes open");
  });
});

describe("the call sheet", () => {
  const richStudent = {
    studentCode: "EW-001",
    status: "active",
    level: "A1",
    sessionSlot: "morning",
    deliveryMode: "physical",
    createdAt: new Date(NOW.getTime() - 30 * DAY),
    admission: { batch: "September", phone: "08123456789" },
    profile: { phone: null, whatsapp: null, guardianName: "Mr Obi", guardianPhone: "08099998888", city: "Lagos" },
    branch: { name: "Lagos" },
    tutor: { user: { name: "Herr Weber" } },
    user: { name: "Ada Obi", email: "ada@example.com" },
  };

  it("has one value per header, with and without money", () => {
    const finance = computeStudentFinance(student({ id: "a" }), NOW);
    for (const canSeeMoney of [true, false]) {
      const headers = chaseSheetHeaders(canSeeMoney);
      const row = chaseSheetRow({ student: richStudent, finance }, canSeeMoney, NOW);
      expect(row).toHaveLength(headers.length);
    }
  });

  it("puts the phone number up front, formatted so Excel keeps the leading zero", () => {
    const finance = computeStudentFinance(student({ id: "a" }), NOW);
    const headers = chaseSheetHeaders(true);
    const row = chaseSheetRow({ student: richStudent, finance }, true, NOW);
    expect(row[headers.indexOf("Phone")]).toBe("0812 345 6789");
    expect(row[headers.indexOf("Guardian phone")]).toBe("0809 999 8888");
  });

  it("leaves every naira figure out for a role without the payments capability", () => {
    const headers = chaseSheetHeaders(false);
    expect(headers.some((h) => h.includes("NGN"))).toBe(false);
    expect(headers).toContain("Group");
    expect(headers).toContain("Priority");
  });

  it("sorts most urgent first, then biggest debt", () => {
    const fresh = computeStudentFinance(student({ id: "f", createdAt: new Date(NOW.getTime() - 2 * DAY) }), NOW);
    const overdue = computeStudentFinance(student({ id: "o" }), NOW);
    const sorted = sortChaseEntries(
      [
        { student: richStudent, finance: fresh },
        { student: richStudent, finance: overdue },
      ],
      NOW,
    );
    expect(sorted.map((e) => e.finance.id)).toEqual(["o", "f"]);
  });

  it("describes the portal state in words a caller can use", () => {
    expect(portalStatusOf(computeStudentFinance(student({ id: "a" }), NOW))).toBe("Locked — deposit not paid");
    const settled = student({ id: "a", createdAt: new Date(NOW.getTime() - 10 * DAY), payments: [{ amount: DEPOSIT }] });
    expect(portalStatusOf(computeStudentFinance(settled, NOW))).toBe("Open");
  });
});
