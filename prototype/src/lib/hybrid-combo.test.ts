import { describe, expect, it } from "vitest";
import { HYBRID_COMBOS, comboForSlots, fallbackHybridCombo, findHybridCombo } from "./hybrid-combo";

describe("HYBRID_COMBOS", () => {
  it("offers only same-time physical and online classes", () => {
    expect(HYBRID_COMBOS.filter((combo) => combo.id !== "other")).toEqual([
      expect.objectContaining({ id: "physical-morning_online-morning", physicalSlot: "morning", onlineSlot: "morning" }),
      expect.objectContaining({ id: "physical-evening_online-evening", physicalSlot: "evening", onlineSlot: "evening" }),
    ]);
    expect(HYBRID_COMBOS).toHaveLength(3);
  });

  it("still offers the 'not sure yet' escape hatch", () => {
    expect(HYBRID_COMBOS.find((c) => c.id === "other")).toBeTruthy();
  });
});

describe("findHybridCombo", () => {
  it("finds a matching pairing by id", () => {
    const combo = findHybridCombo("physical-morning_online-morning");
    expect(combo).toMatchObject({ physicalSlot: "morning", onlineSlot: "morning" });
  });

  it("does not accept cross-time pairings", () => {
    expect(findHybridCombo("physical-morning_online-evening")).toBeNull();
  });

  it("returns null for an unknown id", () => {
    expect(findHybridCombo("nope")).toBeNull();
  });
});

describe("comboForSlots", () => {
  it("finds the combo matching a student's stored slots", () => {
    expect(comboForSlots("morning", "morning")).toMatchObject({
      physicalSlot: "morning",
      onlineSlot: "morning",
    });
  });

  it("does not map a legacy cross-time pair to a current combo", () => {
    expect(comboForSlots("morning", "evening")).toBeNull();
  });

  it("returns null when there is no online slot on file yet", () => {
    expect(comboForSlots("morning", null)).toBeNull();
  });
});

describe("fallbackHybridCombo", () => {
  it("picks the first real combo whose both halves are open", () => {
    const isSlotOpen = (level: string | null | undefined, slot: string, mode: "hybrid" | "online") =>
      mode === "hybrid" ? slot === "evening" : slot === "evening";
    const combo = fallbackHybridCombo(isSlotOpen, "A1");
    expect(combo).toMatchObject({ physicalSlot: "evening", onlineSlot: "evening" });
  });

  it("falls back to the first combo outright when nothing reads as open", () => {
    const combo = fallbackHybridCombo(() => false, "A1");
    expect(combo.id).toBe(HYBRID_COMBOS[0].id);
  });
});
