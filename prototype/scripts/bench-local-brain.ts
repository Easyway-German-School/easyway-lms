import { ASSISTANT_ACTIONS } from "@/lib/assistant-actions";
import { ASSISTANT_TOOLS } from "@/lib/assistant-tools";
import type { ToolSpec } from "@/lib/ollama";

/**
 * Can a local model be trusted with the action tools, and how fast is it?
 *
 *   npm run bench:brain              # the sensible candidates
 *   npm run bench:brain -- qwen2.5:7b mistral:latest
 *
 * WHY THIS EXISTS. The decision to keep the local model out of the write path
 * was made on reasoning — small models fill structured arguments badly — and
 * reasoning is not evidence. This measures it: real tool specs, real office
 * phrasings, and a score for whether the model picked the right action AND
 * filled in the arguments that decide who it lands on.
 *
 * WHAT COUNTS AS A PASS is deliberately strict, because the cost of a miss is
 * not a bad sentence. `mark_attendance` with the branch dropped marks the
 * wrong campus present. `message_students` with the level dropped writes to
 * the whole school. Picking the right TOOL and then losing a filter is the
 * failure this whole design is afraid of, so a dropped required argument is a
 * failure here even though the model "understood the request".
 *
 * Speed is measured the way the front desk experiences it: wall clock from
 * asking to having something to act on.
 */

const DEFAULT_MODELS = ["qwen2.5:3b", "qwen2.5:7b"];
const URL = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";

type Case = {
  ask: string;
  /** The tool a competent assistant would reach for. */
  expect: string;
  /**
   * Arguments that MUST be present and correct. Anything the office said out
   * loud and the model dropped is a wrong action, not a partial one.
   */
  required: Record<string, string | number | boolean>;
  /** Arguments it must NOT invent — conditions nobody asked for. */
  forbidden?: string[];
};

const CASES: Case[] = [
  {
    ask: "Chase everyone in Lagos who still owes tuition.",
    expect: "send_fee_reminders",
    required: { branch: "Lagos" },
  },
  {
    ask: "Mark the Lagos A1 morning class present on 2026-08-01.",
    expect: "mark_attendance",
    required: { branch: "Lagos", level: "A1", date: "2026-08-01" },
  },
  {
    ask: "Move the Abuja A1 students up to the next level.",
    expect: "promote_students",
    required: { branch: "Abuja", level: "A1" },
  },
  {
    ask: "Tell the Lagos B1 students their class is cancelled on 2026-08-05 because the tutor is ill.",
    expect: "postpone_class",
    required: { branch: "Lagos", level: "B1", date: "2026-08-05" },
  },
  {
    ask: "Send enrolment links to everyone who enquired recently.",
    expect: "invite_leads",
    required: {},
  },
  {
    ask: "How many students do we have in Port Harcourt?",
    expect: "count_students",
    required: { branch: "Port Harcourt" },
    // The dangerous failure in reverse: turning a question into an action.
    forbidden: ["title", "message"],
  },
  {
    ask: "Send a message to the Abuja B2 students reminding them to bring their passports.",
    expect: "message_students",
    required: { branch: "Abuja", level: "B2" },
  },
];

const SYSTEM = `You are the assistant for the office of Easyway German Language School in Nigeria.

You have tools. Use them.
- Use ONLY the filters the request actually mentions, and use ALL of them.
- Never add a condition nobody asked for.
- Action tools prepare a plan for a human to confirm; they do not happen immediately.
- When an action needs a message, write it yourself.`;

const PASS = "[32mPASS[0m";
const FAIL = "[31mFAIL[0m";

function specs(): ToolSpec[] {
  return [...ASSISTANT_TOOLS.map((t) => t.spec), ...ASSISTANT_ACTIONS.map((a) => a.spec)];
}

type Attempt = {
  ok: boolean;
  why: string;
  seconds: number;
  picked: string;
  args: Record<string, unknown>;
};

async function askModel(model: string, testCase: Case, tools: ToolSpec[]): Promise<Attempt> {
  const started = Date.now();
  let response: Response;
  try {
    response = await fetch(`${URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: testCase.ask },
        ],
        tools,
        stream: false,
        keep_alive: "30m",
        options: { temperature: 0, num_predict: 400 },
      }),
      signal: AbortSignal.timeout(180_000),
    });
  } catch (error) {
    return {
      ok: false,
      why: error instanceof Error && error.name === "TimeoutError" ? "timed out" : "unreachable",
      seconds: (Date.now() - started) / 1000,
      picked: "-",
      args: {},
    };
  }

  const seconds = (Date.now() - started) / 1000;

  if (!response.ok) {
    return { ok: false, why: `HTTP ${response.status}`, seconds, picked: "-", args: {} };
  }

  const data = (await response.json()) as {
    message?: { tool_calls?: Array<{ function?: { name?: string; arguments?: unknown } }> };
  };

  const call = data.message?.tool_calls?.[0];
  if (!call) return { ok: false, why: "called no tool at all", seconds, picked: "-", args: {} };

  const picked = call.function?.name ?? "?";
  const raw = call.function?.arguments;
  const args: Record<string, unknown> =
    typeof raw === "string"
      ? (() => {
          try {
            return JSON.parse(raw);
          } catch {
            return {};
          }
        })()
      : ((raw as Record<string, unknown>) ?? {});

  if (picked !== testCase.expect) {
    return { ok: false, why: `picked ${picked}`, seconds, picked, args };
  }

  for (const [key, want] of Object.entries(testCase.required)) {
    const got = args[key];
    if (got === undefined || got === null || got === "") {
      return { ok: false, why: `dropped "${key}"`, seconds, picked, args };
    }
    if (String(got).toLowerCase() !== String(want).toLowerCase()) {
      return { ok: false, why: `${key}="${String(got)}" not "${want}"`, seconds, picked, args };
    }
  }

  for (const key of testCase.forbidden ?? []) {
    if (args[key] !== undefined) {
      return { ok: false, why: `invented "${key}"`, seconds, picked, args };
    }
  }

  return { ok: true, why: "", seconds, picked, args };
}

async function main() {
  const models = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_MODELS;
  const tools = specs();

  console.log(`${tools.length} tools (${ASSISTANT_TOOLS.length} lookups, ${ASSISTANT_ACTIONS.length} actions)`);
  console.log(`${CASES.length} office requests, against: ${models.join(", ")}\n`);

  const summary: Array<{ model: string; passed: number; median: number; worst: number }> = [];

  for (const model of models) {
    console.log(`\x1b[1m${model}\x1b[0m`);
    const times: number[] = [];
    let passed = 0;

    for (const testCase of CASES) {
      // Warm the model on the first call so the load time is not charged to the
      // first question — the office asks in bursts and keep_alive covers it.
      const attempt = await askModel(model, testCase, tools);
      times.push(attempt.seconds);
      if (attempt.ok) passed += 1;

      const shown = JSON.stringify(attempt.args);
      console.log(
        `  ${attempt.ok ? PASS : FAIL}  ${attempt.seconds.toFixed(1).padStart(5)}s  ${testCase.ask.slice(0, 46).padEnd(48)}${
          attempt.ok ? "" : `\n         ↳ ${attempt.why}  ${shown.slice(0, 110)}`
        }`,
      );
    }

    const sorted = [...times].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const worst = sorted[sorted.length - 1];
    summary.push({ model, passed, median, worst });
    console.log(
      `  → ${passed}/${CASES.length} correct · median ${median.toFixed(1)}s · worst ${worst.toFixed(1)}s\n`,
    );
  }

  console.log("\x1b[1mVerdict\x1b[0m");
  for (const row of summary) {
    const rate = Math.round((row.passed / CASES.length) * 100);
    // The bar is not "usually right". An action tool that is right eight times
    // in ten is wrong once a day at this school's volume, and the wrong one
    // reaches real people.
    const verdict =
      rate === 100 && row.median <= 8
        ? "\x1b[32mtrustworthy with actions\x1b[0m"
        : rate >= 85
          ? "\x1b[33mclose — would still misfire\x1b[0m"
          : "\x1b[31mlookups only\x1b[0m";
    console.log(`  ${row.model.padEnd(18)} ${String(rate).padStart(3)}%  median ${row.median.toFixed(1)}s  ${verdict}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
