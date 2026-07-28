"use client";

import { useEffect, useState } from "react";

const themes = [
  { key: "light", label: "Light" },
  { key: "dark", label: "Dark" },
  { key: "custom", label: "Custom" },
] as const;

type ThemeKey = (typeof themes)[number]["key"];

export default function ThemeToggle() {
  const [theme, setTheme] = useState<ThemeKey | null>(null);

  useEffect(() => {
    const stored = window.localStorage.getItem("easyway-theme") as ThemeKey | null;
    setTheme(stored || "light");
  }, []);

  useEffect(() => {
    if (!theme) return;
    document.documentElement.classList.remove("theme-light", "theme-dark", "theme-custom");
    document.documentElement.classList.add(`theme-${theme}`);
    window.localStorage.setItem("easyway-theme", theme);
  }, [theme]);

  const applyTheme = (selected: ThemeKey) => {
    setTheme(selected);
  };

  return (
    <div className="fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface)]/95 px-3 py-2 text-xs text-[var(--foreground)] shadow-2xl backdrop-blur-xl">
      <span className="font-semibold uppercase tracking-[0.25em] text-[var(--muted)]">Theme</span>
      <div className="flex items-center gap-1">
        {themes.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => applyTheme(item.key)}
            className={`rounded-full border px-3 py-1 transition ${theme === item.key ? "border-transparent bg-gradient-to-r from-[var(--accent)] to-[var(--accent-strong)] text-white shadow-lg" : "border-[var(--border)] bg-[var(--surface-alt)] text-[var(--foreground)] hover:border-[var(--accent)]/40 hover:text-[var(--accent)]"}`}
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}
