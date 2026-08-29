import { NextResponse } from "next/server";
import { generateMissionPracticeFeedback } from "@/lib/ai";
import { requireAiUser } from "@/lib/ai-guard";
import { reserveStudentAiRequest } from "@/lib/ai-limits";

export async function POST(req: Request) {
  // A student feature, so any signed-in account — but not the whole internet.
  const gate = await requireAiUser();
  if (!gate.ok) return gate.response;

  try {
    const body = await req.json();
    const missionTitle = String(body?.missionTitle || "practice mission");
    const missionDescription = String(body?.missionDescription || "Complete the task with a short response.");
    const studentResponse = String(body?.studentResponse || "").trim();

    if (!studentResponse) {
      return NextResponse.json(
        {
          prompt: `Practice this mission: ${missionTitle}\n\n${missionDescription}\n\nWrite a short answer in German or English, depending on the task.`,
          feedback: "Please write a short answer to start the practice session.",
          score: 0,
        },
        { status: 200 }
      );
    }

    const quota = await reserveStudentAiRequest(gate.userId, "missionPractice");
    if (!quota.allowed) {
      return NextResponse.json({ error: "Daily mission practice limit reached. Try again tomorrow." }, { status: 429 });
    }

    const result = await generateMissionPracticeFeedback({
      title: missionTitle,
      description: missionDescription,
      response: studentResponse,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("mission-practice error", error);
    return NextResponse.json({ error: "Mission practice failed" }, { status: 500 });
  }
}

// Long-running: model calls / bulk work. Set here (not vercel.json) so it
// travels with the route regardless of where the app is built from.
export const maxDuration = 60;
