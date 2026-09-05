"use client";

import { useEffect, useSyncExternalStore } from "react";

type Theme = "system" | "light" | "dark";

const OPTIONS: { value: Theme; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

const THEME_CHANGE_EVENT = "magni-theme-change";

function getTheme(): Theme {
  const saved = localStorage.getItem("theme");
  return saved === "light" || saved === "dark" ? saved : "system";
}

function getServerTheme(): Theme {
  return "system";
}

function subscribeToTheme(onChange: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === "theme" || event.key === null) onChange();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(THEME_CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(THEME_CHANGE_EVENT, onChange);
  };
}

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
  const theme = useSyncExternalStore(subscribeToTheme, getTheme, getServerTheme);

  useEffect(() => {
    apply(theme);
    // In System mode, follow live OS changes.
    if (theme !== "system") return;
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => apply("system");
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [theme]);

  function choose(next: Theme) {
    localStorage.setItem("theme", next);
    window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
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
