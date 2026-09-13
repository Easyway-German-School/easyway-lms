import { describe, expect, it } from "vitest";
import { toCsv } from "./csv";

describe("toCsv", () => {
  it("writes a header row and one row per record", () => {
    const csv = toCsv([{ name: "Ada", seat: 3 }], ["name", "seat"]);
    expect(csv).toBe("name,seat\r\nAda,3");
  });

  it("quotes fields containing a comma, quote, or newline", () => {
    const csv = toCsv([{ name: 'Ada, "Grace"\nLovelace' }], ["name"]);
    expect(csv).toBe('name\r\n"Ada, ""Grace""\nLovelace"');
  });

  it("renders null as an empty field, not the string \"null\"", () => {
    const csv = toCsv([{ note: null }], ["note"]);
    expect(csv).toBe("note\r\n");
  });
});
