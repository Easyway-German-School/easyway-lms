/**
 * The rendered recap of a class recording's `ClassTranscript` — summary, key
 * points, action items, vocabulary, and (private lessons only) corrections and
 * progress. Shared by the public share-link page (`/notes/[token]`), the
 * signed-in owner's view (`/notes/class/[id]`), and the offline copy.
 */

export type ClassRecapData = {
  summary: string | null;
  keyPoints?: string[] | null;
  actionItems?: string[] | null;
  vocabulary?: Array<{ de: string; en: string; note?: string }> | null;
  corrections?: Array<{ mistake: string; correction: string; note?: string }> | null;
  progressHighlights?: string[] | null;
};

function Bullets({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <h2 className="text-sm font-semibold text-[var(--foreground)]">{title}</h2>
      <ul className="mt-2 space-y-1.5 text-sm text-[var(--muted)]">
        {items.map((item) => (
          <li key={item} className="flex gap-2">
            <span className="text-[var(--accent)]">•</span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function ClassRecap({ data }: { data: ClassRecapData }) {
  const keyPoints = (data.keyPoints ?? []).filter(Boolean);
  const actionItems = (data.actionItems ?? []).filter(Boolean);
  const vocabulary = data.vocabulary ?? [];
  const corrections = data.corrections ?? [];
  const progress = (data.progressHighlights ?? []).filter(Boolean);

  return (
    <div className="space-y-6">
      {data.summary ? (
        <p className="text-sm leading-7 text-[var(--muted)]">{data.summary}</p>
      ) : null}

      <Bullets title="Key points" items={keyPoints} />
      <Bullets title="Action items" items={actionItems} />

      {corrections.length > 0 ? (
        <div>
          <h2 className="text-sm font-semibold text-[var(--foreground)]">Corrections</h2>
          <ul className="mt-2 space-y-2 text-sm">
            {corrections.map((item) => (
              <li key={item.mistake} className="rounded-xl border border-[var(--border)] px-3 py-2">
                <span className="text-red-500 line-through">{item.mistake}</span>{" "}
                <span className="text-[var(--foreground)]">→ {item.correction}</span>
                {item.note ? <span className="block text-xs text-[var(--muted)]">{item.note}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <Bullets title="Progress this lesson" items={progress} />

      {vocabulary.length > 0 ? (
        <div>
          <h2 className="text-sm font-semibold text-[var(--foreground)]">Vocabulary taught</h2>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {vocabulary.map((word) => (
              <div key={word.de} className="rounded-xl border border-[var(--border)] px-3 py-2">
                <p className="text-sm font-semibold text-[var(--foreground)]">{word.de}</p>
                <p className="text-xs text-[var(--muted)]">
                  {word.en}
                  {word.note ? ` — ${word.note}` : ""}
                </p>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
