import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A Claude key that is present but has run out of credit used to make every
 * model call return null — even with a working Groq key beside it. These pin
 * the failover so that cannot quietly come back.
 */
describe("hosted text failover", () => {
  const calls: string[] = [];

  function stubFetch(handlers: { claude: () => Response; groq: (model: string) => Response }) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("anthropic.com")) {
          calls.push("claude");
          return handlers.claude();
        }
        const model = JSON.parse(String(init?.body ?? "{}")).model as string;
        calls.push(`groq:${model}`);
        return handlers.groq(model);
      }),
    );
  }

  const groqOk = (text: string) =>
    new Response(JSON.stringify({ choices: [{ message: { content: text }, finish_reason: "stop" }] }), { status: 200 });
  const noCredit = () =>
    new Response(JSON.stringify({ error: { message: "Your credit balance is too low to access the Anthropic API." } }), { status: 400 });

  beforeEach(() => {
    vi.resetModules();
    calls.length = 0;
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    process.env.GROQ_API_KEY = "gsk_test";
    delete process.env.DEEPSEEK_API_KEY;
    delete process.env.OLLAMA_BASE_URL;
    delete process.env.ANYTHINGLLM_BASE_URL;
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("falls through to Groq when Claude has no credit", async () => {
    stubFetch({ claude: noCredit, groq: () => groqOk("hello from groq") });
    const { callModel } = await import("./ai");
    expect(await callModel("hi", 100, "learning-content")).toBe("hello from groq");
    expect(calls).toEqual(["claude", "groq:openai/gpt-oss-120b"]);
  });

  it("stops asking an unfunded Claude, so the next call goes straight to Groq", async () => {
    stubFetch({ claude: noCredit, groq: () => groqOk("ok") });
    const { callModel, activeModelName } = await import("./ai");
    await callModel("one", 100, "learning-content");
    calls.length = 0;
    await callModel("two", 100, "learning-content");
    expect(calls).toEqual(["groq:openai/gpt-oss-120b"]);
    // ...and the model recorded on the notes is the one that actually answered.
    expect(activeModelName("learning-content")).toBe("openai/gpt-oss-120b");
  });

  it("does not sideline Claude for a passing error", async () => {
    stubFetch({ claude: () => new Response("overloaded", { status: 529 }), groq: () => groqOk("ok") });
    const { callModel } = await import("./ai");
    await callModel("one", 100, "learning-content");
    calls.length = 0;
    await callModel("two", 100, "learning-content");
    expect(calls[0]).toBe("claude");
  });

  it("tries the sibling Groq model when the first is rate limited", async () => {
    stubFetch({
      claude: noCredit,
      groq: (model) =>
        model === "openai/gpt-oss-120b"
          ? new Response("{}", { status: 429, headers: { "retry-after": "60" } })
          : groqOk("from the sibling"),
    });
    const { callModel } = await import("./ai");
    expect(await callModel("hi", 100, "learning-content")).toBe("from the sibling");
    // retry-after of 60s is "come back later", not worth waiting for inside a request.
    expect(calls).toEqual(["claude", "groq:openai/gpt-oss-120b", "groq:openai/gpt-oss-20b"]);
  });

  it("sizes the prompt for the model that will answer", async () => {
    stubFetch({ claude: noCredit, groq: () => groqOk("ok") });
    const { callModel, promptCharBudget } = await import("./ai");
    expect(promptCharBudget("learning-content")).toBeGreaterThan(9_000);
    await callModel("x", 10, "learning-content");
    expect(promptCharBudget("learning-content")).toBe(9_000);
  });
});
