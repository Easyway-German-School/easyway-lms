"use client";

/**
 * The multi-select used everywhere a tutor's assignment is edited.
 *
 * A native <select multiple> was the obvious thing and the wrong one: on a
 * phone it collapses to a list nobody can ctrl-click, and it gives no signal
 * that leaving it empty means "all". These are toggle chips with that rule
 * spelled out under them, because an admin who assigns a tutor to Lagos and
 * leaves the sitting blank has said something specific and should be able to
 * see what it was.
 */

export type PickerOption = { value: string; label: string; hint?: string };

export default function AssignmentPicker({
  label,
  options,
  selected,
  onChange,
  emptyMeans,
  required = false,
}: {
  label: string;
  options: PickerOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  /** What an empty selection means. Shown under the chips. */
  emptyMeans: string;
  required?: boolean;
}) {
  const toggle = (value: string) => {
    onChange(selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value]);
  };

  const unset = selected.length === 0;

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-semibold text-[var(--foreground)]">
          {label}
          {required ? <span className="ml-1 text-[var(--accent)]">*</span> : null}
        </p>
        {selected.length > 0 ? (
          <button
            type="button"
            onClick={() => onChange([])}
            className="text-xs font-medium text-[var(--muted)] underline underline-offset-2"
          >
            Clear
          </button>
        ) : null}
      </div>

      <div className="mt-2 flex flex-wrap gap-2">
        {options.map((option) => {
          const active = selected.includes(option.value);
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => toggle(option.value)}
              title={option.hint}
              aria-pressed={active}
              className={`rounded-full border px-4 py-2 text-sm font-medium transition ${
                active
                  ? "border-[var(--accent)] bg-[var(--accent)] text-white shadow-sm"
                  : "border-[var(--border)] bg-[var(--surface)] text-[var(--foreground-soft)] hover:border-[var(--accent)]"
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>

      <p className={`mt-2 text-xs ${unset && required ? "text-amber-700" : "text-[var(--muted)]"}`}>
        {unset ? emptyMeans : `${selected.length} selected`}
      </p>
    </div>
  );
}
