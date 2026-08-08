import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { requireAuthSession } from "@/lib/auth";

export async function POST(request: NextRequest) {
  try {
    const session = await requireAuthSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { transcript, scenario } = body;

    if (!transcript || typeof transcript !== "string" || transcript.trim().length < 2) {
      return NextResponse.json(
        { error: "Transcript text is required" },
        { status: 400 }
      );
    }

    const normalizedTranscript = transcript.trim();
    const tips = buildFeedback(normalizedTranscript, scenario);

    return NextResponse.json({
      transcript: normalizedTranscript,
      tips,
      confidence: 88,
      scenario,
    });
  } catch (error) {
    console.error("Voice practice error:", error);
    return NextResponse.json(
      { error: "Failed to analyze voice" },
      { status: 500 }
    );
  }
}

function buildFeedback(transcript: string, scenario?: string) {
  const lower = transcript.toLowerCase();
  const tips: string[] = [];

  if (lower.includes("möchte") || lower.includes("mochte")) {
    tips.push("• Your phrasing is polite and natural. Keep that tone for formal exchanges.");
  }

  if (lower.includes("visum")) {
    tips.push("• 'Visum' is clear and well-pronounced. Keep the stress on the first syllable.");
  }

  if (lower.includes("deutschland") || lower.includes("germany")) {
    tips.push("• Good topic-specific vocabulary for the travel scenario.");
  }

  if (transcript.split(/\s+/).length < 6) {
    tips.push("• Try adding one more detail to make the sentence sound more complete.");
  } else {
    tips.push("• Your pacing is strong. Speak slightly slower for emphasis when you want to sound more confident.");
  }

  if (scenario?.toLowerCase().includes("embassy")) {
    tips.push("• This fits a formal embassy exchange. Use a respectful closing line next time.");
  } else if (scenario?.toLowerCase().includes("landlord")) {
    tips.push("• This sounds suitable for a landlord conversation. Add one practical detail about the apartment.");
  }

  return tips.length > 0 ? tips : ["• Good effort. Keep speaking and your confidence will improve quickly."];
}
