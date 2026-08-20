import { parseModelJson } from "@/lib/safe-json";

/**
 * AI Service - Supports Claude API, Ollama (local), or mock responses
 * Set environment variables:
 * - ANTHROPIC_API_KEY: For Claude API
 * - OLLAMA_BASE_URL: For local Ollama (e.g., http://localhost:11434)
 */

/**
 * The hosted model, in one place.
 *
 * This used to be `claude-3-5-sonnet-20241022`, written out four times. That
 * model was RETIRED in October 2025, so every one of those four calls had been
 * quietly 404ing and falling through to the mock grader — students were being
 * marked by the hardcoded fallback and nobody could tell, because the fallback
 * is deliberately plausible.
 *
 * One constant now, so the next model change is one line and cannot go
 * half-applied.
 */
const CLAUDE_MODEL = "claude-opus-5";

/**
 * One Claude call, shared by the four features that make one.
 *
 * Tuned for a student waiting on a page, not for depth:
 *
 *   thinking disabled + effort low — every one of these calls is short
 *   structured extraction (grade this, transcribe that), which is precisely
 *   the shape that does not benefit from reasoning. It matters more than it
 *   looks: on current models thinking is ON unless you say otherwise, and
 *   `max_tokens` caps thinking AND the answer together — so a 256-token budget
 *   would be spent thinking and return an empty string. Disabling it is what
 *   makes these budgets mean what they appear to mean.
 *
 * Returns null rather than throwing, because every caller's answer to a
 * failure is the same: fall back to the mock and let the page render.
 */
/**
 * Why the last Claude call failed, for the one caller that can act on it.
 *
 * `callClaude` returns null for every failure because its other callers all
 * respond the same way — fall back to the mock and let the page render. But
 * "no credit on the account" and "the model gave a bad answer" need different
 * words in front of an admin: one is fixed by topping up, the other by
 * rewording. Telling somebody to reword their brief when the real problem is
 * billing is how a working feature gets abandoned as broken.
 *
 * Module-level and last-write-wins, which is imprecise under concurrency and
 * good enough: it is read immediately after an awaited call, and it only ever
 * improves an error message.
 */
let lastClaudeFailure: string | null = null;

export function claudeFailureHint(): string | null {
  return lastClaudeFailure;
}

// Exported so assistant-brain.ts (the admin assistant's brain) can name the
// same model rather than hardcoding a second copy of this default that would
// silently drift from this one.
//
// llama-3.3-70b-versatile was the default until Groq retired it from their
// catalog outright — not deprecated-with-warning, just gone, so every call
// failed with a flat model_not_found and no earlier signal. Confirmed against
// GET https://api.groq.com/openai/v1/models with the account's own key before
// picking a replacement: openai/gpt-oss-120b is the largest general-purpose
// model Groq currently serves with tool calling, which is the one property
// this brain cannot do without (see assistant-brain.ts's groqTurn()).
export const GROQ_MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-120b";

/**
 * Groq's free tier, spoken with the same OpenAI-shaped chat-completions body
 * every hosted provider but Anthropic uses.
 *
 * This exists because the school will not pay a monthly bill and this
 * machine cannot run Ollama reliably (see [[project-ai-actually-works]]) —
 * so production had NO reachable model at all, hosted or local. Groq's free
 * tier is fast enough for a student watching a spinner and costs the
 * platform nothing, which is also why its calls are NOT run through
 * `recordUsage`: `ai.tokens` bills a school the real per-token cost this
 * platform pays a provider, and Groq's real cost here is zero. Metering it
 * at Claude's rate would invent a charge for a call nobody paid for.
 */
async function callGroq(prompt: string, maxTokens: number): Promise<string | null> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return null;

  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        max_tokens: maxTokens,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      console.error("Groq API error:", response.status, detail);
      return null;
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return data.choices?.[0]?.message?.content?.trim() || null;
  } catch {
    return null;
  }
}

/**
 * The one function every hosted-text call site should use.
 *
 * Tries whichever hosted key is actually configured, in the order
 * `hostedProvider()` picks: Claude first when funded (best quality), Groq
 * next (free, fast, no local RAM needed), DeepSeek last. Callers that used to
 * branch on `provider === "claude"` only would silently mock the moment
 * someone set GROQ_API_KEY instead of ANTHROPIC_API_KEY — this is what closes
 * that gap everywhere at once instead of at each call site separately.
 */
async function callHostedText(prompt: string, maxTokens: number): Promise<string | null> {
  if (hasKey(process.env.ANTHROPIC_API_KEY)) return callClaude(prompt, maxTokens);
  if (hasKey(process.env.GROQ_API_KEY)) return callGroq(prompt, maxTokens);
  if (hasKey(process.env.DEEPSEEK_API_KEY)) return callDeepSeekText(prompt, maxTokens);
  return null;
}

async function callDeepSeekText(prompt: string, maxTokens: number): Promise<string | null> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return null;
  try {
    const response = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
        max_tokens: maxTokens,
      }),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as any;
    return data.choices?.[0]?.message?.content?.trim() || null;
  } catch {
    return null;
  }
}

async function callClaude(prompt: string, maxTokens: number): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    lastClaudeFailure = "No ANTHROPIC_API_KEY is configured.";
    return null;
  }
  lastClaudeFailure = null;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: maxTokens,
        thinking: { type: "disabled" },
        output_config: { effort: "low" },
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      console.error("Claude API error:", response.status, detail);
      // The one failure worth naming precisely. A key that is present but
      // unfunded looks identical to a working one from every check we can
      // make without spending money, so this is the only place the truth
      // becomes available.
      lastClaudeFailure = /credit balance is too low/i.test(detail)
        ? "Claude has no credit on the account. Top it up, or draft with the local model instead."
        : response.status === 401 || response.status === 403
          ? "Claude rejected the API key."
          : `Claude returned ${response.status}.`;
      return null;
    }

    const data = (await response.json()) as {
      content?: Array<{ type?: string; text?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
      id?: string;
    };

    /**
     * Metered from the provider's own count, not from an estimate of ours.
     *
     * The whole pricing argument is that a school can be shown the supplier
     * bill their own actions produced, and a token count we guessed at would
     * quietly stop being that. Input and output are summed because the meter
     * prices them together; splitting them is a pricing change, not a
     * measurement one.
     *
     * `data.id` is Anthropic's message id, which makes the idempotency key
     * derivable from the response itself — replaying this response a year from
     * now produces the same key and is refused as the duplicate it is.
     */
    const used = (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0);
    if (used > 0 && data.id) {
      const { recordUsage } = await import("@/lib/usage/record");
      void recordUsage({
        meter: "ai.tokens",
        quantity: used,
        sourceId: `claude:${data.id}`,
        metadata: { model: CLAUDE_MODEL },
      });
    }
    // Take the first TEXT block by type rather than by position: a response can
    // lead with a non-text block, and content[0].text would then be undefined.
    const text = data.content?.find((block) => block.type === "text")?.text;
    return text?.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Pull JSON out of a model reply.
 *
 * Kept as a name because a dozen call sites use it, but the implementation now
 * lives in one place. This file previously held its own copy AND left six
 * other call sites on a bare `JSON.parse`, which is how the daily missions
 * came to be discarded on every request: two parsers, and the feature that
 * needed one most used neither.
 */
function parseJsonReply<T>(raw: string | null): T | null {
  return parseModelJson<T>(raw);
}

/** Appended to every prompt that wants JSON back. Cheap, and it works. */
const JSON_ONLY = "\n\nReturn only the JSON object. No prose, no code fences, no XML tags.";

export async function gradeEssay(essay: string): Promise<{
  score: number;
  feedback: Array<{ category: string; comment: string; score: number }>;
  summary: string;
}> {
  const provider = getAIProvider();

  if (provider === "claude" || provider === "groq" || provider === "deepseek") {
    return gradeEssayWithClaude(essay);
  } else if (provider === "ollama") {
    return gradeEssayWithOllama(essay);
  } else {
    return gradeEssayMock(essay);
  }
}

export async function analyzePronunciation(phrase: string): Promise<{
  transcription: string;
  issues: string[];
  corrections: string[];
  confidence: number;
}> {
  const provider = getAIProvider();

  if (provider === "claude" || provider === "groq" || provider === "deepseek") {
    return analyzePronunciationWithClaude(phrase);
  } else if (provider === "ollama") {
    return analyzePronunciationWithOllama(phrase);
  } else {
    return analyzePronunciationMock(phrase);
  }
}

export async function generateEssayNextSteps(score: number, feedback: Array<{ category: string; comment: string; score: number }>, essay: string): Promise<string> {
  const provider = getAIProvider();
  if (provider === "claude" || provider === "groq") {
    return generateNextStepsWithClaude(score, feedback, essay);
  } else if (provider === "deepseek") {
    return generateNextStepsWithDeepSeek(score, feedback, essay);
  } else if (provider === "ollama") {
    return generateNextStepsWithOllama(score, feedback, essay);
  } else {
    return generateNextStepsMock(score, feedback);
  }
}

/**
 * Daily missions, generated for one student.
 *
 * This used to return the canned set on the Claude path behind a
 * "for now" comment, and the Ollama path threw the model's answer away
 * because it arrived wrapped in a markdown fence. Between the two, every
 * student in the school had been reading the same three invented missions
 * since the feature shipped, and nothing anywhere logged that.
 *
 * Now it asks whichever model is actually reachable, and says so loudly when
 * it cannot. Falling back to the canned set is still correct — a student
 * opening their dashboard should never see an error because a model is busy —
 * but it must be visible in the logs, not silent.
 */
export async function generateDailyMissions(
  profile: any,
): Promise<Array<{ title: string; description: string; reward: string }>> {
  const prompt = [
    "You write daily missions for a student learning German at a Nigerian language school.",
    "",
    `Level: ${profile.level || "A1"}`,
    `Exam readiness: ${profile.examReadiness ?? 0}%`,
    `Pathway: ${profile.pathway || "Language training"}`,
    `Personal goal: ${profile.germanyGoal || "Not selected"}`,
    `Goal in their own words: ${profile.germanyGoalNote || "Not provided"}`,
    `Current streak: ${profile.streak ?? 0} days`,
    `Lessons finished: ${profile.completedLessons ?? 0}`,
    "",
    "Write exactly 3 missions. Each must be finishable in under 15 minutes today.",
    "Pitch them at the level given — an A1 student cannot 'discuss an article'.",
    "Make them concrete: name the words, the tense or the situation to practise.",
    "",
    'Reply with ONLY a JSON array: [{"title":"…","description":"…","reward":"+20 XP"}]',
  ].join("\n");

  const provider = getAIProvider("student");

  const raw =
    provider === "claude" || provider === "groq" || provider === "deepseek"
      ? await callHostedText(prompt, 700)
      : provider === "ollama" || provider === "anythingllm"
        ? await callLocalModel(getOllamaModel(), prompt, 0.6)
        : null;

  const parsed = parseModelJson<Array<{ title?: string; description?: string; reward?: string }>>(raw);

  if (Array.isArray(parsed)) {
    const missions = parsed
      .filter((mission) => mission && typeof mission.title === "string" && mission.title.trim())
      .slice(0, 3)
      .map((mission) => ({
        title: String(mission.title).trim(),
        description: String(mission.description ?? "").trim(),
        reward: String(mission.reward ?? "+20 XP").trim(),
      }));

    if (missions.length > 0) return missions;
  }

  console.warn(
    `[ai] daily missions fell back to the canned set (provider=${provider}, model answered=${raw ? "yes" : "no"})`,
  );
  return generateDailyMissionsMock(profile);
}

export async function generateMissionPracticeFeedback(input: {
  title: string;
  description: string;
  response: string;
}): Promise<{ prompt: string; feedback: string; score: number; suggestion?: string }> {
  const provider = getAIProvider();

  if (provider === "claude" || provider === "groq" || provider === "deepseek") {
    return generateMissionPracticeFeedbackWithClaude(input);
  }

  if (provider === "ollama" || provider === "anythingllm") {
    return generateMissionPracticeFeedbackWithLocalModel(input);
  }

  return generateMissionPracticeFeedbackMock(input);
}

async function generateMissionPracticeFeedbackWithClaude(input: {
  title: string;
  description: string;
  response: string;
}) {
  const raw = await callHostedText(
    `You are an expert German tutor. A student submitted the following mission response.\n\nMission: ${input.title}\nDescription: ${input.description}\nResponse: ${input.response}\n\nGive output as JSON with fields: prompt, feedback, score, suggestion.${JSON_ONLY}`,
    512,
  );

  const parsed = parseJsonReply<{
    prompt?: string;
    feedback?: string;
    score?: number | string;
    suggestion?: string;
  }>(raw);
  if (!parsed) return generateMissionPracticeFeedbackMock(input);

  return {
    prompt: parsed.prompt || `Practice this mission: ${input.title}\n\n${input.description}`,
    feedback: parsed.feedback || "Nice effort. Keep improving your answer with more detail.",
    score: Number(parsed.score) || 70,
    suggestion: parsed.suggestion || "Try adding one detail or example to strengthen your response.",
  };
}

async function generateMissionPracticeFeedbackWithLocalModel(input: {
  title: string;
  description: string;
  response: string;
}) {
  const prompt = `You are an expert German tutor. A student submitted the following mission response.\n\nMission: ${input.title}\nDescription: ${input.description}\nResponse: ${input.response}\n\nReturn only valid JSON with the fields: prompt, feedback, score, suggestion.`;
  const raw = await callLocalModel(getOllamaModel(), prompt, 0.2);
  if (!raw) return generateMissionPracticeFeedbackMock(input);

  try {
    const parsed = parseModelJson<any>(raw);
    if (!parsed) return generateMissionPracticeFeedbackMock(input);
    return {
      prompt: parsed.prompt || `Practice this mission: ${input.title}\n\n${input.description}`,
      feedback: parsed.feedback || "Nice effort. Keep improving your answer with more detail.",
      score: Number(parsed.score) || 70,
      suggestion: parsed.suggestion || "Try adding one detail or example to strengthen your response.",
    };
  } catch {
    return generateMissionPracticeFeedbackMock(input);
  }
}

function generateMissionPracticeFeedbackMock(input: {
  title: string;
  description: string;
  response: string;
}) {
  const response = input.response.trim();
  const lengthScore = Math.min(80, Math.max(25, Math.round(response.length / 2)));
  const germanWords = (response.match(/\b(der|die|das|und|ist|ich|du|wir|einen|eine|mit|für|nicht|auch|nur)\b/gi) || []).length;
  const germanBonus = Math.min(15, germanWords * 3);
  const score = Math.min(100, lengthScore + germanBonus);
  const hasQuestion = /\?/.test(response);
  const needsMoreDetail = response.length < 40;

  let feedback = "Good start. Your response addresses the task, but it can be more specific.";
  let suggestion = "Add one detail or example to make your answer stronger.";

  if (needsMoreDetail) {
    feedback = "Nice effort! The response is short, so add a sentence or two to describe your idea more clearly.";
    suggestion = "Expand your response with one extra detail or explanation.";
  } else if (hasQuestion) {
    feedback = "Your answer is clear and engaging. Try answering any question directly with a complete sentence.";
    suggestion = "Convert questions into a full statement and add one supporting detail.";
  } else if (germanBonus > 6) {
    feedback = "Great use of German vocabulary. Keep that up and focus on complete task coverage.";
    suggestion = "Include one more German phrase or example specific to the mission.";
  }

  return {
    prompt: `Practice this mission: ${input.title}\n\n${input.description}`,
    feedback,
    score,
    suggestion,
  };
}

export async function generateCourseOutline(courseInfo: any): Promise<{ modules: Array<{ title: string; description: string; lessons: Array<{ title: string; description: string; duration: number; type: string }> }> }> {
  const provider = getAIProvider("backoffice");
  // Either local runner: callLocalModel tries AnythingLLM before Ollama.
  if (provider === "ollama" || provider === "anythingllm") {
    return generateCourseOutlineWithOllama(courseInfo);
  }
  // No local runtime reachable (true on Vercel) — this used to fall straight
  // to the mock even with a funded hosted key. Now it asks whichever hosted
  // model callHostedText finds before giving up.
  if (provider === "claude" || provider === "groq" || provider === "deepseek") {
    return generateCourseOutlineWithHosted(courseInfo);
  }
  return generateCourseOutlineMock(courseInfo);
}

export async function generateLessonPackage(lessonData: any): Promise<{ summary: string; objectives: string[]; grammarFocus: string[]; vocabulary: string[]; quizQuestions?: Array<{ question: string; type: string; options?: string[]; answer: string }>; modules: Array<{ title: string; description: string; lessons: Array<{ title: string; description: string; type: string; duration: number }> }>; missions: Array<{ title: string; description: string; reward: string }> }> {
  const provider = getAIProvider("backoffice");
  // Either local runner: callLocalModel tries AnythingLLM before Ollama.
  if (provider === "ollama" || provider === "anythingllm") {
    return generateLessonPackageWithOllama(lessonData);
  }
  if (provider === "claude" || provider === "groq" || provider === "deepseek") {
    return generateLessonPackageWithHosted(lessonData);
  }
  return generateLessonPackageMock(lessonData);
}

export async function parseUploadedContent(content: string): Promise<{
  title: string;
  objectives: string[];
  grammarFocus: string[];
  vocabulary: string[];
  quizQuestions: Array<{ question: string; options?: string[]; answer: string; type: string }>;
  keyTopics: string[];
  suggestedLevel: string;
}> {
  const provider = getAIProvider("backoffice");
  // Either local runner: callLocalModel tries AnythingLLM before Ollama.
  if (provider === "ollama" || provider === "anythingllm") {
    return parseUploadedContentWithOllama(content);
  }
  if (provider === "claude" || provider === "groq" || provider === "deepseek") {
    return parseUploadedContentWithHosted(content);
  }
  return parseUploadedContentMock(content);
}

/**
 * Turn a tutor's shorthand into an announcement their class will read.
 *
 * CLAUDE, NOT THE LOCAL MODEL, and that is a deliberate exception to this
 * file's usual routing. A tutor is sitting on the page waiting, which puts
 * this in the "interactive" bucket — and more to the point, the local 3b model
 * is good at reading pre-computed figures and bad at prose. An announcement
 * that reads as though a machine wrote it is worse than the tutor's own
 * scribble, because the class can tell.
 *
 * Returns null on any failure. The caller keeps whatever the tutor typed and
 * says the assistant is unavailable — a drafting aid that eats your text when
 * the API is down would be used exactly once.
 */
export async function draftClassAnnouncement(input: {
  notes: string;
  cohortLabel?: string | null;
  urgent?: boolean;
}): Promise<{ title: string; message: string } | null> {
  const audience = input.cohortLabel ? `the ${input.cohortLabel} class` : "their German class";

  const prompt = `You are helping a German-language tutor in Nigeria write a short announcement to ${audience}.

The tutor's notes:
"""
${input.notes.slice(0, 1500)}
"""

Write the announcement they meant to send.

Rules:
- Plain, warm, direct English. The students are Nigerian adults learning German; most read this on a phone.
- Keep the MESSAGE under 60 words. Say the one thing that changed and what the student must do.
- Never invent specifics. If the notes do not give a date, time, room or link, do not supply one.
- No greeting line, no sign-off, no "Dear students". The portal already shows who sent it.
- The TITLE is at most 8 words and names the thing itself ("Monday class moved to 4pm"), not the genre ("Important announcement").
${input.urgent ? "- This one is urgent: lead with the change, not the context." : ""}

Return JSON: {"title": "...", "message": "..."}${JSON_ONLY}`;

  const parsed = parseJsonReply<{ title?: unknown; message?: unknown }>(
    await callClaude(prompt, 600),
  );
  if (!parsed) return null;

  const title = typeof parsed.title === "string" ? parsed.title.trim() : "";
  const message = typeof parsed.message === "string" ? parsed.message.trim() : "";
  // A draft missing either half is not a partial success — the form has two
  // required fields and half a draft would leave the tutor worse off.
  if (!title || !message) return null;

  // The server rejects titles over 120 characters, so a long one is trimmed
  // here rather than being offered and then refused on send.
  return { title: title.slice(0, 120), message };
}

/**
 * Which engine the admin explicitly asked for.
 *
 * `auto` keeps the file's existing routing (local first, hosted if no local
 * runtime, mock if neither). The other two are a deliberate override, because
 * for this one feature the difference is visible in the output: the local 3b
 * model is competent at extracting structure from figures and weak at writing
 * prose somebody will read, and an email to three hundred students is entirely
 * prose. Admins should be able to say so rather than editing an env var.
 */
export type EmailDraftEngine = "auto" | "claude" | "local";

export type EmailDraftBlock =
  | { type: "heading"; text: string }
  | { type: "text"; text: string }
  | { type: "callout"; text: string }
  | { type: "button"; label: string; href: string };

/**
 * What each engine can actually do right now, for the composer's toggle.
 *
 * A disabled radio with a reason beside it is far better than one that looks
 * available and silently produces the canned mock text — which is exactly the
 * failure this codebase has already had once, when a present-but-unfunded
 * Claude key made hosted the *preferred* provider and every caller fell
 * through to its placeholder.
 */
export function emailDraftEngines(): Array<{ id: EmailDraftEngine; label: string; available: boolean; detail: string }> {
  const claude = hasKey(process.env.ANTHROPIC_API_KEY);
  const local = localModelAvailable();
  return [
    { id: "auto", label: "Automatic", available: claude || local, detail: local ? "Uses the local model first" : claude ? "Uses Claude" : "No engine reachable" },
    { id: "claude", label: "Claude", available: claude, detail: claude ? `${CLAUDE_MODEL} — best prose, costs per send` : "No ANTHROPIC_API_KEY set" },
    { id: "local", label: "Local model", available: local, detail: local ? `${getOllamaModel()} — free, blunter writing` : "No local runtime reachable" },
  ];
}

/**
 * Draft a whole campaign as BLOCKS rather than as HTML.
 *
 * Asking for typed objects instead of markup is what makes this dependable on
 * a small model as well as a large one: a 3b model asked for an email table
 * layout produces something that neither validates nor renders, while the same
 * model asked for four labelled strings usually gets it right. It also means
 * the result lands in the editor as editable blocks rather than as a wall of
 * HTML nobody can safely touch.
 */
export async function draftEmailBlocks(input: {
  brief: string;
  audience?: string | null;
  engine?: EmailDraftEngine;
}): Promise<{ subject: string; blocks: EmailDraftBlock[]; engine: string } | null> {
  const audience = input.audience?.trim() || "students at a German language school in Nigeria";

  const prompt = `You are writing an email for EasyWay German Language School to ${audience}.

What the school wants to say:
"""
${input.brief.slice(0, 2000)}
"""

Compose the email as a short sequence of blocks.

Rules:
- Plain, warm, direct English. Most readers are Nigerian adults learning German, reading on a phone.
- Lead with the thing that changed. No throat-clearing, no "We hope this email finds you well".
- No greeting block and no sign-off block — the template already adds "Hallo <name>," and the school's footer.
- Never invent a date, time, price, venue or link that is not in the brief above.
- Use {{name}} for the reader's first name and {{level}} for their class level if you want them mid-sentence.
- Between 2 and 6 blocks. At most one "callout" and at most one "button".
- A "button" href must be a portal path like /payments, /calendar or /dashboard.

Block types: {"type":"heading","text":...} {"type":"text","text":...} {"type":"callout","text":...} {"type":"button","label":...,"href":...}

Return JSON: {"subject": "...", "blocks": [ ... ]}${JSON_ONLY}`;

  const engine = input.engine ?? "auto";
  let raw: string | null = null;
  let used = "";

  if (engine === "claude") {
    raw = await callClaude(prompt, 1200);
    used = CLAUDE_MODEL;
  } else if (engine === "local") {
    raw = await callLocalModel(getOllamaModel(), prompt, 0.4);
    used = getOllamaModel();
  } else {
    raw = await callModel(prompt, 1200, "backoffice");
    used = activeModelName("backoffice");
  }

  const parsed = parseJsonReply<{ subject?: unknown; blocks?: unknown }>(raw);
  if (!parsed) return null;

  const subject = typeof parsed.subject === "string" ? parsed.subject.trim().slice(0, 150) : "";
  if (!Array.isArray(parsed.blocks)) return null;

  // The model's output is treated exactly as hostile as a browser's: anything
  // unrecognised is dropped rather than passed along to the renderer.
  const blocks = parsed.blocks.flatMap((item): EmailDraftBlock[] => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const text = typeof row.text === "string" ? row.text.trim() : "";
    switch (row.type) {
      case "heading":
        return text ? [{ type: "heading", text: text.slice(0, 200) }] : [];
      case "text":
        return text ? [{ type: "text", text: text.slice(0, 3000) }] : [];
      case "callout":
        return text ? [{ type: "callout", text: text.slice(0, 400) }] : [];
      case "button": {
        const label = typeof row.label === "string" ? row.label.trim().slice(0, 60) : "";
        const href = typeof row.href === "string" ? row.href.trim().slice(0, 300) : "";
        return label && href ? [{ type: "button", label, href }] : [];
      }
      default:
        return [];
    }
  });

  if (blocks.length === 0 || !subject) return null;
  return { subject, blocks, engine: used };
}

export async function summarizeText(text: string): Promise<string> {
  const provider = getAIProvider("backoffice");
  // Either local runner: callLocalModel tries AnythingLLM before Ollama.
  if (provider === "ollama" || provider === "anythingllm") {
    return summarizeTextWithOllama(text);
  }
  if (provider === "claude" || provider === "groq" || provider === "deepseek") {
    const raw = await callHostedText(
      `Summarize the following German learning content into a concise paragraph that preserves the main ideas and structure. Return only the summary text, no JSON.\n\nCONTENT:\n${text}`,
      500,
    );
    return raw || summarizeTextMock(text);
  }
  return summarizeTextMock(text);
}

export async function generatePersonalizedPlan(studentProfile: any, candidateLessons: any[], options: { maxLessons?: number; minutesPerDay?: number; strategy?: string } = {}) {
  const provider = getAIProvider("student");
  const maxLessons = options.maxLessons || 10;
  const strategy = (options.strategy || process.env.PERSONALIZATION_PLANNER_STRATEGY || 'hybrid').toLowerCase();
  const useFewShot = strategy === 'fewshot' || strategy === 'hybrid';
  const shouldUseLocalModel = (provider === 'anythingllm' || provider === 'ollama') && strategy !== 'deterministic';
  const shouldUseHostedModel = (provider === 'claude' || provider === 'groq' || provider === 'deepseek') && strategy !== 'deterministic';

  function mapLevelToRank(level: string | undefined) {
    const rank: Record<string, number> = { A1: 1, A2: 2, B1: 3, B2: 4, C1: 5, C2: 6 };
    return rank[level || 'A2'] || 2;
  }

  function getTargetDifficultyRank() {
    const studentLevelRank = mapLevelToRank(studentProfile.level || 'A2');
    const recentScores = Array.isArray(studentProfile.recentPerformance)
      ? studentProfile.recentPerformance
          .map((item: any) => Number(item.score || 0))
          .filter((score: number) => Number.isFinite(score))
      : [];
    const recentAverage = recentScores.length
      ? recentScores.reduce((sum: number, score: number) => sum + score, 0) / recentScores.length
      : Number(studentProfile.averageScore || 0);
    const readiness = Number(studentProfile.examReadiness || 0);

    if (recentAverage >= 85) return Math.min(6, studentLevelRank + 1);
    if (recentAverage <= 60 || readiness < 50) return Math.max(1, studentLevelRank - 1);
    return studentLevelRank;
  }

  function scoreLesson(lesson: any) {
    let score = 0;
    const studentLevelRank = mapLevelToRank(studentProfile.level || 'A2');
    const lessonLevelRank = mapLevelToRank(lesson.level || lesson.courseLevel || 'A2');
    const targetRank = getTargetDifficultyRank();
  const mastery = Array.isArray(studentProfile.skillMastery) ? studentProfile.skillMastery : [];
  const weakest = mastery[0];
  const lessonText = `${lesson.title || ''} ${lesson.description || ''} ${lesson.type || ''}`.toLowerCase();
  if (weakest && lessonText.includes(String(weakest.skill).toLowerCase())) score += Math.max(0, 18 - Number(weakest.mastery || 50) / 5);

    score += 20 - Math.abs(studentLevelRank - lessonLevelRank) * 4;
    score += Math.max(0, 10 - (lesson.order || 0));
    if (!studentProfile.completedLessons || !studentProfile.completedLessons.includes(lesson.id)) score += 10;
    const readiness = Number(studentProfile.examReadiness || 0);
    score += Math.max(0, Math.min(20, 50 - readiness) / 2);
    if (lesson.type === 'quiz' || lesson.type === 'assignment') score += 5;
    if (lesson.duration && lesson.duration <= 20) score += 2;

    const difficultyDelta = lessonLevelRank - targetRank;
    if (difficultyDelta === 0) score += 6;
    else if (difficultyDelta === 1) score += 2;
    else if (difficultyDelta < 0) score += 4;
    else score -= 8;

    return score;
  }

  const enrichedLessons = candidateLessons.map((lesson) => ({
    ...lesson,
    completed: Boolean(lesson.completed),
    difficulty: lesson.level || lesson.courseLevel || 'A2',
    tags: Array.from(new Set([lesson.type, lesson.source, lesson.difficulty, lesson.courseTitle, lesson.level].filter(Boolean))),
    summary: lesson.summary || lesson.description?.slice(0, 280) || '',
  }));

  const ranked = enrichedLessons
    .map((l) => ({ ...l, _score: scoreLesson(l) }))
    .sort((a, b) => (b._score ?? 0) - (a._score ?? 0))
    .slice(0, maxLessons);

  const profile = {
    level: studentProfile.level || 'A2',
    pathway: studentProfile.pathway || 'Language training',
    examReadiness: Number(studentProfile.examReadiness || 0),
    completedLessonsCount: Array.isArray(studentProfile.completedLessons) ? studentProfile.completedLessons.length : 0,
    averageScore: Number(studentProfile.averageScore || 0),
    recentPerformance: studentProfile.recentPerformance || [],
      skillMastery: studentProfile.skillMastery || [],
    preferences: {
      dailyMinutes: options.minutesPerDay || 30,
      goal: studentProfile.germanyGoal || 'improve exam readiness and complete pathway milestones',
      goalNote: studentProfile.germanyGoalNote || null,
    },
  };

  const fewShotExamples = useFewShot ? `
Few-shot examples:
Example A:
{"lessons":[{"id":"l1","title":"Present Perfect Tense","reason":"Good next step because the student is building foundational grammar after recent strong quiz performance."}]}
Example B:
{"lessons":[{"id":"l2","title":"Listening for gist","reason":"A lighter, confidence-building task is ideal when exam readiness is still below target."}]}
` : '';

  const localModelPrompt = `You are an expert German curriculum planner.
Given a learner profile, performance history, and a set of candidate lessons, create a personalized learning plan ordered by what will most efficiently move the student toward their pathway goals.

Planner strategy: ${strategy}
${fewShotExamples}
Learner profile:
${JSON.stringify(profile, null, 2)}

Candidate lessons:
${JSON.stringify(
  ranked.map((lesson) => ({
    id: lesson.id,
    title: lesson.title,
    courseTitle: lesson.courseTitle,
    level: lesson.level || lesson.courseLevel,
    difficulty: lesson.difficulty,
    tags: lesson.tags,
    duration: lesson.duration,
    summary: lesson.summary,
    completed: lesson.completed,
    source: lesson.source,
  })),
  null,
  2
)}

Return valid JSON only in this structure:
{
  "generatedAt": "2026-01-01T00:00:00.000Z",
  "rationale": "Why these lessons were selected",
  "lessons": [
    {
      "id": "...",
      "title": "...",
      "courseTitle": "...",
      "duration": 20,
      "type": "lesson|quiz|assignment",
      "difficulty": "A1|A2|B1|B2|C1|C2",
      "tags": ["..."],
      "goal": "One sentence objective",
      "reason": "Why this is next for the student",
      "source": "pathway|lecturer"
    }
  ]
}
`;

  if (shouldUseLocalModel) {
    const model = provider === 'anythingllm' ? process.env.ANYTHINGLLM_MODEL || 'anything-v7' : process.env.OLLAMA_MODEL || 'mistral:latest';
    try {
      const response = await callLocalModel(model, localModelPrompt, 0.2);
      if (response) {
        try {
          const parsed = JSON.parse(response);
          if (parsed?.lessons && Array.isArray(parsed.lessons)) {
            return {
              ...parsed,
              strategy,
              variant: 'llm',
              targetDifficulty: getTargetDifficultyRank(),
              adaptiveHint: 'Difficulty is tuned from recent performance and exam readiness.',
            };
          }
        } catch {
          // fall back to deterministic
        }
      }
    } catch {
      // ignore and use fallback
    }
  }

  if (shouldUseHostedModel) {
    try {
      const response = await callHostedText(localModelPrompt, 1400);
      const parsed = parseModelJson<any>(response);
      if (parsed?.lessons && Array.isArray(parsed.lessons)) {
        return {
          ...parsed,
          strategy,
          variant: 'llm',
          targetDifficulty: getTargetDifficultyRank(),
          adaptiveHint: 'Difficulty is tuned from recent performance and exam readiness.',
        };
      }
    } catch {
      // fall back to deterministic
    }
  }

  const plan = {
    generatedAt: new Date().toISOString(),
    rationale: 'Fallback deterministic ranking plan',
    strategy,
    variant: 'deterministic',
    targetDifficulty: getTargetDifficultyRank(),
    adaptiveHint: 'Difficulty is tuned from recent performance and exam readiness.',
    lessons: ranked.map((lesson) => ({
      id: lesson.id,
      title: lesson.title,
      courseTitle: lesson.courseTitle,
      duration: lesson.duration || 20,
      type: lesson.type || 'lesson',
      difficulty: lesson.difficulty,
      tags: lesson.tags,
      goal: lesson.description?.slice(0, 140) || 'Continue your learning path with this lesson.',
      reason: lesson.completed ? 'Review completed practice.' : 'Recommended next lesson based on your current progress.',
      source: lesson.source || 'pathway',
    })),
  };

  return plan;
}

async function summarizeTextWithOllama(text: string) {
  const baseUrl = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
  try {
    const prompt = `Summarize the following German learning content into a concise paragraph that preserves the main ideas and structure. Return only the summary text, no JSON.

CONTENT:
${text}`;

    const response = await fetch(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: getOllamaModel(), prompt, stream: false, temperature: 0.2 }),
    });

    if (!response.ok) return summarizeTextMock(text);
    const data = (await response.json()) as any;
    return (data.response || "").toString().trim();
  } catch {
    return summarizeTextMock(text);
  }
}

function summarizeTextMock(text: string) {
  const sentences = text
    .replace(/\s+/g, " ")
    .trim()
    .split(/[\.\!\?]+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  return sentences.slice(0, 3).join(". ") + (sentences.length > 3 ? "." : "");
}

async function generateDailyMissionsWithOllama(profile: any) {
  const baseUrl = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
  try {
    const prompt = `Create 3 short, personalized daily missions for a German learner.\nProfile: level=${profile.level || 'unknown'}, examReadiness=${profile.examReadiness || 0}, pathway=${profile.pathway || 'general'}, streak=${profile.streak || 0}, completedLessons=${profile.completedLessons || 0}.\nReturn JSON array with objects {title, description, reward}. Keep missions practical and varied.`;

    const response = await fetch(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: getOllamaModel(), prompt, stream: false, temperature: 0.3 }),
    });

    if (!response.ok) return generateDailyMissionsMock(profile);
    const data = (await response.json()) as any;
    const text = data.response || "";
    try {
      const parsed = parseModelJson<any>(text);
      if (Array.isArray(parsed)) return parsed;
      return generateDailyMissionsMock(profile);
    } catch {
      return generateDailyMissionsMock(profile);
    }
  } catch {
    return generateDailyMissionsMock(profile);
  }
}

async function generateCourseOutlineWithOllama(courseInfo: any) {
  const baseUrl = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
  try {
    const prompt = `Create a practical German course outline for the following course.\nTitle: ${courseInfo.title}\nLevel: ${courseInfo.level || 'A2'}\nDescription: ${courseInfo.description}\nReturn valid JSON with {modules:[{title,description,lessons:[{title,description,duration,type}]}]} and include 3 modules with 2-3 lessons each.`;

    const response = await fetch(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: getOllamaModel(), prompt, stream: false, temperature: 0.3 }),
    });

    if (!response.ok) return generateCourseOutlineMock(courseInfo);
    const data = (await response.json()) as any;
    const text = data.response || "";
    try {
      const parsed = parseModelJson<any>(text);
      if (parsed?.modules && Array.isArray(parsed.modules)) return parsed;
      return generateCourseOutlineMock(courseInfo);
    } catch {
      return generateCourseOutlineMock(courseInfo);
    }
  } catch {
    return generateCourseOutlineMock(courseInfo);
  }
}

async function generateLessonPackageWithOllama(lessonData: any) {
  const baseUrl = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
  try {
    const prompt = `Create an AI-powered German lesson package based on the following input.
Title: ${lessonData.title || "New lesson"}
Level: ${lessonData.level || "A1"}
Description: ${lessonData.description || "Focus on a practical language skill."}
Audience: ${lessonData.audience || "German learners"}
Tone: ${lessonData.tone || "Friendly and gamified"}
Return valid JSON with:
  summary, objectives (array), grammarFocus (array), vocabulary (array), quizQuestions (array of {question,type,options,answer}), modules (array of {title,description,lessons:[{title,description,type,duration}]}), missions (array of {title,description,reward}).
Make the package interactive, mission-driven, and suitable for classroom or self-study.`;

    const response = await fetch(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: getOllamaModel(), prompt, stream: false, temperature: 0.3 }),
    });

    if (!response.ok) return generateLessonPackageMock(lessonData);
    const data = (await response.json()) as any;
    const text = data.response || "";
    try {
      const parsed = parseModelJson<any>(text);
      if (parsed?.summary && Array.isArray(parsed.objectives) && Array.isArray(parsed.modules)) return parsed;
      return generateLessonPackageMock(lessonData);
    } catch {
      return generateLessonPackageMock(lessonData);
    }
  } catch {
    return generateLessonPackageMock(lessonData);
  }
}

async function generateCourseOutlineWithHosted(courseInfo: any) {
  const prompt = `Create a practical German course outline for the following course.\nTitle: ${courseInfo.title}\nLevel: ${courseInfo.level || 'A2'}\nDescription: ${courseInfo.description}\nReturn valid JSON with {modules:[{title,description,lessons:[{title,description,duration,type}]}]} and include 3 modules with 2-3 lessons each.${JSON_ONLY}`;
  const raw = await callHostedText(prompt, 1200);
  const parsed = parseModelJson<any>(raw);
  if (parsed?.modules && Array.isArray(parsed.modules)) return parsed;
  return generateCourseOutlineMock(courseInfo);
}

async function generateLessonPackageWithHosted(lessonData: any) {
  const prompt = `Create an AI-powered German lesson package based on the following input.
Title: ${lessonData.title || "New lesson"}
Level: ${lessonData.level || "A1"}
Description: ${lessonData.description || "Focus on a practical language skill."}
Audience: ${lessonData.audience || "German learners"}
Tone: ${lessonData.tone || "Friendly and gamified"}
Return valid JSON with:
  summary, objectives (array), grammarFocus (array), vocabulary (array), quizQuestions (array of {question,type,options,answer}), modules (array of {title,description,lessons:[{title,description,type,duration}]}), missions (array of {title,description,reward}).
Make the package interactive, mission-driven, and suitable for classroom or self-study.${JSON_ONLY}`;
  const raw = await callHostedText(prompt, 2000);
  const parsed = parseModelJson<any>(raw);
  if (parsed?.summary && Array.isArray(parsed.objectives) && Array.isArray(parsed.modules)) return parsed;
  return generateLessonPackageMock(lessonData);
}

async function parseUploadedContentWithHosted(content: string) {
  const prompt = `Analyze this German learning content and extract structured information. Return valid JSON.

CONTENT:
${content.slice(0, 5000)}

Return this exact JSON structure:
{
  "title": "Generated title from content (max 50 chars)",
  "objectives": ["objective 1", "objective 2", "objective 3"],
  "grammarFocus": ["grammar topic 1", "grammar topic 2"],
  "vocabulary": ["word1", "word2", "word3", "word4", "word5"],
  "keyTopics": ["topic1", "topic2"],
  "suggestedLevel": "A1|A2|B1|B2|C1|C2",
  "quizQuestions": [
    {
      "question": "What is...?",
      "type": "multiple-choice",
      "options": ["option1", "option2", "option3", "option4"],
      "answer": "correct option"
    }
  ]
}

Generate 3-5 quiz questions based on the content. Be specific to German language learning.${JSON_ONLY}`;
  const raw = await callHostedText(prompt, 1400);
  const parsed = parseModelJson<any>(raw);
  if (parsed?.title && Array.isArray(parsed.objectives)) {
    return {
      title: parsed.title || "Parsed lesson",
      objectives: parsed.objectives || [],
      grammarFocus: parsed.grammarFocus || [],
      vocabulary: parsed.vocabulary || [],
      keyTopics: parsed.keyTopics || [],
      quizQuestions: parsed.quizQuestions || [],
      suggestedLevel: parsed.suggestedLevel || "A2",
    };
  }
  return parseUploadedContentMock(content);
}

function generateDailyMissionsMock(profile: any) {
  const level = (profile?.level || "B1").toString();
  const readiness = Number(profile?.examReadiness || 0);
  const streak = Number(profile?.streak || 0);

  const missions = [] as Array<{ title: string; description: string; reward: string }>;
  missions.push({
    title: "Quick grammar warmup",
    description: `Complete a 10-minute exercise focusing on case agreement and separable verbs. (${level})`,
    reward: "+20 XP",
  });

  if (readiness >= 60) {
    missions.push({
      title: "Timed writing sprint",
      description: "Write a 150-word response to a familiar prompt in 20 minutes; focus on coherence.",
      reward: "+30 XP",
    });
  } else {
    missions.push({
      title: "Vocabulary match",
      description: "Learn and use 8 topic-specific words (e.g., travel or housing) in sentences.",
      reward: "+25 XP",
    });
  }

  missions.push({
    title: streak >= 3 ? "Streak booster: speak" : "Speaking drill",
    description: streak >= 3 ? "Record a 2-minute oral summary of today's lesson and keep your streak going." : "Practice a 2-minute speaking prompt with the Tandem partner.",
    reward: "+15 XP",
  });

  return missions;
}

async function parseUploadedContentWithOllama(content: string) {
  const baseUrl = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
  try {
    const prompt = `Analyze this German learning content and extract structured information. Return valid JSON.

CONTENT:
${content.slice(0, 5000)}

Return this exact JSON structure:
{
  "title": "Generated title from content (max 50 chars)",
  "objectives": ["objective 1", "objective 2", "objective 3"],
  "grammarFocus": ["grammar topic 1", "grammar topic 2"],
  "vocabulary": ["word1", "word2", "word3", "word4", "word5"],
  "keyTopics": ["topic1", "topic2"],
  "suggestedLevel": "A1|A2|B1|B2|C1|C2",
  "quizQuestions": [
    {
      "question": "What is...?",
      "type": "multiple-choice",
      "options": ["option1", "option2", "option3", "option4"],
      "answer": "correct option"
    }
  ]
}

Generate 3-5 quiz questions based on the content. Be specific to German language learning.`;

    const response = await fetch(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: getOllamaModel(), prompt, stream: false, temperature: 0.3 }),
    });

    if (!response.ok) return parseUploadedContentMock(content);
    const data = (await response.json()) as any;
    const text = (data?.response || "{}").toString();
    const sanitizedText = text
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```$/i, "")
      .trim();

    try {
      const parsed = JSON.parse(sanitizedText);
      if (parsed?.title && Array.isArray(parsed.objectives)) {
        return {
          title: parsed.title || "Parsed lesson",
          objectives: parsed.objectives || [],
          grammarFocus: parsed.grammarFocus || [],
          vocabulary: parsed.vocabulary || [],
          keyTopics: parsed.keyTopics || [],
          quizQuestions: parsed.quizQuestions || [],
          suggestedLevel: parsed.suggestedLevel || "A2",
        };
      }
      return parseUploadedContentMock(content);
    } catch {
      return parseUploadedContentMock(content);
    }
  } catch {
    return parseUploadedContentMock(content);
  }
}

function parseUploadedContentMock(content: string) {
  // Extract a title from first line or first 50 chars
  const lines = content.split("\n").filter((l) => l.trim());
  const title = lines[0]?.slice(0, 60) || "Uploaded German Content";

  // Detect some German words for vocabulary
  const commonWords = content.match(/\b[A-Z][a-z]+\b/g) || [];
  const uniqueWords = [...new Set(commonWords)].slice(0, 8);

  // Suggest level based on content complexity
  const complexity = content.length + content.split(/[;:,]/).length;
  const suggestedLevel = complexity > 2000 ? "B1" : complexity > 1000 ? "A2" : "A1";

  return {
    title: title.replace(/[^a-zA-Z0-9\s]/g, "").slice(0, 50),
    objectives: [
      "Understand the main concepts in the provided content",
      "Practice vocabulary and grammar presented",
      "Apply knowledge in context-based exercises",
    ],
    grammarFocus: ["sentence structure", "verb conjugation", "case agreement"],
    vocabulary: uniqueWords.length > 0 ? uniqueWords : ["lernen", "sprechen", "verstehen", "schreiben", "hören"],
    keyTopics: ["language", "communication", "practice"],
    suggestedLevel,
    quizQuestions: [
      {
        question: "What is the main topic of this content?",
        type: "short-answer",
        options: undefined,
        answer: "Check the content summary",
      },
      {
        question: "Which vocabulary word appears most frequently?",
        type: "multiple-choice",
        options: uniqueWords.slice(0, 4),
        answer: uniqueWords[0] || "word",
      },
      {
        question: "True or False: The content is suitable for B1 level students.",
        type: "true-false",
        options: ["True", "False"],
        answer: suggestedLevel === "B1" ? "True" : "False",
      },
    ],
  };
}

function generateCourseOutlineMock(courseInfo: any) {
  const level = courseInfo.level || "A2";
  const title = courseInfo.title || "New German Course";
  return {
    modules: [
      {
        title: `${title} - Core Foundations`,
        description: `Introduce the ${level} concepts and vocabulary that learners need to begin confidently.`,
        lessons: [
          { title: "Foundations and key phrases", description: "Learn the most essential vocabulary and expressions.", duration: 20, type: "lesson" },
          { title: "Grammar patterns in context", description: "Practice core grammar through real examples.", duration: 25, type: "quiz" },
        ],
      },
      {
        title: `Applied Practice for ${title}`,
        description: "Move from comprehension to practical speaking and writing tasks.",
        lessons: [
          { title: "Speaking drill", description: "Practice pronunciation and fluency through a guided activity.", duration: 25, type: "lesson" },
          { title: "Written response", description: "Apply the course concepts in a short writing task.", duration: 30, type: "assignment" },
        ],
      },
      {
        title: "Review, feedback, and next steps",
        description: "Consolidate learning and prepare the next mission path.",
        lessons: [
          { title: "Self-check quiz", description: "Test your understanding with a quick assessment.", duration: 20, type: "quiz" },
          { title: "Reflection and improvement", description: "Review strengths and plan the next lesson.", duration: 15, type: "lesson" },
        ],
      },
    ],
  };
}

function generateLessonPackageMock(lessonData: any) {
  const title = lessonData.title || "AI lesson package";
  const description = lessonData.description || "A lesson designed to build German skills.";
  return {
    summary: `This lesson package turns ${title} into a compact, task-driven learning path.`,
    objectives: [
      `Understand the key grammar unit in ${title}`,
      "Practice vocabulary with context-rich examples",
      "Complete a speaking prompt and a short quiz",
    ],
    grammarFocus: ["modal verbs", "separable verbs", "sentence order"],
    vocabulary: ["Reisen", "Bewerbung", "Gespräch", "Freizeit"],
    modules: [
      {
        title: "Warm-up and vocabulary",
        description: "Introduce the key words and expressions needed for the lesson.",
        lessons: [
          { title: "Key vocabulary", description: "Learn the most important words and phrases.", type: "lesson", duration: 20 },
          { title: "Sentence examples", description: "See the vocabulary in natural German sentences.", type: "lesson", duration: 15 },
        ],
      },
      {
        title: "Core practice",
        description: "Work through the lesson's grammar and speaking activities.",
        lessons: [
          { title: "Grammar focus", description: "Practice the target grammar with examples.", type: "quiz", duration: 25 },
          { title: "Speaking prompt", description: "Record or speak the key sentence pattern aloud.", type: "assignment", duration: 20 },
        ],
      },
      {
        title: "Review and challenge",
        description: "Reflect on what you learned and test your understanding.",
        lessons: [
          { title: "Reflection task", description: "Answer a short follow-up question in German.", type: "assignment", duration: 20 },
          { title: "Challenge quiz", description: "Check comprehension with a quick quiz.", type: "quiz", duration: 20 },
        ],
      },
    ],
    missions: [
      { title: "Vocabulary mission", description: "Use 6 new words in speaking or writing.", reward: "+30 XP" },
      { title: "Grammar mission", description: "Complete the grammar drill and check the answer key.", reward: "+35 XP" },
      { title: "Speaking mission", description: "Practice the prompt aloud and compare your recording.", reward: "+25 XP" },
    ],
  };
}

/**
 * Which model answers, and why it depends on who is waiting.
 *
 * ---------------------------------------------------------------------------
 * THE SPLIT
 *
 * There is no single right provider for this product, because the two kinds of
 * AI work here have opposite requirements.
 *
 *   INTERACTIVE — a student has tapped something and is watching a spinner:
 *   pronunciation, essay grading, missions, practice feedback. On this
 *   school's hardware a local 7B model takes the better part of a minute per
 *   answer. A teenager on a phone does not wait fifty seconds; they conclude
 *   it is broken and stop using the feature. These go to the hosted model.
 *
 *   BACK OFFICE — nobody is watching, or the wait is expected: parsing an
 *   uploaded PDF into a lesson, drafting a course outline. These are slow
 *   anyway, they are the most expensive calls (whole documents), and they run
 *   on material the school already owns. These prefer LOCAL, so the school's
 *   own teaching material never leaves the building and the bill does not
 *   scale with how much a tutor uploads.
 *
 * The old function had no notion of this — one global race, hosted first — so
 * every call went to Anthropic the moment a key existed, including document
 * parsing, and Ollama was fourth in a queue it never reached. The school had
 * installed Ollama specifically to keep this work local.
 *
 * ---------------------------------------------------------------------------
 * OVERRIDE
 *
 * `AI_PROVIDER` forces one provider for everything, which is what you want
 * when testing that a fallback path still works, or when the office is
 * offline and everything must run locally. Otherwise the workload decides.
 */
export type AiWorkload =
  /** Somebody is watching a spinner. Speed wins. */
  | "interactive"
  /** Nobody is waiting. Privacy and cost win. */
  | "backoffice"
  /** A learner is waiting for a tailored plan or quest. */
  | "student";

type Provider = "claude" | "groq" | "ollama" | "deepseek" | "anythingllm" | "mock";

function hasKey(value: string | undefined): boolean {
  return Boolean(value && !value.startsWith("sk-placeholder"));
}

/**
 * Claude first when funded (best quality), then Groq — free, fast, no local
 * RAM needed, which is what actually unblocks production on a school laptop
 * with no server budget — then DeepSeek.
 */
function hostedProvider(): Provider | null {
  if (hasKey(process.env.ANTHROPIC_API_KEY)) return "claude";
  if (hasKey(process.env.GROQ_API_KEY)) return "groq";
  if (hasKey(process.env.DEEPSEEK_API_KEY)) return "deepseek";
  return null;
}

/**
 * Is this a local model URL that cannot possibly resolve from where we run?
 *
 * `localhost` on a laptop is the office machine. `localhost` on Vercel is the
 * serverless container, which has no Ollama in it and never will. The two are
 * indistinguishable from the string alone, so the deployment target decides.
 *
 * This exists because the obvious thing to do when deploying is to paste
 * `.env.local` into the hosting dashboard, and `OLLAMA_BASE_URL` comes along
 * with everything else. Without this check the back-office workloads would keep
 * choosing a model at an address that refuses every connection, and essay
 * grading would fail in a way that looks like the grader being broken rather
 * than like a setting that came along for the ride.
 */
function isUnreachableLocalUrl(url: string | undefined): boolean {
  if (!url) return true;
  const serverless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
  if (!serverless) return false;
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:|\/|$)/i.test(url.trim());
}

/** True when a local model runtime could actually be spoken to from here. */
export function localModelAvailable(): boolean {
  return localProvider() !== null;
}

function localProvider(): Provider | null {
  if (process.env.ANYTHINGLLM_BASE_URL && !isUnreachableLocalUrl(process.env.ANYTHINGLLM_BASE_URL)) {
    return "anythingllm";
  }
  if (process.env.OLLAMA_BASE_URL && !isUnreachableLocalUrl(process.env.OLLAMA_BASE_URL)) {
    return "ollama";
  }
  return null;
}

function getAIProvider(workload: AiWorkload = "interactive"): Provider {
  const forced = String(process.env.AI_PROVIDER ?? "").toLowerCase();
  if (forced === "claude" || forced === "groq" || forced === "ollama" || forced === "deepseek" || forced === "anythingllm" || forced === "mock") {
    return forced;
  }

  // Admin authoring uses the office Ollama runtime when available, then Groq
  // on Vercel, keeping Claude reserved for student learning.
  if (workload === "backoffice") {
    return localProvider() ?? (hasKey(process.env.GROQ_API_KEY) ? "groq" : null) ??
      (hasKey(process.env.DEEPSEEK_API_KEY) ? "deepseek" : null) ??
      "mock";
  }

  // Student-facing recommendations use Claude when configured. Local models
  // remain reserved for staff and background authoring work.
  if (workload === "student") {
    return hasKey(process.env.ANTHROPIC_API_KEY)
      ? "claude"
      : (hasKey(process.env.GROQ_API_KEY) ? "groq" : null) ??
          (hasKey(process.env.DEEPSEEK_API_KEY) ? "deepseek" : "mock");
  }

  /**
   * LOCAL FIRST, for every workload — not just the back office.
   *
   * This used to prefer the hosted model for anything a student waits on,
   * which is the right instinct when the hosted account is funded. This one is
   * not: the API answers "credit balance is too low", `callClaude` returns
   * null, and every caller falls through to its canned response. The result
   * was worse than having no hosted key at all, because a key being *present*
   * is what made it preferred.
   *
   * The school's decision is no monthly bill and no rented server, so the work
   * is arranged to be small enough not to need one — see src/lib/ai-cache.ts,
   * which turns roughly 1,300 generations a day into about twenty. At that
   * volume a local model, or a free hosted tier, is genuinely enough.
   *
   * A hosted provider is still used when there is no local runtime reachable,
   * so a deployment with a funded key configured keeps working. `AI_PROVIDER`
   * overrides all of it.
   */
  return localProvider() ?? hostedProvider() ?? "mock";
}

/**
 * Which model is actually going to answer, for logging and for the cache row.
 *
 * Worth recording alongside every generated answer: when a batch of summaries
 * comes back useless, the first question is which model produced them, and
 * without this the answer is a guess about what the environment looked like
 * that week.
 */
export function activeModelName(workload: AiWorkload = "interactive"): string {
  const provider = getAIProvider(workload);
  if (provider === "claude") return CLAUDE_MODEL;
  if (provider === "groq") return GROQ_MODEL;
  if (provider === "ollama" || provider === "anythingllm") return getOllamaModel();
  return provider;
}

/**
 * Ask whichever model is reachable, and give back its raw text.
 *
 * One entry point, so a new feature cannot accidentally hardcode a provider
 * the way the daily missions did — that mistake cost this school every
 * personalised mission it was supposed to have been generating.
 *
 * Returns null on any failure. Callers decide what to do without it; for the
 * background jobs the answer is always "leave it for the next run", never
 * "write a placeholder into the database as though it were real output".
 */
export async function callModel(prompt: string, maxTokens = 800, workload: AiWorkload = "interactive"): Promise<string | null> {
  const provider = getAIProvider(workload);

  if (provider === "claude" || provider === "groq" || provider === "deepseek") {
    return callHostedText(prompt, maxTokens);
  }
  if (provider === "ollama" || provider === "anythingllm") {
    return callLocalModel(getOllamaModel(), prompt, 0.4);
  }
  return null;
}

async function callLocalModel(model: string, prompt: string, temperature = 0.2) {
  // Try AnythingLLM first, then Ollama. If the configured model fails, try without specifying a model
  // and then attempt any fallback model names from OLLAMA_FALLBACK_MODELS.
  const anythingBase = process.env.ANYTHINGLLM_BASE_URL;
  const ollamaBase = process.env.OLLAMA_BASE_URL;
  const fallbackModels = (process.env.OLLAMA_FALLBACK_MODELS || "").split(',').map(s => s.trim()).filter(Boolean);

  const tryEndpoint = async (baseUrl: string, payload: any) => {
    try {
      const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) return null;
      const data = await res.json();
      // Common response shapes: { response: "..." } or { output: [{ content: [{ text: '...' }] }] }
      if (data.response) return data.response;
      if (data.output && Array.isArray(data.output) && data.output[0]?.content) {
        const txt = data.output[0].content.map((c: any) => c.text || c).join("\n");
        return txt;
      }
      // fallback to first string property
      for (const k of Object.keys(data)) {
        if (typeof data[k] === 'string') return data[k];
      }
      return null;
    } catch (err) {
      return null;
    }
  };

  const payloadWithModel = { model, prompt, stream: false, temperature };
  const payloadNoModel = { prompt, stream: false, temperature };

  // 1) Try configured model on AnythingLLM / Ollama
  if (anythingBase) {
    const out = await tryEndpoint(anythingBase, payloadWithModel);
    if (out) return out;
  }
  if (ollamaBase) {
    const out = await tryEndpoint(ollamaBase, payloadWithModel);
    if (out) return out;
  }

  // 2) Try without specifying a model (let server default)
  if (anythingBase) {
    const out = await tryEndpoint(anythingBase, payloadNoModel);
    if (out) return out;
  }
  if (ollamaBase) {
    const out = await tryEndpoint(ollamaBase, payloadNoModel);
    if (out) return out;
  }

  // 3) Try fallback model names if provided
  for (const fb of fallbackModels) {
    if (!fb) continue;
    if (anythingBase) {
      const out = await tryEndpoint(anythingBase, { model: fb, prompt, stream: false, temperature });
      if (out) return out;
    }
    if (ollamaBase) {
      const out = await tryEndpoint(ollamaBase, { model: fb, prompt, stream: false, temperature });
      if (out) return out;
    }
  }

  // 4) As a final fallback, try running the Ollama CLI directly (works when HTTP API shape differs)
  try {
    const cliOut = await callOllamaCli(model, prompt);
    if (cliOut) return cliOut;
  } catch {
    // ignore
  }

  return null;
}

// Run the local Ollama CLI as a fallback when HTTP endpoints don't return usable content.
// This executes: `ollama run <model> <prompt> --format json --nowordwrap` and attempts to extract
// the model output from the CLI JSON.
async function callOllamaCli(model: string, prompt: string) {
  try {
    // There is no `ollama` binary in a serverless container, and spawnSync
    // blocks the event loop for its full 20s timeout finding that out.
    if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) return null;

    // Use spawnSync via child_process to run the CLI synchronously
    const { spawnSync } = await import('child_process');
    const args = ['run', model, prompt, '--format', 'json', '--nowordwrap'];
    const res = spawnSync('ollama', args, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024, timeout: 20000 });
    if (res.error) return null;
    const stdout = (res.stdout || '').toString().trim();
    if (!stdout) return null;

    // Try to find a JSON object inside the CLI output that likely contains the model response.
    // Prefer fields like `response`, `output`, or nested text content. If we find a JSON substring,
    // parse and extract the most likely text field.
    const tryParse = (s: string) => {
      try {
        return JSON.parse(s);
      } catch {
        return null;
      }
    };

    // 1) Try parsing entire stdout as JSON
    let parsed = tryParse(stdout);
    if (parsed) {
      // common shapes: { response: '...', output: [{ content: [{ text: '...' }] }] }
      if (typeof parsed === 'string') return parsed;
      if (parsed.response && typeof parsed.response === 'string') return parsed.response;
      if (parsed.output && Array.isArray(parsed.output) && parsed.output[0]?.content) {
        const txt = parsed.output[0].content.map((c: any) => c.text || c).join('\n');
        if (txt) return txt;
      }
      if (parsed.prompt && typeof parsed.prompt === 'string') {
        // Some CLI JSON contains the final text under `prompt` (observed in some versions)
        return parsed.prompt;
      }
      // Fall back to stringifying the parsed JSON
      return JSON.stringify(parsed);
    }

    // 2) Attempt to extract a JSON substring that contains the expected keys (prompt, feedback, score)
    const match = stdout.match(/\{[\s\S]*?(?:"prompt"|"feedback"|"score")[\s\S]*?\}/);
    if (match) {
      parsed = tryParse(match[0]);
      if (parsed) {
        if (parsed.response && typeof parsed.response === 'string') return parsed.response;
        if (parsed.prompt && typeof parsed.prompt === 'string') return parsed.prompt;
        return match[0];
      }
    }

    // 3) As a last resort, return the raw stdout (model text is often present directly)
    return stdout;
  } catch (err) {
    return null;
  }
}

function getOllamaModel() {
  return process.env.OLLAMA_MODEL || "mistral:latest";
}

async function generateNextStepsWithClaude(score: number, feedback: Array<{ category: string; comment: string; score: number }>, essay: string): Promise<string> {
  const text = await callHostedText(
    `Based on a German essay scored at ${score}/100 with these feedback categories: ${feedback.map((f) => `${f.category}: ${f.score}/100`).join(", ")}, provide ONE specific, actionable next step to improve from ${score} to ${score + 10} points. Keep it to one concise sentence. Reply with the sentence and nothing else.`,
    256,
  );
  return text || generateNextStepsMock(score, feedback);
}

async function generateNextStepsWithDeepSeek(score: number, feedback: Array<{ category: string; comment: string; score: number }>, essay: string): Promise<string> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return generateNextStepsMock(score, feedback);

  try {
    const response = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [
          {
            role: "user",
            content: `Based on a German essay scored at ${score}/100 with feedback: ${feedback.map((f) => `${f.category} (${f.score}/100)`).join(", ")}, suggest ONE specific next step to improve. Keep to one concise sentence.`,
          },
        ],
        temperature: 0.3,
        max_tokens: 150,
      }),
    });

    if (!response.ok) return generateNextStepsMock(score, feedback);
    const data = (await response.json()) as any;
    return data.choices[0]?.message?.content || generateNextStepsMock(score, feedback);
  } catch {
    return generateNextStepsMock(score, feedback);
  }
}

async function generateNextStepsWithOllama(score: number, feedback: Array<{ category: string; comment: string; score: number }>, essay: string): Promise<string> {
  const baseUrl = process.env.OLLAMA_BASE_URL || "http://localhost:11434";

  try {
    const response = await fetch(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: getOllamaModel(),
        prompt: `German essay scored ${score}/100. Feedback: ${feedback.map((f) => `${f.category}: ${f.comment}`).join("; ")}. Suggest ONE actionable next step in one sentence to improve to ${score + 10} points.`,
        stream: false,
        temperature: 0.2,
      }),
    });

    if (!response.ok) return generateNextStepsMock(score, feedback);
    const data = (await response.json()) as any;
    return data.response?.trim() || generateNextStepsMock(score, feedback);
  } catch {
    return generateNextStepsMock(score, feedback);
  }
}

function generateNextStepsMock(score: number, feedback: Array<{ category: string; comment: string; score: number }>): string {
  const weakestCategory = feedback.sort((a, b) => a.score - b.score)[0];
  if (!weakestCategory) return "Keep practicing and focus on variety in your writing.";

  const suggestions: Record<string, string[]> = {
    "Grammar": [
      "Focus on case agreement in accusative and dative constructions.",
      "Practice complex subordinate clause structures with 'obwohl' and 'weil'.",
      "Work on conditional forms (Konjunktiv II) for hypothetical statements.",
    ],
    "Vocabulary": [
      "Expand your connectives beyond 'und' and 'aber'—try 'nichtsdestotrotz', 'infolgedessen'.",
      "Learn topic-specific vocabulary for your exam domain.",
      "Practice using synonyms to avoid repetition.",
    ],
    "Task Completion": [
      "Add a clear introduction that directly addresses the prompt.",
      "Strengthen your conclusion with a summary of key arguments.",
      "Ensure all parts of the task are covered in your response.",
    ],
    "Structure": [
      "Use clear topic sentences at the start of each paragraph.",
      "Improve transitions between ideas using German transition words.",
      "Organize your essay with a logical three-part structure: intro, body, conclusion.",
    ],
  };

  const categoryKey = weakestCategory.category.split(" ")[0];
  const suggestions_for_category = suggestions[categoryKey] || suggestions["Vocabulary"];
  return suggestions_for_category[Math.floor(Math.random() * suggestions_for_category.length)];
}

// Hosted implementation — Claude, Groq or DeepSeek, whichever `callHostedText` finds configured.
async function gradeEssayWithClaude(essay: string) {
  const raw = await callHostedText(
    `Grade this German essay at B2 exam standard. Return JSON with:
{
  "score": (0-100),
  "feedback": [
    {"category": "Grammar", "comment": "...", "score": (0-100)},
    {"category": "Vocabulary", "comment": "...", "score": (0-100)},
    {"category": "Structure", "comment": "...", "score": (0-100)},
    {"category": "Spelling", "comment": "...", "score": (0-100)}
  ],
  "summary": "Overall assessment..."
}

Essay to grade:
${essay}${JSON_ONLY}`,
    1024,
  );

  const parsed = parseJsonReply<{
    score?: number;
    feedback?: Array<{ category: string; comment: string; score: number }>;
    summary?: string;
  }>(raw);
  if (!parsed) return gradeEssayMock(essay);

  return {
    score: parsed.score || 75,
    feedback: parsed.feedback || [],
    summary: parsed.summary || "Essay graded by Claude AI.",
  };
}

async function analyzePronunciationWithClaude(phrase: string) {
  const raw = await callHostedText(
    `Analyze this German phrase for pronunciation coaching. Return JSON:
{
  "transcription": "correct spelling/transcription",
  "issues": ["issue1", "issue2"],
  "corrections": ["correction1", "correction2"],
  "confidence": (0-100)
}

Phrase: ${phrase}${JSON_ONLY}`,
    512,
  );

  const parsed = parseJsonReply<{
    transcription?: string;
    issues?: string[];
    corrections?: string[];
    confidence?: number;
  }>(raw);
  if (!parsed) return analyzePronunciationMock(phrase);

  return {
    transcription: parsed.transcription || phrase,
    issues: parsed.issues || [],
    corrections: parsed.corrections || [],
    confidence: parsed.confidence || 85,
  };
}

// Ollama Implementation (local)
async function gradeEssayWithOllama(essay: string) {
  const baseUrl = process.env.OLLAMA_BASE_URL || "http://localhost:11434";

  try {
    const response = await fetch(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: getOllamaModel(),
        prompt: `Grade this German essay at B2 exam standard. Return only valid JSON with score (0-100), feedback array, and summary. Example output:
{"score":80,"feedback":[{"category":"Grammar","comment":"...","score":78}],"summary":"..."}
Essay:
${essay}`,
        stream: false,
        temperature: 0.1,
      }),
    });

    if (!response.ok) return gradeEssayMock(essay);

    const data = await response.json() as any;
    const text = data.response || "{}";

    try {
      const parsed = parseModelJson<any>(text);
      if (!parsed) throw new Error("unparseable");
      return {
        score: parsed.score || 75,
        feedback: parsed.feedback || [],
        summary: parsed.summary || "Essay graded by Ollama.",
      };
    } catch {
      return gradeEssayMock(essay);
    }
  } catch {
    return gradeEssayMock(essay);
  }
}

async function analyzePronunciationWithOllama(phrase: string) {
  const baseUrl = process.env.OLLAMA_BASE_URL || "http://localhost:11434";

  try {
    const response = await fetch(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: getOllamaModel(),
        prompt: `Analyze German pronunciation for: ${phrase}. Return only valid JSON with fields transcription, issues, corrections, and confidence. Example output:\n{"transcription":"...","issues":["..."],"corrections":["..."],"confidence":85}`,
        stream: false,
        temperature: 0.1,
      }),
    });

    if (!response.ok) return analyzePronunciationMock(phrase);

    const data = await response.json() as any;
    const text = data.response || "{}";

    try {
      const parsed = parseModelJson<any>(text);
      if (!parsed) throw new Error("unparseable");
      return {
        transcription: parsed.transcription || phrase,
        issues: parsed.issues || [],
        corrections: parsed.corrections || [],
        confidence: parsed.confidence || 80,
      };
    } catch {
      return analyzePronunciationMock(phrase);
    }
  } catch {
    return analyzePronunciationMock(phrase);
  }
}

// Mock Responses (fallback)
function gradeEssayMock(essay: string) {
  const hasGrammarErrors = essay.split(" ").length < 10;
  const score = hasGrammarErrors ? 65 : 82;

  return {
    score,
    feedback: [
      {
        category: "Grammar & Structure",
        comment:
          "Good use of subordinate clauses. Watch for case agreement in accusative constructions.",
        score: score - 5,
      },
      {
        category: "Vocabulary",
        comment: "Adequate B2-level vocabulary. Consider more sophisticated connectives.",
        score: score,
      },
      {
        category: "Task Completion",
        comment: "All requirements addressed. Flow could be improved between paragraphs.",
        score: score + 3,
      },
      {
        category: "Spelling & Mechanics",
        comment: "Minor spacing issues. Overall clean presentation.",
        score: score - 2,
      },
    ],
    summary: `Score: ${score}/100. Your essay demonstrates solid B2 competency with clear structure and appropriate vocabulary. Focus on varying sentence complexity and refining grammatical accuracy for C1-level writing.`,
  };
}

function analyzePronunciationMock(phrase: string) {
  return {
    transcription: phrase,
    issues: [
      "Slight vowel elongation in 'Visum'",
      "Initial consonant could be crisper",
    ],
    corrections: [
      "Pronounce 'Visum' with shorter vowels: VIZ-um",
      'Start with clear "Ich" - clear "ich" sound',
    ],
    confidence: 78,
  };
}
