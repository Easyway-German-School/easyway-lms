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

  it("defuses a leading formula character so Excel can't execute it", () => {
    const csv = toCsv([{ name: '=HYPERLINK("http://evil","click")' }], ["name"]);
    expect(csv).toBe('name\r\n"\'=HYPERLINK(""http://evil"",""click"")"');
  });

  it("defuses +, -, @ and tab/CR prefixes too", () => {
    const csv = toCsv(
      [{ a: "+1 234", b: "-2", c: "@cmd", d: "\t=1+1" }],
      ["a", "b", "c", "d"],
    );
    expect(csv).toBe('a,b,c,d\r\n\'+1 234,\'-2,\'@cmd,\'\t=1+1');
  });

  it("leaves an ordinary value alone", () => {
    const csv = toCsv([{ name: "Ada Lovelace" }], ["name"]);
    expect(csv).toBe("name\r\nAda Lovelace");
  });
});
