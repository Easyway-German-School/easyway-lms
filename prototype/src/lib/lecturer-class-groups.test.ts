import { describe, expect, it } from "vitest";
import { classGroupLabel, goLiveKeyFor, groupByClass, type ClassGroupMember } from "./lecturer-class-groups";

/**
 * "My students": the tutor's whole list, divided into the classes they actually
 * teach — and September and October of the same sitting are two classes, each
 * with its own Go live.
 */
describe("my students, divided by class and batch", () => {
  const member = (id: string, batch: string | null, extra: Partial<ClassGroupMember> = {}) => ({
    id,
    level: "A1",
    sessionSlot: "morning",
    deliveryMode: "online",
    branchId: "b1",
    branchMode: "online",
    batch,
    ...extra,
  });

  it("splits one sitting into a class per batch, September first", () => {
    const groups = groupByClass([
      member("a", "October"),
      member("b", "September"),
      member("c", "October"),
    ]);
    expect(groups.map((g) => [g.label, g.members.length])).toEqual([
      ["A1 · Online · Morning · September batch", 1],
      ["A1 · Online · Morning · October batch", 2],
    ]);
  });

  it("keeps the batches of one class together, with the students who have no batch last", () => {
    const groups = groupByClass([
      member("a", "October"),
      member("b", "September", { level: "B1" }),
      member("c", "September"),
      member("d", null, { level: "B1" }),
    ]);
    expect(groups.map((g) => g.label)).toEqual([
      "A1 · Online · Morning · September batch",
      "A1 · Online · Morning · October batch",
      "B1 · Online · Morning · September batch",
      // Students with no batch on record sit last in their class.
      "B1 · Online · Morning",
    ]);
  });

  it("names the batch on the label", () => {
    expect(classGroupLabel(member("a", "September"))).toBe("A1 · Online · Morning · September batch");
    expect(classGroupLabel(member("a", null))).toBe("A1 · Online · Morning");
  });

  it("each batch's Go live starts THAT batch — the key the dashboard card uses", () => {
    const [sept, oct] = groupByClass([member("a", "October"), member("b", "September")]);
    expect(goLiveKeyFor(oct)).toBe("b1:A1:morning:October");
    expect(goLiveKeyFor(sept)).toBe("b1:A1:morning:September");
  });

  it("a class with no batch goes live as the whole cohort (the old behaviour)", () => {
    const [only] = groupByClass([member("a", null)]);
    expect(goLiveKeyFor(only)).toBe("b1:A1:morning");
  });

  it("offers no Go live where the server would refuse the room or there is no video room", () => {
    // Students the office put on the tutor by name are not a class the assignment covers.
    const [named] = groupByClass([member("a", "October", { namedByOffice: true })]);
    expect(goLiveKeyFor(named)).toBeNull();

    // A campus-only class has no video room.
    const [campus] = groupByClass([member("a", "October", { deliveryMode: "physical", branchMode: "physical" })]);
    expect(goLiveKeyFor(campus)).toBeNull();

    // Hybrid students can join over video even from a campus branch.
    const [hybrid] = groupByClass([member("a", "October", { deliveryMode: "hybrid", branchMode: "physical" })]);
    expect(goLiveKeyFor(hybrid)).toBe("b1:A1:morning:October");

    // No branch on the students, nothing to start.
    const [lost] = groupByClass([member("a", "October", { branchId: null })]);
    expect(goLiveKeyFor(lost)).toBeNull();
  });

  it("ignores a named student when picking the class's branch", () => {
    const [group] = groupByClass([
      member("named", "October", { namedByOffice: true, branchId: "other" }),
      member("own", "October"),
    ]);
    expect(goLiveKeyFor(group)).toBe("b1:A1:morning:October");
  });
});
