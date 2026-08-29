import { EDUPRIME } from "@/lib/platform/brand";

/**
 * The EduPrime mark: a prism.
 *
 * A beam of light — one codebase, one deployment — enters the left face and
 * leaves the right as three separated rays: many schools, each its own, cleanly
 * apart. "Prime" as in prism, and as in the layer underneath everything else.
 *
 * Colour follows the brief: blue and purple in the prism body, a yellow beam,
 * and blue / purple / orange rays out. Drawn inline rather than loaded as an
 * <img> so the beam inherits `currentColor` and the whole thing stays crisp at
 * any size. The prism gradient and the ray hexes ARE the brand and do not drift
 * with the theme.
 *
 * Rendered only inside `.eduprime` scope (PlatformShell / the /platform
 * layout), where `--primary` and `--eduprime-purple` are defined.
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
          <stop offset="0" stopColor="#2563EB" />
          <stop offset="1" stopColor="#7C3AED" />
        </linearGradient>
      </defs>

      {withTile && <rect x="2" y="2" width="44" height="44" rx="13" fill="#0d1220" />}

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

      {/* refracted output: blue, purple, orange */}
      <path d="M30 23L42 15.5" stroke="#2563EB" strokeWidth="2.3" strokeLinecap="round" />
      <path d="M31 27H43" stroke="#7C3AED" strokeWidth="2.3" strokeLinecap="round" />
      <path d="M30 31L42 38" stroke="#F97316" strokeWidth="2.3" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Mark + wordmark. `tone`:
 *  - "auto"    inherits currentColor for the text (default; use inside themed UI)
 *  - "inverse" forces white text, for a dark header
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
          <span style={{ color: tone === "inverse" ? "#C4B5FD" : "var(--eduprime-purple)" }}>
            Prime
          </span>
        </span>
      )}
    </span>
  );
}
