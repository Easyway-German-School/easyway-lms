import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import ClassRecap from "@/components/notes/ClassRecap";

export const dynamic = "force-dynamic";

/**
 * The page a shared class-notes link resolves to. Public, no sign-in — the
 * whole point of a share link is someone WITHOUT an EasyWay account (a
 * parent, a study partner) reading it. See the share route's own comment for
 * why a private lesson never reaches this page: `shareToken` is only ever
 * set on a non-private `ClassTranscript`.
 */
export default async function SharedNotesPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const transcript = await prisma.classTranscript.findUnique({
    where: { shareToken: token },
    select: {
      summary: true,
      keyPoints: true,
      actionItems: true,
      vocabulary: true,
      isPrivate: true,
      generatedAt: true,
      classRecording: { select: { level: true, material: { select: { title: true, recordedAt: true } } } },
    },
  });

  // Belt and braces: even if a private row's token were ever set by a future
  // bug, this page refuses to render it rather than trusting the query above
  // alone to have been the only thing standing in the way.
  if (!transcript || transcript.isPrivate) notFound();

  const material = transcript.classRecording?.material;

  return (
    <div className="min-h-screen bg-[var(--background)] px-6 py-12 text-[var(--foreground)]">
      <div className="mx-auto max-w-2xl space-y-6">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.24em] text-[var(--accent)]">Shared class notes · EasyWay</p>
          <h1 className="mt-2 text-2xl font-bold">{material?.title ?? "Class notes"}</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {[
              transcript.classRecording?.level,
              material?.recordedAt ? new Date(material.recordedAt).toLocaleDateString() : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>

        <ClassRecap
          data={{
            summary: transcript.summary,
            keyPoints: transcript.keyPoints as string[] | null,
            actionItems: transcript.actionItems as string[] | null,
            vocabulary: transcript.vocabulary as Array<{ de: string; en: string; note?: string }> | null,
          }}
        />

        <p className="pt-4 text-xs text-[var(--muted)]">Shared from an EasyWay German-language class recap.</p>
      </div>
    </div>
  );
}
