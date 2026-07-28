import { NextResponse } from "next/server";
import { generateCourseOutline } from "@/lib/ai";

export async function POST(req: Request) {
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
