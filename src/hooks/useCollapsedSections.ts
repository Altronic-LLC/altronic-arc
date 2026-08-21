import { useEffect, useState } from "react";

const STORAGE_KEY = "aets-dashboard-collapsed-sections";

function getInitialCollapsedSections(): Set<string> {
  if (typeof window === "undefined") return new Set();
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) return new Set();
  try {
    const parsed = JSON.parse(stored);
    if (Array.isArray(parsed)) {
      return new Set(parsed.filter((v): v is string => typeof v === "string"));
    }
  } catch {
    // Malformed value (manual edit, old format, etc.) — fall back to nothing collapsed
    // rather than throwing and breaking the whole dashboard.
  }
  return new Set();
}

/**
 * Persists which Dashboard department sections are collapsed, the same way
 * useTheme persists light/dark: read once on mount, write on every change.
 */
export function useCollapsedSections() {
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(
    getInitialCollapsedSections,
  );

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...collapsedSections]));
  }, [collapsedSections]);

  function toggleSection(title: string) {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(title)) {
        next.delete(title);
      } else {
        next.add(title);
      }
      return next;
    });
  }

  /** Used by "Collapse all / Expand all" — needs the full title list to collapse everything. */
  function setAllCollapsed(titles: string[], collapsed: boolean) {
    setCollapsedSections(collapsed ? new Set(titles) : new Set());
  }

  return { collapsedSections, toggleSection, setAllCollapsed };
}
