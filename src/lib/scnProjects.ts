import type { ProjectReference } from "@/types/task";
import type { SelectOption } from "@/components/SearchableSelect";

// =============================================================================
// An SCN's Project Reference, picked from ENGINEERING's Project References.
//
// The SCN list's `ProjectReference` is a plain TEXT column, and it has to stay
// one: a SharePoint lookup can only target a list in the SAME site collection,
// and the SCN list (ALTRONICSALESTEAM) and the Projects list
// (Altronic_Engineering) are in different ones. So ARC offers the Projects
// list as a choice and stores the project's TITLE — readable in SharePoint's
// own views, and matched back to the project here to link to it.
//
// The match is by title, so a project renamed after it was picked no longer
// matches. The stored text then still shows, unlinked, and stays in the
// picker as its own option — a picker that dropped it would clear it on the
// next save.
// =============================================================================

function norm(s: string): string {
  return s.trim().toLowerCase();
}

/** The Engineering project a stored title names, or null. */
export function findScnProject(
  projects: readonly ProjectReference[],
  value: string | null | undefined,
): ProjectReference | null {
  if (!value || !value.trim()) return null;
  const key = norm(value);
  return projects.find((p) => norm(p.title) === key) ?? null;
}

/**
 * Picker options: every Engineering project by title, plus the CURRENT value
 * when no project carries it any more (marked so nobody mistakes it for a
 * live project).
 */
export function scnProjectOptions(
  projects: readonly ProjectReference[],
  current: string | null | undefined,
): SelectOption[] {
  const options: SelectOption[] = projects.map((p) => ({ value: p.title, label: p.title }));
  const value = current?.trim();
  if (value && !findScnProject(projects, value)) {
    options.unshift({ value, label: `${value} (not an Engineering project)` });
  }
  return options;
}
