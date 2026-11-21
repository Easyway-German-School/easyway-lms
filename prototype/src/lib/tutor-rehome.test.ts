import { describe, expect, it } from "vitest";
import { namedGroupLinkIsStale } from "./tutor-rehome";

describe("namedGroupLinkIsStale", () => {
  it("keeps a private student named onto a tutor who has no class", () => {
    expect(namedGroupLinkIsStale({ classType: "private", coveredByAssignment: false })).toBe(false);
  });

  it("keeps a group student the tutor's class still covers", () => {
    expect(namedGroupLinkIsStale({ classType: "group", coveredByAssignment: true })).toBe(false);
  });

  it("releases a group student after the class was cleared or they moved sitting", () => {
    expect(namedGroupLinkIsStale({ classType: "group", coveredByAssignment: false })).toBe(true);
  });
});
