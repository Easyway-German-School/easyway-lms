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
 * slow: measured on the development machine, mistral:latest answers a briefing
 * question in about 135 seconds and qwen2.5:3b in about 27. A small model is
 * worth far more here than a clever one — the assistant reads figures that
 * have already been computed, it does not reason about them.
 *
 * Still a ceiling, though. An admin page that hangs forever is worse than one
 * that says the model is taking too long.
 */
const TIMEOUT_MS = 180_000;
const HEALTH_TIMEOUT_MS = 2_000;

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
          // Zero, not 0.3. Choosing a filter is not a creative act, and a
          // model that gets imaginative about which branch you meant is worse
          // than one that asks.
          options: { temperature: options?.temperature ?? 0 },
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
 * Does the configured model support tool calling?
 *
 * Read from Ollama's own `capabilities` list rather than from a hardcoded name
 * list, which would be wrong the week somebody pulls a new model.
 */
export async function ollamaSupportsTools(model?: string): Promise<boolean> {
  const target = model ?? ollamaModel();
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
    return (data.capabilities ?? []).includes("tools");
  } catch {
    return false;
  }
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
          options: { temperature: options?.temperature ?? 0.3 },
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
