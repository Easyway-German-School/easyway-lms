import { describe, expect, it } from "vitest";

import {
  BACKGROUNDS,
  EXTRAS,
  HAIR_COLORS,
  HAIR_STYLES,
  SKIN_TONES,
  avatarOrDefault,
  hashAvatar,
  randomAvatar,
  sanitizeAvatar,
  type AvatarConfig,
} from "@/lib/avatar";

function isValid(a: AvatarConfig) {
  expect(a.v).toBe(1);
  expect(a.bg).toBeGreaterThanOrEqual(0);
  expect(a.bg).toBeLessThan(BACKGROUNDS.length);
  expect(a.skin).toBeLessThan(SKIN_TONES.length);
  expect(a.hairColor).toBeLessThan(HAIR_COLORS.length);
  expect(HAIR_STYLES).toContain(a.hair);
  expect(EXTRAS).toContain(a.extra);
  // The shuffle-only rule: a tongue is for the grin, not a default smile.
  expect(a.mouth).not.toBeUndefined();
}

describe("hashAvatar", () => {
  it("gives the same person the same face every time", () => {
    expect(hashAvatar("Ada Okafor")).toEqual(hashAvatar("Ada Okafor"));
  });

  it("gives different people different faces", () => {
    const faces = new Set(
      ["Ada", "Chidi", "Kemi", "Tunde", "Ngozi", "Sade", "Emeka", "Funmi"].map((n) => JSON.stringify(hashAvatar(n))),
    );
    expect(faces.size).toBeGreaterThan(6);
  });

  it("always produces something drawable, even from nothing", () => {
    for (const seed of ["", " ", "x", "Ünïcödé 名前", "a".repeat(500)]) isValid(hashAvatar(seed));
  });
});

describe("randomAvatar", () => {
  it("is always valid", () => {
    for (let i = 0; i < 200; i += 1) isValid(randomAvatar());
  });
});

describe("sanitizeAvatar", () => {
  it("returns null when there is nothing avatar-shaped", () => {
    expect(sanitizeAvatar(null)).toBeNull();
    expect(sanitizeAvatar(undefined)).toBeNull();
    expect(sanitizeAvatar("face")).toBeNull();
    expect(sanitizeAvatar([1, 2])).toBeNull();
  });

  it("round-trips a valid avatar unchanged", () => {
    const a = hashAvatar("round trip");
    expect(sanitizeAvatar(a)).toEqual(a);
  });

  it("snaps out-of-range and unknown values back onto the approved lists", () => {
    const fixed = sanitizeAvatar({
      bg: 99,
      skin: -1,
      hair: "mohawk-of-doom",
      hairColor: 1.5,
      eyes: "<script>",
      extra: { nope: true },
    })!;
    isValid(fixed);
    expect(HAIR_STYLES).toContain(fixed.hair);
  });

  it("keeps the fields that were fine while repairing the ones that were not", () => {
    const fixed = sanitizeAvatar({ ...hashAvatar("keep"), hair: "nonsense" })!;
    expect(fixed.skin).toBe(hashAvatar("keep").skin);
    expect(HAIR_STYLES).toContain(fixed.hair);
  });

  it("never lets extra keys through", () => {
    const fixed = sanitizeAvatar({ ...hashAvatar("x"), payload: "<img onerror=alert(1)>" })!;
    expect(Object.keys(fixed).sort()).toEqual(
      ["bg", "brows", "extra", "eyes", "hair", "hairColor", "mouth", "skin", "top", "topColor", "v"].sort(),
    );
  });
});

describe("avatarOrDefault", () => {
  it("uses the saved avatar when there is one", () => {
    const saved = hashAvatar("someone else");
    expect(avatarOrDefault(saved, "Ada")).toEqual(saved);
  });

  it("falls back to the stable default for this name", () => {
    expect(avatarOrDefault(null, "Ada")).toEqual(hashAvatar("Ada"));
  });
});
