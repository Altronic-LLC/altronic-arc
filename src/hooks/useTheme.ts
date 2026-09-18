import { useEffect, useState } from "react";

const STORAGE_KEY = "aets-theme";
type Theme = "light" | "dark";

function getInitialTheme(): Theme {
  if (typeof window === "undefined") return "light";
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "light" || stored === "dark") return stored;
  // Default to light. Users can toggle to dark via the header button;
  // their choice is saved to localStorage and persists across sessions.
  return "light";
}

/**
 * @param override Force a theme, ignoring the stored preference — the
 * Reports kiosk's `?theme=` URL flag is the one caller of this (there's no
 * toggle button to reach on that chrome-less page, so a URL flag is the only
 * way to pin its display). A forced theme is deliberately NOT written to
 * localStorage: it's a display setting for that one page, not something
 * that should silently change what the same browser shows everywhere else
 * in ARC.
 */
export function useTheme(override?: Theme) {
  const [theme, setTheme] = useState<Theme>(() => override ?? getInitialTheme());

  useEffect(() => {
    if (override) setTheme(override);
  }, [override]);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") root.classList.add("dark");
    else root.classList.remove("dark");
    if (!override) localStorage.setItem(STORAGE_KEY, theme);
  }, [theme, override]);

  return {
    theme,
    toggle: () => setTheme((t) => (t === "dark" ? "light" : "dark")),
  };
}
