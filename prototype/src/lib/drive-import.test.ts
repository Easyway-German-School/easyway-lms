import { describe, expect, it } from "vitest";
import { driveDownloadUrl } from "./drive-import";

describe("driveDownloadUrl", () => {
  it("rewrites a Drive file view link to a direct download", () => {
    expect(driveDownloadUrl("https://drive.google.com/file/d/abc123/view")).toBe(
      "https://drive.google.com/uc?export=download&id=abc123",
    );
  });

  it("rewrites a Drive file view link with query params", () => {
    expect(driveDownloadUrl("https://drive.google.com/file/d/abc123/view?usp=sharing")).toBe(
      "https://drive.google.com/uc?export=download&id=abc123",
    );
  });

  it("rewrites a native Google Doc to a PDF export", () => {
    expect(driveDownloadUrl("https://docs.google.com/document/d/doc123/view")).toBe(
      "https://docs.google.com/document/d/doc123/export?format=pdf",
    );
  });

  it("rewrites a native Google Sheet to an XLSX export", () => {
    expect(driveDownloadUrl("https://docs.google.com/spreadsheets/d/sheet123/view")).toBe(
      "https://docs.google.com/spreadsheets/d/sheet123/export?format=xlsx",
    );
  });

  it("rewrites a native Google Slides deck to a PPTX export", () => {
    expect(driveDownloadUrl("https://docs.google.com/presentation/d/deck123/view")).toBe(
      "https://docs.google.com/presentation/d/deck123/export?format=pptx",
    );
  });

  it("leaves an unrelated URL untouched", () => {
    expect(driveDownloadUrl("https://example.com/files/kursbuch.pdf")).toBe(
      "https://example.com/files/kursbuch.pdf",
    );
  });

  it("leaves a bare object-storage path untouched", () => {
    expect(driveDownloadUrl("/api/files/materials/kursbuch.pdf")).toBe("/api/files/materials/kursbuch.pdf");
  });

  it("leaves empty input untouched", () => {
    expect(driveDownloadUrl("")).toBe("");
  });
});
