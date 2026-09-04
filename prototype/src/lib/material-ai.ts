import { prisma } from "@/lib/prisma";
import { cached } from "@/lib/ai-cache";
import { extractText } from "@/lib/extract-text";
import { getFile } from "@/lib/storage";
import { callModel, activeModelName } from "@/lib/ai";
import { parseModelJson } from "@/lib/safe-json";
import { notifyInBackground, KIND } from "@/lib/notify";
import { tutorUserIdsForMaterial } from "@/lib/material-audience";

/**
 * Turning what a tutor uploaded into something a student will actually open.
 *
 * The problem this exists for is not technical. A tutor uploads a 14-page PDF
 * for Thursday; most students never open it, and the ones who do skim it once.
 * The material is not the obstacle — starting is. So the same file is offered
 * three ways, each a smaller ask than the last:
 *
 *   a summary       — thirty seconds, tells you whether you care
 *   key points      — what you would have highlighted
 *   quests          — three concrete things to DO, each under five minutes
 *
 * All of it is generated in the background, once, after upload — never while a
 * student waits. Tutors upload days ahead of the class, which is exactly the
 * slack this needs, and it is why a slow local model is fine here.
 */

export type MaterialQuest = {
  title: string;
  task: string;
  /** The answer, for self-marking. Never sent to the student before they try. */
  answer: string;
  xp: number;
};

/**
 * A written-up study note built from the material — what lands in a student's
 * "My Notes" hub so the tutor's handout arrives already read for them. Longer
 * and more structured than `summary`/`keyPoints`, which stay tuned for the
 * fifteen-second skim on the dashboard.
 */
export type StudyNote = {
  /** 2-4 sentences: what this covers and why it matters at this level. */
  overview: string;
  /** The body, as headed groups of bullet points. */
  sections: Array<{ heading: string; points: string[] }>;
  /** New German words/phrases this material teaches. */
  vocabulary: Array<{ de: string; en: string; note?: string }>;
  /** Grammar points worth calling out, if any. */
  grammar?: string[];
};

export type MaterialInsight = {
  summary: string;
  keyPoints: string[];
  quests: MaterialQuest[];
  notes?: StudyNote;
};

/** Enough text to be worth summarising. Below this it is a title page. */
const MIN_USEFUL_CHARS = 400;

/** What we send the model. Small models lose the plot well before this. */
const MAX_PROMPT_CHARS = 6000;

function buildPrompt(title: string, level: string, text: string): string {
  return [
    `You are helping students at a Nigerian school learn German at CEFR level ${level}.`,
    `Their tutor uploaded a material called "${title}".`,
    "",
    "Here is what it says:",
    "---",
    text.slice(0, MAX_PROMPT_CHARS),
    "---",
    "",
    "Produce, in English except for the German words being taught:",
    `1. "summary" — 2 sentences. What is this and why should a ${level} student care?`,
    '2. "keyPoints" — 3 to 5 short bullets. The things worth remembering.',
    '3. "quests" — exactly 3 tasks, each doable in under 5 minutes, each with a checkable answer.',
    "   Base every quest on THIS material, not on German in general.",
    `   Keep them possible for a ${level} student.`,
    '4. "notes" — a written-up study note a student can revise from, as an object:',
    `     "overview": 2 to 4 sentences setting up what this material covers for a ${level} student.`,
    '     "sections": 2 to 5 objects, each {"heading","points":[3-6 short bullets]}, walking through the actual content.',
    '     "vocabulary": every new German word or phrase, each {"de","en","note"}. "note" optional. [] if none.',
    '     "grammar": short bullets naming grammar points this material relies on. [] if none.',
    "   Everything in notes must come from THIS material — do not pad it with general German.",
    "",
    "Reply with ONLY this JSON:",
    '{"summary":"…","keyPoints":["…"],"quests":[{"title":"…","task":"…","answer":"…","xp":20}],' +
      '"notes":{"overview":"…","sections":[{"heading":"…","points":["…"]}],"vocabulary":[{"de":"…","en":"…","note":"…"}],"grammar":["…"]}}',
  ].join("\n");
}

/**
 * Shared validation for a quest list, whether it came out of the model
 * (`coerceInsight`, below) or off a tutor's edit form (the review API) — a
 * tutor typing an empty title should fail the same way a bad generation does.
 */
export function coerceQuests(raw: unknown): MaterialQuest[] {
  return (Array.isArray(raw) ? raw : [])
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const quest = entry as Record<string, unknown>;
      const title = String(quest.title ?? "").trim();
      const task = String(quest.task ?? "").trim();
      if (!title || !task) return null;
      const xp = Number(quest.xp);
      return {
        title,
        task,
        answer: String(quest.answer ?? "").trim(),
        xp: Number.isFinite(xp) && xp > 0 ? Math.min(Math.round(xp), 100) : 20,
      } satisfies MaterialQuest;
    })
    .filter((quest): quest is MaterialQuest => quest !== null)
    .slice(0, 3);
}

function coerceInsight(raw: unknown): MaterialInsight | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;

  const summary = String(value.summary ?? "").trim();
  if (!summary) return null;

  const keyPoints = (Array.isArray(value.keyPoints) ? value.keyPoints : [])
    .map((point) => String(point ?? "").trim())
    .filter(Boolean)
    .slice(0, 6);

  const quests = coerceQuests(value.quests);
  const notes = coerceStudyNote(value.notes);

  // A summary with no quests (or no notes) is still worth keeping — it is most
  // of the value, and refusing it would mean one weak generation loses the lot.
  return { summary, keyPoints, quests, notes };
}

/** Validate/clamp a StudyNote off the model or (later) a tutor's edit. */
export function coerceStudyNote(raw: unknown): StudyNote | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const value = raw as Record<string, unknown>;

  const overview = String(value.overview ?? "").trim();
  if (!overview) return undefined;

  const sections = (Array.isArray(value.sections) ? value.sections : [])
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const item = entry as Record<string, unknown>;
      const heading = String(item.heading ?? "").trim();
      const points = (Array.isArray(item.points) ? item.points : [])
        .map((point) => String(point ?? "").trim())
        .filter(Boolean)
        .slice(0, 8);
      if (!heading || points.length === 0) return null;
      return { heading, points };
    })
    .filter((entry): entry is { heading: string; points: string[] } => entry !== null)
    .slice(0, 8);

  const vocabulary = (Array.isArray(value.vocabulary) ? value.vocabulary : [])
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const item = entry as Record<string, unknown>;
      const de = String(item.de ?? "").trim();
      const en = String(item.en ?? "").trim();
      if (!de || !en) return null;
      const note = String(item.note ?? "").trim();
      return note ? { de, en, note } : { de, en };
    })
    .filter((entry): entry is { de: string; en: string; note?: string } => entry !== null)
    .slice(0, 40);

  const grammar = (Array.isArray(value.grammar) ? value.grammar : [])
    .map((point) => String(point ?? "").trim())
    .filter(Boolean)
    .slice(0, 10);

  // Overview alone is thin; require at least one section or some vocabulary
  // before this is worth showing as a "note".
  if (sections.length === 0 && vocabulary.length === 0) return undefined;

  return { overview, sections, vocabulary, grammar: grammar.length ? grammar : undefined };
}

/**
 * Read the file, ask the model, store the answer.
 *
 * Returns null when there is nothing to work with — a video, an image, a
 * near-empty PDF — which is a normal outcome, not a failure. The material is
 * marked so the queue stops reconsidering it every run.
 */
export async function generateForMaterial(materialId: string): Promise<MaterialInsight | null> {
  const material = await prisma.material.findUnique({
    where: { id: materialId },
    select: {
      id: true, title: true, filePath: true, fileName: true,
      fileType: true, level: true, kind: true, uploadedBy: true,
      branchId: true, sessionSlot: true, batch: true,
      visibleToStudents: true, lecturerId: true,
      course: { select: { level: true } },
      lecturer: { select: { userId: true } },
    },
  });
  if (!material) return null;

  // When notes can't be written, tell the tutor who uploaded it — not the
  // students. Their side stays quiet and just shows "still being prepared".
  const tellTutor = () => {
    const userId = material.lecturer?.userId ?? material.uploadedBy ?? null;
    if (!userId) return;
    notifyInBackground({
      to: { userIds: [userId] },
      kind: KIND.studyNotesFailed,
      severity: "warning",
      title: "Becca couldn't write up notes for a material",
      message: `“${material.title}” didn't produce a study note. Open it in the lesson builder to try again.`,
      link: `/lecturer/materials/${material.id}`,
      dedupeKey: `study-notes-failed:${material.id}`,
    });
  };

  // Recordings and videos carry no readable text. Marked `none` rather than
  // `failed`: nothing went wrong, there is simply nothing to read.
  if (material.kind === "recording" || (material.fileType || "").startsWith("video")) {
    await prisma.material.update({ where: { id: material.id }, data: { aiState: "none" } });
    return null;
  }

  await prisma.material.update({ where: { id: material.id }, data: { aiState: "pending" } });

  try {
    const file = await getFile(material.filePath);
    if (!file) throw new Error("file not found in storage");

    const buffer = Buffer.from(await file.arrayBuffer());
    const text = await extractText(buffer, material.fileName, material.fileType);

    if (text.trim().length < MIN_USEFUL_CHARS) {
      await prisma.material.update({ where: { id: material.id }, data: { aiState: "none" } });
      return null;
    }

    const level = material.level || material.course?.level || "A1";

    // Cached on the TEXT, not the material id: re-uploading the same handout
    // under a new title costs nothing, which is exactly what happens each
    // time a level starts again.
    const insight = await cached<MaterialInsight>(
      "material_summary",
      `${level}:${text.slice(0, MAX_PROMPT_CHARS)}`,
      async () => {
        // Higher than the 1200 it was before "notes" existed — a written-up
        // study note plus a summary, key points and three quests does not fit
        // in that budget.
        const raw = await callModel(buildPrompt(material.title, level, text), 2400, "learning-content");
        return coerceInsight(parseModelJson(raw));
      },
      { model: activeModelName() },
    );

    if (!insight) {
      await prisma.material.update({
        where: { id: material.id },
        data: { aiState: "failed", aiUpdatedAt: new Date() },
      });
      tellTutor();
      return null;
    }

    await prisma.material.update({
      where: { id: material.id },
      data: {
        aiSummary: insight.summary,
        aiKeyPoints: insight.keyPoints,
        aiQuests: insight.quests as unknown as object[],
        aiNotes: (insight.notes as unknown as object) ?? undefined,
        aiState: "ready",
        aiUpdatedAt: new Date(),
      },
    });

    /**
     * Nudge the tutor(s) that there is something to sign off.
     *
     * Nothing the model wrote reaches a student until a tutor approves the
     * quests (`questsReviewedAt`, which also gates the notes). Without this the
     * tutor had to happen to open the material and notice the panel — and for
     * an office cohort upload there is no single owner watching for it at all,
     * so the generated quests would simply never go live. Goes to the assigned
     * tutor(s) for the cohort, resolved the same way the roster is.
     */
    if (insight.quests.length > 0 || insight.notes) {
      const tutorIds = await tutorUserIdsForMaterial(material);
      if (tutorIds.length) {
        notifyInBackground({
          to: { userIds: tutorIds },
          kind: KIND.questsToReview,
          severity: "info",
          title: "Quests ready to review",
          message: `Becca drafted quests and study notes for “${material.title}”. Open Materials to check them — students see them once you sign off.`,
          link: "/lecturer/materials",
          dedupeKey: `quests-review:${material.id}`,
        });
      }
    }

    return insight;
  } catch (error) {
    console.error("[material-ai] failed for", material.id, error);
    await prisma.material.update({
      where: { id: material.id },
      data: { aiState: "failed", aiUpdatedAt: new Date() },
    });
    tellTutor();
    return null;
  }
}

/**
 * Work through materials that have not been looked at yet.
 *
 * Deliberately small per run and ordered by upload date. This shares a machine
 * with the school's actual portal, and a queue that tries to summarise forty
 * PDFs at once would take the memory the site needs to serve pages — which on
 * a 7GB box is not hypothetical.
 */
export async function processMaterialQueue(limit = 3): Promise<{
  attempted: number;
  ready: number;
  skipped: number;
}> {
  const pending = await prisma.material.findMany({
    where: {
      aiState: { in: ["none", "pending"] },
      kind: { not: "recording" },
      // Only ones uploaded recently: back-filling the entire library on the
      // first run would be hours of generation nobody asked for.
      createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: { id: true },
  });

  let ready = 0;
  let skipped = 0;

  for (const material of pending) {
    const insight = await generateForMaterial(material.id);
    if (insight) ready += 1;
    else skipped += 1;
  }

  return { attempted: pending.length, ready, skipped };
}
