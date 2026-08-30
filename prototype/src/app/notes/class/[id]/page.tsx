import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireAuthSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import StudentShell from "@/components/StudentShell";
import ClassRecap from "@/components/notes/ClassRecap";
import DownloadNoteButton from "@/components/notes/DownloadNoteButton";
import { ArrowLeftIcon } from "@/components/icons";

export const dynamic = "force-dynamic";

/**
 * A signed-in student's recap of one class recording — and it stays reachable
 * after the recording's 2-week window closes and the video itself is gone.
 * "The notes stay" lives here.
 *
 * Scoped exactly like the video library: the student's level, a course at
 * their level, or a private class booked for them.
 */
export default async function ClassRecapPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireAuthSession();
  if (!session?.user?.id) redirect(`/auth/signin?callbackUrl=/notes/class/${id}`);

  const student = await prisma.student.findUnique({
    where: { userId: session.user.id },
    select: { id: true, level: true },
  });
  if (!student) notFound();

  const material = await prisma.material.findFirst({
    where: {
      id,
      OR: [
        { level: student.level },
        { course: { level: student.level } },
        { privateClasses: { some: { studentId: student.id } } },
      ],
    },
    select: {
      id: true,
      title: true,
      level: true,
      recordedAt: true,
      course: { select: { level: true } },
      recording: {
        select: {
          privateClassId: true,
          transcript: {
            select: {
              status: true,
              summary: true,
              keyPoints: true,
              actionItems: true,
              vocabulary: true,
              isPrivate: true,
              corrections: true,
              progressHighlights: true,
            },
          },
        },
      },
    },
  });

  const transcript = material?.recording?.transcript;
  if (!material || !transcript || transcript.status !== "ready") notFound();

  const isPrivate = Boolean(material.recording?.privateClassId);
  const recap = {
    summary: transcript.summary,
    keyPoints: transcript.keyPoints as string[] | null,
    actionItems: transcript.actionItems as string[] | null,
    vocabulary: transcript.vocabulary as Array<{ de: string; en: string; note?: string }> | null,
    // Only a private lesson honestly carries these — see the ClassTranscript schema comment.
    corrections: isPrivate ? (transcript.corrections as Array<{ mistake: string; correction: string; note?: string }> | null) : null,
    progressHighlights: isPrivate ? (transcript.progressHighlights as string[] | null) : null,
  };

  return (
    <StudentShell>
      <div className="min-h-screen bg-[var(--background)] px-6 py-10 text-[var(--foreground)]">
        <div className="mx-auto max-w-2xl space-y-6">
          <Link
            href="/notes"
            className="inline-flex items-center gap-2 text-sm font-medium text-[var(--muted)] transition hover:text-[var(--foreground)]"
          >
            <ArrowLeftIcon /> My Notes
          </Link>

          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.24em] text-[var(--accent)]">
                {isPrivate ? "Private lesson recap" : "Class recap"}
              </p>
              <h1 className="mt-2 text-2xl font-bold">{material.title}</h1>
              <p className="mt-1 text-sm text-[var(--muted)]">
                {[
                  material.level ?? material.course?.level,
                  material.recordedAt ? new Date(material.recordedAt).toLocaleDateString() : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
            <DownloadNoteButton kind="class" materialId={material.id} title={material.title} payload={recap} />
          </div>

          <ClassRecap data={recap} />

          <p className="pt-4 text-xs text-[var(--muted)]">
            The recording itself leaves your library 2 weeks after the class — this recap stays.
          </p>
        </div>
      </div>
    </StudentShell>
  );
}
