"use client";

import { useEffect, useState } from "react";

type Theme = "system" | "light" | "dark";

const OPTIONS: { value: Theme; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

/** Resolve a preference to a concrete theme and apply it to <html> + status bar. */
function apply(theme: Theme) {
  const dark =
    theme === "dark" ||
    (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", dark ? "#16130f" : "#faf9f7");
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("system");

  useEffect(() => {
    setTheme((localStorage.getItem("theme") as Theme) || "system");
  }, []);

  // In System mode, follow live OS changes.
  useEffect(() => {
    if (theme !== "system") return;
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => apply("system");
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [theme]);

  function choose(next: Theme) {
    setTheme(next);
    localStorage.setItem("theme", next);
    apply(next);
  }

  return (
    <div className="grid grid-cols-3 gap-1 rounded-xl border border-line bg-surface-muted p-1">
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={theme === option.value}
          onClick={() => choose(option.value)}
          className={`touch-target rounded-lg text-sm font-semibold transition-colors ${
            theme === option.value
              ? "bg-brand text-white"
              : "text-muted active:bg-surface"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
