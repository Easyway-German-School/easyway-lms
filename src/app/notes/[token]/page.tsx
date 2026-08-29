import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";

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
  const keyPoints = (transcript.keyPoints as string[] | null) ?? [];
  const actionItems = (transcript.actionItems as string[] | null) ?? [];
  const vocabulary = (transcript.vocabulary as Array<{ de: string; en: string; note?: string }> | null) ?? [];

  return (
    <div className="min-h-screen bg-[var(--background)] px-6 py-12 text-[var(--foreground)]">
      <div className="mx-auto max-w-2xl space-y-6">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.24em] text-[var(--accent)]">Shared class notes · EasyWay</p>
          <h1 className="mt-2 text-2xl font-bold">{material?.title ?? "Class notes"}</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {[transcript.classRecording?.level, material?.recordedAt ? new Date(material.recordedAt).toLocaleDateString() : null]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>

        <p className="text-sm leading-6 text-[var(--muted)]">{transcript.summary}</p>

        {keyPoints.length > 0 ? (
          <div>
            <h2 className="text-sm font-semibold">Key points</h2>
            <ul className="mt-2 space-y-1.5 text-sm text-[var(--muted)]">
              {keyPoints.map((point) => (
                <li key={point} className="flex gap-2">
                  <span className="text-[var(--accent)]">•</span>
                  <span>{point}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {actionItems.length > 0 ? (
          <div>
            <h2 className="text-sm font-semibold">Action items</h2>
            <ul className="mt-2 space-y-1.5 text-sm text-[var(--muted)]">
              {actionItems.map((item) => (
                <li key={item} className="flex gap-2">
                  <span className="text-[var(--accent)]">•</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {vocabulary.length > 0 ? (
          <div>
            <h2 className="text-sm font-semibold">Vocabulary taught</h2>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {vocabulary.map((word) => (
                <div key={word.de} className="rounded-xl border border-[var(--border)] px-3 py-2">
                  <p className="text-sm font-semibold">{word.de}</p>
                  <p className="text-xs text-[var(--muted)]">
                    {word.en}
                    {word.note ? ` — ${word.note}` : ""}
                  </p>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <p className="pt-4 text-xs text-[var(--muted)]">Shared from an EasyWay German-language class recap.</p>
      </div>
    </div>
  );
}
