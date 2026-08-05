"use client";

import { useEffect, useState } from "react";

/**
 * The theme switch.
 *
 * It used to look broken because it was: the class it wrote onto <html> was
 * correct, but nothing downstream read the resulting variables — `body` had a
 * hardcoded dark gradient and every page painted with `bg-[var(--background)]`,
 * which compiles to `background-color` and silently discards a gradient. So
 * three buttons wrote three different palettes onto an element nobody was
 * looking at. That is fixed in globals.css; this component now only has to pick.
 *
 * The initial value is read from the class the boot script in layout.tsx has
 * already put on <html>, not from a default — reading `"light"` first and
 * writing it back was overwriting a stored `dark` on every mount.
 */

const THEMES = [
  { key: "light", label: "Tag", hint: "Daylight — the school in full sun", swatch: "linear-gradient(135deg,#ffffff,#f2f6f6 55%,#ffe6d2)" },
  { key: "dark", label: "Nacht", hint: "Night — deep teal, easy on the eyes", swatch: "linear-gradient(135deg,#0a1c20,#123036 60%,#FF7A1A)" },
  { key: "custom", label: "Dämmerung", hint: "Dusk — indigo, for late study", swatch: "linear-gradient(135deg,#120e2b,#4a2f8f 55%,#FF7A1A)" },
] as const;

type ThemeKey = (typeof THEMES)[number]["key"];

const STORAGE_KEY = "easyway-theme";

function readAppliedTheme(): ThemeKey {
  const classes = document.documentElement.classList;
  if (classes.contains("theme-dark")) return "dark";
  if (classes.contains("theme-custom")) return "custom";
  return "light";
}

export default function ThemeToggle() {
  const [theme, setTheme] = useState<ThemeKey>("light");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setTheme(readAppliedTheme());
  }, []);

  function applyTheme(next: ThemeKey) {
    const root = document.documentElement;
    root.classList.remove("theme-light", "theme-dark", "theme-custom");
    root.classList.add(`theme-${next}`);
    // The browser's own widgets — scrollbars, form controls, the address bar on
    // mobile — follow this rather than our variables, and a light scrollbar
    // beside a dusk page is the tell that gives away a half-applied theme.
    root.style.colorScheme = next === "light" ? "light" : "dark";
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Private mode. The theme still applies for this session.
    }
    setTheme(next);
    setOpen(false);
  }

  const active = THEMES.find((item) => item.key === theme) ?? THEMES[0];

  return (
    <div className="fixed bottom-4 right-4 z-50 print:hidden">
      {open && (
        <div
          role="group"
          aria-label="Choose a theme"
          className="mb-2 w-60 overflow-hidden rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-2 shadow-2xl backdrop-blur-xl"
        >
          {THEMES.map((item) => {
            const selected = item.key === theme;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => applyTheme(item.key)}
                aria-pressed={selected}
                className={`flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition ${
                  selected ? "bg-[var(--accent-soft)]" : "hover:bg-[var(--surface-alt)]"
                }`}
              >
                <span
                  aria-hidden
                  className="h-8 w-8 shrink-0 rounded-xl border border-[var(--border-strong)] shadow-inner"
                  style={{ background: item.swatch }}
                />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-[var(--foreground)]">{item.label}</span>
                  <span className="block truncate text-[11px] text-[var(--muted)]">{item.hint}</span>
                </span>
                {selected && <span className="ml-auto text-xs font-bold text-[var(--accent)]">✓</span>}
              </button>
            );
          })}
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-label={`Theme: ${active.label}. Change theme`}
        className="flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs font-semibold text-[var(--foreground)] shadow-2xl backdrop-blur-xl transition hover:border-[var(--border-strong)]"
      >
        <span
          aria-hidden
          className="h-5 w-5 rounded-full border border-[var(--border-strong)]"
          style={{ background: active.swatch }}
        />
        <span className="uppercase tracking-[0.22em] text-[var(--muted)]">{active.label}</span>
      </button>
    </div>
  );
}
