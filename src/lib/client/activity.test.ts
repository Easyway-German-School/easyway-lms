import { describe, expect, it } from "vitest";
import { IDLE_PAUSE_AFTER_MS, IDLE_SLOW_AFTER_MS, IDLE_SLOW_FACTOR, idleScale } from "./activity";

describe("idleScale", () => {
  it("polls at full speed for a tab someone is using", () => {
    expect(idleScale(0)).toBe(1);
    expect(idleScale(IDLE_SLOW_AFTER_MS - 1)).toBe(1);
  });

  it("polls a third as often once nobody has touched it for five minutes", () => {
    expect(idleScale(IDLE_SLOW_AFTER_MS)).toBe(IDLE_SLOW_FACTOR);
    expect(idleScale(IDLE_PAUSE_AFTER_MS - 1)).toBe(IDLE_SLOW_FACTOR);
  });

  it("stops polling an abandoned tab after twenty minutes", () => {
    expect(idleScale(IDLE_PAUSE_AFTER_MS)).toBeNull();
    expect(idleScale(IDLE_PAUSE_AFTER_MS * 10)).toBeNull();
  });
});
