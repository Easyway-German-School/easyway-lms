import { NextRequest, NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import { analyzePronunciation } from "@/lib/ai";
import { reserveStudentAiRequest } from "@/lib/ai-limits";
import { recordSkillOutcome } from "@/lib/skill-mastery";
import { getCoachingMemorySummary, saveVoiceCoachMemory } from "@/lib/voice-coach-memory";
import { assessPronunciationWithAzure, azurePronunciationAvailable } from "@/lib/azure-pronunciation";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
const MAX_AUDIO_BYTES = 8 * 1024 * 1024;

export async function POST(request: NextRequest) {
  const session = await requireAuthSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const quota = await reserveStudentAiRequest(session.user.id, "pronunciation");
  if (!quota.allowed) return NextResponse.json({ error: "Daily pronunciation limit reached. Try again tomorrow." }, { status: 429 });

  const form = await request.formData();
  const audio = form.get("audio");
  // 16kHz mono PCM WAV, built client-side from the same decoded buffer used
  // for the acoustic measurements — see encodeWav16kMono in AICoachPanel.tsx.
  // Optional: older clients or a decode failure simply mean no Azure evidence.
  const audioWav = form.get("audioWav");
  const expectedPhrase = String(form.get("expectedPhrase") ?? "").trim();
  const acousticFeatures = (() => {
    try {
      const value = JSON.parse(String(form.get("acousticFeatures") ?? "null"));
      return value && typeof value === "object" ? value as Record<string, number> : null;
    } catch {
      return null;
    }
  })();
  if (!(audio instanceof File) || audio.size === 0) return NextResponse.json({ error: "A voice recording is required." }, { status: 400 });
  if (audio.size > MAX_AUDIO_BYTES) return NextResponse.json({ error: "That recording is too large. Keep it under one minute." }, { status: 400 });

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "Audio analysis is not configured yet." }, { status: 503 });

  const upload = new FormData();
  upload.append("file", audio, audio.name || "voice-coach.webm");
  upload.append("model", "whisper-large-v3-turbo");
  upload.append("language", "de");
  upload.append("response_format", "json");

  const student = await prisma.student.findUnique({ where: { userId: session.user.id }, select: { id: true } });

  // Whisper transcription, the Azure phoneme assessment, and this student's
  // coaching history all run concurrently — none of them depend on each
  // other, and a student waiting on a spinner should not pay for them
  // sequentially.
  const [transcriptionResponse, azureAssessment, coachingMemory] = await Promise.all([
    fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: upload,
    }),
    audioWav instanceof File && azurePronunciationAvailable() && expectedPhrase
      ? assessPronunciationWithAzure(await audioWav.arrayBuffer(), expectedPhrase, "de-DE")
      : Promise.resolve(null),
    student ? getCoachingMemorySummary(student.id) : Promise.resolve(null),
  ]);

  if (!transcriptionResponse.ok) {
    console.error("Audio transcription failed", transcriptionResponse.status);
    return NextResponse.json({ error: "The audio could not be transcribed. Try once more." }, { status: 502 });
  }

  const transcription = String(((await transcriptionResponse.json()) as { text?: string }).text ?? "").trim();
  if (transcription.length < 2) return NextResponse.json({ error: "I could not hear enough German to coach. Try speaking closer to the microphone." }, { status: 422 });

  const result = await analyzePronunciation(transcription, expectedPhrase || transcription, acousticFeatures, azureAssessment, coachingMemory);

  let masteryBefore: number | null = null;
  let masteryAfter: number | null = null;
  if (student) {
    const before = await prisma.studentSkillMastery.findUnique({
      where: { studentId_skill: { studentId: student.id, skill: "speaking" } },
      select: { mastery: true },
    });
    masteryBefore = before?.mastery ?? null;

    await recordSkillOutcome({ studentId: student.id, skill: "speaking", score: result.confidence });
    await saveVoiceCoachMemory(student.id, expectedPhrase || transcription, result, acousticFeatures, azureAssessment);

    const after = await prisma.studentSkillMastery.findUnique({
      where: { studentId_skill: { studentId: student.id, skill: "speaking" } },
      select: { mastery: true },
    });
    masteryAfter = after?.mastery ?? null;
  }

  return NextResponse.json({ ...result, audioAnalyzed: true, analysisMode: "speech-transcript", transcription, phonemeAssessed: Boolean(azureAssessment), masteryBefore, masteryAfter });
}

