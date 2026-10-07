import { GraphError, graphFetch, graphFetchAll } from "./graph";
import { SITES, SP_SCN_SITE_URL, USE_MOCK } from "./config";
import { mockDelay } from "./mockLatency";
import {
  MAX_UPLOAD_BYTES,
  formatBytes,
  mapEntry,
  sortEntries,
  uploadToDriveTarget,
  type DriveEntry,
  type GraphDriveChild,
  type UploadProgress,
} from "./projectFiles";

// =============================================================================
// The SCN Documents library — an in-app browser over the DEFAULT document
// library of the ALTRONICSALESTEAM/SCN subsite (Ray, 2026-10-07: "create
// subfolders, see subfolders, edit files, add files directly in ARC").
//
// Live 2026-10-07: `/sites/{SITES.scn}/drive` is "Documents", and its root
// holds ARCHIVE, EECR, General, Inventory Review Reports, LTB Analysis, SCN and
// Single Use Reports, plus four loose files.
//
// Every URL here is `/sites/{SITES.scn}/drive/…` on purpose: that is the shape
// `lib/listAccess.ts` recognises as a DRIVE refusal, so a 403 locks the
// documents screen (APPS' `needsDrive`) without touching the SCN list.
//
// Deliberately NO delete and NO rename. Removing or renaming a file is a
// deliberate trip to SharePoint — "Open in SharePoint" is one click away — and
// a rename breaks every link somebody pasted into an SCN comment.
//
// Conflict rules, both chosen so nothing is ever silently overwritten:
//  - a new FOLDER uses `conflictBehavior: fail` — a clashing name is an error
//    naming the folder, never a quiet "General 1";
//  - an uploaded FILE uses `rename`, so a second "SCN FLOW.pdf" lands as
//    "SCN FLOW 1.pdf" beside the first instead of replacing it.
// =============================================================================

/** The library's own SharePoint page — "Open in SharePoint" at the root. */
export const SCN_DOCUMENTS_LIBRARY_URL = `${SP_SCN_SITE_URL}/Shared%20Documents/Forms/AllItems.aspx`;

/** Shown on every write refusal — the site somebody would ask about. */
export const SCN_DOCUMENTS_SITE_LABEL = "ALTRONICSALESTEAM / SCN";

const DRIVE = () => `/sites/${SITES.scn}/drive`;

const ENTRY_SELECT =
  "$select=id,name,webUrl,size,lastModifiedDateTime,folder,file,parentReference";

/** One step of the breadcrumb, root first. `id: null` is the library root. */
export interface ScnDocumentCrumb {
  id: string | null;
  name: string;
  webUrl: string;
}

interface GraphDriveItemWithParent extends GraphDriveChild {
  parentReference?: { path?: string; id?: string };
}

// -----------------------------------------------------------------------------
// Reading
// -----------------------------------------------------------------------------

/**
 * The children of a folder — subfolders first, then files, each alphabetical.
 * No `folderId` lists the library root. Paged, so a folder past one page of
 * results still lists whole.
 */
export async function listScnDocuments(folderId?: string): Promise<DriveEntry[]> {
  if (USE_MOCK) {
    return mockDelay(sortEntries(mockChildren(folderId ?? MOCK_ROOT).map(withChildCount)));
  }
  const parent = folderId ? `${DRIVE()}/items/${folderId}` : `${DRIVE()}/root`;
  const children = await graphFetchAll<GraphDriveChild>(
    `${parent}/children?${ENTRY_SELECT}&$top=999`,
  );
  return sortEntries(children.map((c) => mapEntry(c, false)));
}

/** Split a `parentReference.path` ("/drives/b!…/root:/General/LTB") into names. */
export function pathSegments(parentPath: string | undefined): string[] {
  if (!parentPath) return [];
  const at = parentPath.indexOf("root:");
  if (at < 0) return [];
  return parentPath
    .slice(at + "root:".length)
    .split("/")
    .filter(Boolean)
    .map((s) => {
      try {
        return decodeURIComponent(s);
      } catch {
        return s;
      }
    });
}

function encodePath(segments: string[]): string {
  return segments.map((s) => encodeURIComponent(s)).join("/");
}

/**
 * The breadcrumb from the library root down to `folderId`, root first and the
 * folder itself last. No id gives just the root.
 *
 * One read of the folder gives its ancestors' NAMES (`parentReference.path`);
 * their ids — which the crumbs link by — are then resolved by path, all in
 * parallel. Cheaper than walking up one parent at a time, which is a chain of
 * dependent requests as deep as the folder.
 */
export async function getScnDocumentPath(folderId?: string): Promise<ScnDocumentCrumb[]> {
  const root: ScnDocumentCrumb = { id: null, name: "Documents", webUrl: SCN_DOCUMENTS_LIBRARY_URL };
  if (!folderId) return [root];

  if (USE_MOCK) {
    const chain: ScnDocumentCrumb[] = [];
    let id: string | undefined = folderId;
    while (id && id !== MOCK_ROOT) {
      const entry = mockFind(id);
      if (!entry) break;
      chain.unshift({ id: entry.id, name: entry.name, webUrl: entry.webUrl });
      id = mockParent.get(id);
    }
    return mockDelay([root, ...chain]);
  }

  const item = await graphFetch<GraphDriveItemWithParent>(
    `${DRIVE()}/items/${folderId}?$select=id,name,webUrl,parentReference`,
  );
  const names = pathSegments(item.parentReference?.path);
  const ancestors = await Promise.all(
    names.map((_, i) =>
      graphFetch<GraphDriveChild>(
        `${DRIVE()}/root:/${encodePath(names.slice(0, i + 1))}:?$select=id,name,webUrl`,
      ),
    ),
  );
  return [
    root,
    ...ancestors.map((a) => ({ id: a.id, name: a.name, webUrl: a.webUrl })),
    { id: item.id, name: item.name, webUrl: item.webUrl },
  ];
}

/**
 * A file's bytes, for a Download button.
 *
 * Via the item's `@microsoft.graph.downloadUrl` — a short-lived,
 * PRE-AUTHENTICATED link fetched without our bearer token (attaching one gets
 * it rejected) — the Open Orders arrangement. NOT the file's webUrl: that is a
 * SharePoint page, and a background fetch of it carries no sign-in on a phone.
 */
export async function downloadScnDocument(itemId: string): Promise<Blob> {
  if (USE_MOCK) return mockDelay(new Blob(["mock SCN document"], { type: "text/plain" }));
  const base = `${DRIVE()}/items/${itemId}`;
  let item = await graphFetch<{ "@microsoft.graph.downloadUrl"?: string }>(
    `${base}?$select=id,@microsoft.graph.downloadUrl`,
  );
  let url = item?.["@microsoft.graph.downloadUrl"];
  // An instance annotation a $select'd response may leave out — re-read whole.
  if (!url) {
    item = await graphFetch<{ "@microsoft.graph.downloadUrl"?: string }>(base);
    url = item?.["@microsoft.graph.downloadUrl"];
  }
  if (!url) throw new Error("That file has no download link — open it in SharePoint instead.");
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Couldn't download that file (${res.status}).`);
  return res.blob();
}

// -----------------------------------------------------------------------------
// Writing
// -----------------------------------------------------------------------------

/** Characters SharePoint refuses anywhere in a file or folder name. */
const ILLEGAL_NAME_CHARS = /["*:<>?/\\|]/;

/**
 * Why SharePoint would refuse this folder name, or null when it's fine.
 * Checked before the request so the reason is a sentence, not a bare 400.
 */
export function scnFolderNameProblem(name: string): string | null {
  if (!name.trim()) return "A folder name is required.";
  if (ILLEGAL_NAME_CHARS.test(name)) {
    return 'A folder name can\'t contain any of these: " * : < > ? / \\ |';
  }
  if (/^\s|\s$/.test(name)) return "A folder name can't start or end with a space.";
  if (/^\.|\.$/.test(name)) return "A folder name can't start or end with a full stop.";
  return null;
}

/** Did Graph refuse because the name is already taken? */
function isNameConflict(err: unknown): boolean {
  if (err instanceof GraphError) {
    return err.status === 409 || /nameAlreadyExists/i.test(err.body);
  }
  return false;
}

/**
 * Create a subfolder. `parentId: null` creates it at the library root.
 * `conflictBehavior: fail`, so an existing name is refused rather than the new
 * folder being quietly renamed "General 1".
 */
export async function createScnFolder(
  parentId: string | null,
  name: string,
): Promise<DriveEntry> {
  const problem = scnFolderNameProblem(name);
  if (problem) throw new Error(problem);
  const clash = () => new Error(`A folder called "${name}" already exists here.`);

  if (USE_MOCK) {
    const key = parentId ?? MOCK_ROOT;
    const siblings = mockChildren(key);
    if (siblings.some((e) => e.name.toLowerCase() === name.toLowerCase())) throw clash();
    const entry: DriveEntry = {
      id: `scndoc-${nextMockId++}`,
      name,
      webUrl: mockWebUrl(key, name),
      isFolder: true,
      size: 0,
      lastModified: new Date(),
      childCount: 0,
    };
    mockTree.set(key, [...siblings, entry]);
    mockTree.set(entry.id, []);
    mockParent.set(entry.id, key);
    return mockDelay(entry);
  }

  const parent = parentId ? `${DRIVE()}/items/${parentId}` : `${DRIVE()}/root`;
  try {
    const created = await graphFetch<GraphDriveChild>(`${parent}/children`, {
      method: "POST",
      body: JSON.stringify({
        name,
        folder: {},
        "@microsoft.graph.conflictBehavior": "fail",
      }),
    });
    return { ...mapEntry(created, false), childCount: 0 };
  } catch (err) {
    if (isNameConflict(err)) throw clash();
    throw err;
  }
}

/**
 * Upload one file into a folder (`null` = library root). Chunked above 4 MB
 * through the shared `uploadToDriveTarget`; `rename` on a name clash, so an
 * existing file is never replaced.
 */
export async function uploadScnDocument(
  folderId: string | null,
  file: File,
  onProgress?: UploadProgress,
): Promise<DriveEntry> {
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error(
      `"${file.name}" is ${formatBytes(file.size)} — over the ` +
        `${formatBytes(MAX_UPLOAD_BYTES)} upload limit. Upload it in SharePoint directly.`,
    );
  }

  if (USE_MOCK) {
    const key = folderId ?? MOCK_ROOT;
    const siblings = mockChildren(key);
    const name = mockUniqueName(siblings, file.name);
    const entry: DriveEntry = {
      id: `scndoc-${nextMockId++}`,
      name,
      webUrl: mockWebUrl(key, name),
      isFolder: false,
      size: file.size,
      lastModified: new Date(),
    };
    mockTree.set(key, [...siblings, entry]);
    mockParent.set(entry.id, key);
    onProgress?.(1);
    return mockDelay(entry);
  }

  const parent = folderId ? `${DRIVE()}/items/${folderId}` : `${DRIVE()}/root`;
  const target = `${parent}:/${encodeURIComponent(file.name)}:`;
  const res = await uploadToDriveTarget(target, file, { conflict: "rename", onProgress });
  return mapEntry(res, false);
}

// -----------------------------------------------------------------------------
// Mock library — mirrors the live root (2026-10-07), a few levels deep.
// -----------------------------------------------------------------------------

const MOCK_ROOT = "__scn_root__";
const MOCK_BASE = `${SP_SCN_SITE_URL}/Shared%20Documents`;
let nextMockId = 1;

function mockWebUrl(parentKey: string, name: string): string {
  const parentPath: string[] = [];
  let id: string | undefined = parentKey;
  while (id && id !== MOCK_ROOT) {
    const entry = mockFind(id);
    if (!entry) break;
    parentPath.unshift(entry.name);
    id = mockParent.get(id);
  }
  return `${MOCK_BASE}/${encodePath([...parentPath, name])}`;
}

function mockUniqueName(siblings: DriveEntry[], name: string): string {
  const taken = new Set(siblings.map((s) => s.name.toLowerCase()));
  if (!taken.has(name.toLowerCase())) return name;
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  for (let n = 1; ; n++) {
    const candidate = `${stem} ${n}${ext}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

let mockTree = new Map<string, DriveEntry[]>();
let mockParent = new Map<string, string>();

function seedMock() {
  mockTree = new Map();
  mockParent = new Map();
  nextMockId = 1;
  const at = (iso: string) => new Date(iso);
  function add(parentKey: string, name: string, kind: "folder" | "file", size = 0, when = "2026-06-01T12:00:00Z"): string {
    const id = `scndoc-${nextMockId++}`;
    const entry: DriveEntry = {
      id,
      name,
      webUrl: mockWebUrl(parentKey, name),
      isFolder: kind === "folder",
      size,
      lastModified: at(when),
      childCount: kind === "folder" ? 0 : undefined,
    };
    mockTree.set(parentKey, [...(mockTree.get(parentKey) ?? []), entry]);
    mockParent.set(id, parentKey);
    if (kind === "folder") mockTree.set(id, []);
    return id;
  }
  mockTree.set(MOCK_ROOT, []);
  const archive = add(MOCK_ROOT, "ARCHIVE", "folder", 0, "2025-11-03T15:00:00Z");
  add(archive, "SCN2023-014 Closed.pdf", "file", 340_000, "2024-01-10T15:00:00Z");
  add(archive, "SCN2022-031 Closed.docx", "file", 52_000, "2023-03-02T15:00:00Z");
  const eecr = add(MOCK_ROOT, "EECR", "folder", 0, "2026-04-12T15:00:00Z");
  add(eecr, "EECR-0042 Capacitor change.xlsx", "file", 41_000, "2026-04-12T15:00:00Z");
  const general = add(MOCK_ROOT, "General", "folder", 0, "2026-09-18T15:00:00Z");
  const templates = add(general, "Templates", "folder", 0, "2026-02-01T15:00:00Z");
  add(templates, "SCN Template.docx", "file", 38_000, "2026-02-01T15:00:00Z");
  add(general, "Supplier contact list.xlsx", "file", 64_000, "2026-09-18T15:00:00Z");
  add(MOCK_ROOT, "Inventory Review Reports", "folder", 0, "2026-07-30T15:00:00Z");
  const ltb = add(MOCK_ROOT, "LTB Analysis", "folder", 0, "2026-08-21T15:00:00Z");
  add(ltb, "LTB Analysis Q3 2026.xlsx", "file", 128_000, "2026-08-21T15:00:00Z");
  add(MOCK_ROOT, "SCN", "folder", 0, "2026-09-30T15:00:00Z");
  add(MOCK_ROOT, "Single Use Reports", "folder", 0, "2026-05-05T15:00:00Z");
  add(MOCK_ROOT, "Master List Single Use_6-8-2022.xlsx", "file", 212_000, "2022-06-08T15:00:00Z");
  add(MOCK_ROOT, "Obsolete SCN2024-070 Varispark.docx", "file", 46_000, "2024-11-14T15:00:00Z");
  add(MOCK_ROOT, "SCN FLOW.pdf", "file", 185_000, "2025-03-20T15:00:00Z");
  add(MOCK_ROOT, "Submitting an SCN.docx", "file", 29_000, "2025-03-24T15:00:00Z");
}
seedMock();

/** TESTS ONLY: restore the seeded mock library. */
export function __resetScnDocumentsMock(): void {
  seedMock();
}

function mockChildren(key: string): DriveEntry[] {
  return mockTree.get(key) ?? [];
}

function mockFind(id: string): DriveEntry | undefined {
  const parent = mockParent.get(id);
  return parent ? mockChildren(parent).find((e) => e.id === id) : undefined;
}

function withChildCount(e: DriveEntry): DriveEntry {
  return e.isFolder ? { ...e, childCount: mockChildren(e.id).length } : { ...e };
}
