import { NextRequest, NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

const MAX_TEXT_LENGTH = 500;

export async function POST(request: NextRequest) {
  const session = await requireAuthSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const ttsUrl = process.env.VOICE_COACH_TTS_URL?.trim();
  if (!ttsUrl) return NextResponse.json({ error: "Voice provider is not configured." }, { status: 503 });

  const body = await request.json().catch(() => null) as { text?: unknown } | null;
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text || text.length > MAX_TEXT_LENGTH) {
    return NextResponse.json({ error: "Text must be between 1 and 500 characters." }, { status: 400 });
  }

  try {
    const response = await fetch(ttsUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.VOICE_COACH_TTS_TOKEN ? { Authorization: `Bearer ${process.env.VOICE_COACH_TTS_TOKEN}` } : {}),
      },
      body: JSON.stringify({ text, language: "de-DE", format: "wav" }),
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    });

    if (!response.ok) {
      console.error("Voice Coach TTS provider failed", response.status);
      return NextResponse.json({ error: "Voice provider unavailable." }, { status: 502 });
    }

    const audio = await response.arrayBuffer();
    if (!audio.byteLength) return NextResponse.json({ error: "Voice provider returned no audio." }, { status: 502 });

    return new NextResponse(audio, {
      headers: {
        "Cache-Control": "private, max-age=300",
        "Content-Length": String(audio.byteLength),
        "Content-Type": response.headers.get("content-type") || "audio/wav",
      },
    });
  } catch (error) {
    console.error("Voice Coach TTS request failed", error);
    return NextResponse.json({ error: "Voice provider unavailable." }, { status: 502 });
  }
}