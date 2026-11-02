import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useKanbanAvailable } from "./useIsPhone";

// =============================================================================
// Remember List or Kanban — BusinessIT#51 (Thomas Terhune: "It remembers my
// dark mode").
//
// The pick is saved when somebody presses List or Kanban in the header's
// switcher — and ONLY then. Arriving at a list any other way (the Dashboard
// card, the Departments menu, a link) goes to the board if the board was the
// last pick. Saving on the click rather than on whichever screen loaded
// keeps a shared link to a board from changing anybody's default.
//
// Per browser, like the theme, and in localStorage only: losing it costs one
// click. Every access is wrapped — the accessor throws in a private window or
// with site data blocked, and a list must never fail to open over a
// preference.
// =============================================================================

export type ViewPair = "tasks" | "eirs" | "operationsTasks";
export type RememberedView = "list" | "board";

const STORAGE_KEY = "arc-view-prefs";

function readAll(): Partial<Record<ViewPair, RememberedView>> {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/** The last view picked for this pair; List when none was. */
export function rememberedView(pair: ViewPair): RememberedView {
  return readAll()[pair] === "board" ? "board" : "list";
}

/** Save the view just picked in the switcher. */
export function rememberView(pair: ViewPair, view: RememberedView): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...readAll(), [pair]: view }));
  } catch {
    // A lost preference is the status quo — nothing to tell anyone.
  }
}

/**
 * Wraps a LIST route: shows it, or sends the person to the board if that was
 * their last pick. Never on a screen too small for a board — there is no
 * board to go to there. The filters in the URL travel with them.
 */
export function RememberedViewRoute({
  pair,
  boardPath,
  carrySearch,
  children,
}: {
  pair: ViewPair;
  boardPath: string;
  /** Which of the list's URL params the board understands. */
  carrySearch: (search: string) => string;
  children: ReactNode;
}) {
  const { search } = useLocation();
  const kanbanAvailable = useKanbanAvailable();
  if (kanbanAvailable && rememberedView(pair) === "board") {
    return <Navigate replace to={`${boardPath}${carrySearch(search)}`} />;
  }
  return <>{children}</>;
}
