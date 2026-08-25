import { NextRequest, NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { findOwnedRecordingMaterial } from "@/lib/class-notes-access";

export const dynamic = "force-dynamic";

/**
 * A student's own editable copy of a class's notes — "just like Zoho
 * Notebook". Independent of `ClassTranscript`: this can be opened and typed
 * into before the AI pass has even finished, and a later re-generation of
 * the AI notes never touches what a student wrote here. See the model
 * comment on `StudentClassNote` in schema.prisma.
 */

const MAX_CONTENT_CHARS = 20_000;

async function requireOwnedMaterial(materialId: string, userId: string) {
  const student = await prisma.student.findUnique({ where: { userId } });
  if (!student) return { error: NextResponse.json({ error: "Student not found" }, { status: 404 }) } as const;

  const material = await findOwnedRecordingMaterial(materialId, student);
  if (!material) return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) } as const;

  return { student, material } as const;
}

/** Get-or-create: an empty note is seeded from the AI summary the first time it is opened, never after. */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const session = await requireAuthSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const resolved = await requireOwnedMaterial(id, session.user.id);
  if ("error" in resolved) return resolved.error;
  const { student, material } = resolved;

  const existing = await prisma.studentClassNote.findUnique({
    where: { studentId_materialId: { studentId: student.id, materialId: material.id } },
  });
  if (existing) {
    return NextResponse.json({ content: existing.content, updatedAt: existing.updatedAt, seeded: false });
  }

  const seed = buildSeed(material.recording?.transcript);

  return NextResponse.json({ content: seed, updatedAt: null, seeded: Boolean(seed) });
}

/**
 * What a blank notebook opens with. A private lesson gets more than a
 * summary to start from — its corrections and vocabulary are already
 * personal to this one student, so handing them over as a starting outline
 * is a real head start, not just a recap; a group class's notes stay generic
 * on purpose (see the module comment on `ClassTranscript.isPrivate`), so
 * there is nothing student-specific to add here for those.
 */
function buildSeed(
  transcript:
    | {
        status: string;
        summary: string | null;
        isPrivate: boolean;
        vocabulary: unknown;
        corrections: unknown;
      }
    | null
    | undefined,
): string {
  if (!transcript || transcript.status !== "ready" || !transcript.summary) return "";

  const lines = [transcript.summary, ""];

  if (transcript.isPrivate) {
    const vocabulary = (transcript.vocabulary as Array<{ de: string; en: string }> | null) ?? [];
    const corrections = (transcript.corrections as Array<{ mistake: string; correction: string }> | null) ?? [];

    if (vocabulary.length > 0) {
      lines.push("Vocabulary:");
      vocabulary.forEach((word) => lines.push(`- ${word.de} — ${word.en}`));
      lines.push("");
    }
    if (corrections.length > 0) {
      lines.push("To practice:");
      corrections.forEach((item) => lines.push(`- ${item.mistake} → ${item.correction}`));
      lines.push("");
    }
  }

  return lines.join("\n").trim() + "\n";
}

/** Autosave. Upserts on every call — the client debounces, this stays simple. */
export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const session = await requireAuthSession();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const resolved = await requireOwnedMaterial(id, session.user.id);
  if ("error" in resolved) return resolved.error;
  const { student, material } = resolved;

  const body = await request.json().catch(() => ({}));
  const content = String(body?.content ?? "").slice(0, MAX_CONTENT_CHARS);

  const saved = await prisma.studentClassNote.upsert({
    where: { studentId_materialId: { studentId: student.id, materialId: material.id } },
    create: { studentId: student.id, materialId: material.id, content },
    update: { content },
  });

  return NextResponse.json({ updatedAt: saved.updatedAt });
}
