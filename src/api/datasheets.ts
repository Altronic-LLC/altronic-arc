import { graphFetch, GraphError } from "./graph";
import { SITES, USE_MOCK } from "./config";
import { formatBytes, uploadToDriveTarget, type UploadProgress } from "./projectFiles";
import { MOCK_DATASHEET_PART_NUMBERS } from "@/data/altronicPartsMockData";

// =============================================================================
// Part datasheets — PDFs in the Engineering site's Documents library,
// `General/Datasheets/<Altronic Part #>.pdf` (Tim, 2026-09-28). The old Power
// App linked to the file when a component's HasDataSheet flag was set. Part
// List parts get the same lookup (Tim, same day); that list has no flag column,
// so for them the folder is the only answer.
//
// ARC looks for the FILE, not just the flag, because the two disagree
// (checked live 2026-09-28, 3,946 components, 1,776 files):
//   1,366  flagged, and the PDF is there
//      18  flagged, but no PDF        → a link to nothing
//     380  NOT flagged, but a PDF is  → a datasheet the flag hides
// So a component's page asks for `<pn>.pdf` directly — one small request —
// and shows the link whenever it's there, saying so when the flag disagrees.
//
// The path lookup is case-insensitive in SharePoint, which matters: four
// files are stored in different case from their part number (`601427ht.pdf`).
//
// Opening goes to the file's `webUrl` — SharePoint's own PDF viewer, as an
// ordinary link. A top-level navigation carries the user's SharePoint sign-in,
// where a fetch from this origin would need a token and hit CORS (see the
// Supplier Logo notes in CLAUDE.md).
//
// UPLOADING (Tim, 2026-09-28) writes `<pn>.pdf` into the same folder, so the
// lookup above finds it with no second record to keep in step. Two rules:
//  - PDFs only. The lookup only ever asks for `.pdf`, so anything else would
//    upload and then never be found.
//  - It NEVER overwrites. Graph's `conflictBehavior: fail` answers 409 when
//    the name is taken, and that is reported as DatasheetExistsError. Replacing
//    a datasheet other parts' engineers rely on is a deliberate act in
//    SharePoint, not a side effect of adding a part.
// =============================================================================

export const DATASHEETS_PATH = "General/Datasheets";

export interface Datasheet {
  name: string;
  /** SharePoint's own viewer for the file — open it in a new tab. */
  webUrl: string;
  size: number;
}

const SITE_URL = "https://coopermachineryservices.sharepoint.com/sites/Altronic_Engineering";

/** The file a part number's datasheet would be, e.g. `601110.pdf`. */
export function datasheetFileName(partNumber: string): string {
  return `${partNumber.trim()}.pdf`;
}

function drivePath(partNumber: string): string {
  return [...DATASHEETS_PATH.split("/"), datasheetFileName(partNumber)].map(encodeURIComponent).join("/");
}

/**
 * Largest datasheet ARC will upload. Real ones are a few hundred KB to a few
 * MB; this is far past that, and stops a mis-picked scan or CAD export burning
 * a long upload before anyone notices.
 */
export const DATASHEET_MAX_BYTES = 50 * 1024 * 1024;

/** A datasheet with that part number's name is already in the folder. */
export class DatasheetExistsError extends Error {
  constructor(public partNumber: string) {
    super(
      `${datasheetFileName(partNumber)} is already in the Datasheets folder, so it wasn't replaced. ` +
        "Open it from the part's page to check it's the right one.",
    );
    this.name = "DatasheetExistsError";
  }
}

/**
 * Why this file can't be a datasheet, or null when it can. Checked BEFORE a
 * part is created, so a wrong pick doesn't leave a part behind with no file.
 */
export function datasheetFileProblem(file: File): string | null {
  const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
  if (!isPdf) return `"${file.name}" isn't a PDF. Datasheets are stored as <part #>.pdf, so pick the PDF.`;
  if (file.size === 0) return `"${file.name}" is empty.`;
  if (file.size > DATASHEET_MAX_BYTES) {
    return `"${file.name}" is ${formatBytes(file.size)} — over the ${formatBytes(DATASHEET_MAX_BYTES)} limit for a datasheet.`;
  }
  return null;
}

function mockDatasheet(partNumber: string, size: number): Datasheet {
  return { name: datasheetFileName(partNumber), webUrl: `${SITE_URL}/Shared%20Documents/${drivePath(partNumber)}`, size };
}

function seedMockStore(): Map<string, Datasheet> {
  return new Map(MOCK_DATASHEET_PART_NUMBERS.map((pn) => [pn.toLowerCase(), mockDatasheet(pn, 184_320)]));
}

/** Mock mode's Datasheets folder — mutable, so an upload shows up. */
let mockStore = seedMockStore();

export function __resetDatasheetsMockStore() {
  mockStore = seedMockStore();
}

/** Where a deleted part's datasheet is moved to, inside the Datasheets folder. */
export const DELETED_DATASHEETS_FOLDER = "Deleted";

/** `601110 deleted 2026-09-28.pdf` — findable, and never `<pn>.pdf` again. */
export function archivedDatasheetName(partNumber: string, on: Date): string {
  const day = `${on.getFullYear()}-${String(on.getMonth() + 1).padStart(2, "0")}-${String(on.getDate()).padStart(2, "0")}`;
  return `${partNumber.trim()} deleted ${day}.pdf`;
}

/**
 * Move a part's datasheet out of the way when its number is deleted — into
 * `Datasheets/Deleted/`, renamed with the date — so the number's NEXT part
 * doesn't show the old part's PDF, and an upload for it isn't refused as a
 * duplicate. Kept rather than deleted: it is a record of the part that was.
 *
 * Resolves to the new name, or null when there was no datasheet to move.
 * Anything else propagates: the delete is refused rather than leaving a
 * reused number pointing at another part's datasheet.
 */
export async function archiveDatasheet(partNumber: string, on: Date = new Date()): Promise<string | null> {
  const pn = partNumber.trim();
  if (!pn) return null;
  const name = archivedDatasheetName(pn, on);
  if (USE_MOCK) {
    if (!mockStore.delete(pn.toLowerCase())) return null;
    return name;
  }
  const drive = `/sites/${SITES.engineering}/drive`;
  let fileId: string;
  try {
    const item = await graphFetch<{ id: string; file?: unknown }>(`${drive}/root:/${drivePath(pn)}?$select=id,file`);
    if (!item.file) return null;
    fileId = item.id;
  } catch (err) {
    if (err instanceof GraphError && err.status === 404) return null;
    throw err;
  }
  const folderPath = DATASHEETS_PATH.split("/").map(encodeURIComponent).join("/");
  try {
    await graphFetch(`${drive}/root:/${folderPath}:/children`, {
      method: "POST",
      body: JSON.stringify({ name: DELETED_DATASHEETS_FOLDER, folder: {}, "@microsoft.graph.conflictBehavior": "fail" }),
    });
  } catch (err) {
    // Already there — the usual case after the first delete.
    if (!(err instanceof GraphError && err.status === 409)) throw err;
  }
  const folder = await graphFetch<{ id: string }>(
    `${drive}/root:/${folderPath}/${encodeURIComponent(DELETED_DATASHEETS_FOLDER)}?$select=id`,
  );
  const moved = await graphFetch<{ name: string }>(`${drive}/items/${fileId}?@microsoft.graph.conflictBehavior=rename`, {
    method: "PATCH",
    body: JSON.stringify({ parentReference: { id: folder.id }, name }),
  });
  return moved?.name ?? name;
}

/**
 * Put `file` into the Datasheets folder as `<partNumber>.pdf`. Refuses a file
 * that isn't a PDF, and never replaces one already there (DatasheetExistsError).
 */
export async function uploadDatasheet(
  partNumber: string,
  file: File,
  onProgress?: UploadProgress,
): Promise<Datasheet> {
  const pn = partNumber.trim();
  if (!pn) throw new Error("A datasheet needs the part number it belongs to.");
  const problem = datasheetFileProblem(file);
  if (problem) throw new Error(problem);

  if (USE_MOCK) {
    if (mockStore.has(pn.toLowerCase())) throw new DatasheetExistsError(pn);
    const sheet = mockDatasheet(pn, file.size);
    mockStore.set(pn.toLowerCase(), sheet);
    onProgress?.(1);
    return sheet;
  }
  try {
    const item = await uploadToDriveTarget(`/sites/${SITES.engineering}/drive/root:/${drivePath(pn)}:`, file, {
      conflict: "fail",
      onProgress,
    });
    return { name: item.name, webUrl: item.webUrl, size: item.size ?? file.size };
  } catch (err) {
    if (err instanceof GraphError && err.status === 409) throw new DatasheetExistsError(pn);
    throw err;
  }
}

/**
 * The datasheet for a part, or null when there isn't one. A 404 is "none";
 * anything else (a refused library, a throttle) propagates, so "we couldn't
 * look" is never shown as "there is no datasheet".
 */
export async function findDatasheet(partNumber: string): Promise<Datasheet | null> {
  if (!partNumber.trim()) return null;
  if (USE_MOCK) return mockStore.get(partNumber.trim().toLowerCase()) ?? null;
  try {
    const item = await graphFetch<{ name: string; webUrl: string; size?: number; file?: unknown }>(
      `/sites/${SITES.engineering}/drive/root:/${drivePath(partNumber)}?$select=name,webUrl,size,file`,
    );
    // A FOLDER with the part number's name isn't a datasheet.
    if (!item.file) return null;
    return { name: item.name, webUrl: item.webUrl, size: item.size ?? 0 };
  } catch (err) {
    if (err instanceof GraphError && err.status === 404) return null;
    throw err;
  }
}
