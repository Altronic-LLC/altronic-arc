import { SITES, SP_PMO_SITE_URL } from "./config";
import { createDriveLibrary, type DriveLibrary } from "./driveLibrary";
import { QUOTE_PDF_FOLDER_PATH } from "./quotePdfFiles";
import type { DriveEntry } from "./projectFiles";

// =============================================================================
// Insourcing Quotes — each quote's PROJECT FOLDER (Ray, 2026-11-24).
//
// A quote's folder sits directly under `General/IC Quotes` in the Altronic_PMO
// Documents library — the same folder the quote PDFs are saved to. The quote
// stores the folder's NAME in its `ProjectFolder` column, and every rev of the
// quote shares it.
//
// Two libraries, both on the shared `driveLibrary` engine (no new Graph code):
//  - `IC Quotes` itself, read to offer existing folders to link and written
//    once to create a new quote folder (`conflictBehavior: fail`, so a name
//    already taken is an error, never "Name 1");
//  - one library ROOTED AT each quote's folder (`quoteFolderLibrary(name)`,
//    cached per name), which the quote page browses: subfolders, upload,
//    open. Nothing above the quote's folder is reachable from the card.
//
// A folder renamed or moved in SharePoint no longer matches the stored name;
// listing it then 404s and the card says so and offers to link again.
// Permissions are the PMO library's own — the boundary, as everywhere.
// =============================================================================

const IC_QUOTES_SEGMENTS = QUOTE_PDF_FOLDER_PATH.split("/");

/** IC Quotes' own SharePoint page. */
export const IC_QUOTES_FOLDER_URL = `${SP_PMO_SITE_URL}/Shared%20Documents/${IC_QUOTES_SEGMENTS.map(encodeURIComponent).join("/")}`;

/** Shown on a write refusal — the site somebody would ask about. */
export const QUOTE_FOLDER_SITE_LABEL = "Altronic_PMO";

/** The demo quote folder (IQ-COO-0001's), seeded with a little content. */
export const DEMO_QUOTE_FOLDER = "IQ-COO-0001 Cooper CPU-95 retrofit";

const icQuotes = createDriveLibrary({
  siteId: () => SITES.pmo,
  rootPath: IC_QUOTES_SEGMENTS,
  rootName: "IC Quotes",
  rootWebUrl: IC_QUOTES_FOLDER_URL,
  mockPrefix: "icq",
  mockWebBase: IC_QUOTES_FOLDER_URL,
  seedMock: (add, root) => {
    add(root, DEMO_QUOTE_FOLDER, "folder", 0, "2026-10-02T15:00:00Z");
    add(root, "IQ-WAB-0002 Wabtec sensors", "folder", 0, "2026-10-05T15:00:00Z");
    add(root, "IQ-COO-0001-R1.pdf", "file", 88_000, "2026-09-18T15:00:00Z");
  },
});

/** The folders directly under IC Quotes — what a quote can link to. */
export async function listIcQuoteFolders(): Promise<DriveEntry[]> {
  return (await icQuotes.list()).filter((e) => e.isFolder);
}

/** Create a quote's folder directly under IC Quotes. Refuses a name already there. */
export function createIcQuoteFolder(name: string): Promise<DriveEntry> {
  return icQuotes.createFolder(null, name);
}

const libraries = new Map<string, DriveLibrary>();

/** The library rooted at one quote's folder. Cached, so a name is one library. */
export function quoteFolderLibrary(name: string): DriveLibrary {
  let lib = libraries.get(name);
  if (!lib) {
    const segments = [...IC_QUOTES_SEGMENTS, name];
    const webUrl = `${SP_PMO_SITE_URL}/Shared%20Documents/${segments.map(encodeURIComponent).join("/")}`;
    lib = createDriveLibrary({
      siteId: () => SITES.pmo,
      rootPath: segments,
      rootName: name,
      rootWebUrl: webUrl,
      mockPrefix: `qf${libraries.size + 1}`,
      mockWebBase: webUrl,
      seedMock: (add, root) => {
        if (name !== DEMO_QUOTE_FOLDER) return;
        const drawings = add(root, "Drawings", "folder", 0, "2026-10-02T15:00:00Z");
        add(drawings, "CPU-95 harness.pdf", "file", 240_000, "2026-10-02T15:00:00Z");
        add(root, "Supplier quotes", "folder", 0, "2026-10-03T15:00:00Z");
        add(root, "Customer RFQ 4471.pdf", "file", 120_000, "2026-10-01T15:00:00Z");
      },
    });
    libraries.set(name, lib);
  }
  return lib;
}

/** TESTS ONLY: restore the seeded mock libraries. */
export function __resetQuoteFoldersMock(): void {
  icQuotes.resetMock();
  for (const lib of libraries.values()) lib.resetMock();
}
