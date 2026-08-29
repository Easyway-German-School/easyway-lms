import { describe, expect, it } from "vitest";
import {
  DEFAULT_FEATURES,
  externalBodySlug,
  isExamBodyLive,
  parseFeatures,
} from "./features";

/**
 * NFC and NFD spellings of the awarding-body name, built from explicit
 * unicode escapes (never a typed accented character) so the two
 * byte-different-but-visually-identical forms cannot be silently collapsed
 * into one by an editor, a copy-paste, or this file being re-saved.
 *
 * NFC: U+00D6 (LATIN CAPITAL LETTER O WITH DIAERESIS) as a single codepoint.
 * NFD: plain "O" followed by U+0308 (COMBINING DIAERESIS) as two codepoints.
 */
const OSD_NFC = "ÖSD";
const OSD_NFD = "ÖSD";

describe("parseFeatures", () => {
  it("degrades missing, null or garbage to exactly the defaults, non-strict", () => {
    expect(parseFeatures(undefined)).toEqual(DEFAULT_FEATURES);
    expect(parseFeatures(null)).toEqual(DEFAULT_FEATURES);
    expect(parseFeatures("nonsense")).toEqual(DEFAULT_FEATURES);
    expect(parseFeatures(42)).toEqual(DEFAULT_FEATURES);
    expect(parseFeatures([])).toEqual(DEFAULT_FEATURES);
    expect(parseFeatures({ examCentre: "yes" })).toEqual(DEFAULT_FEATURES);
  });

  it("merges a partial override without disturbing untouched siblings", () => {
    const result = parseFeatures({ games: { onlineCohortRequiresLiveClass: false } });
    expect(result.games.onlineCohortRequiresLiveClass).toBe(false);
    expect(result.examCentre).toEqual(DEFAULT_FEATURES.examCentre);
  });

  it("merges one exam body without flipping the other", () => {
    const result = parseFeatures({ examCentre: { externalBodies: { osd: true } } });
    expect(result.examCentre.externalBodies).toEqual({ osd: true, telc: false });
    expect(result.examCentre.goetheReferralUrl).toBe(DEFAULT_FEATURES.examCentre.goetheReferralUrl);
  });

  it("accepts null to hide the Goethe referral, and a string to change it", () => {
    expect(parseFeatures({ examCentre: { goetheReferralUrl: null } }).examCentre.goetheReferralUrl).toBeNull();
    expect(
      parseFeatures({ examCentre: { goetheReferralUrl: "https://example.com/book" } }).examCentre
        .goetheReferralUrl,
    ).toBe("https://example.com/book");
  });

  it("returns fresh, independently-mutable objects, not references into DEFAULT_FEATURES", () => {
    const result = parseFeatures(null);
    result.games.onlineCohortRequiresLiveClass = false;
    expect(DEFAULT_FEATURES.games.onlineCohortRequiresLiveClass).toBe(true);
  });

  it("strict mode returns null for garbage instead of silently defaulting", () => {
    expect(parseFeatures("nonsense", { strict: true })).toBeNull();
    expect(parseFeatures({ examCentre: { externalBodies: { osd: "yes" } } }, { strict: true })).toBeNull();
    expect(parseFeatures({ games: { onlineCohortRequiresLiveClass: "yes" } }, { strict: true })).toBeNull();
    expect(parseFeatures({ examCentre: { goetheReferralUrl: 42 } }, { strict: true })).toBeNull();
  });

  it("strict mode accepts a well-formed partial override", () => {
    const result = parseFeatures({ games: { onlineCohortRequiresLiveClass: false } }, { strict: true });
    expect(result).not.toBeNull();
    expect(result?.games.onlineCohortRequiresLiveClass).toBe(false);
  });
});

describe("externalBodySlug", () => {
  it("maps the NFC form", () => {
    expect(externalBodySlug(OSD_NFC)).toBe("osd");
  });

  it("maps the NFD form (O + combining diaeresis) to the same slug", () => {
    expect(OSD_NFD).not.toBe(OSD_NFC); // sanity: genuinely different byte sequences
    expect(externalBodySlug(OSD_NFD)).toBe("osd");
  });

  it("maps telc case-insensitively", () => {
    expect(externalBodySlug("telc")).toBe("telc");
    expect(externalBodySlug("TELC")).toBe("telc");
  });

  it("returns null for internal and for anything unrecognised", () => {
    expect(externalBodySlug("internal")).toBeNull();
    expect(externalBodySlug(null)).toBeNull();
    expect(externalBodySlug("")).toBeNull();
    expect(externalBodySlug("goethe")).toBeNull();
  });
});

describe("isExamBodyLive", () => {
  it("internal exams are always live, regardless of the flags", () => {
    expect(isExamBodyLive(DEFAULT_FEATURES, "internal")).toBe(true);
  });

  it("reads the per-body flag for a recognised external body", () => {
    const features = parseFeatures({ examCentre: { externalBodies: { osd: true } } });
    expect(isExamBodyLive(features, OSD_NFC)).toBe(true);
    expect(isExamBodyLive(features, "telc")).toBe(false);
  });

  it("defaults both external bodies to not live", () => {
    expect(isExamBodyLive(DEFAULT_FEATURES, OSD_NFC)).toBe(false);
    expect(isExamBodyLive(DEFAULT_FEATURES, "telc")).toBe(false);
  });
});
