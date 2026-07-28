import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const scenario = body.scenario?.toString() || "German roleplay";
  const transcript = "Ich möchte ein Visum beantragen.";
  const tips = [
    `Szenario: ${scenario}`,
    "Mock pronunciation score: 84/100.",
    "Achten Sie auf klare Endkonsonanten und die richtige Betonung der Vokale.",
    "Versuchen Sie, den Satzfluss flüssig zu halten wie ein Muttersprachler.",
  ];

  return NextResponse.json({ transcript, tips });
}
