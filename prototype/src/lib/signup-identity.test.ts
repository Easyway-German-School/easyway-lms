import { describe, expect, it } from "vitest";

import { sameStudentIdentity } from "@/lib/signup-identity";

describe("sameStudentIdentity", () => {
  it("matches the same name, date of birth, and phone despite formatting differences", () => {
    expect(
      sameStudentIdentity(
        { name: "María Adebayo", admission: { phone: "+234 803 123 4567", dob: "24/12/2000" } },
        { name: "Maria Adebayo", admission: { phone: "0803-123-4567", dob: "24/12/2000" } },
      ),
    ).toBe(true);
  });

  it("does not treat a shared family phone as proof of a duplicate account", () => {
    expect(
      sameStudentIdentity(
        { name: "Ayo Adebayo", admission: { phone: "08031234567", dob: "24/12/2000" } },
        { name: "Tola Adebayo", admission: { phone: "08031234567", dob: "24/12/2000" } },
      ),
    ).toBe(false);
  });

  it("matches an exact government ID even when the contact details differ", () => {
    expect(
      sameStudentIdentity(
        { name: "Ayo Adebayo", admission: { idNumber: "AB-12345678" } },
        { name: "Ayo Othername", admission: { govIdNumber: "ab 12345678" } },
      ),
    ).toBe(true);
  });
});
