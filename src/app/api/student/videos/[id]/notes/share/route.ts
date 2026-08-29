import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { findOwnedRecordingMaterial } from "@/lib/class-notes-access";

export const dynamic = "force-dynamic";

/**
 * "Share" — an EasyWay link generated on request, the way Happy Scribe's own
 * share button works, rather than a PDF you have to hand someone.
 *
 * Deliberately refused for a private lesson. The public page this resolves
 * to (`/notes/[token]`) never renders `corrections`/`progressHighlights`
 * regardless of what's in the row, but even the group-safe fields — summary,
 * vocabulary — are still one family's paid one-to-one lesson; a shareable
 * link for that is a different product decision than sharing a cohort
 * class's notes, and nobody asked for it.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const session = await requireAuthSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const student = await prisma.student.findUnique({ where: { userId: session.user.id } });
  if (!student) return NextResponse.json({ error: "Student not found" }, { status: 404 });

  const material = await findOwnedRecordingMaterial(id, student);
  if (!material) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const transcript = material.recording?.transcript;
  if (!transcript || transcript.status !== "ready") {
    return NextResponse.json({ error: "Notes are not ready for this class yet" }, { status: 409 });
  }
  if (transcript.isPrivate) {
    return NextResponse.json({ error: "Private lesson notes cannot be shared by link" }, { status: 403 });
  }

  const token = transcript.shareToken ?? crypto.randomBytes(16).toString("base64url");
  if (!transcript.shareToken) {
    await prisma.classTranscript.update({ where: { id: transcript.id }, data: { shareToken: token } });
  }

  const base = (process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || "").trim().replace(/\/+$/, "");
  const url = `${base || ""}/notes/${token}`;

  return NextResponse.json({ url, token });
}
