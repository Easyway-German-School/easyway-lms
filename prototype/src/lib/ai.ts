/**
 * AI Service - Supports Claude API, Ollama (local), or mock responses
 * Set environment variables:
 * - ANTHROPIC_API_KEY: For Claude API
 * - OLLAMA_BASE_URL: For local Ollama (e.g., http://localhost:11434)
 */

export async function gradeEssay(essay: string): Promise<{
  score: number;
  feedback: Array<{ category: string; comment: string; score: number }>;
  summary: string;
}> {
  const provider = getAIProvider();

  if (provider === "claude") {
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

  if (provider === "claude") {
    return analyzePronunciationWithClaude(phrase);
  } else if (provider === "ollama") {
    return analyzePronunciationWithOllama(phrase);
  } else {
    return analyzePronunciationMock(phrase);
  }
}

export async function generateEssayNextSteps(score: number, feedback: Array<{ category: string; comment: string; score: number }>, essay: string): Promise<string> {
  const provider = getAIProvider();
  if (provider === "claude") {
    return generateNextStepsWithClaude(score, feedback, essay);
  } else if (provider === "deepseek") {
    return generateNextStepsWithDeepSeek(score, feedback, essay);
  } else if (provider === "ollama") {
    return generateNextStepsWithOllama(score, feedback, essay);
  } else {
    return generateNextStepsMock(score, feedback);
  }
}

export async function generateDailyMissions(profile: any): Promise<Array<{ title: string; description: string; reward: string }>> {
  const provider = getAIProvider();
  if (provider === "claude") {
    // Fallback to mock for Claude for now
    return generateDailyMissionsMock(profile);
  } else if (provider === "deepseek") {
    return generateDailyMissionsMock(profile);
  } else if (provider === "ollama") {
    return generateDailyMissionsWithOllama(profile);
  } else {
    return generateDailyMissionsMock(profile);
  }
}

export async function generateMissionPracticeFeedback(input: {
  title: string;
  description: string;
  response: string;
}): Promise<{ prompt: string; feedback: string; score: number; suggestion?: string }> {
  const provider = getAIProvider();

  if (provider === "claude") {
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
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return generateMissionPracticeFeedbackMock(input);

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 256,
        messages: [
          {
            role: "user",
            content: `You are an expert German tutor. A student submitted the following mission response.\n\nMission: ${input.title}\nDescription: ${input.description}\nResponse: ${input.response}\n\nGive output as valid JSON only with fields: prompt, feedback, score, suggestion.`,
          },
        ],
      }),
    });

    if (!response.ok) return generateMissionPracticeFeedbackMock(input);
    const data = await response.json() as any;
    const text = data?.content?.[0]?.text || "{}";
    const parsed = JSON.parse(text);
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

async function generateMissionPracticeFeedbackWithLocalModel(input: {
  title: string;
  description: string;
  response: string;
}) {
  const prompt = `You are an expert German tutor. A student submitted the following mission response.\n\nMission: ${input.title}\nDescription: ${input.description}\nResponse: ${input.response}\n\nReturn only valid JSON with the fields: prompt, feedback, score, suggestion.`;
  const raw = await callLocalModel(getOllamaModel(), prompt, 0.2);
  if (!raw) return generateMissionPracticeFeedbackMock(input);

  try {
    const parsed = JSON.parse(raw);
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
  const provider = getAIProvider();
  if (provider === "ollama") {
    return generateCourseOutlineWithOllama(courseInfo);
  }
  return generateCourseOutlineMock(courseInfo);
}

export async function generateLessonPackage(lessonData: any): Promise<{ summary: string; objectives: string[]; grammarFocus: string[]; vocabulary: string[]; quizQuestions?: Array<{ question: string; type: string; options?: string[]; answer: string }>; modules: Array<{ title: string; description: string; lessons: Array<{ title: string; description: string; type: string; duration: number }> }>; missions: Array<{ title: string; description: string; reward: string }> }> {
  const provider = getAIProvider();
  if (provider === "ollama") {
    return generateLessonPackageWithOllama(lessonData);
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
  const provider = getAIProvider();
  if (provider === "ollama") {
    return parseUploadedContentWithOllama(content);
  }
  return parseUploadedContentMock(content);
}

export async function summarizeText(text: string): Promise<string> {
  const provider = getAIProvider();
  if (provider === "ollama") {
    return summarizeTextWithOllama(text);
  }
  return summarizeTextMock(text);
}

export async function generatePersonalizedPlan(studentProfile: any, candidateLessons: any[], options: { maxLessons?: number; minutesPerDay?: number; strategy?: string } = {}) {
  const provider = getAIProvider();
  const maxLessons = options.maxLessons || 10;
  const strategy = (options.strategy || process.env.PERSONALIZATION_PLANNER_STRATEGY || 'hybrid').toLowerCase();
  const useFewShot = strategy === 'fewshot' || strategy === 'hybrid';
  const shouldUseLocalModel = (provider === 'anythingllm' || provider === 'ollama') && strategy !== 'deterministic';

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
    pathway: studentProfile.pathway || 'Goethe exam mastery',
    examReadiness: Number(studentProfile.examReadiness || 0),
    completedLessonsCount: Array.isArray(studentProfile.completedLessons) ? studentProfile.completedLessons.length : 0,
    averageScore: Number(studentProfile.averageScore || 0),
    recentPerformance: studentProfile.recentPerformance || [],
    preferences: {
      dailyMinutes: options.minutesPerDay || 30,
      goal: 'improve exam readiness and complete pathway milestones',
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
      const parsed = JSON.parse(text);
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
      const parsed = JSON.parse(text);
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
      const parsed = JSON.parse(text);
      if (parsed?.summary && Array.isArray(parsed.objectives) && Array.isArray(parsed.modules)) return parsed;
      return generateLessonPackageMock(lessonData);
    } catch {
      return generateLessonPackageMock(lessonData);
    }
  } catch {
    return generateLessonPackageMock(lessonData);
  }
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

function getAIProvider(): "claude" | "ollama" | "deepseek" | "anythingllm" | "mock" {
  if (process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_API_KEY.startsWith("sk-placeholder")) return "claude";
  if (process.env.DEEPSEEK_API_KEY && !process.env.DEEPSEEK_API_KEY.startsWith("sk-placeholder")) return "deepseek";
  if (process.env.ANYTHINGLLM_BASE_URL) return "anythingllm";
  if (process.env.OLLAMA_BASE_URL) return "ollama";
  return "mock";
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
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return generateNextStepsMock(score, feedback);

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 256,
        messages: [
          {
            role: "user",
            content: `Based on a German essay scored at ${score}/100 with these feedback categories: ${feedback.map((f) => `${f.category}: ${f.score}/100`).join(", ")}, provide ONE specific, actionable next step to improve from ${score} to ${score + 10} points. Keep it to one concise sentence.`,
          },
        ],
      }),
    });

    if (!response.ok) return generateNextStepsMock(score, feedback);
    const data = (await response.json()) as any;
    return data.content[0]?.text || generateNextStepsMock(score, feedback);
  } catch {
    return generateNextStepsMock(score, feedback);
  }
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

// Claude Implementation
async function gradeEssayWithClaude(essay: string) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: `Grade this German essay for a Goethe B2 exam. Return JSON with:
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
${essay}`,
        },
      ],
    }),
  });

  if (!response.ok) {
    console.error("Claude API error:", await response.text());
    return gradeEssayMock(essay);
  }

  const data = await response.json() as any;
  const content = data.content[0]?.text || "{}";

  try {
    const parsed = JSON.parse(content);
    return {
      score: parsed.score || 75,
      feedback: parsed.feedback || [],
      summary: parsed.summary || "Essay graded by Claude AI.",
    };
  } catch {
    return gradeEssayMock(essay);
  }
}

async function analyzePronunciationWithClaude(phrase: string) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 512,
      messages: [
        {
          role: "user",
          content: `Analyze this German phrase for pronunciation coaching. Return JSON:
{
  "transcription": "correct spelling/transcription",
  "issues": ["issue1", "issue2"],
  "corrections": ["correction1", "correction2"],
  "confidence": (0-100)
}

Phrase: ${phrase}`,
        },
      ],
    }),
  });

  if (!response.ok) {
    return analyzePronunciationMock(phrase);
  }

  const data = await response.json() as any;
  const content = data.content[0]?.text || "{}";

  try {
    const parsed = JSON.parse(content);
    return {
      transcription: parsed.transcription || phrase,
      issues: parsed.issues || [],
      corrections: parsed.corrections || [],
      confidence: parsed.confidence || 85,
    };
  } catch {
    return analyzePronunciationMock(phrase);
  }
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
        prompt: `Grade this German essay for a Goethe B2 exam. Return only valid JSON with score (0-100), feedback array, and summary. Example output:
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
      const parsed = JSON.parse(text);
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
      const parsed = JSON.parse(text);
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
