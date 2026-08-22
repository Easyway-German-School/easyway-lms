import { NextRequest, NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import { analyzePronunciation } from "@/lib/ai";
import { reserveStudentAiRequest } from "@/lib/ai-limits";
import { recordSkillOutcome } from "@/lib/skill-mastery";

export const dynamic = "force-dynamic";
const MAX_AUDIO_BYTES = 8 * 1024 * 1024;

export async function POST(request: NextRequest) {
  const session = await requireAuthSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const quota = await reserveStudentAiRequest(session.user.id, "pronunciation");
  if (!quota.allowed) return NextResponse.json({ error: "Daily pronunciation limit reached. Try again tomorrow." }, { status: 429 });

  const form = await request.formData();
  const audio = form.get("audio");
  const expectedPhrase = String(form.get("expectedPhrase") ?? "").trim();
  if (!(audio instanceof File) || audio.size === 0) return NextResponse.json({ error: "A voice recording is required." }, { status: 400 });
  if (audio.size > MAX_AUDIO_BYTES) return NextResponse.json({ error: "That recording is too large. Keep it under one minute." }, { status: 400 });

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "Audio analysis is not configured yet." }, { status: 503 });

  const upload = new FormData();
  upload.append("file", audio, audio.name || "voice-coach.webm");
  upload.append("model", "whisper-large-v3-turbo");
  upload.append("language", "de");
  upload.append("response_format", "json");

  const transcriptionResponse = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: upload,
  });
  if (!transcriptionResponse.ok) {
    console.error("Audio transcription failed", transcriptionResponse.status);
    return NextResponse.json({ error: "The audio could not be transcribed. Try once more." }, { status: 502 });
  }

  const transcription = String(((await transcriptionResponse.json()) as { text?: string }).text ?? "").trim();
  if (transcription.length < 2) return NextResponse.json({ error: "I could not hear enough German to coach. Try speaking closer to the microphone." }, { status: 422 });

  const result = await analyzePronunciation(transcription, expectedPhrase || transcription);
  const student = await import("@/lib/prisma").then(({ prisma }) => prisma.student.findUnique({ where: { userId: session.user.id }, select: { id: true } }));
  if (student) void recordSkillOutcome({ studentId: student.id, skill: "speaking", score: result.confidence });

  return NextResponse.json({ ...result, audioAnalyzed: true, analysisMode: "speech-transcript", transcription });
}
