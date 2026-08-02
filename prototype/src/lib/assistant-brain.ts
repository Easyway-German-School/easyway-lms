import Anthropic from "@anthropic-ai/sdk";
import {
  ollamaChatStream,
  ollamaModel,
  ollamaStatus,
  ollamaSupportsTools,
  toolArguments,
  type ChatMessage as OllamaMessage,
  type ToolSpec,
} from "@/lib/ollama";

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
 *   Not set                →  Ollama, exactly as before. Read tools only —
 *                             see toolsForBrain() below, which is the load-
 *                             bearing half of this decision.
 *
 * The privacy story the old file told is still true and now needs saying out
 * loud rather than being implied by the architecture: with a key set, student
 * names and balances are sent to Anthropic. A school that does not want that
 * unsets the key and keeps the local assistant, complete, at reading speed.
 * That is a deployment decision, so it lives in an environment variable and
 * the admin page says which mode it is in.
 *
 * ---------------------------------------------------------------------------
 * ONE MESSAGE SHAPE, TWO WIRE FORMATS
 *
 * Ollama wants tool results as `{role:"tool", tool_name}` and takes system
 * messages inline. Anthropic wants them as `tool_result` blocks inside a USER
 * message, keyed by the id of the `tool_use` that asked, and takes the system
 * prompt as a separate top-level parameter. Neither is convertible to the
 * other after the fact — the Anthropic form needs an id that the Ollama form
 * never carried.
 *
 * So the route speaks BrainMessage, which carries the id, and each adapter
 * below throws away what its provider does not want. Trying to make the route
 * speak either provider's dialect directly is what makes this kind of code rot.
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

export type Provider = "claude" | "ollama";

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

const CLAUDE_MODEL = "claude-opus-5";

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

export function brainProvider(): Provider {
  return hasHostedBrain() ? "claude" : "ollama";
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
 */
export function canBrainAct(): boolean {
  return brainProvider() === "claude";
}

export async function brainStatus(): Promise<BrainStatus> {
  if (brainProvider() === "claude") {
    return {
      provider: "claude",
      model: CLAUDE_MODEL,
      ready: true,
      canAct: true,
      note: "Answers in seconds and can carry out actions you confirm. Questions are sent to Anthropic.",
    };
  }

  const status = await ollamaStatus();
  const supportsTools = status.modelReady ? await ollamaSupportsTools() : false;

  return {
    provider: "ollama",
    model: status.model,
    ready: status.reachable && status.modelReady && supportsTools,
    // Deliberately false even when Ollama is perfectly healthy.
    canAct: false,
    note: "Runs on this machine — nothing leaves the building. Looks things up, but cannot carry out actions.",
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
    const status = (error as { status?: number }).status;
    if (status === 401) {
      return { ok: false, reason: "The AI key was rejected. Check ANTHROPIC_API_KEY." };
    }
    if (status === 429) {
      return { ok: false, reason: "The assistant is rate limited right now. Try again in a moment." };
    }
    return { ok: false, reason: "The assistant could not be reached. Try again." };
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
): Promise<BrainTurn> {
  return brainProvider() === "claude"
    ? claudeTurn(messages, onDelta, tools)
    : ollamaTurn(messages, onDelta, tools);
}
