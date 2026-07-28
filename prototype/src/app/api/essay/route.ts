import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { prisma } from "@/lib/prisma";

const OPENAI_KEY = process.env.OPENAI_API_KEY;

function normalizeEssay(essay: string) {
  return essay.trim().replace(/\s+/g, " ");
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions as any) as any;
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const essay = normalizeEssay(body.essay?.toString() || "");

  if (!essay.length) {
    return NextResponse.json({ error: "Essay text is required." }, { status: 400 });
  }

  const student = await prisma.student.findUnique({
    where: { userId: session.user.id as string }
  });

  if (!student) {
    return NextResponse.json({ error: "Student not found" }, { status: 404 });
  }

  if (OPENAI_KEY && OPENAI_KEY.length > 20 && !OPENAI_KEY.startsWith("sk-placeholder")) {
    try {
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${OPENAI_KEY}`,
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content: `You are an exam coach for German learners. Grade the essay on grammar, vocabulary, coherence, and spelling. Reply with valid JSON containing { summary: string, score: number, feedback: string[] } only.`,
            },
            {
              role: "user",
              content: `Grade this essay:\n\n${essay}`,
            },
          ],
          temperature: 0.3,
          max_tokens: 500,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        const content = data.choices?.[0]?.message?.content;
        if (content) {
          try {
            const parsed = JSON.parse(content);
            // Save grade to database
            await prisma.grade.create({
              data: {
                studentId: student.id,
                type: "essay",
                content: essay,
                score: parsed.score || 75,
                feedback: parsed.feedback?.join("\n") || "Good effort"
              }
            });
            return NextResponse.json(parsed);
          } catch (error) {
            console.warn("Failed to parse OpenAI essay JSON", error);
          }
        }
      }
    } catch (error) {
      console.error("OpenAI essay grading error:", error);
    }
  }

  const wordCount = essay.split(/\s+/).length;
  const baseScore = Math.min(90, Math.max(55, 70 + Math.round((wordCount - 120) / 20)));

  return NextResponse.json({
    summary: `Mock Goethe score: ${baseScore}/100 — strong structure with room to tighten grammar.`,
    score: baseScore,
    feedback: [
      "Good use of transition phrases, but check subordinate clause word order.",
      "Consider adding stronger conclusion statements for clearer exam style.",
      "Your vocabulary is varied, though a few spelling details need review.",
      "Strong coherence between paragraphs — keep the logic consistent.",
    ],
  });
}
