"use client";

import { EyeIcon, EyeOffIcon } from "@/components/icons";
import { usePrivacyMode } from "@/lib/use-privacy-mode";

/**
 * The eye button. Blanks or reveals every <Secret> figure on the page, and
 * remembers the choice across reloads. See usePrivacyMode.
 *
 * `variant="pill"` is the default, sized to sit in a toolbar next to a Refresh
 * button; `variant="icon"` is a bare square for tighter headers.
 */
export default function PrivacyToggle({
  variant = "pill",
  className = "",
}: {
  variant?: "pill" | "icon";
  className?: string;
}) {
  const { hidden, toggle } = usePrivacyMode();

  const label = hidden ? "Show figures" : "Hide figures";

  if (variant === "icon") {
    return (
      <button
        type="button"
        onClick={toggle}
        aria-pressed={hidden}
        aria-label={label}
        title={label}
        className={`grid h-10 w-10 place-items-center rounded-xl text-[var(--muted)] transition hover:bg-[var(--surface-alt)] hover:text-[var(--foreground)] ${className}`}
      >
        {hidden ? <EyeOffIcon className="h-5 w-5" /> : <EyeIcon className="h-5 w-5" />}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={hidden}
      title={label}
      className={`flex items-center gap-2 rounded-full border border-[var(--border)] px-4 py-2 text-sm font-semibold transition hover:bg-[var(--surface-alt)] ${className}`}
    >
      {hidden ? <EyeOffIcon className="h-4 w-4" /> : <EyeIcon className="h-4 w-4" />}
      {label}
    </button>
  );
}
