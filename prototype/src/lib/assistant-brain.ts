import Anthropic from "@anthropic-ai/sdk";
import {
  ollamaChatStream,
  ollamaModel,
  ollamaStatus,
  ollamaSupportsTools,
  toolArguments,
  type ChatMessage as OllamaMessage,
  type ToolCall as OllamaToolCall,
  type ToolSpec,
} from "@/lib/ollama";
import { GROQ_MODEL } from "@/lib/ai";

/**
 * The assistant's brain, and which one it uses.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS AT ALL
 *
 * The assistant used to be Ollama and nothing else, and that was the right
 * call while it could only READ. A 3B model reading six pre-computed figures
 * off a briefing is a safe use of a small model, and keeping four hundred
 * students' fee balances on the office machine is worth a slow answer.
 *
 * Giving it ACTIONS changes the arithmetic, and not by a little. Choosing
 * between six lookup tools is a classification problem; choosing between
 * lookups and eight writes — then filling in who, how much and when — is not.
 * Measured on this machine, qwen2.5:3b picks the right lookup most of the time
 * and mis-fills action arguments often enough that a human would be confirming
 * a wrong plan several times a day. The confirm step (see assistant-actions.ts)
 * catches that, but a confirm step people learn to distrust is a confirm step
 * people learn to click through.
 *
 * So the model got better and the safety net stayed. Both, not either.
 *
 * ---------------------------------------------------------------------------
 * WHICH BRAIN, AND WHY THAT ORDER
 *
 *   ANTHROPIC_API_KEY set  →  Claude. ~2-4 seconds to a full answer, and tool
 *                             arguments that survive being checked.
 *   Else GROQ_API_KEY set  →  Groq. Also hosted, also real structured tool
 *                             calling — same trust tier as Claude, see
 *                             canBrainAct() — and free, which is why it sits
 *                             ahead of the local model rather than behind it.
 *                             This is the same Claude-then-Groq order ai.ts
 *                             already uses for the rest of the app's hosted
 *                             calls; this file just extends it to the one
 *                             brain that was still Claude-or-nothing.
 *   Neither set             →  Ollama, exactly as before. Read tools only —
 *                             see toolsForBrain() below, which is the load-
 *                             bearing half of this decision.
 *
 * The privacy story the old file told is still true and now needs saying out
 * loud rather than being implied by the architecture: with a key set, student
 * names and balances are sent to Anthropic or to Groq, whichever answered.
 * A school that does not want that unsets both keys and keeps the local
 * assistant, complete, at reading speed. That is a deployment decision, so it
 * lives in environment variables and the admin page says which mode it is in.
 *
 * ---------------------------------------------------------------------------
 * ONE MESSAGE SHAPE, THREE WIRE FORMATS
 *
 * Ollama wants tool results as `{role:"tool", tool_name}` and takes system
 * messages inline. Anthropic wants them as `tool_result` blocks inside a USER
 * message, keyed by the id of the `tool_use` that asked, and takes the system
 * prompt as a separate top-level parameter. Groq speaks the OpenAI shape —
 * closer to Ollama's (system messages inline, no top-level parameter) but
 * still keyed by id like Anthropic's, via `tool_call_id`, and it fragments a
 * streamed tool call's arguments across several chunks that have to be
 * reassembled by index — Ollama and Anthropic each send a tool call whole.
 * None of the three is convertible to another after the fact.
 *
 * So the route speaks BrainMessage, which carries the id, and each adapter
 * below throws away what its provider does not want. Trying to make the route
 * speak any provider's dialect directly is what makes this kind of code rot.
 */

/* -------------------------------------------------------------------------- */
/* The shared shape                                                           */
/* -------------------------------------------------------------------------- */

export type BrainToolCall = {
  /**
   * Anthropic's `tool_use.id`, needed to match the result back. Ollama has no
   * such concept, so one is invented there and simply never used.
   */
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

export type BrainMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: BrainToolCall[] }
  | { role: "tool"; toolCallId: string; name: string; content: string };

export type BrainTurn =
  | { ok: true; text: string; toolCalls: BrainToolCall[]; model: string; provider: Provider }
  | { ok: false; reason: string };

export type Provider = "claude" | "groq" | "ollama";

export type BrainStatus = {
  provider: Provider;
  model: string;
  ready: boolean;
  /** Whether this brain may be trusted with the action tools. */
  canAct: boolean;
  /** Shown to the admin. Says where the data goes, in plain words. */
  note: string;
  reason?: string;
};

/**
 * Which hosted model, and why it is a knob rather than a constant.
 *
 * The default is Opus because this assistant fills in arguments that decide
 * who gets messaged and whose level changes, and that is the job worth paying
 * for. But it is the school's money, and the cheaper models are not toys:
 *
 *   claude-opus-5    $5 / $25 per million tokens   the default
 *   claude-sonnet-5  $3 / $15                      most of the quality
 *   claude-haiku-4-5 $1 / $5                       fine for lookups
 *
 * Set ANTHROPIC_ASSISTANT_MODEL to move between them without touching code.
 * Roughly two US cents a question at the default, and less after the first
 * one — the system prompt and tool list are cached, so the repeated part of
 * every question bills at a tenth of the rate.
 */
const CLAUDE_MODEL = process.env.ANTHROPIC_ASSISTANT_MODEL || "claude-opus-5";

/**
 * Ceiling on one reply.
 *
 * On Claude this covers thinking AND the answer together, which is the trap
 * worth naming: thinking is ON by default on this model, so a budget sized
 * around a five-sentence answer would be spent thinking and return nothing.
 * Four thousand is far more than five sentences needs and leaves the model
 * room to reason about which action to propose.
 */
const MAX_TOKENS = 4_000;

export function hasHostedBrain(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export function hasGroqBrain(): boolean {
  return Boolean(process.env.GROQ_API_KEY);
}

export function brainProvider(): Provider {
  if (hasHostedBrain()) return "claude";
  if (hasGroqBrain()) return "groq";
  return "ollama";
}

/**
 * Whether the current brain may be offered tools that WRITE.
 *
 * This is the single most important line in the file, so it is a function with
 * a name rather than an `if` buried in the route.
 *
 * A local 3B model gets the read tools and nothing else. Not because writing is
 * forbidden to it in principle, but because every action tool this app has
 * takes arguments that decide who is affected — a level, a branch, an amount, a
 * date — and a model that fills those in approximately produces a confirm card
 * that is plausible and wrong. Plausible and wrong is the one failure mode the
 * confirm step cannot save you from, because it is the one a busy person
 * approves.
 *
 * Groq is trusted the same as Claude, not gated like Ollama. It is a real
 * hosted model doing real structured function calling — the same mechanism
 * Claude uses, not the heuristic tool-parsing a small local model does — so
 * the failure mode above does not apply to it the way it applies to Ollama.
 * The trade being made explicitly: whenever Claude has no credit and Groq
 * takes over, student and financial data starts flowing to a second hosted
 * destination. That is disclosed in brainStatus()'s note, the same way the
 * Claude path already discloses Anthropic.
 */
export function canBrainAct(): boolean {
  const provider = brainProvider();
  if (provider === "claude" || provider === "groq") return true;
  // The school's override. Off unless deliberately set — see below.
  return process.env.ASSISTANT_LOCAL_ACTIONS === "true";
}

/**
 * ASSISTANT_LOCAL_ACTIONS=true — let the LOCAL model propose actions.
 *
 * Off by default, and the default is a measurement rather than an opinion:
 * `npm run bench:brain` runs the real action tools against the installed local
 * models with the phrasings the office actually uses, and scores whether the
 * right tool was picked AND the filters that decide who it lands on survived.
 * Run it before turning this on, and run it again after changing OLLAMA_MODEL.
 *
 * The failure it guards against is specific. A model that picks
 * `mark_attendance` correctly and drops `branch` marks the wrong campus
 * present. One that picks `message_students` and drops `level` writes to the
 * whole school. Both produce a confirm card that looks entirely reasonable —
 * the count is the only tell, and the count is only a tell to somebody who
 * knows what it should have been.
 *
 * So this is a real switch, not a discouraged one: with a model that scores
 * clean on the bench, local actions are free, private and fast, which is
 * strictly better than paying. It is off by default because "the office's
 * records" is the wrong place to find out that the model was close enough.
 */
export function localActionsEnabled(): boolean {
  return process.env.ASSISTANT_LOCAL_ACTIONS === "true";
}

export async function brainStatus(): Promise<BrainStatus> {
  const provider = brainProvider();

  if (provider === "claude") {
    return {
      provider: "claude",
      model: CLAUDE_MODEL,
      ready: true,
      canAct: true,
      note: "Answers in seconds and can carry out actions you confirm. Questions are sent to Anthropic.",
    };
  }

  if (provider === "groq") {
    return {
      provider: "groq",
      model: GROQ_MODEL,
      ready: true,
      canAct: true,
      note: "Answers in seconds and can carry out actions you confirm. Free tier — questions are sent to Groq.",
    };
  }

  const status = await ollamaStatus();
  const supportsTools = status.modelReady ? await ollamaSupportsTools() : false;
  const acting = localActionsEnabled();

  return {
    provider: "ollama",
    model: status.model,
    ready: status.reachable && status.modelReady && supportsTools,
    canAct: acting,
    note: acting
      ? "Runs on this machine — nothing leaves the building. Check every plan before confirming: a local model is more likely to drop a filter."
      : "Runs on this machine — nothing leaves the building. Looks things up, but cannot carry out actions.",
    reason: status.reachable
      ? status.modelReady
        ? supportsTools
          ? undefined
          : `${status.model} cannot call tools. Switch OLLAMA_MODEL to qwen2.5:3b.`
        : status.reason
      : status.reason,
  };
}

/* -------------------------------------------------------------------------- */
/* Claude                                                                     */
/* -------------------------------------------------------------------------- */

let client: Anthropic | null = null;

function anthropic(): Anthropic {
  // One client, reused: it holds a connection pool, and building a fresh one
  // per question throws that away on exactly the request that is trying to be
  // fast.
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return client;
}

/**
 * Translate BrainMessages into the Anthropic wire shape.
 *
 * Two things here are not obvious and both cause silent breakage if missed:
 *
 *   1. System messages become the top-level `system` parameter, not entries in
 *      `messages`. The last one carries a cache breakpoint, so the system
 *      prompt and the tool list — which render ahead of it — are billed at a
 *      tenth of the price on every question after the first. That is the whole
 *      prompt-caching win, and it depends on the system text being byte-stable,
 *      which is why the briefing is cached upstream rather than rebuilt here.
 *
 *   2. Consecutive tool results MERGE into one user message. The API wants all
 *      results from one assistant turn in a single message; splitting them
 *      across several teaches the model to stop asking for tools in parallel,
 *      which is a slow, invisible regression rather than an error.
 */
function toAnthropic(messages: BrainMessage[]): {
  system: Anthropic.TextBlockParam[];
  turns: Anthropic.MessageParam[];
} {
  const system: Anthropic.TextBlockParam[] = [];
  const turns: Anthropic.MessageParam[] = [];

  for (const message of messages) {
    if (message.role === "system") {
      system.push({ type: "text", text: message.content });
      continue;
    }

    if (message.role === "user") {
      turns.push({ role: "user", content: message.content });
      continue;
    }

    if (message.role === "assistant") {
      const blocks: Anthropic.ContentBlockParam[] = [];
      if (message.content.trim()) blocks.push({ type: "text", text: message.content });
      for (const call of message.toolCalls ?? []) {
        blocks.push({ type: "tool_use", id: call.id, name: call.name, input: call.arguments });
      }
      // An assistant turn with neither text nor tools is not a legal message.
      if (blocks.length > 0) turns.push({ role: "assistant", content: blocks });
      continue;
    }

    const result: Anthropic.ToolResultBlockParam = {
      type: "tool_result",
      tool_use_id: message.toolCallId,
      content: message.content,
    };

    const last = turns[turns.length - 1];
    if (last && last.role === "user" && Array.isArray(last.content)) {
      (last.content as Anthropic.ContentBlockParam[]).push(result);
    } else {
      turns.push({ role: "user", content: [result] });
    }
  }

  if (system.length > 0) {
    system[system.length - 1] = {
      ...system[system.length - 1],
      cache_control: { type: "ephemeral" },
    };
  }

  return { system, turns };
}

function toAnthropicTools(tools: ToolSpec[]): Anthropic.Tool[] {
  return tools.map((tool) => ({
    name: tool.function.name,
    description: tool.function.description,
    input_schema: tool.function.parameters as Anthropic.Tool["input_schema"],
  }));
}

async function claudeTurn(
  messages: BrainMessage[],
  onDelta: (text: string) => void,
  tools: ToolSpec[],
): Promise<BrainTurn> {
  const { system, turns } = toAnthropic(messages);

  try {
    const stream = anthropic().messages.stream({
      model: CLAUDE_MODEL,
      max_tokens: MAX_TOKENS,
      /**
       * Adaptive rather than disabled, and low effort rather than high.
       *
       * Disabling thinking on this model is the tempting move for a latency-
       * sensitive page and it is the wrong one: with thinking off it will
       * occasionally write a tool call into its visible text instead of
       * emitting a real tool call. The turn then SUCCEEDS, the lookup never
       * runs, and the admin reads a confident answer built on nothing. Low
       * effort costs a fraction of a second and removes that failure entirely.
       *
       * Note there is no `temperature` here. This model rejects it outright —
       * the Ollama path sets temperature 0 and that parameter simply does not
       * cross over.
       */
      thinking: { type: "adaptive" },
      output_config: { effort: "low" },
      system,
      messages: turns,
      ...(tools.length > 0 ? { tools: toAnthropicTools(tools) } : {}),
    });

    stream.on("text", (text) => onDelta(text));

    const message = await stream.finalMessage();

    /**
     * A refusal is a successful HTTP response with an empty or partial body,
     * so `content[0]` must never be read before this check.
     *
     * The recovery is deliberately NOT a hosted fallback model. This app has a
     * working local assistant sitting right there, and falling back to it also
     * covers the outage case — a refusal and an unreachable API get the same
     * honest answer instead of two different half-broken ones.
     */
    if (message.stop_reason === "refusal") {
      return {
        ok: false,
        reason: "The assistant declined that request. Try rephrasing it.",
      };
    }

    const text = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("")
      .trim();

    const toolCalls: BrainToolCall[] = message.content
      .filter((block): block is Anthropic.ToolUseBlock => block.type === "tool_use")
      .map((block) => ({
        id: block.id,
        name: block.name,
        arguments: (block.input ?? {}) as Record<string, unknown>,
      }));

    return { ok: true, text, toolCalls, model: CLAUDE_MODEL, provider: "claude" };
  } catch (error) {
    console.error("Claude turn failed", error);
    return { ok: false, reason: describeClaudeFailure(error) };
  }
}

/**
 * Say what actually went wrong, in words that name the fix.
 *
 * This function exists because the first end-to-end run of this code returned
 * "The assistant could not be reached", which sent us to check the network, the
 * key and the model name — when the real answer was in the response body all
 * along: the Anthropic account was out of credit. A generic message on a
 * specific failure costs somebody twenty minutes, and the office has no server
 * log to go and read.
 */
function describeClaudeFailure(error: unknown): string {
  const status = (error as { status?: number }).status;
  const detail =
    (error as { error?: { error?: { message?: string } } }).error?.error?.message ?? "";

  // Billing comes back as a 400, not a 402, so it has to be matched on the
  // message rather than the status or it reads as a malformed request.
  if (/credit balance/i.test(detail)) {
    return "The Anthropic account is out of credit, so the fast assistant is unavailable. Top it up, or unset ANTHROPIC_API_KEY to fall back to the local one.";
  }
  if (status === 401) return "The AI key was rejected. Check ANTHROPIC_API_KEY.";
  if (status === 403) return "That AI key is not allowed to use this model.";
  if (status === 429) return "The assistant is rate limited right now. Try again in a moment.";
  if (status === 400 && detail) return `The assistant refused that request: ${detail}`;
  if (typeof status === "number" && status >= 500) {
    return "Anthropic is having trouble right now. Try again in a moment.";
  }
  return "The assistant could not be reached. Check the internet connection.";
}

/* -------------------------------------------------------------------------- */
/* Groq                                                                       */
/* -------------------------------------------------------------------------- */

type GroqWireMessage =
  | { role: "system" | "user"; content: string }
  | {
      role: "assistant";
      content: string | null;
      tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>;
    }
  | { role: "tool"; tool_call_id: string; content: string };

/**
 * Translate BrainMessages into the OpenAI-compatible shape Groq's chat
 * completions endpoint wants.
 *
 * Closer to Ollama's wire format than Anthropic's — system messages sit
 * inline in the array rather than in a separate top-level parameter — but a
 * tool call is identified by `id` the way Anthropic's is, because that id has
 * to survive round to round for `tool_call_id` to match it back up. Ollama
 * never needed this: it has no id at all, one is invented in ollamaTurn()
 * below and never read back.
 */
function toGroq(messages: BrainMessage[]): GroqWireMessage[] {
  return messages.map((message) => {
    if (message.role === "tool") {
      return { role: "tool", tool_call_id: message.toolCallId, content: message.content };
    }
    if (message.role === "assistant") {
      return {
        role: "assistant",
        // OpenAI's shape wants `null`, not an empty string, when a turn is
        // pure tool calls with no accompanying text.
        content: message.content || null,
        ...(message.toolCalls?.length
          ? {
              tool_calls: message.toolCalls.map((call) => ({
                id: call.id,
                type: "function" as const,
                function: { name: call.name, arguments: JSON.stringify(call.arguments) },
              })),
            }
          : {}),
      };
    }
    return { role: message.role, content: message.content };
  });
}

let groqCallCounter = 0;

/**
 * Say what actually went wrong, mirroring describeClaudeFailure() below —
 * an admin staring at "the assistant could not be reached" when the real
 * answer is "the Groq key is wrong" loses the same twenty minutes either way.
 */
function describeGroqFailure(status: number, detail: string): string {
  if (status === 401) return "The Groq key was rejected. Check GROQ_API_KEY.";
  if (status === 429) return "Groq is rate limited right now. Try again in a moment.";
  if (status >= 500) return "Groq is having trouble right now. Try again in a moment.";
  return detail
    ? `Groq refused that request: ${detail.slice(0, 200)}`
    : "Could not reach Groq. Check the internet connection.";
}

/**
 * Groq's streamed tool calls arrive FRAGMENTED — unlike Ollama, which sends
 * one whole tool call per line. Each SSE chunk carries a partial
 * `{index, id?, function:{name?, arguments?}}` and the pieces have to be
 * accumulated by `index` across the whole stream: the id and the function
 * name typically land in the first fragment for that index, and `arguments`
 * arrives as a JSON string built up a few characters at a time.
 */
async function groqTurn(
  messages: BrainMessage[],
  onDelta: (text: string) => void,
  tools: ToolSpec[],
): Promise<BrainTurn> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return { ok: false, reason: "GROQ_API_KEY is not set." };

  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: toGroq(messages),
        ...(tools.length > 0 ? { tools } : {}),
        stream: true,
        temperature: 0,
        max_tokens: MAX_TOKENS,
      }),
    });

    if (!response.ok || !response.body) {
      const detail = await response.text().catch(() => "");
      return { ok: false, reason: describeGroqFailure(response.status, detail) };
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let text = "";
    const calls = new Map<number, { id: string; name: string; arguments: string }>();

    const consume = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) return;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === "[DONE]") return;

      let parsed: { choices?: Array<{ delta?: { content?: string; tool_calls?: unknown } }> };
      try {
        parsed = JSON.parse(payload);
      } catch {
        // A malformed frame is not worth killing a good answer over — same
        // rule ollamaChatStream's consume() follows.
        return;
      }

      const delta = parsed.choices?.[0]?.delta;
      if (!delta) return;

      if (typeof delta.content === "string" && delta.content) {
        text += delta.content;
        onDelta(delta.content);
      }

      const fragments = delta.tool_calls;
      if (Array.isArray(fragments)) {
        for (const raw of fragments) {
          const fragment = raw as { index?: number; id?: string; function?: { name?: string; arguments?: string } };
          const index = fragment.index ?? 0;
          const existing = calls.get(index) ?? { id: "", name: "", arguments: "" };
          if (fragment.id) existing.id = fragment.id;
          if (fragment.function?.name) existing.name += fragment.function.name;
          if (fragment.function?.arguments) existing.arguments += fragment.function.arguments;
          calls.set(index, existing);
        }
      }
    };

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) consume(line);
    }
    consume(buffer);

    const toolCalls: BrainToolCall[] = [...calls.values()]
      .filter((call) => call.name)
      .map((call) => {
        // toolArguments() already knows how to turn a raw JSON string into
        // arguments — reused rather than re-implemented, same as ollamaTurn()
        // below reuses it for Ollama's own tool calls.
        const shim: OllamaToolCall = { function: { name: call.name, arguments: call.arguments } };
        return {
          id: call.id || `groq_${(groqCallCounter += 1)}`,
          name: call.name,
          arguments: toolArguments(shim),
        };
      });

    return { ok: true, text: text.trim(), toolCalls, model: GROQ_MODEL, provider: "groq" };
  } catch (error) {
    console.error("Groq turn failed", error);
    return { ok: false, reason: "Could not reach Groq. Check the internet connection." };
  }
}

/* -------------------------------------------------------------------------- */
/* Ollama                                                                     */
/* -------------------------------------------------------------------------- */

function toOllama(messages: BrainMessage[]): OllamaMessage[] {
  return messages.map((message) => {
    if (message.role === "tool") {
      return { role: "tool", tool_name: message.name, content: message.content };
    }
    if (message.role === "assistant") {
      return {
        role: "assistant",
        content: message.content,
        ...(message.toolCalls?.length
          ? {
              tool_calls: message.toolCalls.map((call) => ({
                function: { name: call.name, arguments: call.arguments },
              })),
            }
          : {}),
      };
    }
    return { role: message.role, content: message.content };
  });
}

let localCallCounter = 0;

async function ollamaTurn(
  messages: BrainMessage[],
  onDelta: (text: string) => void,
  tools: ToolSpec[],
): Promise<BrainTurn> {
  const result = await ollamaChatStream(toOllama(messages), onDelta, {
    ...(tools.length > 0 ? { tools } : {}),
  });

  if (!result.ok) return { ok: false, reason: result.reason };

  return {
    ok: true,
    text: result.text,
    toolCalls: result.toolCalls.map((call) => ({
      // Ollama does not issue ids. One is minted so the rest of the pipeline
      // has a single shape to handle; nothing on this path ever reads it back.
      id: `local_${(localCallCounter += 1)}`,
      name: call.function?.name ?? "",
      arguments: toolArguments(call),
    })),
    model: ollamaModel(),
    provider: "ollama",
  };
}

/* -------------------------------------------------------------------------- */
/* The one entry point                                                        */
/* -------------------------------------------------------------------------- */

/**
 * One turn of the conversation, streamed.
 *
 * The caller runs the tool loop: if `toolCalls` comes back non-empty, execute
 * them, append the assistant turn and the results, and call again. Execution
 * deliberately does not live here — this file is transport, and a transport
 * layer that also decides who may run what is how permission models get
 * bypassed.
 */
export async function brainTurn(
  messages: BrainMessage[],
  onDelta: (text: string) => void,
  tools: ToolSpec[] = [],
  options?: {
    /**
     * The narrower tool set to retry with locally if the hosted brain fails.
     * The route passes the READ tools only — a fallback is not the moment to
     * hand write access to a model that was never trusted with it.
     */
    fallbackTools?: ToolSpec[];
    /**
     * Skip the choice and use this brain.
     *
     * The caller sets this to "ollama" for every round AFTER a fallback has
     * happened, and that stickiness is not a nicety. Without it the loop
     * re-tries the hosted brain on the next round, fails the same way, and
     * finds the conversation is now mid-tool-call — so the fallback is refused
     * and the whole question dies holding a half-finished local answer. A
     * fallback that only survives one round is a fallback that only works for
     * questions needing no lookups, which is not the interesting case.
     */
    force?: Provider;
  },
): Promise<BrainTurn> {
  if (options?.force === "ollama") return ollamaTurn(messages, onDelta, tools);
  if (options?.force === "groq") return groqTurn(messages, onDelta, tools);

  const provider = brainProvider();
  if (provider === "ollama") return ollamaTurn(messages, onDelta, tools);

  const primary = provider === "claude"
    ? await claudeTurn(messages, onDelta, tools)
    : await groqTurn(messages, onDelta, tools);
  if (primary.ok) return primary;

  /**
   * The primary brain failed. Rather than hand the office an error, step down
   * the same cascade brainProvider() would if the failed one were unset:
   * Claude falls to Groq before either falls to the local model, because Groq
   * is still hosted and still trusted with actions (see canBrainAct()) —
   * dropping straight to Ollama would throw away tool-calling quality the
   * school is not actually short of.
   *
   * TWO CONDITIONS gate EVERY step down, both load bearing:
   *
   *   Nothing may have streamed yet. If half an answer is already on screen,
   *   a second model continuing it produces one reply written by two authors
   *   in two voices, spliced at an arbitrary word.
   *
   *   No tool calls may have happened yet. A conversation carrying the failed
   *   brain's own tool_use/tool_call ids means the failure came mid-loop;
   *   replaying that history to a brain that never issued those ids is asking
   *   it to answer for work it did not do.
   *
   * Neither holds after the first round, and in practice the first round is
   * where an out-of-credit or unreachable API fails anyway.
   */
  const midConversation = messages.some(
    (message) => message.role === "tool" || (message.role === "assistant" && message.toolCalls?.length),
  );
  if (midConversation) return primary;

  let streamed = false;
  const capture = (text: string) => {
    streamed = true;
    onDelta(text);
  };

  if (provider === "claude" && hasGroqBrain()) {
    // The FULL tool set, not fallbackTools — Groq is trusted the same as
    // Claude, so a Claude→Groq step-down loses no capability, unlike the
    // step to Ollama below.
    const groqFallback = await groqTurn(messages, capture, tools);
    if (groqFallback.ok) return groqFallback;
    // Groq streamed something before failing — stop here rather than let a
    // third brain finish what a second one started.
    if (streamed) return groqFallback;
  }

  const local = await ollamaStatus();
  if (!local.reachable || !local.modelReady) return primary;

  const fallback = await ollamaTurn(messages, capture, options?.fallbackTools ?? []);

  // Every hosted option failed — report the ORIGINAL problem, because that is
  // the one the admin can do something about.
  if (!fallback.ok) return streamed ? fallback : primary;
  return fallback;
}
