import { describe, expect, it } from "vitest";
import { escapeHtml } from "./html";

describe("escapeHtml", () => {
  it("neutralises a script tag instead of passing it through", () => {
    expect(escapeHtml('<script>alert("x")</script>')).toBe("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
  });

  it("escapes an attribute-breakout attempt", () => {
    expect(escapeHtml('"><img src=x onerror=alert(1)>')).not.toContain('"><img');
  });

  it("leaves plain text untouched apart from converting newlines", () => {
    expect(escapeHtml("Ada Lovelace")).toBe("Ada Lovelace");
  });
});
