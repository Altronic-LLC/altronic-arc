import { GraphError, graphFetch, graphFetchAll } from "./graph";
import { USE_MOCK } from "./config";
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
// A folder library — an in-app browser over a SharePoint document library (or
// one folder inside it): list, breadcrumb, new folder, upload, download,
// rename, delete. Built for SCN Documents (Ray, 2026-10-07) and reused for
// Supply Chain Files (BusinessIT#36), so each is a CONFIG, not a copy.
//
// Every URL is `/sites/{siteId}/drive/…` on purpose: that is the shape
// `lib/listAccess.ts` recognises as a DRIVE refusal, so a 403 locks only the
// documents screen (APPS' `needsDrive`), never a list on the same site.
//
// `rootPath` pins the "root" to a folder INSIDE the drive (Supply Chain Files is
// `General/Supply Chain Files` in the PMO library). The breadcrumb then starts
// at that folder, and nothing above it is reachable from the screen.
//
// Conflict rules, all chosen so nothing is ever silently overwritten:
//  - a new FOLDER uses `conflictBehavior: fail` — a clashing name is an error
//    naming the folder, never a quiet "General 1";
//  - a RENAME sends `conflictBehavior: fail` too, and a 409 becomes "A file or
//    folder called X already exists here.";
//  - an uploaded FILE uses `rename`, so a second "Report.pdf" lands as
//    "Report 1.pdf" beside the first instead of replacing it.
// Delete moves the item to the site's RECYCLE BIN (a folder with its contents,
// restorable for 93 days). No permanent delete here, deliberately; a 404 means
// somebody already removed it, which is the outcome asked for, so it resolves.
// =============================================================================

/** One step of the breadcrumb, root first. `id: null` is the library root. */
export interface DriveCrumb {
  id: string | null;
  name: string;
  webUrl: string;
}

interface GraphDriveItemWithParent extends GraphDriveChild {
  parentReference?: { path?: string; id?: string };
}

const ENTRY_SELECT =
  "$select=id,name,webUrl,size,lastModifiedDateTime,folder,file,parentReference";

/** Characters SharePoint refuses anywhere in a file or folder name. */
const ILLEGAL_NAME_CHARS = /["*:<>?/\\|]/;

/**
 * Why SharePoint would refuse this file or folder name, or null when it's
 * fine. Checked before the request so the reason is a sentence, not a bare 400.
 */
export function driveItemNameProblem(
  name: string,
  kind: "folder" | "file" = "folder",
): string | null {
  const noun = `A ${kind} name`;
  if (!name.trim()) return `${noun} is required.`;
  if (ILLEGAL_NAME_CHARS.test(name)) {
    return `${noun} can't contain any of these: " * : < > ? / \\ |`;
  }
  if (/^\s|\s$/.test(name)) return `${noun} can't start or end with a space.`;
  if (/^\.|\.$/.test(name)) return `${noun} can't start or end with a full stop.`;
  return null;
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

/** Did Graph refuse because the name is already taken? */
function isNameConflict(err: unknown): boolean {
  if (err instanceof GraphError) {
    return err.status === 409 || /nameAlreadyExists/i.test(err.body);
  }
  return false;
}

/** The seeding helper handed to a library's mock. */
export type MockAdd = (
  parentKey: string,
  name: string,
  kind: "folder" | "file",
  size?: number,
  when?: string,
) => string;

export interface DriveLibraryConfig {
  /** The Graph site id — read lazily so a test can change it. */
  siteId: () => string;
  /** Folder (as path segments) inside the drive that acts as the root. Omit for the drive root. */
  rootPath?: string[];
  /** The root crumb's label. */
  rootName: string;
  /** The root's own SharePoint page — "Open in SharePoint" at the root. */
  rootWebUrl: string;
  /** Prefix for mock ids and the mock root key. */
  mockPrefix: string;
  /** The mock library's folder URL base (what real webUrls would start with). */
  mockWebBase: string;
  /** Seed the mock library. */
  seedMock: (add: MockAdd, rootKey: string) => void;
}

export function createDriveLibrary(cfg: DriveLibraryConfig) {
  const DRIVE = () => `/sites/${cfg.siteId()}/drive`;
  const rootPath = cfg.rootPath ?? [];

  /** The Graph reference to a folder; no id = the library root. */
  const parentRef = (folderId?: string | null) =>
    folderId
      ? `${DRIVE()}/items/${folderId}`
      : rootPath.length
        ? `${DRIVE()}/root:/${encodePath(rootPath)}:`
        : `${DRIVE()}/root`;

  // ---------------------------------------------------------------------------
  // Mock library
  // ---------------------------------------------------------------------------
  const MOCK_ROOT = `__${cfg.mockPrefix}_root__`;
  let nextMockId = 1;
  let mockTree = new Map<string, DriveEntry[]>();
  let mockParent = new Map<string, string>();

  const mockChildren = (key: string): DriveEntry[] => mockTree.get(key) ?? [];
  const mockFind = (id: string): DriveEntry | undefined => {
    const parent = mockParent.get(id);
    return parent ? mockChildren(parent).find((e) => e.id === id) : undefined;
  };
  const withChildCount = (e: DriveEntry): DriveEntry =>
    e.isFolder ? { ...e, childCount: mockChildren(e.id).length } : { ...e };

  function mockWebUrl(parentKey: string, name: string): string {
    const parentPath: string[] = [];
    let id: string | undefined = parentKey;
    while (id && id !== MOCK_ROOT) {
      const entry = mockFind(id);
      if (!entry) break;
      parentPath.unshift(entry.name);
      id = mockParent.get(id);
    }
    return `${cfg.mockWebBase}/${encodePath([...parentPath, name])}`;
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

  function mockRemoveSubtree(id: string): void {
    for (const child of mockChildren(id)) mockRemoveSubtree(child.id);
    mockTree.delete(id);
    mockParent.delete(id);
  }

  function seedMock() {
    mockTree = new Map();
    mockParent = new Map();
    nextMockId = 1;
    const add: MockAdd = (parentKey, name, kind, size = 0, when = "2026-06-01T12:00:00Z") => {
      const id = `${cfg.mockPrefix}-${nextMockId++}`;
      const entry: DriveEntry = {
        id,
        name,
        webUrl: mockWebUrl(parentKey, name),
        isFolder: kind === "folder",
        size,
        lastModified: new Date(when),
        childCount: kind === "folder" ? 0 : undefined,
      };
      mockTree.set(parentKey, [...(mockTree.get(parentKey) ?? []), entry]);
      mockParent.set(id, parentKey);
      if (kind === "folder") mockTree.set(id, []);
      return id;
    };
    mockTree.set(MOCK_ROOT, []);
    cfg.seedMock(add, MOCK_ROOT);
  }
  seedMock();

  // ---------------------------------------------------------------------------
  // Reading
  // ---------------------------------------------------------------------------

  /**
   * The children of a folder — subfolders first, then files, each alphabetical.
   * No `folderId` lists the library root. Paged, so a folder past one page of
   * results still lists whole.
   */
  async function list(folderId?: string): Promise<DriveEntry[]> {
    if (USE_MOCK) {
      return mockDelay(sortEntries(mockChildren(folderId ?? MOCK_ROOT).map(withChildCount)));
    }
    const children = await graphFetchAll<GraphDriveChild>(
      `${parentRef(folderId)}/children?${ENTRY_SELECT}&$top=999`,
    );
    return sortEntries(children.map((c) => mapEntry(c, false)));
  }

  /**
   * The breadcrumb from the library root down to `folderId`, root first and the
   * folder itself last. No id gives just the root.
   *
   * One read of the folder gives its ancestors' NAMES (`parentReference.path`);
   * their ids — which the crumbs link by — are then resolved by path, all in
   * parallel. Cheaper than walking up one parent at a time. Ancestors at or
   * above `rootPath` are never shown.
   */
  async function getPath(folderId?: string): Promise<DriveCrumb[]> {
    const root: DriveCrumb = { id: null, name: cfg.rootName, webUrl: cfg.rootWebUrl };
    if (!folderId) return [root];

    if (USE_MOCK) {
      const chain: DriveCrumb[] = [];
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
    const below = names.map((_, i) => i).filter((i) => i >= rootPath.length);
    const ancestors = await Promise.all(
      below.map((i) =>
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
   * it rejected). NOT the file's webUrl: that is a SharePoint page, and a
   * background fetch of it carries no sign-in on a phone.
   */
  async function download(itemId: string): Promise<Blob> {
    if (USE_MOCK) return mockDelay(new Blob(["mock document"], { type: "text/plain" }));
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

  // ---------------------------------------------------------------------------
  // Writing
  // ---------------------------------------------------------------------------

  /** Create a subfolder. `parentId: null` creates it at the library root. */
  async function createFolder(parentId: string | null, name: string): Promise<DriveEntry> {
    const problem = driveItemNameProblem(name, "folder");
    if (problem) throw new Error(problem);
    const clash = () => new Error(`A folder called "${name}" already exists here.`);

    if (USE_MOCK) {
      const key = parentId ?? MOCK_ROOT;
      const siblings = mockChildren(key);
      if (siblings.some((e) => e.name.toLowerCase() === name.toLowerCase())) throw clash();
      const entry: DriveEntry = {
        id: `${cfg.mockPrefix}-${nextMockId++}`,
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

    try {
      const created = await graphFetch<GraphDriveChild>(`${parentRef(parentId)}/children`, {
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
  async function upload(
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
        id: `${cfg.mockPrefix}-${nextMockId++}`,
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

    // A path-addressed root already ends in ":" — an id or the bare drive root doesn't.
    const joiner = rootPath.length > 0 && !folderId ? "" : ":";
    const target = `${parentRef(folderId)}${joiner}/${encodeURIComponent(file.name)}:`;
    const res = await uploadToDriveTarget(target, file, { conflict: "rename", onProgress });
    return mapEntry(res, false);
  }

  /**
   * Rename a file or folder. Returns the renamed entry, or `null` when the name
   * is unchanged (case-sensitively equal to `currentName`) — then nothing is
   * sent. A case-only change IS sent.
   */
  async function rename(
    itemId: string,
    newName: string,
    options: { currentName?: string; isFolder?: boolean } = {},
  ): Promise<DriveEntry | null> {
    const problem = driveItemNameProblem(newName, options.isFolder ? "folder" : "file");
    if (problem) throw new Error(problem);
    if (options.currentName !== undefined && options.currentName === newName) return null;
    const clash = () => new Error(`A file or folder called "${newName}" already exists here.`);

    if (USE_MOCK) {
      const parentKey = mockParent.get(itemId);
      const entry = parentKey ? mockFind(itemId) : undefined;
      if (!parentKey || !entry) throw new Error("That item isn't in the library any more.");
      if (entry.name === newName) return mockDelay(null);
      const siblings = mockChildren(parentKey);
      if (
        siblings.some((e) => e.id !== itemId && e.name.toLowerCase() === newName.toLowerCase())
      ) {
        throw clash();
      }
      const renamed: DriveEntry = {
        ...entry,
        name: newName,
        webUrl: mockWebUrl(parentKey, newName),
        lastModified: new Date(),
      };
      mockTree.set(
        parentKey,
        siblings.map((e) => (e.id === itemId ? renamed : e)),
      );
      return mockDelay(withChildCount(renamed));
    }

    try {
      const updated = await graphFetch<GraphDriveChild>(`${DRIVE()}/items/${itemId}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: newName,
          "@microsoft.graph.conflictBehavior": "fail",
        }),
      });
      return mapEntry(updated, false);
    } catch (err) {
      if (isNameConflict(err)) throw clash();
      throw err;
    }
  }

  /** Delete a file or folder — to the recycle bin; a 404 resolves (already gone). */
  async function remove(itemId: string): Promise<void> {
    if (USE_MOCK) {
      const parentKey = mockParent.get(itemId);
      if (!parentKey) return mockDelay(undefined);
      mockTree.set(
        parentKey,
        mockChildren(parentKey).filter((e) => e.id !== itemId),
      );
      mockRemoveSubtree(itemId);
      return mockDelay(undefined);
    }
    try {
      await graphFetch(`${DRIVE()}/items/${itemId}`, { method: "DELETE" });
    } catch (err) {
      if (err instanceof GraphError && err.status === 404) return;
      throw err;
    }
  }

  return { list, getPath, download, createFolder, upload, rename, remove, resetMock: seedMock };
}

export type DriveLibrary = ReturnType<typeof createDriveLibrary>;
