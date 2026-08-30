import type { StudyNote } from "@/lib/material-ai";

/**
 * Renders a ready-made note (`Material.aiNotes`). Shared by the reader page
 * and the offline copy on `/materials/offline`, so it takes a plain object and
 * nothing else.
 */
export default function StudyNoteView({ note }: { note: StudyNote }) {
  return (
    <div className="space-y-6">
      <p className="text-sm leading-7 text-[var(--muted)]">{note.overview}</p>

      {note.sections?.map((section) => (
        <section key={section.heading}>
          <h2 className="text-sm font-semibold text-[var(--foreground)]">{section.heading}</h2>
          <ul className="mt-2 space-y-1.5 text-sm text-[var(--muted)]">
            {section.points.map((point) => (
              <li key={point} className="flex gap-2">
                <span className="text-[var(--accent)]">•</span>
                <span>{point}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {note.grammar && note.grammar.length > 0 ? (
        <section>
          <h2 className="text-sm font-semibold text-[var(--foreground)]">Grammar to watch</h2>
          <ul className="mt-2 space-y-1.5 text-sm text-[var(--muted)]">
            {note.grammar.map((point) => (
              <li key={point} className="flex gap-2">
                <span className="text-[var(--accent)]">•</span>
                <span>{point}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {note.vocabulary && note.vocabulary.length > 0 ? (
        <section>
          <h2 className="text-sm font-semibold text-[var(--foreground)]">Vocabulary</h2>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {note.vocabulary.map((word) => (
              <div key={word.de} className="rounded-xl border border-[var(--border)] px-3 py-2">
                <p className="text-sm font-semibold text-[var(--foreground)]">{word.de}</p>
                <p className="text-xs text-[var(--muted)]">
                  {word.en}
                  {word.note ? ` — ${word.note}` : ""}
                </p>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
