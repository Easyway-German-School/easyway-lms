import { beforeEach, describe, expect, it, vi } from "vitest";

type UpsertArgs = { create: { value: { until: number } } };
const upsert = vi.fn(async (_args: UpsertArgs) => ({}));
const findUnique = vi.fn(async (_args?: unknown) => null as unknown);
vi.mock("@/lib/prisma", () => ({ prisma: { aiCache: { upsert, findUnique } } }));

describe("parseGroqRetrySeconds", () => {
  it("reads minutes and seconds", async () => {
    const { parseGroqRetrySeconds } = await import("./ai-cooldown");
    expect(parseGroqRetrySeconds("Please try again in 13m27s. Need more tokens?")).toBe(13 * 60 + 27);
  });

  it("reads seconds alone, and fractional seconds", async () => {
    const { parseGroqRetrySeconds } = await import("./ai-cooldown");
    expect(parseGroqRetrySeconds("Please try again in 27s. Upgrade")).toBe(27);
    expect(parseGroqRetrySeconds("Please try again in 18m25.056s. Upgrade")).toBe(18 * 60 + 26);
  });

  it("returns null when there is nothing to parse", async () => {
    const { parseGroqRetrySeconds } = await import("./ai-cooldown");
    expect(parseGroqRetrySeconds("Rate limit reached.")).toBeNull();
    expect(parseGroqRetrySeconds("")).toBeNull();
  });
});

describe("markGroqCooldown / groqCoolingDown", () => {
  beforeEach(() => {
    upsert.mockClear();
    findUnique.mockReset();
  });

  it("round-trips through the durable store", async () => {
    const { markGroqCooldown, groqCoolingDown } = await import("./ai-cooldown");
    await markGroqCooldown("groq-asr", 60);
    const written = upsert.mock.calls[0][0];
    findUnique.mockResolvedValue({ value: written.create.value });

    expect(await groqCoolingDown("groq-asr")).toBe(true);
  });

  it("is false once the wait has passed", async () => {
    const { groqCoolingDown } = await import("./ai-cooldown");
    findUnique.mockResolvedValue({ value: { until: Date.now() - 1000 } });
    expect(await groqCoolingDown("groq-chat")).toBe(false);
  });

  it("is false with no row at all — never blocks the first-ever call", async () => {
    const { groqCoolingDown } = await import("./ai-cooldown");
    findUnique.mockResolvedValue(null);
    expect(await groqCoolingDown("groq-asr")).toBe(false);
  });

  it("never locks a quota out longer than the ceiling, however long Groq's message says", async () => {
    const { markGroqCooldown } = await import("./ai-cooldown");
    await markGroqCooldown("groq-chat", 24 * 60 * 60); // a whole day, mis-parsed or genuinely reported
    const written = upsert.mock.calls[0][0];
    expect(written.create.value.until - Date.now()).toBeLessThanOrEqual(20 * 60 * 1000 + 50);
  });

  it("a failed write never throws — the caller has already handled the real failure", async () => {
    upsert.mockRejectedValueOnce(new Error("db down"));
    const { markGroqCooldown } = await import("./ai-cooldown");
    await expect(markGroqCooldown("groq-asr", 30)).resolves.toBeUndefined();
  });
});
