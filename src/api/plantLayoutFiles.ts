import { GraphError, graphFetch } from "./graph";
import { SITES, SP_PLANT_LAYOUT_FILES_LIST_ID, USE_MOCK } from "./config";
import { mockDelay } from "./mockLatency";
import { uploadToDriveTarget, type GraphDriveChild } from "./projectFiles";
import { MOCK_WALLS_FILES } from "@/data/plantMockData";

// =============================================================================
// Plant Layout Files — the document library holding each layout's walls
// drawing (`walls/…svg`) and, from Phase 3, the published composites.
//
// A walls drawing is a FILE, not a list column: a cleaned CAD export can pass
// a list column's ~64,000-character limit, and a library versions it and
// serves it to Power BI by URL.
//
// The library's drive is looked up from its LIST id once per session. Reading
// goes through the item's `@microsoft.graph.downloadUrl` — short-lived and
// pre-authenticated, fetched WITHOUT our token (the driveLibrary arrangement);
// the file's webUrl is a SharePoint page, not the bytes.
// =============================================================================

let mockFiles: Record<string, { name: string; svg: string }> = { ...MOCK_WALLS_FILES };
let mockPublished: Record<string, { content: string; modifiedAt: Date }> = {};
let nextMockFile = 1;
let drivePromise: Promise<string> | null = null;

/** For tests: put the mock library back and forget the looked-up drive. */
export function __resetPlantLayoutFilesForTests(): void {
  mockFiles = { ...MOCK_WALLS_FILES };
  mockPublished = {};
  nextMockFile = 1;
  drivePromise = null;
}

function libraryDriveId(): Promise<string> {
  if (!SP_PLANT_LAYOUT_FILES_LIST_ID) {
    return Promise.reject(
      new Error("Plant Layout Files isn't set up yet: VITE_SP_PLANT_LAYOUT_FILES_LIST_ID is not set."),
    );
  }
  if (!drivePromise) {
    drivePromise = graphFetch<{ id: string }>(
      `/sites/${SITES.pmo}/lists/${SP_PLANT_LAYOUT_FILES_LIST_ID}/drive?$select=id`,
    ).then((d) => d.id);
    // A failed lookup must not be remembered for the whole session.
    drivePromise.catch(() => {
      drivePromise = null;
    });
  }
  return drivePromise;
}

/** A walls drawing's text, by drive item id. Not yet sanitised — the caller does that. */
export async function readWallsFile(fileId: string): Promise<string> {
  if (USE_MOCK) {
    const file = mockFiles[fileId];
    if (!file) throw new Error("That walls drawing isn't in the Plant Layout Files library any more.");
    return mockDelay(file.svg);
  }
  if (!fileId) throw new Error("This layout has no walls drawing.");
  const driveId = await libraryDriveId();
  const base = `/drives/${driveId}/items/${encodeURIComponent(fileId)}`;
  type WithUrl = { "@microsoft.graph.downloadUrl"?: string };
  let item = await graphFetch<WithUrl>(`${base}?$select=id,@microsoft.graph.downloadUrl`);
  let url = item?.["@microsoft.graph.downloadUrl"];
  // An instance annotation a $select'd response may leave out — re-read whole.
  if (!url) {
    item = await graphFetch<WithUrl>(base);
    url = item?.["@microsoft.graph.downloadUrl"];
  }
  if (!url) throw new Error("The walls drawing has no download link.");
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Couldn't read the walls drawing (${res.status}).`);
  return res.text();
}

/**
 * Delete a walls drawing. Graph's DELETE moves it to the PMO site's recycle
 * bin (restorable for 93 days), never a permanent delete. A 404 resolves: the
 * file is already gone, which is what was asked for. The CALLER decides
 * whether any layout still uses it (api/plantLayouts.ts → deletePlantLayout).
 */
export async function deleteWallsFile(fileId: string): Promise<void> {
  if (USE_MOCK) {
    const { [fileId]: _gone, ...rest } = mockFiles;
    mockFiles = rest;
    return mockDelay(undefined);
  }
  if (!fileId) return;
  const driveId = await libraryDriveId();
  try {
    await graphFetch(`/drives/${driveId}/items/${encodeURIComponent(fileId)}`, { method: "DELETE" });
  } catch (err) {
    if (err instanceof GraphError && err.status === 404) return;
    throw err;
  }
}

/** A file name SharePoint will take: no `" * : < > ? / \ |`, ends in .svg. */
export function wallsFileName(original: string): string {
  const base = original
    .replace(/\.svg$/i, "")
    .replace(/["*:<>?/\\|#%]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+|\.+$/g, "");
  return `${base || "walls"}.svg`;
}

/**
 * Save a walls drawing to `walls/` and hand back its drive item id. Never
 * overwrites: a second file of the same name is renamed by SharePoint ("x 1.svg").
 * The SANITISED drawing is what's stored — what ARC shows is what's kept.
 */
export async function uploadWallsFile(name: string, cleanSvg: string): Promise<{ id: string; name: string }> {
  const fileName = wallsFileName(name);
  if (USE_MOCK) {
    const id = `mock-walls-new-${nextMockFile++}`;
    mockFiles = { ...mockFiles, [id]: { name: fileName, svg: cleanSvg } };
    return mockDelay({ id, name: fileName });
  }
  const driveId = await libraryDriveId();
  const file = new File([cleanSvg], fileName, { type: "image/svg+xml" });
  const item = await uploadToDriveTarget(`/drives/${driveId}/root:/walls/${encodeURIComponent(fileName)}:`, file, {
    conflict: "rename",
  });
  return { id: item.id, name: item.name };
}

// -----------------------------------------------------------------------------
// published/ — the files a published layout leaves for Power BI
// (lib/plantPublishFiles.ts builds them). ARC generates and owns these, so a
// write REPLACES the file of that name: re-publishing the same version gives
// the same file, and the "current" copy is meant to be overwritten.
// -----------------------------------------------------------------------------

/** A file in `published/`. */
export interface PublishedFile {
  name: string;
  /** SharePoint's page for it (Open in SharePoint, and the address for Power BI); "" in the demo. */
  webUrl: string;
  size: number;
  modifiedAt: Date | null;
}

const PUBLISHED_FOLDER = "published";

function publishedPath(driveId: string, name: string): string {
  return `/drives/${driveId}/root:/${PUBLISHED_FOLDER}/${encodeURIComponent(name)}:`;
}

/** Write (or overwrite) one file in `published/`. */
export async function writePublishedFile(name: string, content: string, contentType: string): Promise<PublishedFile> {
  if (USE_MOCK) {
    mockPublished = { ...mockPublished, [name]: { content, modifiedAt: new Date() } };
    return mockDelay({ name, webUrl: "", size: new Blob([content]).size, modifiedAt: new Date() });
  }
  const driveId = await libraryDriveId();
  const file = new File([content], name, { type: contentType });
  const item = await uploadToDriveTarget(publishedPath(driveId, name), file, { conflict: "replace" });
  return toPublishedFile(item);
}

function toPublishedFile(item: GraphDriveChild): PublishedFile {
  return {
    name: item.name,
    webUrl: item.webUrl ?? "",
    size: item.size ?? 0,
    modifiedAt: item.lastModifiedDateTime ? new Date(item.lastModifiedDateTime) : null,
  };
}

/** The named files in `published/`; a name with no file is left out. */
export async function findPublishedFiles(names: readonly string[]): Promise<Record<string, PublishedFile>> {
  if (USE_MOCK) {
    const out: Record<string, PublishedFile> = {};
    for (const n of names) {
      const f = mockPublished[n];
      if (f) out[n] = { name: n, webUrl: "", size: new Blob([f.content]).size, modifiedAt: f.modifiedAt };
    }
    return mockDelay(out);
  }
  const driveId = await libraryDriveId();
  const found = await Promise.all(
    names.map(async (n) => {
      try {
        const item = await graphFetch<GraphDriveChild>(
          `${publishedPath(driveId, n)}?$select=id,name,webUrl,size,lastModifiedDateTime`,
        );
        return item ? toPublishedFile(item) : null;
      } catch (err) {
        if (err instanceof GraphError && err.status === 404) return null;
        throw err;
      }
    }),
  );
  const out: Record<string, PublishedFile> = {};
  found.forEach((f, i) => {
    if (f) out[names[i]] = f;
  });
  return out;
}

/**
 * A published file's text, through the item's pre-authenticated download
 * link (the readWallsFile arrangement) — for the Download button.
 */
export async function readPublishedFile(name: string): Promise<string> {
  if (USE_MOCK) {
    const f = mockPublished[name];
    if (!f) throw new Error(`${name} isn't in the Plant Layout Files library.`);
    return mockDelay(f.content);
  }
  const driveId = await libraryDriveId();
  type WithUrl = { "@microsoft.graph.downloadUrl"?: string };
  const item = await graphFetch<WithUrl>(publishedPath(driveId, name));
  const url = item?.["@microsoft.graph.downloadUrl"];
  if (!url) throw new Error(`${name} has no download link.`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Couldn't read ${name} (${res.status}).`);
  return res.text();
}
