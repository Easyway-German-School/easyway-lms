// Colours are chosen for text contrast: white on the blues, navy on the golds.
const LEVELS = [
  { code: "A1", label: "Beginner", from: "#4a82c8", to: "#3f74b8", dark: false },
  { code: "A2", label: "Elementary", from: "#3f74b8", to: "#33659f", dark: false },
  { code: "B1", label: "Intermediate", from: "#33659f", to: "#2a5688", dark: false },
  { code: "B2", label: "Upper-intermediate", from: "#2a5688", to: "#4d5f80", dark: false },
  { code: "C1", label: "Advanced", from: "#c9a23c", to: "#dcb64a", dark: true },
  { code: "C2", label: "Mastery", from: "#dcb64a", to: "#efd27a", dark: true },
];

/** The CEFR ladder as a colour journey, from cool blue to gold. */
export default function LevelsStrip() {
  return (
    <section className="relative overflow-hidden bg-gradient-to-br from-[var(--navy-deep)] via-[var(--navy)] to-[#12325c] px-5 pb-32 pt-16 text-white sm:px-6 sm:pb-36 sm:pt-20">
      <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-[var(--gold-bright)]/10 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-32 -left-16 h-80 w-80 rounded-full bg-[var(--sky)]/30 blur-3xl" />
      <div className="relative mx-auto max-w-6xl">
        <div className="reveal max-w-2xl">
          <p className="flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.35em] text-[var(--gold-bright)]">
            <span className="h-px w-8 bg-[var(--gold-bright)]" />
            One ladder, six steps
          </p>
          <h2 className="font-serif-display mt-4 text-balance text-3xl font-semibold leading-tight sm:text-5xl">
            From first words to fluency
          </h2>
          <p className="mt-4 text-base leading-relaxed text-white/75">
            The ÖSD certifies German across the whole CEFR scale, A1 to C2. The levels on offer at each
            sitting are listed on the departures board below.
          </p>
        </div>

        <ol className="mt-10 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {LEVELS.map((l, i) => (
            <li
              key={l.code}
              className="reveal card-lift relative overflow-hidden rounded-2xl p-5 shadow-lg shadow-black/20 ring-1 ring-white/15"
              style={{ backgroundImage: `linear-gradient(145deg, ${l.from}, ${l.to})` }}
            >
              <span
                className={`pointer-events-none absolute -right-2 -top-4 font-serif-display text-7xl font-bold ${l.dark ? "text-[#071328]/10" : "text-white/10"}`}
                aria-hidden="true"
              >
                {i + 1}
              </span>
              <p className={`font-serif-display text-4xl font-semibold ${l.dark ? "text-[var(--navy-deep)]" : "text-white"}`}>{l.code}</p>
              <p className={`mt-1 text-xs font-semibold uppercase tracking-wider ${l.dark ? "text-[var(--navy-deep)]/80" : "text-white/90"}`}>{l.label}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
