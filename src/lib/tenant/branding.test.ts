import { describe, expect, it } from "vitest";
import { brandingCss, isSafeColor, isSafeLogo } from "./branding";

/**
 * These two guards are the whole security surface of white-labelling.
 *
 * A tenant's colour is interpolated into a stylesheet and a tenant's logo into
 * an <img src>, both of which are set by whoever operates the platform on
 * behalf of a customer — which means the values travel from a customer email,
 * through a form, into every page that customer's students load. The tests that
 * matter here are the rejections.
 */

describe("the colour guard", () => {
  it("accepts hex, long and short", () => {
    expect(isSafeColor("#FF6600")).toBe(true);
    expect(isSafeColor("#f60")).toBe(true);
    expect(isSafeColor("  #7C3AED  ")).toBe(true);
  });

  it("refuses anything that could close the rule and open another", () => {
    // The payload that makes this a stored-CSS-injection hole rather than a
    // cosmetic field: everything after the brace would be honoured.
    expect(isSafeColor("red;} :root{display:none")).toBe(false);
    expect(isSafeColor("red")).toBe(false);
    expect(isSafeColor("rgb(255,102,0)")).toBe(false);
    expect(isSafeColor("url(https://tracker.example/x.png)")).toBe(false);
    expect(isSafeColor("#GGGGGG")).toBe(false);
    expect(isSafeColor("")).toBe(false);
    expect(isSafeColor(null)).toBe(false);
    expect(isSafeColor(undefined)).toBe(false);
  });
});

describe("the logo guard", () => {
  it("accepts same-origin paths and https", () => {
    expect(isSafeLogo("/uploads/school.png")).toBe(true);
    expect(isSafeLogo("https://cdn.example.com/school.png")).toBe(true);
  });

  it("refuses schemes that execute, exfiltrate, or get blocked as mixed content", () => {
    expect(isSafeLogo("javascript:alert(1)")).toBe(false);
    expect(isSafeLogo("data:image/svg+xml,<svg onload=alert(1)>")).toBe(false);
    // Protocol-relative: resolves to https here but to http on an http page,
    // and reads like a path to anyone skimming the validator.
    expect(isSafeLogo("//evil.example.com/school.png")).toBe(false);
    // Not a security hole, but a logo that silently never renders is worse
    // than a rejected one, because nobody in the school's office is reading
    // the browser console to find out why.
    expect(isSafeLogo("http://cdn.example.com/school.png")).toBe(false);
    expect(isSafeLogo("")).toBe(false);
    expect(isSafeLogo(null)).toBe(false);
  });
});

describe("the generated stylesheet", () => {
  it("emits nothing at all when no colour is set", () => {
    // The live tenant has this column null, so this is the path that must
    // leave the existing palette completely untouched.
    expect(brandingCss(null)).toBe("");
    expect(brandingCss("not a colour")).toBe("");
  });

  it("outranks every selector globals.css uses for the same properties", () => {
    const css = brandingCss("#7C3AED");
    // :root and .theme-light are both (0,1,0); html.theme-dark is (0,1,1).
    // Doubling puts these at (0,2,0) and (0,3,0), so source order stops
    // mattering — which is what keeps dev and a production build agreeing.
    expect(css).toContain(":root:root {");
    expect(css).toContain(":root:root.theme-dark");
    expect(css).toContain(":root:root.theme-custom");
  });

  it("lightens rather than desaturates for the dark themes", () => {
    const css = brandingCss("#7C3AED");
    const [, light, dark] = css.match(/--accent: (#[0-9a-f]{6});[\s\S]*--accent: (#[0-9a-f]{6});/i) ?? [];

    expect(light.toLowerCase()).toBe("#7c3aed");
    expect(dark).toBeDefined();
    expect(dark.toLowerCase()).not.toBe("#7c3aed");

    // Every channel moves towards white, which is what keeps the hue's
    // character. An HSL lightness bump would have pulled it towards grey.
    const channels = (hex: string) =>
      [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    const from = channels("#7c3aed");
    const to = channels(dark.toLowerCase());
    to.forEach((value, i) => expect(value).toBeGreaterThan(from[i]));
  });

  it("carries the colour into the soft tint as rgba, not as a second hex", () => {
    // --accent-soft is used behind text; it has to be translucent so the
    // surface underneath still shows through in all three themes.
    expect(brandingCss("#FF6600")).toContain("rgba(255, 102, 0, 0.12)");
  });
});
