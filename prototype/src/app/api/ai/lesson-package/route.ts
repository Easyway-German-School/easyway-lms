import { NextRequest, NextResponse } from "next/server";
import { generateLessonPackage } from "@/lib/ai";
import { requireAiStaff } from "@/lib/ai-guard";

export async function POST(request: NextRequest) {
  const gate = await requireAiStaff();
  if (!gate.ok) return gate.response;

  try {
    const body = await request.json();
    const lessonInput = body.lesson || {};
    const lessonPackage = await generateLessonPackage(lessonInput);
    return NextResponse.json({ lessonPackage });
  } catch (error) {
    console.error("lesson-package error", error);
    return NextResponse.json({ lessonPackage: null }, { status: 500 });
  }
}
