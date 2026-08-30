import { parseModelJson } from "@/lib/safe-json";
import type { AzurePronunciationAssessment } from "@/lib/azure-pronunciation";
import type { CoachingMemorySummary } from "@/lib/voice-coach-memory";
import { levelRank, pickExploration, styleAdjustment, type LearningStyle } from "@/lib/learner-style";

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
/**
 * TWO MODELS, CHOSEN BY WHETHER ANYBODY IS WAITING.
 *
 * Measured, not assumed: marking one short essay took ~50 SECONDS on the Opus
 * tier against a 60-second function ceiling (see vercel.json). Ten seconds of
 * headroom is not headroom — a longer essay times out, and because the timeout
 * falls through to the mock grader it does so SILENTLY, which is precisely the
 * failure this file has now suffered twice.
 *
 * So anything a learner sits and waits for goes to the Sonnet tier, which is
 * roughly three times faster and is the tier this code was written against in
 * the first place. Work nobody is watching — the admin email composer drafting
 * a newsletter — keeps the Opus tier, because there the extra minute costs
 * nothing and the quality is worth having.
 */
const CLAUDE_MODEL_FAST = "claude-sonnet-5";
const CLAUDE_MODEL_DEEP = "claude-opus-5";

/**
 * Interactive is the DEFAULT, deliberately. A caller that forgets to say which
 * it is, is far more likely to be one with a student in front of it, and the
 * cost of guessing wrong that way is a slower answer rather than a timeout.
 */
function claudeModelFor(workload: AiWorkload = "interactive"): string {
  return workload === "backoffice" ? CLAUDE_MODEL_DEEP : CLAUDE_MODEL_FAST;
}

/**
 * Never send a budget so small the answer cannot fit.
 *
 * A ceiling, not a target — a grader asked for forty words still returns forty
 * words and is billed for forty. This only stops a 256-token budget truncating
 * a JSON reply mid-object, which surfaces as a parse failure and a silent fall
 * back to the mock.
 */
const CLAUDE_MIN_TOKENS = 1024;

/**
 * Appended to every Claude prompt. Cheap insurance, and specifically the
 * mitigation the API docs give for running with thinking switched off.
 *
 * Deliberately generic: naming the tags one does not want is documented to
 * make the leak MORE likely, not less.
 */
const TAG_GUARD = "\n\nDo not include internal or system XML tags in your response.";

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
async function callHostedText(
  prompt: string,
  maxTokens: number,
  workload: AiWorkload = "interactive",
): Promise<string | null> {
  if (hasKey(process.env.ANTHROPIC_API_KEY)) return callClaude(prompt, maxTokens, workload);
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

    // DeepSeek is a real paid API (unlike Groq's free tier) — meter it the
    // same way callClaude meters Anthropic, or its spend goes untracked.
    const used = (data.usage?.prompt_tokens ?? 0) + (data.usage?.completion_tokens ?? 0);
    if (used > 0 && data.id) {
      const { recordUsage } = await import("@/lib/usage/record");
      void recordUsage({
        meter: "ai.tokens",
        quantity: used,
        sourceId: `deepseek:${data.id}`,
        metadata: { model: "deepseek-chat" },
      });
    }

    return data.choices?.[0]?.message?.content?.trim() || null;
  } catch {
    return null;
  }
}

async function callClaude(
  prompt: string,
  maxTokens: number,
  workload: AiWorkload = "interactive",
): Promise<string | null> {
  const model = claudeModelFor(workload);
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
      /**
       * THIS REQUEST SHAPE IS VERSION-SENSITIVE, AND IT HAS BITTEN TWICE.
       *
       * The note above CLAUDE_MODEL_FAST records the first time: a retired id
       * left every call 404ing into the mock grader, invisibly, because the
       * mock is deliberately plausible. It happened AGAIN with the successor —
       * `claude-sonnet-4-20250514` was equally retired, and every Claude
       * feature in this app (essay marking, pronunciation, email drafting) was
       * silently mocked until somebody read the server log.
       *
       * Two things changed on current models and both are hard failures:
       *
       *   `temperature` IS REJECTED. Not ignored — a 400. It was set to 0.2
       *   here to keep graders consistent; consistency now comes from the
       *   prompt and from `effort`.
       *
       *   THINKING IS NOW ON BY DEFAULT, and it is not free. Left on, essay
       *   grading measured 43 SECONDS against roughly nine with it off — and
       *   the note at the top of this function is a product requirement, not a
       *   preference: a student is sitting on a page waiting for this. So it
       *   stays off, at low effort, which the model accepts.
       *
       *   The documented cost of switching thinking off is that reasoning can
       *   occasionally leak into the visible answer as XML-ish tags. For the
       *   JSON callers `JSON_ONLY` already forbids exactly that; TAG_GUARD
       *   below says the same thing to the prose callers, which had nothing.
       *   The other documented failure — a tool call written as text instead
       *   of a tool_use block — cannot arise here: not one caller in this file
       *   sends tools.
       */
      body: JSON.stringify({
        model,
        max_tokens: Math.max(maxTokens, CLAUDE_MIN_TOKENS),
        thinking: { type: "disabled" },
        output_config: { effort: "low" },
        messages: [{ role: "user", content: `${prompt}${TAG_GUARD}` }],
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
        metadata: { model },
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

const GERMAN_ACOUSTIC_COACHING_CONTEXT = `
Acoustic coaching context for German:
- There is no single frequency that identifies German, and these measurements do not
  prove a phoneme, accent, or native-speaker identity. Treat them as speaker-relative
  evidence, not universal thresholds.
- Use estimated pitch and its confidence for intonation, prominence, and question-like
  movement only when the recording is long and voiced enough. Do not equate pitch with
  correctness.
- Use duration and RMS for pacing, pauses, and loudness consistency. Do not infer effort
  or confidence from loudness alone.
- Use zero-crossing rate, spectral centroid, and the low/mid/high band ratios as broad
  proxies for frication, aspiration, and spectral brightness. They can be strongly
  affected by the microphone, room, compression, and background noise.
- German-relevant patterns to discuss cautiously include vowel length contrasts, clear
  final consonants, /ç/ versus /x/ in ich/machen contexts, /ʁ/ variation, and lexical
  stress. These acoustic summaries cannot locate those sounds in time or replace forced
  alignment; only mention them when the transcript and the measurements jointly support
  a useful drill.
`;

export async function gradeEssay(essay: string): Promise<{
  score: number;
  feedback: Array<{ category: string; comment: string; score: number }>;
  strengths: string[];
  growthAreas: string[];
  achievementTitle: string | null;
  summary: string;
}> {
  // "student", not the default "interactive": a funded Claude key must not be
  // shadowed by a local Ollama runtime that happens to be reachable — see the
  // same note on analyzePronunciation.
  const provider = getAIProvider("student");

  if (provider === "claude" || provider === "groq" || provider === "deepseek") {
    return gradeEssayWithClaude(essay);
  } else if (provider === "ollama") {
    return gradeEssayWithOllama(essay);
  } else {
    return gradeEssayMock(essay);
  }
}

/**
 * Grades a short (2-3 sentence) in-scene German writing response from a
 * personalized story beat — e.g. a handover note in the care/nursing
 * chapter. Deliberately a separate function from gradeEssay rather than a
 * reused call: gradeEssay's rubric (Grammar/Vocabulary/Structure/Spelling
 * categories, a full "summary" paragraph) is built for a multi-paragraph
 * exam-style essay, and asking it to grade two sentences the same way
 * produces feedback that doesn't fit what the student actually wrote.
 */
export async function gradeStoryWriting(input: {
  prompt: string;
  promptGerman?: string;
  response: string;
  goalId: string;
  sceneTitle: string;
}): Promise<{ score: number; feedback: string; corrections: string[]; achievementTitle: string | null }> {
  const provider = getAIProvider("student");

  if (provider === "claude" || provider === "groq" || provider === "deepseek") {
    return gradeStoryWritingWithClaude(input);
  } else if (provider === "ollama") {
    return gradeStoryWritingWithOllama(input);
  } else {
    return gradeStoryWritingMock(input);
  }
}

export async function analyzePronunciation(
  phrase: string,
  expectedPhrase = phrase,
  acousticFeatures: Record<string, number> | null = null,
  azureAssessment: AzurePronunciationAssessment | null = null,
  coachingMemory: CoachingMemorySummary | null = null,
): Promise<{
  transcription: string;
  issues: string[];
  corrections: string[];
  confidence: number;
  nextPractice?: string;
  practicePhrase?: string;
  wordAccuracy?: number;
  missingWords?: string[];
  extraWords?: string[];
  pronunciationScore?: number | null;
  weakWords?: Array<{ word: string; accuracyScore: number; errorType: string }>;
  achievementTitle?: string | null;
}> {
  const wordComparison = comparePronunciationWords(phrase, expectedPhrase);
  // "student" workload, not the default "interactive" one: this feature is a
  // funded Claude call the school specifically wants powering it, and
  // "interactive" prefers a local Ollama runtime when one happens to be
  // reachable (see getAIProvider) — which would quietly hand a premium
  // feature to whatever is running on a dev machine instead. "student"
  // checks ANTHROPIC_API_KEY first, unconditionally.
  const provider = getAIProvider("student");

  if (provider === "claude" || provider === "groq" || provider === "deepseek") {
    return analyzePronunciationWithClaude(phrase, expectedPhrase, wordComparison, acousticFeatures, azureAssessment, coachingMemory);
  } else if (provider === "ollama") {
    return analyzePronunciationWithOllama(phrase, expectedPhrase, wordComparison);
  } else {
    return analyzePronunciationMock(phrase, wordComparison);
  }
}

type PronunciationWordComparison = {
  accuracy: number;
  missingWords: string[];
  extraWords: string[];
};

function comparePronunciationWords(spoken: string, target: string): PronunciationWordComparison {
  const clean = (value: string) => value.toLocaleLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const targetWords = clean(target).split(/\s+/).filter(Boolean);
  const spokenWords = clean(spoken).split(/\s+/).filter(Boolean);
  const rows = Array.from({ length: targetWords.length + 1 }, () => Array<number>(spokenWords.length + 1).fill(0));

  for (let targetIndex = 1; targetIndex <= targetWords.length; targetIndex += 1) {
    for (let spokenIndex = 1; spokenIndex <= spokenWords.length; spokenIndex += 1) {
      rows[targetIndex][spokenIndex] = targetWords[targetIndex - 1] === spokenWords[spokenIndex - 1]
        ? rows[targetIndex - 1][spokenIndex - 1] + 1
        : Math.max(rows[targetIndex - 1][spokenIndex], rows[targetIndex][spokenIndex - 1]);
    }
  }

  const missingWords: string[] = [];
  const extraWords: string[] = [];
  let targetIndex = targetWords.length;
  let spokenIndex = spokenWords.length;
  while (targetIndex > 0 || spokenIndex > 0) {
    if (targetIndex > 0 && spokenIndex > 0 && targetWords[targetIndex - 1] === spokenWords[spokenIndex - 1]) {
      targetIndex -= 1;
      spokenIndex -= 1;
    } else if (targetIndex > 0 && (spokenIndex === 0 || rows[targetIndex - 1][spokenIndex] >= rows[targetIndex][spokenIndex - 1])) {
      missingWords.unshift(targetWords[targetIndex - 1]);
      targetIndex -= 1;
    } else {
      extraWords.unshift(spokenWords[spokenIndex - 1]);
      spokenIndex -= 1;
    }
  }

  return {
    accuracy: targetWords.length ? Math.round((rows[targetWords.length][spokenWords.length] / targetWords.length) * 100) : 0,
    missingWords,
    extraWords,
  };
}

export async function generateEssayNextSteps(score: number, feedback: Array<{ category: string; comment: string; score: number }>, essay: string): Promise<string> {
  // "student", not "interactive" — see gradeEssay above.
  const provider = getAIProvider("student");
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
  // "student", not "interactive" — see gradeEssay above.
  const provider = getAIProvider("student");

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
  const provider = getAIProvider("learning-content");
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
  const provider = getAIProvider("learning-content");
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
 * "Suggest times" for a private-class booking — fills the candidate chips a
 * tutor or admin can click, never books anything itself. Same non-destructive
 * shape as `draftClassAnnouncement`: the model proposes, a human still picks
 * one and presses the real book button.
 *
 * The route re-checks every suggestion against the tutor's live bookings
 * before showing it — a model can still propose a time it was told to avoid,
 * and the actual conflict check belongs to the database, not the prompt.
 */
export async function suggestPrivateClassTimes(input: {
  studentName?: string | null;
  dayRanges: { day: string; ranges: { start: string; end: string }[] }[];
  durationMinutes: number;
  timezone?: string | null;
  busyTimes: string[];
  now: string;
}): Promise<{ suggestions: { scheduledAt: string; reason: string }[] } | null> {
  const prefText = input.dayRanges.length
    ? input.dayRanges.map((d) => `${d.day}: ${d.ranges.map((r) => `${r.start}-${r.end}`).join(", ")}`).join("; ")
    : "no preferences shared yet";
  const busyText = input.busyTimes.length ? input.busyTimes.join(", ") : "none";

  const prompt = `You are helping schedule a one-to-one German class for ${input.studentName ?? "a private student"}.

Student's stated availability (day: time ranges, their own local time${input.timezone ? `, ${input.timezone}` : ""}):
${prefText}

Session length: ${input.durationMinutes} minutes.
Right now (ISO, for reference): ${input.now}
The tutor already has sessions booked at these times — do not suggest anything within 2 hours of any of these: ${busyText}

Suggest exactly 3 candidate session start times over the next 14 days that fall inside the student's stated availability, avoid the tutor's existing bookings, and are spread across different days rather than clustered on one.

Return JSON: {"suggestions": [{"scheduledAt": "<ISO 8601 datetime>", "reason": "<one short clause, e.g. \\"Matches their Tuesday evening slot\\">"}]}${JSON_ONLY}`;

  const parsed = parseJsonReply<{ suggestions?: unknown }>(await callClaude(prompt, 500));
  if (!parsed || !Array.isArray(parsed.suggestions)) return null;

  const suggestions = parsed.suggestions
    .filter((s): s is Record<string, unknown> => !!s && typeof s === "object")
    .map((s) => ({
      scheduledAt: typeof s.scheduledAt === "string" ? s.scheduledAt : "",
      reason: typeof s.reason === "string" ? s.reason.trim().slice(0, 140) : "",
    }))
    .filter((s) => s.scheduledAt && !Number.isNaN(new Date(s.scheduledAt).getTime()))
    .slice(0, 3);

  return suggestions.length > 0 ? { suggestions } : null;
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
    { id: "claude", label: "Claude", available: claude, detail: claude ? `${CLAUDE_MODEL_DEEP} — best prose, costs per send` : "No ANTHROPIC_API_KEY set" },
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
    // Back office: an admin drafts a newsletter and goes to make tea. The
    // deeper model is worth the extra seconds here in a way it is not when a
    // student is watching an essay being marked.
    raw = await callClaude(prompt, 1200, "backoffice");
    used = CLAUDE_MODEL_DEEP;
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

/**
 * BECCA, WRITING UP A SCHEDULE RECOMMENDATION SHE DID NOT MAKE.
 *
 * The slots, their ranking and the stated-versus-observed mismatch are all
 * computed in `private-schedule-advisor.ts` before this is called. This
 * function is handed the finished answer and asked for the words. That
 * boundary is the whole design: a model that picks the hour will eventually
 * pick one the tutor is already teaching in, and no amount of prompting fixes
 * a system nobody can audit.
 *
 * Returns null on any failure — no key, no credit, a timeout, an empty reply.
 * The caller ships the deterministic prose instead, which is written to be
 * good rather than to be a placeholder, so the feature degrades in tone and
 * never in usefulness.
 */
export async function becomeBecca(input: {
  studentName: string;
  level: string;
  advice: {
    candidates: Array<{ day: string; start: string; score: number; reasons: string[]; tutorBusy: boolean }>;
    mismatch: { note: string } | null;
    evidence: { hasStated: boolean; observedTrusted: boolean; observedEvents: number };
    fallbackMessage: string;
  };
}): Promise<string | null> {
  const { studentName, level, advice } = input;
  if (!advice.candidates.length) return null;

  const slots = advice.candidates
    .map(
      (candidate, index) =>
        `${index + 1}. ${candidate.day} at ${candidate.start} (confidence ${candidate.score}/100)` +
        `${candidate.tutorBusy ? " — tutor already has something near this" : ""}` +
        `\n   because: ${candidate.reasons.join("; ") || "it fits the days they marked"}`,
    )
    .join("\n");

  const prompt = [
    "You are Becca, the study companion inside a German language school's app.",
    "You are speaking directly to one student about when to hold their one-to-one class.",
    "",
    `Student's first name: ${studentName}. Level: ${level}.`,
    "",
    "These slots have ALREADY been chosen by the scheduling system. Your job is only to explain them warmly.",
    "Do not invent, reorder, merge or add slots. Do not change any day or time. Do not promise a booking.",
    "",
    slots,
    "",
    advice.mismatch
      ? `IMPORTANT — raise this gently, it is the most useful thing you can tell them: ${advice.mismatch.note}`
      : "",
    advice.evidence.observedTrusted
      ? "You may refer to when they usually use the app, because that is what the reasons above are based on. Be matter-of-fact about it, never surveillance-flavoured."
      : "Do NOT claim to know when they usually study — there is not enough data yet. Base everything on what they told you.",
    "",
    "Write 2-3 short sentences. Warm, direct, British English, second person. No greeting, no sign-off, no bullet points, no markdown. Return only the sentences.",
  ]
    .filter(Boolean)
    .join("\n");

  const raw = await callHostedText(prompt, 300);
  const text = (raw || "").trim();
  // A one-word reply is a failure wearing a success's clothes.
  return text.length >= 40 ? text : null;
}

export async function summarizeText(text: string): Promise<string> {
  const provider = getAIProvider("learning-content");
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

export async function generatePersonalizedPlan(
  studentProfile: any,
  candidateLessons: any[],
  options: {
    maxLessons?: number;
    minutesPerDay?: number;
    strategy?: string;
    /**
     * How this learner actually studies — format taste, session length, grit.
     * See src/lib/learner-style.ts. When present and past "none" confidence it
     * adds a BOUNDED nudge to each lesson's score, on top of the academic
     * ranking; it can reorder near-ties and float a loved format, it can never
     * remove a lesson the weakest-skill logic put there.
     */
    styleSignals?: LearningStyle | null;
    /**
     * Reserve a small slice of the plan for deliberately off-profile lessons,
     * so a settled profile does not calcify into a filter bubble. Only fires
     * at "fair"/"strong" style confidence. Defaults on; pass false to disable.
     */
    explore?: boolean;
  } = {},
) {
  const provider = getAIProvider("student");
  const maxLessons = options.maxLessons || 10;
  const strategy = (options.strategy || process.env.PERSONALIZATION_PLANNER_STRATEGY || 'hybrid').toLowerCase();
  // `fewshot` and `hybrid` are the same code path — kept as distinct labels
  // only so an A/B comparison can tell which prompt wording produced a plan.
  const useFewShot = strategy === 'fewshot' || strategy === 'hybrid';
  const shouldUseLocalModel = (provider === 'anythingllm' || provider === 'ollama') && strategy !== 'deterministic';
  const shouldUseHostedModel = (provider === 'claude' || provider === 'groq' || provider === 'deepseek') && strategy !== 'deterministic';

  const style = options.styleSignals ?? null;
  const styleRank = levelRank(studentProfile?.level);

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

    // How this student actually studies — added last and bounded to ~±12, so
    // it shades the academic ranking above without ever overturning it. A no-op
    // when there is no style reading yet (a brand-new student ranks on
    // academics alone).
    score += styleAdjustment(lesson, style, styleRank);

    return score;
  }

  const enrichedLessons = candidateLessons.map((lesson) => ({
    ...lesson,
    completed: Boolean(lesson.completed),
    difficulty: lesson.level || lesson.courseLevel || 'A2',
    tags: Array.from(new Set([lesson.type, lesson.source, lesson.difficulty, lesson.courseTitle, lesson.level].filter(Boolean))),
    summary: lesson.summary || lesson.description?.slice(0, 280) || '',
  }));

  const scored = enrichedLessons
    .map((l) => ({ ...l, _score: scoreLesson(l) }))
    .sort((a, b) => (b._score ?? 0) - (a._score ?? 0));

  /**
   * EXPLORATION. A recommender that only ever serves what the profile already
   * likes calcifies — the plan stops surprising anyone and after a month it
   * reads as the portal no longer paying attention. `pickExploration` spends a
   * small fixed slice of slots on lessons the taste weighting pushed DOWN, and
   * only once the profile is settled enough for "off-profile" to mean
   * something. Those lessons then feed back through completions on the next
   * rebuild, so a good exploratory pick raises its own format's affinity.
   */
  const exploration = options.explore === false
    ? { picks: [] as typeof scored, reason: "" }
    : pickExploration(scored, style, { keep: maxLessons });
  const exploratoryIds = new Set(exploration.picks.map((p) => p.id));

  const ranked = [
    ...scored.filter((l) => !exploratoryIds.has(l.id)).slice(0, Math.max(0, maxLessons - exploratoryIds.size)),
    ...exploration.picks,
  ].slice(0, maxLessons);

  /**
   * Attach the "why" to whatever plan shape we end up returning — the LLM
   * paths, the local-model path and the deterministic fallback all pass
   * through here so the student-facing copy and the exploratory tags are
   * identical regardless of which engine produced the list.
   */
  const decoratePlan = (plan: any) => {
    const lessons = Array.isArray(plan?.lessons)
      ? plan.lessons.map((lesson: any) => ({
          ...lesson,
          exploratory: exploratoryIds.has(lesson?.id) || lesson?.exploratory === true,
        }))
      : plan?.lessons;
    return {
      ...plan,
      lessons,
      stylePersonalization: style && style.confidence !== 'none'
        ? { confidence: style.confidence, summary: style.summary, formatAffinity: style.formatAffinity }
        : null,
      exploration: exploration.picks.length
        ? { count: exploration.picks.length, reason: exploration.reason }
        : null,
    };
  };

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
            return decoratePlan({
              ...parsed,
              strategy,
              variant: 'llm',
              targetDifficulty: getTargetDifficultyRank(),
              adaptiveHint: 'Difficulty is tuned from recent performance and exam readiness.',
            });
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
        return decoratePlan({
          ...parsed,
          strategy,
          variant: 'llm',
          targetDifficulty: getTargetDifficultyRank(),
          adaptiveHint: 'Difficulty is tuned from recent performance and exam readiness.',
        });
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
      reason: exploratoryIds.has(lesson.id)
        ? 'Outside your usual pattern — in to see whether it clicks.'
        : lesson.completed ? 'Review completed practice.' : 'Recommended next lesson based on your current progress.',
      source: lesson.source || 'pathway',
    })),
  };

  return decoratePlan(plan);
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
  | "student"
  /** Tutor material becomes learner-facing lessons, summaries, and quests. */
  | "learning-content";

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
  // Admin authoring uses the office Ollama runtime when available, then Groq
  // on Vercel. Claude is deliberately not a backoffice fallback.
  if (workload === "backoffice") {
    return localProvider() ?? (hasKey(process.env.GROQ_API_KEY) ? "groq" : null) ??
      (hasKey(process.env.DEEPSEEK_API_KEY) ? "deepseek" : null) ??
      "mock";
  }

  // Claude powers the learner-facing intelligence: personalized plans,
  // daily missions, and the transformation of tutor material into learning.
  if (workload === "student" || workload === "learning-content") {
    return hasKey(process.env.ANTHROPIC_API_KEY)
      ? "claude"
      : (hasKey(process.env.GROQ_API_KEY) ? "groq" : null) ??
          (hasKey(process.env.DEEPSEEK_API_KEY) ? "deepseek" : "mock");
  }

  const forced = String(process.env.AI_PROVIDER ?? "").toLowerCase();
  if (forced === "claude" || forced === "groq" || forced === "ollama" || forced === "deepseek" || forced === "anythingllm" || forced === "mock") {
    return forced;
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
  if (provider === "claude") return claudeModelFor(workload);
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
    `Grade this German essay at B2 exam standard, like a sharp but encouraging tutor handing back marked work —
not a form letter. Every comment must quote or closely paraphrase an actual word, phrase, or sentence FROM THIS
ESSAY as evidence. A comment that could be pasted onto any other essay unchanged is not acceptable — rewrite it
until it only fits this one. Return JSON:
{
  "score": (0-100),
  "feedback": [
    {"category": "Grammar", "comment": "quote or reference something specific from THIS essay", "score": (0-100)},
    {"category": "Vocabulary", "comment": "quote or reference something specific from THIS essay", "score": (0-100)},
    {"category": "Structure", "comment": "quote or reference something specific from THIS essay", "score": (0-100)},
    {"category": "Spelling", "comment": "quote or reference something specific from THIS essay", "score": (0-100)}
  ],
  "strengths": ["one specific thing done well, quoting the essay", "a second, different one"],
  "growthAreas": ["the single highest-impact fix, quoting the exact spot", "the second highest-impact fix"],
  "achievementTitle": "a short (2-4 word) badge-style title reflecting their STRONGEST category this round, e.g. 'Vocabulary Virtuoso', 'Grammar Guardian', 'Structure Specialist' — pick whichever category actually scored highest, do not default to the same one every time",
  "summary": "2-3 sentences, overall assessment, second person"
}
growthAreas must be ordered by impact — the fix that would raise the score the most comes first. Do not invent
errors that are not in the text; if the essay is genuinely strong in a category, say so and leave that out of
growthAreas.

Essay to grade:
${essay}${JSON_ONLY}`,
    1200,
  );

  const parsed = parseJsonReply<{
    score?: number;
    feedback?: Array<{ category: string; comment: string; score: number }>;
    strengths?: string[];
    growthAreas?: string[];
    achievementTitle?: string;
    summary?: string;
  }>(raw);
  if (!parsed) return gradeEssayMock(essay);

  return {
    score: parsed.score || 75,
    feedback: parsed.feedback || [],
    strengths: parsed.strengths || [],
    growthAreas: parsed.growthAreas || [],
    achievementTitle: parsed.achievementTitle || null,
    summary: parsed.summary || "Essay graded by Claude AI.",
  };
}

async function analyzePronunciationWithClaude(
  phrase: string,
  expectedPhrase: string,
  comparison: PronunciationWordComparison,
  acousticFeatures: Record<string, number> | null,
  azureAssessment: AzurePronunciationAssessment | null,
  coachingMemory: CoachingMemorySummary | null,
) {
  // Azure's per-word accuracy scores are the closest thing to ground truth this
  // pipeline has — a forced alignment against the reference text, not a text
  // model's guess. Naming the actual weak words up front (rather than leaving
  // Claude to rediscover them from a JSON blob) is what makes the coaching
  // concrete instead of generic.
  const weakWordsFromAzure = (azureAssessment?.words ?? [])
    .filter((word) => word.accuracyScore < 75 || word.errorType !== "None")
    .slice(0, 6);

  const memorySection = coachingMemory && coachingMemory.attemptCount > 1
    ? `This student's coaching history (last ${Math.min(10, coachingMemory.attemptCount)} attempts):
${JSON.stringify(coachingMemory)}
If a recurring issue or missing word shows up again in THIS attempt, say so directly — "this is the Nth time" is more useful to them than rediscovering the same note. If the trend is "improving", say that too; a student who is improving and never hears it stops trusting the feedback.`
    : "This is this student's first tracked attempt — no history yet, so coach only what is in front of you.";

  const azureSection = azureAssessment
    ? `Real phoneme-level pronunciation assessment from Azure Speech (forced alignment against the target sentence — this is measured, not estimated):
${JSON.stringify({ ...azureAssessment, words: weakWordsFromAzure.length ? weakWordsFromAzure : azureAssessment.words.slice(0, 8) })}
This is your most reliable evidence for word- and phoneme-level pronunciation. When it disagrees with the transcript-only word comparison, trust this. Name specific weak words or phonemes from it when they exist.`
    : "No phoneme-level assessment is available for this attempt — coach only from the transcript comparison and the waveform measurements below, and do not claim word- or phoneme-level precision you do not have.";

  const raw = await callHostedText(
    `You are a precise, encouraging German pronunciation coach for a Nigerian adult learner. Compare the target sentence with
  the speech-recognition transcript. Do not invent problems that are not supported by
  the evidence given. Return JSON:
{
  "transcription": "correct spelling/transcription",
  "issues": ["issue1", "issue2"],
  "corrections": ["correction1", "correction2"],
  "confidence": (0-100),
  "nextPractice": "one short, targeted drill for the clearest weakness",
  "practicePhraseNext": "a NEW short German phrase that specifically drills their weak sounds, e.g. if they miss final consonants, use words ending in -t, -ck, -ch, -ng",
  "achievementTitle": "a short (2-4 word) badge-style title for what this attempt actually did WELL, e.g. 'Clear Consonants', 'Vowel Precision', 'Steady Rhythm', 'Word-Perfect Run' — ground it in the strongest real signal from the evidence below (a clean word-match, a strong phoneme score, good pacing); if nothing stands out yet, use something honest like 'Building Momentum' rather than inventing praise"
}
Target sentence: ${expectedPhrase}
Spoken transcript: ${phrase}
Word comparison from the app: ${JSON.stringify(comparison)}
${azureSection}
Acoustic measurements from the recorded waveform: ${JSON.stringify(acousticFeatures || {})}
${GERMAN_ACOUSTIC_COACHING_CONTEXT}
${memorySection}
Use the word comparison, the phoneme assessment (when present), the acoustic measurements, and the coaching history together as evidence. Do not claim exact phoneme or accent errors unless the evidence supports it. For practicePhraseNext: craft a phrase 6-12 words long that targets their specific weak area (from recurringIssueThemes if available, or from this attempt's issues). Make it a realistic German sentence, not a nonsense drill. Keep the JSON concise.${JSON_ONLY}`,
    800,
  );

  const parsed = parseJsonReply<{
    transcription?: string;
    issues?: string[];
    corrections?: string[];
    confidence?: number;
    nextPractice?: string;
    practicePhraseNext?: string;
    achievementTitle?: string;
  }>(raw);
  if (!parsed) return analyzePronunciationMock(phrase, comparison);

  // The word-match accuracy stays the grounded floor for `confidence` and
  // `wordAccuracy` — recordSkillOutcome and the student's personal-best score
  // already depend on that meaning "did you say the right words", and
  // changing it retroactively changes what every past skill-mastery point
  // meant. Azure's PronScore is real evidence the old pipeline never had, so
  // it is surfaced ADDITIVELY as `pronunciationScore` rather than folded in.
  return {
    transcription: parsed.transcription || phrase,
    issues: parsed.issues || [],
    corrections: parsed.corrections || [],
    confidence: comparison.accuracy,
    nextPractice: parsed.nextPractice || generatePronunciationNextPractice(parsed.issues || [], expectedPhrase),
    practicePhrase: parsed.practicePhraseNext || (comparison.missingWords.length ? comparison.missingWords.join(" ") : expectedPhrase),
    wordAccuracy: comparison.accuracy,
    missingWords: comparison.missingWords,
    extraWords: comparison.extraWords,
    pronunciationScore: azureAssessment?.pronScore ?? null,
    weakWords: weakWordsFromAzure.map((word) => ({ word: word.word, accuracyScore: word.accuracyScore, errorType: word.errorType })),
    achievementTitle: parsed.achievementTitle || null,
  };
}

/**
 * The once-a-week "here's how you're actually doing" paragraph.
 *
 * Called from voice-coach-memory.ts, at most once every 7 days per student,
 * only on a save (never on a page load) — see maybeRefreshWeeklySummary
 * there for why. Returns null on any failure; the caller keeps whatever
 * digest it already had rather than showing nothing.
 */
export async function generateWeeklyCoachingSummary(summary: CoachingMemorySummary): Promise<string | null> {
  const raw = await callHostedText(
    `You are Becca, a warm but precise German pronunciation coach, writing a short weekly progress note for a
student at a Nigerian language school. Base it ONLY on the data below — never invent a detail it does not support.

Attempt history summary: ${JSON.stringify(summary)}

Write 2-3 sentences, second person ("you"), for the student to read. Name the one clearest trend and the one
thing worth practising next. If weakPhonemes or recurringIssueThemes is empty, do not invent a weak sound — praise
consistency instead. No greeting, no sign-off — this drops straight into a card in the app.
Return JSON: {"summary": "..."}${JSON_ONLY}`,
    250,
  );
  const parsed = parseJsonReply<{ summary?: string }>(raw);
  const text = parsed?.summary?.trim();
  return text ? text.slice(0, 600) : null;
}

function generatePronunciationNextPractice(issues: string[], phrase: string): string {
  const text = issues.join(" ").toLowerCase();
  if (text.includes("vowel") || text.includes("visum") || text.includes("um")) {
    return "Repeat: 'Visum' and 'Ich möchte ein Visum beantragen' while keeping the vowels short and the final 'um' crisp.";
  }
  if (text.includes("consonant") || text.includes("ch") || text.includes("ich")) {
    return "Practice the 'ch' sound with 5 slow repetitions of 'ich', 'machen', and 'nicht' before redoing the full sentence.";
  }
  if (text.includes("stress") || text.includes("rhythm") || text.includes("intonation")) {
    return "Say the sentence in three rhythm blocks: 'Ich möchte', 'ein Visum', 'beantragen' — then join them smoothly.";
  }
  return `Practice the phrase again in 3 short chunks: ${phrase.split(/\s+/).slice(0, 4).join(" ")}… then finish the sentence with a clearer ending.`;
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
        strengths: parsed.strengths || [],
        growthAreas: parsed.growthAreas || [],
        achievementTitle: parsed.achievementTitle || null,
        summary: parsed.summary || "Essay graded by Ollama.",
      };
    } catch {
      return gradeEssayMock(essay);
    }
  } catch {
    return gradeEssayMock(essay);
  }
}

async function analyzePronunciationWithOllama(phrase: string, expectedPhrase: string, comparison: PronunciationWordComparison) {
  const baseUrl = process.env.OLLAMA_BASE_URL || "http://localhost:11434";

  try {
    const response = await fetch(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: getOllamaModel(),
        prompt: `Compare target German sentence: ${expectedPhrase} with spoken transcript: ${phrase}. Word comparison: ${JSON.stringify(comparison)}. Coach only supported mismatches. Return only valid JSON with fields transcription, issues, corrections, confidence, and nextPractice.`,
        stream: false,
        temperature: 0.1,
      }),
    });

    if (!response.ok) return analyzePronunciationMock(phrase, comparison);

    const data = await response.json() as any;
    const text = data.response || "{}";

    try {
      const parsed = parseModelJson<any>(text);
      if (!parsed) throw new Error("unparseable");
      return {
        transcription: parsed.transcription || phrase,
        issues: parsed.issues || [],
        corrections: parsed.corrections || [],
        confidence: comparison.accuracy,
        nextPractice: parsed.nextPractice || generatePronunciationNextPractice(parsed.issues || [], expectedPhrase),
        practicePhrase: comparison.missingWords.length ? comparison.missingWords.join(" ") : expectedPhrase,
        wordAccuracy: comparison.accuracy,
        missingWords: comparison.missingWords,
        extraWords: comparison.extraWords,
        // Computed from the measured word-match, not asked of the local model:
        // a small model asked to invent a "you did well at X" badge fabricates
        // one, same failure class documented on generateDailyMissions.
        achievementTitle: comparison.accuracy >= 90 ? "Word-Perfect Run" : comparison.accuracy >= 70 ? "Building Momentum" : null,
      };
    } catch {
      return analyzePronunciationMock(phrase, comparison);
    }
  } catch {
    return analyzePronunciationMock(phrase, comparison);
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
    strengths: [
      "Your subordinate clauses are consistently well-formed — that is a B2/C1 marker most learners at your stage still miss.",
    ],
    growthAreas: [
      "Watch case agreement after accusative prepositions — that is the single fastest way to lift this score.",
    ],
    achievementTitle: hasGrammarErrors ? "Vocabulary Builder" : "Structure Specialist",
    summary: `Score: ${score}/100. Your essay demonstrates solid B2 competency with clear structure and appropriate vocabulary. Focus on varying sentence complexity and refining grammatical accuracy for C1-level writing.`,
  };
}

async function gradeStoryWritingWithClaude(input: {
  prompt: string;
  promptGerman?: string;
  response: string;
  goalId: string;
  sceneTitle: string;
}) {
  const raw = await callHostedText(
    `You are a warm, precise German writing coach reviewing a short in-scene response from a personalized
roleplay story. The student is practising for a real goal ("${input.goalId}"), in a scene titled
"${input.sceneTitle}". This is NOT a full essay — grade it as what it is: a short, situational piece of writing,
2-3 sentences, written under time pressure inside a story. Every comment must reference the student's ACTUAL words.

The prompt they were given: ${input.prompt}${input.promptGerman ? `\nGerman version of the prompt: ${input.promptGerman}` : ""}
What they wrote: ${input.response}

Return JSON:
{
  "score": (0-100, judged as a short situational response, not against full-essay standards),
  "feedback": "1-2 sentences, second person, specific to what they actually wrote",
  "corrections": ["a specific correction quoting their text, if any real error exists — omit if the writing is clean"],
  "achievementTitle": "a short (2-4 word) badge-style title for what this response did well, e.g. 'Clear Handover', 'Precise Detail' — ground it in a real strength, or use something honest like 'Good Start' if nothing stands out yet"
}
Do not invent errors that are not in the text. If the response is too short to fairly judge, say so in feedback rather than inventing detail that was not attempted.${JSON_ONLY}`,
    500,
  );

  const parsed = parseJsonReply<{ score?: number; feedback?: string; corrections?: string[]; achievementTitle?: string }>(raw);
  if (!parsed) return gradeStoryWritingMock(input);

  return {
    score: typeof parsed.score === "number" ? Math.max(0, Math.min(100, parsed.score)) : 70,
    feedback: parsed.feedback || "Written response recorded.",
    corrections: parsed.corrections || [],
    achievementTitle: parsed.achievementTitle || null,
  };
}

async function gradeStoryWritingWithOllama(input: {
  prompt: string;
  promptGerman?: string;
  response: string;
  goalId: string;
  sceneTitle: string;
}) {
  const baseUrl = process.env.OLLAMA_BASE_URL || "http://localhost:11434";

  try {
    const response = await fetch(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: getOllamaModel(),
        prompt: `Grade this short (2-3 sentence) German writing response from a roleplay scene titled "${input.sceneTitle}". Prompt given: ${input.prompt}. Response: ${input.response}. Return only valid JSON with score (0-100), feedback (1-2 sentences), and corrections (array).`,
        stream: false,
        temperature: 0.1,
      }),
    });

    if (!response.ok) return gradeStoryWritingMock(input);

    const data = await response.json() as any;
    const text = data.response || "{}";

    try {
      const parsed = parseModelJson<any>(text);
      if (!parsed) throw new Error("unparseable");
      return {
        score: typeof parsed.score === "number" ? Math.max(0, Math.min(100, parsed.score)) : 70,
        feedback: parsed.feedback || "Written response recorded.",
        corrections: parsed.corrections || [],
        achievementTitle: parsed.achievementTitle || null,
      };
    } catch {
      return gradeStoryWritingMock(input);
    }
  } catch {
    return gradeStoryWritingMock(input);
  }
}

function gradeStoryWritingMock(input: { response: string }) {
  const wordCount = input.response.trim().split(/\s+/).filter(Boolean).length;
  const score = wordCount >= 12 ? 78 : wordCount >= 6 ? 68 : 50;
  return {
    score,
    feedback: wordCount >= 12
      ? "A clear, situational response — this reads like something a real colleague would write."
      : "A good start — try adding one more detail to make this feel complete.",
    corrections: [],
    achievementTitle: wordCount >= 12 ? "Clear Handover" : null,
  };
}

function analyzePronunciationMock(phrase: string, comparison: PronunciationWordComparison) {
  const issues = [
    ...(comparison.missingWords.length ? [`Missing words: ${comparison.missingWords.join(", ")}`] : []),
    ...(comparison.extraWords.length ? [`Extra words heard: ${comparison.extraWords.join(", ")}`] : []),
  ];
  return {
    transcription: phrase,
    issues: issues.length ? issues : ["All target words were detected. Keep working on clear German sounds and steady rhythm."],
    corrections: comparison.missingWords.length
      ? [`Repeat the missing words slowly, then insert them back into the full sentence: ${comparison.missingWords.join(", ")}.`]
      : comparison.extraWords.length
        ? [`Remove the extra words and repeat the target sentence in short chunks.`]
        : ["Repeat the sentence once more at normal speed while keeping each word distinct."],
    confidence: comparison.accuracy,
    nextPractice: comparison.missingWords.length
      ? `Practise this chunk five times: ${comparison.missingWords.join(" ")}, then repeat the full target sentence.`
      : "Repeat the full target sentence three times, keeping the same clear rhythm.",
    practicePhrase: comparison.missingWords.length ? comparison.missingWords.join(" ") : phrase,
    wordAccuracy: comparison.accuracy,
    missingWords: comparison.missingWords,
    extraWords: comparison.extraWords,
    achievementTitle: comparison.accuracy >= 90 ? "Word-Perfect Run" : comparison.accuracy >= 70 ? "Building Momentum" : null,
  };
}
