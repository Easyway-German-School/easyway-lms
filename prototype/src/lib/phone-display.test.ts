import { describe, expect, it } from "vitest";
import { describePhone, phoneForSheet, studentPhoneRaw } from "./phone-display";

describe("describePhone", () => {
  it("prints a Nigerian mobile in the local form the team dials", () => {
    expect(describePhone("08123456789")?.display).toBe("0812 345 6789");
    expect(describePhone("+234 812 345 6789")?.display).toBe("0812 345 6789");
    expect(describePhone("2348123456789")?.display).toBe("0812 345 6789");
    // The leading 0 dropped off somewhere along the way.
    expect(describePhone("8123456789")?.display).toBe("0812 345 6789");
  });

  it("gives a Nigerian number an international tel: and a WhatsApp link", () => {
    const parts = describePhone("0812 345 6789");
    expect(parts?.tel).toBe("+2348123456789");
    expect(parts?.whatsapp).toBe("https://wa.me/2348123456789");
  });

  it("never yields a display that starts with '+' or a bare digit run (Excel / formula guard)", () => {
    expect(phoneForSheet("+2348123456789")).toMatch(/^0\d{3} \d{3} \d{4}$/);
  });

  it("keeps a foreign number exactly as typed, and only offers WhatsApp when it is clearly international", () => {
    const de = describePhone("+49 151 2345 6789");
    expect(de?.display).toBe("+49 151 2345 6789");
    expect(de?.whatsapp).toBe("https://wa.me/4915123456789");

    const odd = describePhone("12345");
    expect(odd?.display).toBe("12345");
    expect(odd?.whatsapp).toBeNull();
  });

  it("returns null for nothing at all", () => {
    expect(describePhone("")).toBeNull();
    expect(describePhone(null)).toBeNull();
    expect(describePhone("n/a")).toBeNull();
    expect(phoneForSheet(undefined)).toBe("");
  });
});

describe("studentPhoneRaw", () => {
  it("prefers the profile number, falls back to the signup form's", () => {
    expect(studentPhoneRaw({ profile: { phone: "0801" }, admission: { phone: "0802" } }).phone).toBe("0801");
    expect(studentPhoneRaw({ profile: { phone: "" }, admission: { phone: "0802" } }).phone).toBe("0802");
    expect(studentPhoneRaw({ profile: null, admission: null }).phone).toBe("");
  });
});
