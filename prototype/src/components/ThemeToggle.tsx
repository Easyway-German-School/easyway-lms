"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";

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
 *
 * Two render shapes: `floating` (fixed bottom-right, used by PageContainer on
 * pages that have no portal chrome of their own) and `compact` (a small
 * header button the three portal shells place next to NotificationCenter).
 * A page never shows both — see FloatingThemeToggleContext below.
 */

const THEMES = [
  { key: "light", label: "Tag", hint: "Daylight — the school in full sun", swatch: "linear-gradient(135deg,#ffffff,#f2f6f6 55%,#ffe6d2)" },
  { key: "dark", label: "Nacht", hint: "Night — deep teal, easy on the eyes", swatch: "linear-gradient(135deg,#0a1c20,#123036 60%,#FF7A1A)" },
  { key: "custom", label: "Dämmerung", hint: "Dusk — indigo, for late study", swatch: "linear-gradient(135deg,#120e2b,#4a2f8f 55%,#FF7A1A)" },
] as const;

export type ThemeKey = (typeof THEMES)[number]["key"];

const STORAGE_KEY = "easyway-theme";

export function readAppliedTheme(): ThemeKey {
  const classes = document.documentElement.classList;
  if (classes.contains("theme-dark")) return "dark";
  if (classes.contains("theme-custom")) return "custom";
  return "light";
}

export function applyTheme(next: ThemeKey) {
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
}

/**
 * A portal shell (Student/Lecturer/Admin) mounts its own compact toggle in
 * the header. While one is mounted, PageContainer's global floating toggle
 * hides itself so a shell page never shows the switch twice.
 */
const FloatingThemeToggleContext = createContext<{ hide: () => void; show: () => void } | null>(null);

export function FloatingThemeToggleProvider({
  children,
  render,
}: {
  children: React.ReactNode;
  render: (visible: boolean) => React.ReactNode;
}) {
  const [visible, setVisible] = useState(true);
  const hiders = useRef(0);

  const hide = () => {
    hiders.current += 1;
    setVisible(false);
  };
  const show = () => {
    hiders.current = Math.max(0, hiders.current - 1);
    if (hiders.current === 0) setVisible(true);
  };

  return (
    <FloatingThemeToggleContext.Provider value={{ hide, show }}>
      {children}
      {render(visible)}
    </FloatingThemeToggleContext.Provider>
  );
}

/** Called by a portal shell for as long as it is mounted. */
export function useHideFloatingThemeToggle() {
  const ctx = useContext(FloatingThemeToggleContext);
  useEffect(() => {
    if (!ctx) return;
    ctx.hide();
    return () => ctx.show();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx]);
}

function useThemeState() {
  const [theme, setTheme] = useState<ThemeKey>("light");
  useEffect(() => {
    setTheme(readAppliedTheme());
  }, []);
  return [theme, setTheme] as const;
}

export default function ThemeToggle({ variant = "floating" }: { variant?: "floating" | "compact" }) {
  const [theme, setTheme] = useThemeState();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  function pick(next: ThemeKey) {
    applyTheme(next);
    setTheme(next);
    setOpen(false);
  }

  const active = THEMES.find((item) => item.key === theme) ?? THEMES[0];

  const menu = open && (
    <div
      role="group"
      aria-label="Choose a theme"
      className={
        variant === "compact"
          ? "absolute right-0 top-full z-50 mt-2 w-60 overflow-hidden rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-2 shadow-2xl backdrop-blur-xl"
          : "mb-2 w-60 overflow-hidden rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-2 shadow-2xl backdrop-blur-xl"
      }
    >
      {THEMES.map((item) => {
        const selected = item.key === theme;
        return (
          <button
            key={item.key}
            type="button"
            onClick={() => pick(item.key)}
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
  );

  if (variant === "compact") {
    return (
      <div ref={rootRef} className="relative print:hidden">
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          aria-expanded={open}
          aria-label={`Theme: ${active.label}. Change theme`}
          title={`Theme: ${active.label}`}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-[var(--border)] bg-[var(--surface)] transition hover:border-[var(--border-strong)]"
        >
          <span
            aria-hidden
            className="h-5 w-5 rounded-full border border-[var(--border-strong)]"
            style={{ background: active.swatch }}
          />
        </button>
        {menu}
      </div>
    );
  }

  return (
    <div ref={rootRef} className="fixed bottom-4 right-4 z-50 print:hidden">
      {menu}
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
