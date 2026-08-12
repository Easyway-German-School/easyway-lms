/**
 * The four (or six) shapes an answer wears.
 *
 * Shapes carry the identity and colour merely makes them findable, which is the
 * opposite of how this format is usually built. Roughly one boy in twelve
 * cannot reliably separate the red from the green; "press the red one" is an
 * instruction that loses him the round for a reason that has nothing to do with
 * German, in front of the class, repeatedly. A triangle is a triangle to
 * everyone.
 *
 * Drawn rather than emoji, like every other icon in this project — see
 * components/icons.tsx for why.
 */

const PATHS: Record<string, string> = {
  triangle: "M12 3.5 21 20H3z",
  diamond: "M12 2.5 21.5 12 12 21.5 2.5 12z",
  circle: "M12 2.6a9.4 9.4 0 1 0 0 18.8 9.4 9.4 0 0 0 0-18.8z",
  square: "M4 4h16v16H4z",
  hexagon: "M12 2.5 20.2 7v10L12 21.5 3.8 17V7z",
  star: "m12 2.5 2.9 6.2 6.8.8-5 4.6 1.3 6.7L12 17.6 6 20.8l1.3-6.7-5-4.6 6.8-.8z",
};

export default function AnswerShape({
  shape,
  size = 24,
  className = "",
}: {
  shape: string;
  size?: number;
  className?: string;
}) {
  const path = PATHS[shape] ?? PATHS.circle;

  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
      focusable="false"
      style={{ flexShrink: 0 }}
    >
      <path d={path} fill="currentColor" />
    </svg>
  );
}
