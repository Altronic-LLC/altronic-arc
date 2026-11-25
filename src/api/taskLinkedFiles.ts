import { GraphError, graphFetch } from "./graph";
import { SP_LIST_ID, SP_SITE_ID, USE_MOCK } from "./config";
import { mockDelay } from "./mockLatency";
import { PROJECT_FOLDERS_PATH, mockDriveItem } from "./projectFiles";
import { withConflictRetry } from "./tasks";
import {
  LINKED_FILES_COLUMN,
  addLinkedFiles,
  folderNamesBelowProjectFolders,
  folderPathText,
  parseLinkedFiles,
  removeLinkedFile,
  sameLinkedFiles,
  serializeLinkedFiles,
  type LinkedFile,
  type ParsedLinkedFiles,
  type PickedLibraryFile,
} from "@/lib/linkedFiles";

// =============================================================================
// Engineering tasks' LINKED files (BusinessIT#62) — see lib/linkedFiles.ts.
//
// The `LinkedFiles` column is read ON ITS OWN, one task at a time, never in
// the task list's `$select`. The list is ~3,000 rows downloaded in pages and
// only a task's own page shows its links, so there is nothing to gain by
// widening that read — and a lot to lose: selecting a column a list hasn't got
// 400s the WHOLE read, and this column arrives by a script that runs
// separately from the deploy. Read alone, a missing column costs only the
// "Linked files" list, which then says to run the script.
//
// Every write reads the column FRESH and re-reads inside the conflict retry,
// so two people linking at once both keep their files, and a write never
// lands over a value ARC couldn't read.
// =============================================================================

/** The column isn't on the list yet — `scripts/add-task-linked-files-column.ps1`. */
export class LinkedFilesColumnMissingError extends Error {
  constructor() {
    super(
      "Linking files isn't set up yet: the Project Task List has no LinkedFiles column. " +
        "Ask an ARC admin to run scripts/add-task-linked-files-column.ps1.",
    );
    this.name = "LinkedFilesColumnMissingError";
  }
}

/** The stored links couldn't be read, so ARC won't write over them. */
export class LinkedFilesUnreadableError extends Error {
  constructor() {
    super(
      "This task's linked files couldn't be read, so ARC won't change them. " +
        "Ask an ARC admin to check the task's LinkedFiles column in SharePoint.",
    );
    this.name = "LinkedFilesUnreadableError";
  }
}

/** Remembered once a read is refused for want of the column. */
let columnAvailable: boolean | null = null;

/** Whether the column is known to exist (null = not asked yet). */
export function linkedFilesColumnAvailable(): boolean | null {
  return columnAvailable;
}

const itemPath = (taskId: number) => `/sites/${SP_SITE_ID}/lists/${SP_LIST_ID}/items/${taskId}`;

// ---------------------------------------------------------------------------
// Mock store — the raw column value per task, as SharePoint would hold it.
// ---------------------------------------------------------------------------
const MOCK_SEED: Record<number, string> = {
  15: JSON.stringify([
    {
      id: "mf-amp-draw-1",
      name: "driver-board-revD.dwg",
      webUrl: "#",
      folderPath: "0017-AMP-5000 Refresh / Drawings",
      linkedBy: "Demo User",
      linkedByEmail: "demo.user@altronic-llc.com",
      linkedAt: "2026-11-20T15:00:00.000Z",
    },
  ]),
};
let mockStore = new Map<number, string>(Object.entries(MOCK_SEED).map(([k, v]) => [Number(k), v]));

/** TESTS ONLY: put the mock links back as seeded (or as given). */
export function __resetLinkedFilesMock(seed: Record<number, string> = MOCK_SEED): void {
  mockStore = new Map(Object.entries(seed).map(([k, v]) => [Number(k), v]));
  columnAvailable = null;
}

/** Read the raw column for one task. Throws the column-missing error on a 400. */
async function readRaw(taskId: number): Promise<unknown> {
  if (USE_MOCK) return mockDelay(mockStore.get(taskId) ?? null);
  if (columnAvailable === false) throw new LinkedFilesColumnMissingError();
  try {
    const item = await graphFetch<{ fields?: Record<string, unknown> }>(
      `${itemPath(taskId)}?$expand=fields($select=${LINKED_FILES_COLUMN})`,
      { expectedStatuses: [400] },
    );
    columnAvailable = true;
    return item.fields?.[LINKED_FILES_COLUMN] ?? null;
  } catch (err) {
    if (err instanceof GraphError && err.status === 400) {
      columnAvailable = false;
      throw new LinkedFilesColumnMissingError();
    }
    throw err;
  }
}

/** A task's linked files, and whether the stored value could be read. */
export async function readTaskLinkedFiles(taskId: number): Promise<ParsedLinkedFiles> {
  return parseLinkedFiles(await readRaw(taskId));
}

async function writeRaw(taskId: number, value: string | null): Promise<void> {
  if (USE_MOCK) {
    if (value === null) mockStore.delete(taskId);
    else mockStore.set(taskId, value);
    await mockDelay(undefined);
    return;
  }
  await graphFetch(`${itemPath(taskId)}/fields`, {
    method: "PATCH",
    body: JSON.stringify({ [LINKED_FILES_COLUMN]: value }),
  });
}

/**
 * Change a task's links: read fresh, apply `change`, write — again on a
 * conflict, re-reading first. Refuses a value it couldn't read. Sends nothing
 * when the change leaves the list as it was.
 */
async function rewriteLinks(
  taskId: number,
  change: (current: LinkedFile[]) => LinkedFile[],
): Promise<LinkedFile[]> {
  return withConflictRetry(async () => {
    const current = await readTaskLinkedFiles(taskId);
    if (current.corrupt) throw new LinkedFilesUnreadableError();
    const next = change(current.files);
    if (sameLinkedFiles(current.files, next)) return current.files;
    await writeRaw(taskId, serializeLinkedFiles(next));
    return next;
  });
}

/** Link files to a task. Already-linked files are skipped. Returns the links. */
export function linkTaskFiles(
  taskId: number,
  picked: PickedLibraryFile[],
  by: { name: string; email: string },
): Promise<LinkedFile[]> {
  const at = new Date();
  return rewriteLinks(taskId, (current) => addLinkedFiles(current, picked, by, at));
}

/** Unlink one file. The file itself is never touched. Returns the links. */
export function unlinkTaskFile(taskId: number, fileId: string): Promise<LinkedFile[]> {
  return rewriteLinks(taskId, (current) => removeLinkedFile(current, fileId));
}

/** What a linked file looks like in SharePoint now. */
export type LinkedFileState =
  | { status: "found"; name: string; webUrl: string; folderPath: string }
  | { status: "gone" };

/**
 * Look a linked file up by its drive item id: its CURRENT name, link and
 * folder (a rename or a move keeps the id), or `gone` when SharePoint answers
 * 404 — deleted, or moved out of the library. Anything else throws, and the
 * card keeps what it stored: "couldn't look" must never read as "gone".
 */
export async function lookUpLinkedFile(fileId: string): Promise<LinkedFileState> {
  if (USE_MOCK) {
    const found = mockDriveItem(fileId);
    return mockDelay(
      found
        ? { status: "found" as const, name: found.name, webUrl: found.webUrl, folderPath: found.folderPath }
        : { status: "gone" as const },
    );
  }
  try {
    const item = await graphFetch<{
      name: string;
      webUrl: string;
      parentReference?: { path?: string };
    }>(`/sites/${SP_SITE_ID}/drive/items/${fileId}?$select=id,name,webUrl,parentReference`, {
      expectedStatuses: [404],
    });
    return {
      status: "found",
      name: item.name,
      webUrl: item.webUrl,
      folderPath: folderPathText(
        folderNamesBelowProjectFolders(item.parentReference?.path, PROJECT_FOLDERS_PATH),
      ),
    };
  } catch (err) {
    if (err instanceof GraphError && err.status === 404) return { status: "gone" };
    throw err;
  }
}
