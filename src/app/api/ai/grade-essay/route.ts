import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { gradeEssay } from "@/lib/ai";

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions as any) as any;
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { essay } = body;

    if (!essay || essay.trim().length < 10) {
      return NextResponse.json(
        { error: "Essay must be at least 10 characters" },
        { status: 400 }
      );
    }

    const result = await gradeEssay(essay);
    
    // Generate AI-driven next steps based on the grade
    const { generateEssayNextSteps } = await import("@/lib/ai");
    const nextStep = await generateEssayNextSteps(result.score, result.feedback, essay);

    return NextResponse.json({
      ...result,
      nextStep, // Add AI-generated suggestion
    });
  } catch (error) {
    console.error("Essay grading error:", error);
    return NextResponse.json(
      { error: "Failed to grade essay" },
      { status: 500 }
    );
  }
}
