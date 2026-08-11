import { graphFetch } from "./graph";
import { SP_SITE_ID, USE_MOCK } from "./config";
import { safeUniqueFilename } from "@/lib/uniqueFilename";

// =============================================================================
// Project-folder attachments for tasks.
//
// Files don't live on the task list-item; they live in the site's default
// Documents library under "General/Project Folders/<Project Folder>/". Each
// project folder carries a `Project Reference` lookup metadata column that
// ties it to a Project. Workflow:
//
//   1. Discover every folder under /General/Project Folders/ (one call,
//      cached for a few minutes).
//   2. Read each folder's `ProjectReferenceLookupId` field via the
//      listItem expansion.
//   3. When a task wants to upload / list, look up the folder by the
//      task's parentProject.lookupId.
//   4. If no folder matches, fall through to a hardcoded "Miscellaneous"
//      folder + prefix the filename with the task's project code so the
//      file is still findable.
//
// Auth: existing Graph `Sites.Selected` scope is enough — no separate
// SharePoint REST permission needed. (The list-item attachments path
// in src/api/attachments.ts uses SP REST and is still wired up for EIRs
// until they get migrated to this model.)
// =============================================================================

/** Library path containing project subfolders, relative to drive root. */
const PROJECT_FOLDERS_PATH = "General/Project Folders";
/**
 * Folder name to fall through to when no project folder matches.
 * Case-insensitive `includes("misc")` so the SharePoint folder can be
 * "Miscellaneous", "Misc", "MISC", "Miscellaneous Projects", etc. without
 * us caring which spelling someone used.
 */
function isMiscFolder(name: string): boolean {
  return /misc/i.test(name);
}

/** How many recent files to surface on the task detail page. */
export const RECENT_FILES_LIMIT = 5;

/**
 * Largest body Graph accepts on the simple PUT path (≈ 4 MB). This is NOT the
 * app's upload limit — it's just the point where we switch to a chunked
 * upload session. See {@link MAX_UPLOAD_BYTES}.
 */
const SIMPLE_UPLOAD_MAX_BYTES = 4 * 1024 * 1024;

/**
 * The app's actual upload ceiling.
 *
 * Files up to this size go through a resumable upload session (Graph accepts
 * far larger, but a browser tab pushing multi-gigabyte files over VPN is a
 * bad bet — one dropped connection wastes the whole transfer). Raise this
 * constant if the appetite changes; nothing else needs to move.
 */
export const MAX_UPLOAD_BYTES = 250 * 1024 * 1024;

/**
 * Bytes per chunk in an upload session. Graph REQUIRES a multiple of 320 KiB
 * for every chunk except the last, and rejects the whole session otherwise —
 * so this is 25 × 320 KiB, not a round 8 MB.
 */
const UPLOAD_CHUNK_BYTES = 25 * 320 * 1024;

/** How many times to re-send a single chunk before giving up on the upload. */
const CHUNK_RETRIES = 3;

/** Human-readable size for messages ("12.4 MB"). */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Reports fraction complete, 0–1. Called at least once per chunk. */
export type UploadProgress = (fraction: number) => void;

/**
 * Send one file to a drive folder, picking the transport by size: a single
 * PUT under 4 MB, a resumable chunked session above it.
 *
 * `basePath` is the Graph path of the PARENT folder
 * (e.g. `/sites/{id}/drive/items/{folderId}`); `name` is the final filename.
 */
async function uploadToDrive(
  basePath: string,
  name: string,
  file: File,
  onProgress?: UploadProgress,
): Promise<GraphDriveChild> {
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error(
      `"${file.name}" is ${formatBytes(file.size)} — over the ` +
        `${formatBytes(MAX_UPLOAD_BYTES)} upload limit. Put it in the project ` +
        `folder in SharePoint directly and paste the link into a comment.`,
    );
  }
  const target = `${basePath}:/${encodeURIComponent(name)}:`;

  if (file.size <= SIMPLE_UPLOAD_MAX_BYTES) {
    // Server-side backstop for the race between our pre-upload dedupe listing
    // (see resolveUniqueName) and this PUT: if someone else wrote the same
    // name in that window, Graph renames ours instead of clobbering theirs.
    // The chunked path below gets the equivalent via a body param on
    // createUploadSession — the simple PUT has no body-shaped place for it,
    // only this query param.
    const res = await graphFetch<GraphDriveChild>(
      `${target}/content?@microsoft.graph.conflictBehavior=rename`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/octet-stream" },
        body: await file.arrayBuffer(),
      },
    );
    onProgress?.(1);
    return res;
  }
  return uploadViaSession(target, file, onProgress);
}

/**
 * Resumable upload for files too big for one PUT.
 *
 * Graph hands back a short-lived, PRE-AUTHENTICATED `uploadUrl`; chunks go to
 * it with a plain `fetch` and NO Authorization header — attaching our bearer
 * token to that URL is both unnecessary and a way to get the session rejected.
 * Intermediate chunks answer 202; the last one answers 200/201 carrying the
 * finished driveItem.
 *
 * On failure the session is cancelled (best-effort DELETE) so a half-written
 * file doesn't linger in the library waiting to confuse someone.
 */
async function uploadViaSession(
  target: string,
  file: File,
  onProgress?: UploadProgress,
): Promise<GraphDriveChild> {
  const session = await graphFetch<{ uploadUrl: string }>(
    `${target}/createUploadSession`,
    {
      method: "POST",
      body: JSON.stringify({
        item: { "@microsoft.graph.conflictBehavior": "rename" },
      }),
    },
  );
  if (!session?.uploadUrl) {
    throw new Error(`Couldn't start an upload session for "${file.name}".`);
  }

  try {
    for (let start = 0; start < file.size; start += UPLOAD_CHUNK_BYTES) {
      const end = Math.min(start + UPLOAD_CHUNK_BYTES, file.size);
      const finished = await putChunk(session.uploadUrl, file, start, end);
      onProgress?.(end / file.size);
      if (finished) return finished;
    }
  } catch (err) {
    void cancelUploadSession(session.uploadUrl);
    throw err;
  }
  // Every chunk went up but Graph never returned the finished item.
  void cancelUploadSession(session.uploadUrl);
  throw new Error(`Upload of "${file.name}" ended without a completed file.`);
}

/**
 * PUT one byte range. Returns the finished driveItem when this was the last
 * chunk, or null when Graph wants more (202). Retries the SAME range on
 * transport errors and 5xx/429 — chunk PUTs are idempotent, so a retry is
 * always safe.
 */
async function putChunk(
  uploadUrl: string,
  file: File,
  start: number,
  end: number,
): Promise<GraphDriveChild | null> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= CHUNK_RETRIES; attempt++) {
    if (attempt > 0) await sleep(500 * 2 ** (attempt - 1));
    let res: Response;
    try {
      res = await fetch(uploadUrl, {
        method: "PUT",
        headers: {
          "Content-Length": String(end - start),
          "Content-Range": `bytes ${start}-${end - 1}/${file.size}`,
        },
        body: file.slice(start, end),
      });
    } catch (err) {
      lastError = err;
      continue;
    }
    if (res.status === 200 || res.status === 201) {
      return (await res.json()) as GraphDriveChild;
    }
    if (res.status === 202) return null;
    if (res.status === 429 || res.status >= 500) {
      lastError = new Error(`Graph answered ${res.status} for bytes ${start}-${end - 1}`);
      continue;
    }
    // 4xx other than 429 won't improve on retry (expired session, bad range).
    throw new Error(
      `Upload failed at ${formatBytes(start)} of ${formatBytes(file.size)} ` +
        `(HTTP ${res.status}). ${await res.text().catch(() => "")}`.trim(),
    );
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(`Upload stalled at ${formatBytes(start)}.`);
}

/** Best-effort session teardown — failures here are not worth surfacing. */
async function cancelUploadSession(uploadUrl: string): Promise<void> {
  try {
    await fetch(uploadUrl, { method: "DELETE" });
  } catch {
    /* the session expires on its own soon enough */
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface ProjectFile {
  /** Drive item id — used for delete. */
  id: string;
  name: string;
  /** Clickable link to the file in SharePoint. */
  webUrl: string;
  size: number;
  lastModified: Date;
}

export interface ProjectFolder {
  id: string;
  /** SharePoint folder display name (e.g. "NGI-5000"). */
  name: string;
  /** Clickable link to the folder in SharePoint. */
  webUrl: string;
  /** Project Reference lookupId attached to this folder via metadata. */
  projectLookupId: number;
}

/**
 * Resolved folder for a task. `kind: "project"` means we found a folder
 * tagged with the task's project; `kind: "misc"` means we're falling back
 * to the Miscellaneous folder and the filename will be prefixed.
 */
export type ResolvedFolder =
  | { kind: "project"; folder: ProjectFolder }
  | { kind: "misc"; folder: ProjectFolder; filenamePrefix: string };

/**
 * Take the leading code from a project reference value. Defensive about
 * null / undefined / non-string inputs because `parentProject.title`
 * sometimes comes back blank when the projects catalogue hasn't joined
 * the lookup yet — and that empty string was the reason the Misc
 * filename prefix was silently dropping on uploads.
 */
export function projectCodePrefix(projectRef: string | null | undefined): string {
  if (typeof projectRef !== "string") return "";
  const trimmed = projectRef.trim();
  if (!trimmed) return "";
  return trimmed.split(/\s+/)[0] ?? "";
}

// ---------------------------------------------------------------------------
// Mock store — keyed by project lookupId. Sentinel id 0 = Miscellaneous.
// ---------------------------------------------------------------------------
const mockFiles = new Map<number, ProjectFile[]>();
let nextMockFileId = 1;

function mockNow() {
  return new Date();
}

// ---------------------------------------------------------------------------
// Folder discovery (cached by the React Query layer)
// ---------------------------------------------------------------------------

interface GraphDriveChild {
  id: string;
  name: string;
  webUrl: string;
  folder?: { childCount?: number };
  file?: unknown;
  size?: number;
  lastModifiedDateTime?: string;
  listItem?: { fields?: Record<string, unknown> };
}

function encodeDrivePath(segments: string[]): string {
  return segments.map((s) => encodeURIComponent(s)).join("/");
}

function readLookupId(fields: Record<string, unknown>): number {
  // Same auto-detect dance we use for EIR Project Reference: column
  // internal name varies (`ProjectReference`, `Project_x0020_Reference`,
  // …) so we scan any key whose name looks like the project ref column.
  for (const [key, raw] of Object.entries(fields)) {
    if (!/project/i.test(key)) continue;
    if (!/reference/i.test(key)) continue;
    if (typeof raw === "number" && raw > 0) return raw;
    if (typeof raw === "string") {
      const n = parseInt(raw, 10);
      if (!Number.isNaN(n) && n > 0) return n;
    }
    if (raw && typeof raw === "object") {
      const obj = raw as Record<string, unknown>;
      for (const k of ["LookupId", "lookupId", "Id", "id"] as const) {
        const v = obj[k];
        if (typeof v === "number" && v > 0) return v;
        if (typeof v === "string") {
          const n = parseInt(v, 10);
          if (!Number.isNaN(n) && n > 0) return n;
        }
      }
    }
  }
  return 0;
}

/**
 * Fetch every project folder + its tagged project lookupId. The
 * Miscellaneous folder is included with projectLookupId=0 so callers
 * can use the same shape for fallback lookups.
 */
export async function listProjectFolders(): Promise<ProjectFolder[]> {
  if (USE_MOCK) {
    return [];
  }
  const path =
    `/sites/${SP_SITE_ID}/drive/root:/${encodeDrivePath(PROJECT_FOLDERS_PATH.split("/"))}` +
    `:/children?$expand=listItem($expand=fields)`;
  const res = await graphFetch<{ value: GraphDriveChild[] }>(path);
  const folders: ProjectFolder[] = [];
  for (const child of res.value ?? []) {
    if (!child.folder) continue; // skip stray files
    const fields = child.listItem?.fields ?? {};
    const projectLookupId =
      isMiscFolder(child.name) ? 0 : readLookupId(fields);
    folders.push({
      id: child.id,
      name: child.name,
      webUrl: child.webUrl,
      projectLookupId,
    });
  }
  return folders;
}

/**
 * Resolve which folder a file should be written into for the given task
 * project. Returns the Miscellaneous folder with a filename prefix when
 * the project has no matching folder.
 *
 * `projects` is the same Projects-list catalogue `useProjects()` exposes.
 * We use it as a backup source for the project title when the task's
 * own `parentProject.title` came back blank (which happens if the task
 * was loaded before the projects catalogue finished joining titles).
 *
 * `fallbackPrefix` is what we tag the filename with if there's no
 * parent project at all (e.g. a task that hasn't been classified yet).
 * Callers typically pass the task's NumberedTitle (`T15-...`) or
 * `T-{itemId}` so the file is still findable by who-uploaded-it.
 */
export function resolveFolderForProject(
  folders: ProjectFolder[],
  parentProject: { lookupId: number; title: string } | null,
  projects: { lookupId: number; title: string }[] = [],
  fallbackPrefix = "",
): ResolvedFolder | null {
  // 1. Try to match a real project folder by lookupId.
  if (parentProject && parentProject.lookupId > 0) {
    const match = folders.find(
      (f) => f.projectLookupId === parentProject.lookupId && !isMiscFolder(f.name),
    );
    if (match) return { kind: "project", folder: match };
  }

  // 2. Fall through to Misc.
  const misc = folders.find((f) => isMiscFolder(f.name));
  if (!misc) return null; // no Miscellaneous folder configured

  // Resolve the title — prefer the task's own title, fall back to the
  // projects catalogue, then a lookupId-based stub, and finally the
  // task-derived fallback prefix for the no-parent-project case.
  let title = parentProject?.title?.trim() ?? "";
  if (!title && parentProject?.lookupId) {
    title =
      projects.find((p) => p.lookupId === parentProject.lookupId)?.title ?? "";
  }
  let prefix = projectCodePrefix(title);
  if (!prefix && parentProject?.lookupId) {
    prefix = `LID-${parentProject.lookupId}`;
  }
  if (!prefix) {
    prefix = projectCodePrefix(fallbackPrefix);
  }
  return { kind: "misc", folder: misc, filenamePrefix: prefix };
}

// ---------------------------------------------------------------------------
// List, upload, delete files
// ---------------------------------------------------------------------------

function mapDriveFile(c: GraphDriveChild): ProjectFile {
  return {
    id: c.id,
    name: c.name,
    webUrl: c.webUrl,
    size: c.size ?? 0,
    lastModified: c.lastModifiedDateTime ? new Date(c.lastModifiedDateTime) : new Date(0),
  };
}

/**
 * List the most-recently-modified files for the task's project (or Misc
 * with prefix filter). Returns at most `RECENT_FILES_LIMIT` files.
 */
export async function listTaskFiles(
  resolved: ResolvedFolder,
): Promise<ProjectFile[]> {
  if (USE_MOCK) {
    const key = resolved.kind === "project" ? resolved.folder.projectLookupId : 0;
    let list = (mockFiles.get(key) ?? []).slice();
    if (resolved.kind === "misc" && resolved.filenamePrefix) {
      list = list.filter((f) => f.name.startsWith(`${resolved.filenamePrefix}_`));
    }
    list.sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime());
    return list.slice(0, RECENT_FILES_LIMIT);
  }
  const path =
    `/sites/${SP_SITE_ID}/drive/items/${resolved.folder.id}/children` +
    `?$orderby=lastModifiedDateTime%20desc&$top=${RECENT_FILES_LIMIT * 3}` +
    `&$select=id,name,webUrl,size,lastModifiedDateTime,folder,file`;
  const res = await graphFetch<{ value: GraphDriveChild[] }>(path);
  let files = (res.value ?? []).filter((c) => c.file).map(mapDriveFile);
  if (resolved.kind === "misc" && resolved.filenamePrefix) {
    files = files.filter((f) => f.name.startsWith(`${resolved.filenamePrefix}_`));
  }
  return files.slice(0, RECENT_FILES_LIMIT);
}

/** Compute the actual filename to write (applies the Misc prefix). */
export function targetFilename(resolved: ResolvedFolder, originalName: string): string {
  if (resolved.kind === "misc" && resolved.filenamePrefix) {
    return `${resolved.filenamePrefix}_${originalName}`;
  }
  return originalName;
}

/**
 * Dedupe `desiredName` against what's already sitting in the destination
 * folder before we upload, so two people pasting "screenshot.png" into the
 * same project get two files instead of one clobbering the other. Reuses
 * `listProjectFolderEntries` — it already knows how to list a folder's
 * children in both mock and real mode, so this needs no new Graph call shape.
 *
 * If the listing itself fails (transient Graph error, permissions blip), we
 * upload the name as-is rather than blocking the user — the
 * conflictBehavior=rename param on the PUT (see uploadToDrive) is the
 * server-side backstop for exactly that case.
 */
async function resolveUniqueName(folderId: string, desiredName: string): Promise<string> {
  try {
    const existing = await listProjectFolderEntries(folderId);
    return safeUniqueFilename(desiredName, existing.map((e) => e.name));
  } catch {
    return desiredName;
  }
}

export async function uploadTaskFile(
  resolved: ResolvedFolder,
  file: File,
  onProgress?: UploadProgress,
): Promise<ProjectFile> {
  const desiredName = targetFilename(resolved, file.name);
  const finalName = await resolveUniqueName(resolved.folder.id, desiredName);

  /* eslint-disable no-console */
  console.log(
    `[projectFiles] uploading "${file.name}" → ${resolved.folder.name} ` +
      `as "${finalName}" (kind=${resolved.kind}` +
      (resolved.kind === "misc" ? `, prefix="${resolved.filenamePrefix}"` : "") +
      `)`,
  );
  /* eslint-enable no-console */

  if (USE_MOCK) {
    const key = resolved.kind === "project" ? resolved.folder.projectLookupId : 0;
    const entry: ProjectFile = {
      id: `mock-${nextMockFileId++}`,
      name: finalName,
      webUrl: URL.createObjectURL(file),
      size: file.size,
      lastModified: mockNow(),
    };
    const next = [...(mockFiles.get(key) ?? []), entry];
    mockFiles.set(key, next);
    return entry;
  }
  const res = await uploadToDrive(
    `/sites/${SP_SITE_ID}/drive/items/${resolved.folder.id}`,
    finalName,
    file,
    onProgress,
  );
  return mapDriveFile(res);
}

export async function deleteTaskFile(driveItemId: string): Promise<void> {
  if (USE_MOCK) {
    for (const [k, list] of mockFiles) {
      const next = list.filter((f) => f.id !== driveItemId);
      if (next.length !== list.length) {
        mockFiles.set(k, next);
        return;
      }
    }
    return;
  }
  await graphFetch(`/sites/${SP_SITE_ID}/drive/items/${driveItemId}`, {
    method: "DELETE",
  });
}

// =============================================================================
// Project Folders browser — a nested file explorer over the same
// "General/Project Folders" library, used by the Project Folders view.
//
// A single entry type covers both subfolders and files so one list renders
// them together. Top-level project folders also carry their Project Reference
// lookupId so the view can show the linked project's name.
// =============================================================================

export interface DriveEntry {
  id: string;
  name: string;
  webUrl: string;
  isFolder: boolean;
  size: number;
  lastModified: Date;
  /** Number of children (folders only). */
  childCount?: number;
  /** Project Reference lookupId — only resolved for top-level project folders. */
  projectLookupId?: number;
}

function mapEntry(c: GraphDriveChild, computeLookup: boolean): DriveEntry {
  return {
    id: c.id,
    name: c.name,
    webUrl: c.webUrl,
    isFolder: !!c.folder,
    size: c.size ?? 0,
    lastModified: c.lastModifiedDateTime ? new Date(c.lastModifiedDateTime) : new Date(0),
    childCount: c.folder?.childCount,
    projectLookupId:
      computeLookup && c.folder ? readLookupId(c.listItem?.fields ?? {}) : undefined,
  };
}

/** Folders first, then files; each alphabetical (numeric-aware). */
function sortEntries(entries: DriveEntry[]): DriveEntry[] {
  return entries.sort((a, b) => {
    if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { numeric: true });
  });
}

/**
 * List the children (subfolders + files) of a project folder. Pass no
 * `folderId` to list the top-level project folders (children of
 * "General/Project Folders"); pass a drive-item id to browse into one.
 */
export async function listProjectFolderEntries(folderId?: string): Promise<DriveEntry[]> {
  if (USE_MOCK) return sortEntries(mockEntries(folderId).map((e) => ({ ...e })));

  const url = folderId
    ? `/sites/${SP_SITE_ID}/drive/items/${folderId}/children` +
      `?$top=999&$select=id,name,webUrl,size,lastModifiedDateTime,folder,file`
    : `/sites/${SP_SITE_ID}/drive/root:/${encodeDrivePath(PROJECT_FOLDERS_PATH.split("/"))}` +
      `:/children?$expand=listItem($expand=fields)&$top=999`;
  const res = await graphFetch<{ value: GraphDriveChild[] }>(url);
  const entries = (res.value ?? []).map((c) => mapEntry(c, !folderId));
  return sortEntries(entries);
}

/**
 * Upload a file into a folder by its drive-item id. Chunks automatically once
 * the file is bigger than a single PUT can carry — see {@link MAX_UPLOAD_BYTES}.
 */
export async function uploadFileToFolder(
  folderId: string,
  file: File,
  onProgress?: UploadProgress,
): Promise<DriveEntry> {
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error(
      `"${file.name}" is ${formatBytes(file.size)} — over the ` +
        `${formatBytes(MAX_UPLOAD_BYTES)} upload limit.`,
    );
  }
  const finalName = await resolveUniqueName(folderId, file.name);

  if (USE_MOCK) {
    const entry: DriveEntry = {
      id: `mockde-${nextMockFileId++}`,
      name: finalName,
      webUrl: "#",
      isFolder: false,
      size: file.size,
      lastModified: mockNow(),
    };
    const list = mockTree.get(folderId) ?? [];
    mockTree.set(folderId, [...list, entry]);
    return entry;
  }
  const res = await uploadToDrive(
    `/sites/${SP_SITE_ID}/drive/items/${folderId}`,
    finalName,
    file,
    onProgress,
  );
  return mapEntry(res, false);
}

// ---- Mock project-folder tree (demo mode) ---------------------------------
const MOCK_ROOT = "__root__";

function seedMockTree(): Map<string, DriveEntry[]> {
  const d = (name: string, id: string, extra: Partial<DriveEntry> = {}): DriveEntry => ({
    id,
    name,
    webUrl: "#",
    isFolder: true,
    size: 0,
    lastModified: new Date("2026-05-01T12:00:00"),
    childCount: 0,
    ...extra,
  });
  const f = (name: string, id: string, size = 24_000): DriveEntry => ({
    id,
    name,
    webUrl: "#",
    isFolder: false,
    size,
    lastModified: new Date("2026-05-10T09:30:00"),
  });
  return new Map<string, DriveEntry[]>([
    [
      MOCK_ROOT,
      [
        // lookupIds match MOCK_PROJECTS in src/data/mockData.ts, so the
        // Dashboard's project filter can match a folder to its project.
        d("0017-AMP-5000 Refresh", "mf-amp", { projectLookupId: 501, childCount: 3 }),
        d("0000-Engineering Apps", "mf-eng", { projectLookupId: 274, childCount: 1 }),
        d("Miscellaneous", "mf-misc", { projectLookupId: 0, childCount: 1 }),
      ],
    ],
    [
      "mf-amp",
      [
        d("Drawings", "mf-amp-draw", { childCount: 1 }),
        f("AMP-5000 Test Plan.pdf", "mf-amp-1", 512_000),
        f("BOM.xlsx", "mf-amp-2", 88_000),
      ],
    ],
    ["mf-amp-draw", [f("driver-board-revD.dwg", "mf-amp-draw-1", 1_200_000)]],
    ["mf-eng", [f("App Backlog.docx", "mf-eng-1", 40_000)]],
    ["mf-misc", [f("0000_scratch-notes.txt", "mf-misc-1", 2_000)]],
  ]);
}

let mockTree = seedMockTree();

function mockEntries(folderId?: string): DriveEntry[] {
  return mockTree.get(folderId ?? MOCK_ROOT) ?? [];
}
