/**
 * The school's local AI.
 *
 * Ollama runs on the office machine, so student names, fee balances and
 * attendance never leave the building — which is the whole reason for choosing
 * it over a hosted model for this side of the product.
 *
 * It is OPTIONAL by design. Nothing in the admin portal depends on Ollama
 * being installed: every call here returns `{ ok: false, reason }` when it is
 * not reachable, and callers render the plain version of whatever they were
 * showing. A fresh clone with no Ollama is a working LMS with a greyed-out
 * assistant, not a broken one.
 *
 * Configured with the same two variables src/lib/ai.ts already uses, so the
 * office has one place to point at their model, not two:
 *
 *   OLLAMA_BASE_URL=http://localhost:11434   (default)
 *   OLLAMA_MODEL=mistral:latest              (default)
 */

const DEFAULT_URL = "http://localhost:11434";
const DEFAULT_MODEL = "mistral:latest";

/**
 * How long to wait before giving up.
 *
 * Generous, because a local model on a machine without a GPU is genuinely
 * slow. Still a ceiling, though: an admin page that hangs forever is worse
 * than one that says the model is taking too long.
 */
const TIMEOUT_MS = 180_000;
const HEALTH_TIMEOUT_MS = 2_000;

/**
 * How long Ollama should hold the model in memory after a request.
 *
 * This is the cheapest speed fix in the file, and it buys two separate things:
 *
 *   1. THE MODEL ITSELF. Ollama's default is to unload after five minutes.
 *      Reloading qwen2.5:3b from disk costs several seconds — measured at 7.5s
 *      for a 1.5B model on the development machine — and a front desk asks
 *      questions in bursts with long gaps, which is exactly the pattern that
 *      pays that cost on every single burst.
 *
 *   2. THE PROMPT CACHE, which matters far more. Ollama keeps the evaluated
 *      key/value cache for the prompt PREFIX it last saw, and reuses it when
 *      the next prompt starts with the same bytes. Prompt evaluation is the
 *      dominant cost here — measured at 37 SECONDS for a ~900-token prompt on
 *      qwen2.5:3b, against 0.2s when the prefix hits the cache. Unloading the
 *      model throws that cache away.
 *
 * Thirty minutes covers a working session. The cost is a few hundred MB of RAM
 * sitting idle on the office machine, which is a trade worth making.
 *
 * The whole prefix-cache win depends on callers keeping their prompt prefix
 * BYTE-IDENTICAL between questions — see the briefing cache in the assistant
 * route, which exists for exactly this reason.
 */
const KEEP_ALIVE = "30m";

/**
 * Ceiling on generated tokens.
 *
 * The assistant is told to answer in at most five sentences, and generation is
 * the slow half of a warm request (~7 tokens/second on the development
 * machine). Without a ceiling, one confused rambling answer is a minute of a
 * front-desk worker watching a spinner. Four hundred tokens is comfortably
 * more than five sentences and firmly less than a monologue.
 */
const NUM_PREDICT = 400;

export function ollamaUrl(): string {
  return (process.env.OLLAMA_BASE_URL ?? DEFAULT_URL).replace(/\/$/, "");
}

export function ollamaModel(): string {
  return process.env.OLLAMA_MODEL ?? DEFAULT_MODEL;
}

export type OllamaFailure = {
  ok: false;
  /** Safe to show an admin: says what to do, names no internals. */
  reason: string;
};

export type OllamaSuccess = { ok: true; text: string; model: string };
export type OllamaResult = OllamaSuccess | OllamaFailure;

export type OllamaStatus = {
  reachable: boolean;
  url: string;
  /** The configured model, whether or not it is pulled. */
  model: string;
  /** Everything Ollama has locally, so the page can say what to pull. */
  installedModels: string[];
  /** True when the configured model is actually one of the installed ones. */
  modelReady: boolean;
  reason?: string;
};

async function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Is Ollama there, and is the configured model pulled?
 *
 * Deliberately quick to fail: this runs on page load, and an admin waiting two
 * minutes to be told the assistant is off would be absurd.
 */
export async function ollamaStatus(): Promise<OllamaStatus> {
  const url = ollamaUrl();
  const model = ollamaModel();

  try {
    const response = await fetchWithTimeout(`${url}/api/tags`, { cache: "no-store" }, HEALTH_TIMEOUT_MS);
    if (!response.ok) {
      return {
        reachable: false,
        url,
        model,
        installedModels: [],
        modelReady: false,
        reason: `Ollama answered ${response.status}.`,
      };
    }

    const data = (await response.json()) as { models?: Array<{ name?: string }> };
    const installedModels = (data.models ?? [])
      .map((m) => m.name ?? "")
      .filter(Boolean);

    // Ollama reports "mistral:latest" for a model pulled as bare "mistral", so
    // an untagged name is allowed to match the :latest tag — and nothing else.
    //
    // Comparing only the part before the colon would be wrong: "mistral:small"
    // is a different download from "mistral:latest", and treating one as the
    // other reports the assistant ready and then fails every request with a
    // 404. That is exactly what this deployment's .env.local asks for.
    const modelReady = installedModels.some(
      (name) => name === model || (!model.includes(":") && name === `${model}:latest`),
    );

    return {
      reachable: true,
      url,
      model,
      installedModels,
      modelReady,
      reason: modelReady ? undefined : `Ollama is running but ${model} is not pulled yet.`,
    };
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return {
      reachable: false,
      url,
      model,
      installedModels: [],
      modelReady: false,
      reason: aborted
        ? "Ollama did not answer in time."
        : "Ollama is not running. Start it with `ollama serve`.",
    };
  }
}

export type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  /** Only on assistant turns that asked for tools. */
  tool_calls?: ToolCall[];
  /** Only on `tool` turns: which tool produced this. Ollama wants the name. */
  tool_name?: string;
};

/* -------------------------------------------------------------------------- */
/* Tools                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Tool calling, which is what turns the assistant from a narrator into
 * something an office can actually use.
 *
 * The briefing version of this assistant could only read a fixed summary
 * aloud. Ask it "which Lagos B1 students have not paid and have not attended in
 * three weeks" and it had no way to find out, so it either refused or — far
 * worse — produced a confident list of names that do not exist.
 *
 * With tools the model does not answer the question at all. It chooses WHICH
 * QUERY TO RUN and with what arguments; the server runs it against Postgres,
 * checks the caller's capabilities, and hands back real rows. The model's only
 * remaining job is to phrase what came back. That keeps the one rule this
 * assistant has always had — the model never counts anything — while removing
 * the ceiling on what it can be asked.
 *
 * Not every local model can do this. `qwen2.5` (every size) and
 * `mistral:latest` report the `tools` capability; `falcon` does not. The route
 * checks before it tries and falls back to the briefing if the configured
 * model cannot.
 */
export type ToolCall = {
  function: {
    name: string;
    /** Ollama sends an object; some builds send a JSON string. Both handled. */
    arguments: Record<string, unknown> | string;
  };
};

export type ToolSpec = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, unknown>;
      required?: string[];
    };
  };
};

export type OllamaToolResult =
  | { ok: true; text: string; toolCalls: ToolCall[]; model: string }
  | OllamaFailure;

/** Ollama is inconsistent about whether arguments arrive parsed. */
export function toolArguments(call: ToolCall): Record<string, unknown> {
  const raw = call.function?.arguments;
  if (!raw) return {};
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/**
 * One turn that may come back asking for tools instead of answering.
 *
 * The caller runs the loop: execute what was asked for, append the results as
 * `tool` messages, call again. Kept here rather than inside this function
 * because only the caller knows which tools exist and who is allowed to run
 * them — putting the execution in this file would mean the transport layer
 * holds the permission model, which is how permission models get bypassed.
 */
export async function ollamaChatWithTools(
  messages: ChatMessage[],
  tools: ToolSpec[],
  options?: { temperature?: number; model?: string },
): Promise<OllamaToolResult> {
  const url = ollamaUrl();
  const model = options?.model ?? ollamaModel();

  try {
    const response = await fetchWithTimeout(
      `${url}/api/chat`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages,
          tools,
          stream: false,
          keep_alive: KEEP_ALIVE,
          options: {
            // Zero, not 0.3. Choosing a filter is not a creative act, and a
            // model that gets imaginative about which branch you meant is
            // worse than one that asks.
            temperature: options?.temperature ?? 0,
            num_predict: NUM_PREDICT,
          },
        }),
      },
      TIMEOUT_MS,
    );

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      if (response.status === 404) {
        return {
          ok: false,
          reason: `The model ${model} is not installed. Run \`ollama pull ${model}\` and try again.`,
        };
      }
      return { ok: false, reason: `Ollama returned ${response.status}. ${detail.slice(0, 200)}` };
    }

    const data = (await response.json()) as {
      message?: { content?: string; tool_calls?: ToolCall[] };
    };

    return {
      ok: true,
      text: data.message?.content?.trim() ?? "",
      toolCalls: data.message?.tool_calls ?? [],
      model,
    };
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return {
      ok: false,
      reason: aborted
        ? "The model took too long. Try a shorter question, or a smaller model."
        : "Could not reach Ollama. Start it with `ollama serve`.",
    };
  }
}

/**
 * The same turn, streamed.
 *
 * Identical contract to `ollamaChatWithTools` — same arguments, same result —
 * except that text arrives at `onDelta` as the model produces it instead of
 * all at once at the end.
 *
 * This is the difference between a front desk watching a spinner for half a
 * minute and watching an answer appear in three seconds. It does not make the
 * model faster; the total time is unchanged. It makes the wait legible, which
 * for somebody standing at a counter with a student in front of them is the
 * thing that actually matters.
 *
 * SAFE TO USE FOR EVERY ROUND OF THE TOOL LOOP. A round where the model
 * decides to call a tool emits NO content chunks at all — verified against
 * Ollama directly: the entire reply arrives as `tool_calls` with empty text.
 * So the caller can stream every round without risking half-formed tool
 * chatter reaching the page: the tool rounds are silent, and the round that
 * finally answers is the one that streams.
 *
 * Ollama streams newline-delimited JSON, one object per line, NOT SSE — there
 * are no `data:` prefixes to strip. Chunks can split mid-line across TCP
 * reads, so the tail of each read is held back until its newline arrives.
 */
export async function ollamaChatStream(
  messages: ChatMessage[],
  onDelta: (text: string) => void,
  options?: { temperature?: number; model?: string; tools?: ToolSpec[] },
): Promise<OllamaToolResult> {
  const url = ollamaUrl();
  const model = options?.model ?? ollamaModel();
  const tools = options?.tools;

  try {
    const response = await fetchWithTimeout(
      `${url}/api/chat`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages,
          ...(tools && tools.length > 0 ? { tools } : {}),
          stream: true,
          keep_alive: KEEP_ALIVE,
          options: {
            temperature: options?.temperature ?? 0,
            num_predict: NUM_PREDICT,
          },
        }),
      },
      TIMEOUT_MS,
    );

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      if (response.status === 404) {
        return {
          ok: false,
          reason: `The model ${model} is not installed. Run \`ollama pull ${model}\` and try again.`,
        };
      }
      return { ok: false, reason: `Ollama returned ${response.status}. ${detail.slice(0, 200)}` };
    }
    if (!response.body) return { ok: false, reason: "Ollama returned an empty stream." };

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let text = "";
    let toolCalls: ToolCall[] = [];

    const consume = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let parsed: { message?: { content?: string; tool_calls?: ToolCall[] }; error?: string };
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        // A malformed line is not worth killing a good answer over.
        return;
      }
      if (parsed.error) throw new Error(parsed.error);
      const chunk = parsed.message?.content;
      if (chunk) {
        text += chunk;
        onDelta(chunk);
      }
      if (parsed.message?.tool_calls?.length) {
        toolCalls = toolCalls.concat(parsed.message.tool_calls);
      }
    };

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      // The last element is whatever came after the final newline — possibly a
      // half-written object. It waits for the next read.
      buffer = lines.pop() ?? "";
      for (const line of lines) consume(line);
    }
    consume(buffer);

    return { ok: true, text: text.trim(), toolCalls, model };
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return {
      ok: false,
      reason: aborted
        ? "The model took too long. Try a shorter question, or a smaller model."
        : "Could not reach Ollama. Start it with `ollama serve`.",
    };
  }
}

/**
 * Does the configured model support tool calling?
 *
 * Read from Ollama's own `capabilities` list rather than from a hardcoded name
 * list, which would be wrong the week somebody pulls a new model.
 *
 * Cached per model name, because the answer cannot change without someone
 * editing .env.local and restarting the server. This used to be an /api/show
 * round trip on every page load AND every question asked — pure latency in
 * front of an admin who is already waiting.
 */
const toolSupportCache = new Map<string, boolean>();

export async function ollamaSupportsTools(model?: string): Promise<boolean> {
  const target = model ?? ollamaModel();
  const cached = toolSupportCache.get(target);
  if (cached !== undefined) return cached;

  try {
    const response = await fetchWithTimeout(
      `${ollamaUrl()}/api/show`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: target }),
      },
      HEALTH_TIMEOUT_MS * 3,
    );
    if (!response.ok) return false;
    const data = (await response.json()) as { capabilities?: string[] };
    const supported = (data.capabilities ?? []).includes("tools");
    // Only a definite answer is cached. A failed probe is usually "Ollama is
    // not running yet", and that must not be remembered as "no tools" for the
    // life of the process.
    toolSupportCache.set(target, supported);
    return supported;
  } catch {
    return false;
  }
}

/**
 * Load the model into memory without asking it anything.
 *
 * An empty `messages` array is Ollama's documented way to say "just load it".
 * Called when the assistant page opens, so the several-second model load
 * happens while the admin is reading the briefing rather than after they have
 * typed their first question and hit enter.
 *
 * Deliberately fire-and-forget: nothing depends on it, and a failure here is
 * simply the old behaviour of loading on first use.
 */
export function ollamaWarm(model?: string): void {
  const target = model ?? ollamaModel();
  void fetchWithTimeout(
    `${ollamaUrl()}/api/chat`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: target, messages: [], keep_alive: KEEP_ALIVE }),
    },
    HEALTH_TIMEOUT_MS * 10,
  ).catch(() => {});
}

/**
 * One turn of chat.
 *
 * Never throws: every failure is a value, because the callers are admin pages
 * that must still render when the assistant is off.
 */
export async function ollamaChat(
  messages: ChatMessage[],
  options?: { temperature?: number; model?: string },
): Promise<OllamaResult> {
  const url = ollamaUrl();
  const model = options?.model ?? ollamaModel();

  try {
    const response = await fetchWithTimeout(
      `${url}/api/chat`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages,
          stream: false,
          keep_alive: KEEP_ALIVE,
          options: {
            temperature: options?.temperature ?? 0.3,
            num_predict: NUM_PREDICT,
          },
        }),
      },
      TIMEOUT_MS,
    );

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      if (response.status === 404) {
        return {
          ok: false,
          reason: `The model ${model} is not installed. Run \`ollama pull ${model}\` and try again.`,
        };
      }
      return { ok: false, reason: `Ollama returned ${response.status}. ${detail.slice(0, 200)}` };
    }

    const data = (await response.json()) as { message?: { content?: string } };
    const text = data.message?.content?.trim() ?? "";
    if (!text) return { ok: false, reason: "The model returned nothing." };

    return { ok: true, text, model };
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return {
      ok: false,
      reason: aborted
        ? "The model took too long. Try a shorter question, or a smaller model."
        : "Could not reach Ollama. Start it with `ollama serve`.",
    };
  }
}

/**
 * Ask for JSON and get it parsed, or a failure.
 *
 * Local models wrap JSON in prose and code fences however firmly they are told
 * not to, so the fences are stripped and the outermost {...} or [...] is taken
 * rather than trusting the whole response to parse.
 */
export async function ollamaJson<T>(
  messages: ChatMessage[],
  options?: { temperature?: number },
): Promise<{ ok: true; data: T } | OllamaFailure> {
  const result = await ollamaChat(messages, { temperature: options?.temperature ?? 0 });
  if (!result.ok) return result;

  const cleaned = result.text
    .replace(/^\s*```(?:json)?/i, "")
    .replace(/```\s*$/, "")
    .trim();

  const start = cleaned.search(/[[{]/);
  const end = Math.max(cleaned.lastIndexOf("}"), cleaned.lastIndexOf("]"));
  const candidate = start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned;

  try {
    return { ok: true, data: JSON.parse(candidate) as T };
  } catch {
    return { ok: false, reason: "The model did not return usable JSON. Try asking again." };
  }
}
