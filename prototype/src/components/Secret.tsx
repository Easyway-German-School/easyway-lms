import type { ReactNode } from "react";

/**
 * One figure on a screen, shown or blanked to dots.
 *
 * Presentational only: it takes `hidden` as a prop rather than reading the
 * privacy-mode hook itself, so a page with twenty figures on it subscribes
 * once (for its toggle button) instead of twenty times. See usePrivacyMode.
 *
 *   <Secret hidden={hidden}>{naira(finance.outstanding)}</Secret>
 *
 * The mask keeps the surrounding layout roughly still — its width tracks the
 * hidden text, clamped so a long value cannot blow out a card — and is
 * unselectable so it cannot be copied as a string of bullets.
 */
export default function Secret({
  children,
  hidden,
  className = "",
}: {
  children: ReactNode;
  hidden: boolean;
  className?: string;
}) {
  if (!hidden) return <>{children}</>;

  const text = typeof children === "string" || typeof children === "number" ? String(children) : "";
  const dots = "•".repeat(Math.min(Math.max(text.replace(/\s/g, "").length || 4, 3), 7));

  return (
    <span
      aria-hidden="true"
      className={`select-none tracking-[0.15em] tabular-nums ${className}`}
      title="Hidden — use the eye button to show figures"
    >
      {dots}
    </span>
  );
}
