import { graphFetch, graphFetchAll, GraphError } from "./graph";
import { SITES, USE_MOCK } from "./config";
import { mockDelay } from "./mockLatency";
import { uploadToDriveTarget, type GraphDriveChild } from "./projectFiles";

// =============================================================================
// Insourcing Quotes — saving the customer PDF (design §11).
//
// Generating a PDF downloads or prints it locally and saves NOTHING. This
// module is the explicit "Save to folder" half: it writes the PDF into
//
//   General/IC Quotes        ← default Documents library of SITES.pmo
//
// The path came from Ray (2026-10-09, name confirmed: "IC Quotes"). He also
// supplied a sharing link; a share token can be regenerated, so it is not used.
//
// Three rules:
//
//  - **A saved PDF is never silently overwritten.** The upload goes through the
//    shared `uploadToDriveTarget` with `conflictBehavior: rename`, so a second
//    "IQ-COO-0042-R1.pdf" lands as "IQ-COO-0042-R1 1.pdf" — the datasheets /
//    Open Orders raw-extract arrangement. Never `replace`.
//  - **ARC never creates the folder.** It is resolved by path FIRST and the file
//    is then written under the folder's item id. A PUT by full path would
//    quietly create a missing `General/IC Quotes` — the wrong place, silently —
//    so a 404 on the folder is an error naming the path instead.
//  - Auth is the existing `Sites.Selected` grant on the PMO site. No new grant.
// =============================================================================

/** The folder the quote PDFs live in, relative to the PMO drive root. */
export const QUOTE_PDF_FOLDER_PATH = "General/IC Quotes";

export interface SavedQuotePdf {
  name: string;
  webUrl: string;
}

export interface QuotePdfFile {
  name: string;
  webUrl: string;
  size: number;
  /** ISO timestamp; null when Graph didn't give one. */
  modifiedAt: string | null;
  /** Pre-authenticated, short-lived — use at once, never store. */
  downloadUrl?: string;
}

function drive(): string {
  return `/sites/${SITES.pmo}/drive`;
}

/** `…/drive/root:/General/IC%20Quotes:` — Graph's colon form for a path. */
function folderPathRef(): string {
  const encoded = QUOTE_PDF_FOLDER_PATH.split("/")
    .map((s) => encodeURIComponent(s))
    .join("/");
  return `${drive()}/root:/${encoded}:`;
}

function folderMissingError(): Error {
  return new Error(
    `The quote PDF folder "${QUOTE_PDF_FOLDER_PATH}" wasn't found in the Altronic_PMO ` +
      "Documents library. ARC doesn't create it — ask a site owner to create it (or " +
      "restore it), then try again.",
  );
}

function isNotFound(err: unknown): boolean {
  return err instanceof GraphError && err.status === 404;
}

/** The folder's drive-item id; a 404 becomes an error naming the path. */
async function folderId(): Promise<string> {
  try {
    const folder = await graphFetch<{ id: string }>(`${folderPathRef()}?$select=id,name,folder`);
    if (!folder?.id) throw folderMissingError();
    return folder.id;
  } catch (err) {
    if (isNotFound(err)) throw folderMissingError();
    throw err;
  }
}

/**
 * Save a generated quote PDF into `General/IC Quotes`. A name clash RENAMES
 * the new file; the existing one is never replaced. Returns the name it
 * actually landed under.
 */
export async function saveQuotePdf(blob: Blob, fileName: string): Promise<SavedQuotePdf> {
  if (USE_MOCK) return mockSave(blob, fileName);
  const id = await folderId();
  const file = new File([blob], fileName, { type: "application/pdf" });
  const target = `${drive()}/items/${id}:/${encodeURIComponent(fileName)}:`;
  const item = await uploadToDriveTarget(target, file, { conflict: "rename" });
  return { name: item.name, webUrl: item.webUrl ?? "" };
}

interface GraphFileChild extends GraphDriveChild {
  "@microsoft.graph.downloadUrl"?: string;
}

/**
 * The saved PDFs for one quote (every rev — matched on the quote BASE, e.g.
 * `IQ-COO-0042`), newest first. Folders are left out.
 */
export async function listQuotePdfs(quoteBase: string): Promise<QuotePdfFile[]> {
  const prefix = quoteBase.trim().toLowerCase();
  let rows: QuotePdfFile[];
  if (USE_MOCK) {
    rows = await mockDelay(mockStore.map((f) => ({ ...f })));
  } else {
    let children: GraphFileChild[];
    try {
      children = await graphFetchAll<GraphFileChild>(
        `${folderPathRef()}/children?$select=id,name,size,webUrl,lastModifiedDateTime,file,folder,@microsoft.graph.downloadUrl`,
      );
    } catch (err) {
      if (isNotFound(err)) throw folderMissingError();
      throw err;
    }
    rows = children
      .filter((c) => !c.folder)
      .map((c) => ({
        name: c.name,
        webUrl: c.webUrl ?? "",
        size: c.size ?? 0,
        modifiedAt: c.lastModifiedDateTime ?? null,
        downloadUrl: c["@microsoft.graph.downloadUrl"],
      }));
  }
  return rows
    .filter((f) => prefix !== "" && f.name.toLowerCase().startsWith(prefix))
    .sort((a, b) => (b.modifiedAt ?? "").localeCompare(a.modifiedAt ?? ""));
}

// -----------------------------------------------------------------------------
// Mock mode — an in-memory folder that renames a clash the way Graph does.
// -----------------------------------------------------------------------------

let mockStore: QuotePdfFile[] = [];
let mockClock = 0;

/** TESTS ONLY: empty the mock folder. */
export function __resetQuotePdfMockStore(): void {
  mockStore = [];
  mockClock = 0;
}

/** "a.pdf" taken → "a 1.pdf", then "a 2.pdf" … — Graph's `rename` shape. */
function uniqueMockName(fileName: string): string {
  const taken = new Set(mockStore.map((f) => f.name.toLowerCase()));
  if (!taken.has(fileName.toLowerCase())) return fileName;
  const dot = fileName.lastIndexOf(".");
  const stem = dot > 0 ? fileName.slice(0, dot) : fileName;
  const ext = dot > 0 ? fileName.slice(dot) : "";
  for (let n = 1; ; n++) {
    const candidate = `${stem} ${n}${ext}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

async function mockSave(blob: Blob, fileName: string): Promise<SavedQuotePdf> {
  const name = uniqueMockName(fileName);
  // A strictly increasing clock so "newest first" is deterministic even when
  // two saves land in the same millisecond.
  mockClock = Math.max(mockClock + 1, Date.now());
  const entry: QuotePdfFile = {
    name,
    webUrl: `https://example.invalid/IC%20Quotes/${encodeURIComponent(name)}`,
    size: blob.size,
    modifiedAt: new Date(mockClock).toISOString(),
  };
  mockStore.push(entry);
  return mockDelay({ name: entry.name, webUrl: entry.webUrl });
}
