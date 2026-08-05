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
  if (brainProvider() === "claude") return true;
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
  if (brainProvider() === "ollama") return ollamaTurn(messages, onDelta, tools);

  const hosted = await claudeTurn(messages, onDelta, tools);
  if (hosted.ok) return hosted;

  /**
   * The hosted brain failed. Rather than hand the office an error, drop to the
   * local one — which is exactly the assistant they had before this feature
   * existed, and is more useful than nothing when the card runs out of credit
   * on a Tuesday morning.
   *
   * TWO CONDITIONS, both load bearing:
   *
   *   Nothing may have streamed yet. If half an answer is already on screen,
   *   a second model continuing it produces one reply written by two authors
   *   in two voices, spliced at an arbitrary word.
   *
   *   No tool calls may have happened yet. A conversation carrying Anthropic
   *   tool_use ids means the failure came mid-loop; replaying that history to a
   *   local model that never issued those ids is asking it to answer for work
   *   it did not do.
   *
   * Neither holds after the first round, and in practice the first round is
   * where an out-of-credit or unreachable API fails anyway.
   */
  const midConversation = messages.some(
    (message) => message.role === "tool" || (message.role === "assistant" && message.toolCalls?.length),
  );
  if (midConversation) return hosted;

  const local = await ollamaStatus();
  if (!local.reachable || !local.modelReady) return hosted;

  let streamed = false;
  const fallback = await ollamaTurn(
    messages,
    (text) => {
      streamed = true;
      onDelta(text);
    },
    options?.fallbackTools ?? [],
  );

  // The local model failed too — report the ORIGINAL problem, because that is
  // the one the admin can do something about.
  if (!fallback.ok) return streamed ? fallback : hosted;
  return fallback;
}
