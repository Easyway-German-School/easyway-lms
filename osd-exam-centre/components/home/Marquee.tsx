const CITIES = [
  "Wien", "Berlin", "München", "Zürich", "Salzburg", "Hamburg",
  "Heidelberg", "Graz", "Basel", "Innsbruck", "Köln", "Frankfurt",
];

/** A departure-board ticker of D-A-CH cities — pure decoration, hidden from assistive tech. */
export default function Marquee() {
  const row = (
    <div className="flex items-center gap-8 pr-8">
      {CITIES.map((c) => (
        <span key={c} className="flex items-center gap-8">
          <span className="font-serif-display text-lg tracking-wide text-white/85">{c}</span>
          <span className="text-[var(--gold-bright)]/70">✦</span>
        </span>
      ))}
    </div>
  );
  return (
    <div aria-hidden="true" className="relative overflow-hidden border-y border-white/10 bg-[var(--navy-deep)] py-4">
      <div className="marquee-track">
        {row}
        {row}
      </div>
      <div className="pointer-events-none absolute inset-y-0 left-0 w-24 bg-gradient-to-r from-[var(--navy-deep)] to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-24 bg-gradient-to-l from-[var(--navy-deep)] to-transparent" />
    </div>
  );
}
