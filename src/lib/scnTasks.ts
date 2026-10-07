import type { ScnLink, Task } from "@/types/task";
import { appItemUrl } from "./appUrl";

// =============================================================================
// An SCN's Task, picked from ENGINEERING's tasks.
//
// The SCN list has one task column, `Task_x0020_List` — a Hyperlink column
// that historically pointed at Planner boards (38 rows at discovery). Ray,
// 2026-10-07: the task should be a choice of Engineering tasks. A lookup is
// impossible (the Project Task List is in another site collection), so ARC
// writes the hyperlink itself: the URL of the task in ARC, and its numbered
// title as the link text. That still reads correctly in SharePoint's own
// views, and ARC recognises its own links to route them in-app.
//
// A Planner link already on a row is left alone until somebody picks an
// Engineering task for that SCN; it still renders, as an external link.
// =============================================================================

/** The hyperlink value that points an SCN at an Engineering task. */
export function scnTaskLink(task: Pick<Task, "id" | "numberedTitle">): ScnLink {
  return { url: appItemUrl("task", task.id), description: task.numberedTitle };
}

/**
 * The Engineering task id an SCN's Task List link points at, or null for a
 * Planner link (or anything else that isn't an ARC task URL).
 */
export function linkedScnTaskId(link: ScnLink | null | undefined): number | null {
  if (!link?.url) return null;
  let path: string;
  try {
    const url = new URL(link.url);
    if (/(^|\.)tasks\.office\.com$/i.test(url.hostname)) return null;
    path = url.pathname;
  } catch {
    return null;
  }
  const match = /\/task\/(\d+)\/?$/.exec(path);
  return match ? Number(match[1]) : null;
}
