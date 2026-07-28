import { NextRequest, NextResponse } from "next/server";

const programs: Record<string, { nextAction: string; focus: string; score: number; overview: string; path: string[] }> = {
  "Goethe exam mastery": {
    overview: "A focused Goethe exam path with writing, speaking, listening, and grammar readiness for A1–C1.",
    nextAction: "Complete the Goethe writing drill for B2.",
    focus: "Sentence structure and exam vocabulary.",
    score: 82,
    path: [
      "Review mock B2 essay feedback",
      "Practice speaking with exam-style prompts",
      "Complete the listening comprehension mini-test",
      "Run a timed grammar drill session"
    ],
  },
  "Nursing career path": {
    overview: "German for nursing: patient communication, medical vocabulary, and practical hospital dialogue.",
    nextAction: "Practice medical roleplay for patient intake.",
    focus: "Healthcare vocabulary and patient communication.",
    score: 74,
    path: [
      "Study common patient interview questions",
      "Practice chart note writing in German",
      "Roleplay a nurse-patient consultation",
      "Review healthcare-specific grammar patterns"
    ],
  },
  "IT relocation track": {
    overview: "Professional German for tech interviews, workplace fluency, and migration readiness.",
    nextAction: "Review tech interview phrases and CV German.",
    focus: "Professional workplace and technical language.",
    score: 79,
    path: [
      "Refine your German CV and cover letter",
      "Practice technical interview dialogues",
      "Complete workplace communication exercises",
      "Review German job posting vocabulary"
    ],
  },
  "Ausbildung & Vocational Route": {
    overview: "Apprenticeship readiness training, company interview prep and trade-specific German.",
    nextAction: "Complete the vocational German application simulation.",
    focus: "Apprenticeship language and company interview prep.",
    score: 69,
    path: [
      "Prepare your Ausbildung application statement",
      "Practice workplace instruction phrases",
      "Review trade-specific German vocabulary",
      "Simulate a company interview in German"
    ],
  },
};

function normalizePathway(pathway: string | null) {
  return (pathway || "Goethe exam mastery").trim();
}

function computeScore(base: number, progress: number) {
  const adjusted = base + Math.round((progress - 50) / 10);
  return Math.min(98, Math.max(55, adjusted));
}

export async function GET(request: NextRequest) {
  const pathway = normalizePathway(request.nextUrl.searchParams.get("pathway"));
  const progress = Number(request.nextUrl.searchParams.get("progress") || "72");
  const program = programs[pathway] || programs["Goethe exam mastery"];
  const score = computeScore(program.score, progress);

  return NextResponse.json({
    ...program,
    score,
    recommendation: {
      urgent: progress < 60 ? "Focus on the next live coaching session and spoken drills." : "Keep current momentum with mock exam practice.",
      moduleCount: program.path.length,
    },
  });
}
