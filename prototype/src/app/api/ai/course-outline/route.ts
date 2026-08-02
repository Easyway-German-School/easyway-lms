import { NextResponse } from "next/server";
import { generateCourseOutline } from "@/lib/ai";
import { requireAiStaff } from "@/lib/ai-guard";

export async function POST(req: Request) {
  // Authoring tool: tutors and admins. It answered anonymous POSTs until now,
  // and every one of them spent the school's model budget.
  const gate = await requireAiStaff();
  if (!gate.ok) return gate.response;

  try {
    const body = await req.json();
    const courseInfo = body.course || {};
    const outline = await generateCourseOutline(courseInfo);
    return NextResponse.json({ outline });
  } catch (error) {
    console.error("course-outline error", error);
    return NextResponse.json({ outline: null }, { status: 500 });
  }
}
