import { EDUPRIME } from "@/lib/platform/brand";

/**
 * The EduPrime mark: a prism.
 *
 * A single beam of white light — one codebase, one deployment — enters the
 * left face and leaves the right as three coloured rays: many schools, each
 * its own, cleanly separated. "Prime" as in prism, and as in the layer
 * underneath everything else.
 *
 * Drawn inline rather than loaded as an <img> so it inherits `currentColor`
 * for the incoming beam and stays crisp at every size, and so a header does
 * not pay a network request to show the logo. The three outgoing rays are
 * fixed spectrum hex — they ARE the brand and must not drift with the theme.
 *
 * Rendered only inside `.eduprime` scope (the /platform layout), where
 * `--primary` is defined.
 */

export function EduPrimeMark({
  size = 32,
  withTile = false,
  className,
}: {
  size?: number;
  /** Draw the rounded ink tile behind the prism (favicon / avatar contexts). */
  withTile?: boolean;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label={`${EDUPRIME.name} mark`}
    >
      <defs>
        <linearGradient id="ep-prism" x1="18" y1="36" x2="34" y2="10" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#4338CA" />
          <stop offset="0.55" stopColor="#8B7CFF" />
          <stop offset="1" stopColor="#22D3EE" />
        </linearGradient>
      </defs>

      {withTile && <rect x="2" y="2" width="44" height="44" rx="13" fill="#0B1020" />}

      {/* the prism */}
      <path d="M20 35L30 11L33 35Z" fill="url(#ep-prism)" />

      {/* incoming beam — currentColor so it reads on any background */}
      <path
        d="M7 25.5H20.5"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
        opacity={withTile ? 0.95 : 0.9}
      />

      {/* refracted output */}
      <path d="M30 23L42 15.5" stroke="#4338CA" strokeWidth="2.3" strokeLinecap="round" />
      <path d="M31 27H43" stroke="#8B7CFF" strokeWidth="2.3" strokeLinecap="round" />
      <path d="M30 31L42 38" stroke="#22D3EE" strokeWidth="2.3" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Mark + wordmark. `tone`:
 *  - "auto"    inherits currentColor for the text (default; use inside themed UI)
 *  - "inverse" forces white text, for the indigo hero
 */
export default function EduPrimeLogo({
  markSize = 30,
  tone = "auto",
  className,
  wordmark = true,
}: {
  markSize?: number;
  tone?: "auto" | "inverse";
  className?: string;
  wordmark?: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center gap-2.5 ${className ?? ""}`}
      style={tone === "inverse" ? { color: "#fff" } : undefined}
    >
      <EduPrimeMark size={markSize} />
      {wordmark && (
        <span className="text-[1.05rem] font-semibold tracking-tight leading-none">
          Edu
          <span style={{ color: tone === "inverse" ? "#B7B0FF" : "var(--primary)" }}>
            Prime
          </span>
        </span>
      )}
    </span>
  );
}
