import { describe, expect, it } from "vitest";
import { HYBRID_COMBOS, comboForSlots, fallbackHybridCombo, findHybridCombo } from "./hybrid-combo";

describe("HYBRID_COMBOS", () => {
  it("offers every physical sitting paired with every online sitting, not just a curated few", () => {
    // The bug report: "physical morning + online evening" and the rest of the
    // cross product were missing — only 3 hand-picked pairs were offered.
    const physicalSlots = ["morning", "afternoon", "evening", "weekend"];
    const onlineSlots = ["morning", "evening"];
    for (const physicalSlot of physicalSlots) {
      for (const onlineSlot of onlineSlots) {
        const combo = HYBRID_COMBOS.find(
          (c) => c.physicalSlot === physicalSlot && c.onlineSlot === onlineSlot,
        );
        expect(combo, `missing physical ${physicalSlot} + online ${onlineSlot}`).toBeTruthy();
      }
    }
    // 4 physical x 2 online + "other"
    expect(HYBRID_COMBOS).toHaveLength(9);
  });

  it("still offers the 'not sure yet' escape hatch", () => {
    expect(HYBRID_COMBOS.find((c) => c.id === "other")).toBeTruthy();
  });
});

describe("findHybridCombo", () => {
  it("finds a real pairing by id, including ones outside the old curated 3", () => {
    const combo = findHybridCombo("physical-morning_online-evening");
    expect(combo).toMatchObject({ physicalSlot: "morning", onlineSlot: "evening" });
  });

  it("returns null for an unknown id", () => {
    expect(findHybridCombo("nope")).toBeNull();
  });
});

describe("comboForSlots", () => {
  it("finds the combo matching a student's stored slots", () => {
    expect(comboForSlots("morning", "evening")).toMatchObject({
      physicalSlot: "morning",
      onlineSlot: "evening",
    });
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
