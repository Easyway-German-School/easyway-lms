import { NextRequest, NextResponse } from "next/server";
import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolveLecturerId } from "@/lib/lecturer";
import { coerceQuests, type MaterialQuest } from "@/lib/material-ai";
import { notifyInBackground, KIND } from "@/lib/notify";
import {
  MATERIAL_AUDIENCE_SELECT,
  studentIdsForMaterial,
  tutorMayReviewMaterial,
} from "@/lib/material-audience";

/**
 * A tutor's review pass on the AI-generated quests for a material.
 *
 * The model's output never reaches a student unmoderated — see the
 * `questsReviewedAt` doc comment on the Material schema. This is the only write
 * path for that field, so every quest a student ever sees passed through a
 * tutor who could have changed it.
 *
 * A tutor may review their own uploads, and also an office cohort upload whose
 * class their assignment covers — otherwise the quests an admin's upload
 * generates would have no one able to sign them off, and would never go live.
 */

async function authorizeMaterial(materialId: string) {
  const session = await requireAuthSession();
  if (!session || session.user.role !== "lecturer") {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) } as const;
  }

  const lecturerId = await resolveLecturerId(session.user.id);
  if (!lecturerId) {
    return { error: NextResponse.json({ error: "Lecturer profile not found" }, { status: 404 }) } as const;
  }

  const material = await prisma.material.findUnique({
    where: { id: materialId },
    select: {
      ...MATERIAL_AUDIENCE_SELECT,
      title: true,
      aiSummary: true,
      aiKeyPoints: true,
      aiQuests: true,
      aiNotes: true,
      aiState: true,
      questsReviewedAt: true,
      questsReviewedBy: true,
    },
  });
  if (!material || !(await tutorMayReviewMaterial(material, lecturerId))) {
    return { error: NextResponse.json({ error: "Material not found" }, { status: 404 }) } as const;
  }

  return { lecturerId, material } as const;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await authorizeMaterial(id);
  if ("error" in auth) return auth.error;

  return NextResponse.json({
    title: auth.material.title,
    aiState: auth.material.aiState,
    summary: auth.material.aiSummary,
    keyPoints: auth.material.aiKeyPoints ?? [],
    quests: (auth.material.aiQuests as unknown as MaterialQuest[] | null) ?? [],
    // The ready-made study note is released to students by the SAME sign-off
    // as the quests — see the note preview in LecturerQuestReview.
    notes: auth.material.aiNotes ?? null,
    reviewedAt: auth.material.questsReviewedAt,
  });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await authorizeMaterial(id);
  if ("error" in auth) return auth.error;

  const body = await req.json().catch(() => ({}));
  const quests = coerceQuests(body.quests);
  if (quests.length === 0) {
    return NextResponse.json(
      { error: "At least one valid quest (a title and a task) is required" },
      { status: 400 },
    );
  }
  const approve = body.approve === true;
  const firstApproval = approve && !auth.material.questsReviewedAt;

  const updated = await prisma.material.update({
    where: { id },
    data: {
      aiQuests: quests as unknown as object[],
      ...(approve ? { questsReviewedAt: new Date(), questsReviewedBy: auth.lecturerId } : {}),
    },
    select: { aiQuests: true, questsReviewedAt: true },
  });

  /**
   * Tell the class the quests and notes are live — the first time only, so
   * re-editing an already-approved material does not buzz two hundred phones
   * again. Reaches the tutor's roster for their own upload, or the described
   * cohort for an office one.
   */
  if (firstApproval) {
    const studentIds = await studentIdsForMaterial(auth.material);
    if (studentIds.length) {
      notifyInBackground({
        to: { studentIds },
        kind: KIND.studyNotesReady,
        severity: "info",
        title: "New quests and notes from your tutor",
        message: `“${auth.material.title}” now has a quick quest and a written-up study note. Open Materials to start.`,
        link: "/materials",
        push: true,
        dedupeKey: `study-notes-ready:${id}`,
      });
    }
  }

  return NextResponse.json({ quests: updated.aiQuests, reviewedAt: updated.questsReviewedAt });
}
