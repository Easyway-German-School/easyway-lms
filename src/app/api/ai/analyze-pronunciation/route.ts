import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { analyzePronunciation } from "@/lib/ai";

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions as any) as any;
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { phrase } = body;

    if (!phrase || phrase.trim().length < 3) {
      return NextResponse.json(
        { error: "Phrase must be at least 3 characters" },
        { status: 400 }
      );
    }

    const result = await analyzePronunciation(phrase);

    return NextResponse.json(result);
  } catch (error) {
    console.error("Pronunciation analysis error:", error);
    return NextResponse.json(
      { error: "Failed to analyze pronunciation" },
      { status: 500 }
    );
  }
}
