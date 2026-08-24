import { graphFetch } from "./graph";
import { SITES, USE_MOCK } from "./config";
import { weekFolderName } from "@/lib/openOrders";

// =============================================================================
// Open Orders — the SharePoint side.
//
// Everything the weekly run reads and writes lives in ONE folder tree on the
// Sales team site's default document library:
//
//   General/Order Management/OPEN ORDERS/            ← master dashboards
//     RAW UPLOADS/                                   ← the raw SAP extracts
//     Week of 2026-08-17/                            ← that week's customer files
//     Week of 2026-08-24/
//
// **The path is not guessed.** Ray gave a sharing link
// (…/:f:/s/ALTRONICSALESTEAM/IgABH6FP…), and a share token is a poor thing to
// build on: it can be regenerated, and the two links he sent carried different
// `e=` values. The library and path above come from the OneDrive sync mapping
// for that same folder —
//
//   MountPoint   C:\…\ALTRONIC SALES TEAM - General 1\Order Management\OPEN ORDERS
//   UrlNamespace https://coopermachineryservices.sharepoint.com/sites/
//                  ALTRONICSALESTEAM/Shared Documents/
//
// — which resolves to `General/Order Management/OPEN ORDERS` in the default
// drive of SITES.salesTeam. That's the same `General/…` shape the Engineering
// project folders use, because both are Teams channel folders.
//
// Auth: the existing `Sites.Selected` grant on the Sales site (already in
// place for Visit Reports) covers this. No new grant, no SharePoint REST.
// =============================================================================

/** Where the tool's files live, relative to the drive root. */
export const OPEN_ORDERS_PATH = "General/Order Management/OPEN ORDERS";

/** Subfolder the raw SAP extracts are kept in. */
export const RAW_UPLOADS_FOLDER = "RAW UPLOADS";

/** Graph prefix for the Sales site's default document library. */
function driveRoot(): string {
  return `/sites/${SITES.salesTeam}/drive/root`;
}

/** `…/drive/root:/a/b/c:` — the addressing Graph wants for a path. */
function pathRef(segments: string[]): string {
  const encoded = segments.map((s) => encodeURIComponent(s)).join("/");
  return `${driveRoot()}:/${encoded}:`;
}

function basePath(...extra: string[]): string[] {
  return [...OPEN_ORDERS_PATH.split("/"), ...extra];
}

export interface OpenOrdersFile {
  id: string;
  name: string;
  sizeBytes: number;
  lastModified: Date | null;
  /** Opens the file in SharePoint / Excel Online. */
  webUrl: string;
  /**
   * Pre-authenticated direct download URL.
   *
   * Graph returns it as `@microsoft.graph.downloadUrl` and it is short-lived,
   * so it is used the moment it is read and never stored.
   */
  downloadUrl: string | null;
}

export interface OpenOrdersWeek {
  /** Folder name, e.g. "Week of 2026-08-17". */
  name: string;
  id: string;
  /** Monday of that week, parsed out of the name; null if it doesn't fit. */
  weekOf: Date | null;
  fileCount: number;
}

interface GraphChild {
  id: string;
  name: string;
  size?: number;
  webUrl?: string;
  lastModifiedDateTime?: string;
  folder?: { childCount?: number };
  file?: { mimeType?: string };
  "@microsoft.graph.downloadUrl"?: string;
}

const CHILD_SELECT =
  "$select=id,name,size,webUrl,lastModifiedDateTime,folder,file,@microsoft.graph.downloadUrl";

function toFile(child: GraphChild): OpenOrdersFile {
  return {
    id: child.id,
    name: child.name,
    sizeBytes: child.size ?? 0,
    lastModified: child.lastModifiedDateTime ? new Date(child.lastModifiedDateTime) : null,
    webUrl: child.webUrl ?? "",
    downloadUrl: child["@microsoft.graph.downloadUrl"] ?? null,
  };
}

/** Newest first — the file people want is almost always the latest one. */
function newestFirst(a: OpenOrdersFile, b: OpenOrdersFile): number {
  return (b.lastModified?.getTime() ?? 0) - (a.lastModified?.getTime() ?? 0);
}

/**
 * The master dashboards at the root of OPEN ORDERS.
 *
 * Folders are filtered out, so RAW UPLOADS and the weekly folders don't show
 * up as if they were reports.
 */
export async function listMasterReports(): Promise<OpenOrdersFile[]> {
  if (USE_MOCK) return mockMasters();
  const res = await graphFetch<{ value: GraphChild[] }>(
    `${pathRef(basePath())}/children?${CHILD_SELECT}`,
  );
  return (res?.value ?? [])
    .filter((c) => !c.folder)
    .map(toFile)
    .sort(newestFirst);
}

/** The weekly subfolders, newest week first. */
export async function listWeeks(): Promise<OpenOrdersWeek[]> {
  if (USE_MOCK) return mockWeeks();
  const res = await graphFetch<{ value: GraphChild[] }>(
    `${pathRef(basePath())}/children?${CHILD_SELECT}`,
  );
  return (res?.value ?? [])
    .filter((c) => !!c.folder && c.name !== RAW_UPLOADS_FOLDER)
    .map((c) => ({
      id: c.id,
      name: c.name,
      weekOf: weekOfFromName(c.name),
      fileCount: c.folder?.childCount ?? 0,
    }))
    .sort((a, b) => (b.weekOf?.getTime() ?? 0) - (a.weekOf?.getTime() ?? 0));
}

/** The customer workbooks inside one week's folder. */
export async function listWeekFiles(weekName: string): Promise<OpenOrdersFile[]> {
  if (USE_MOCK) return mockWeekFiles(weekName);
  const res = await graphFetch<{ value: GraphChild[] }>(
    `${pathRef(basePath(weekName))}/children?${CHILD_SELECT}`,
  );
  return (res?.value ?? [])
    .filter((c) => !c.folder)
    .map(toFile)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The raw extracts that have been uploaded, newest first. */
export async function listRawUploads(): Promise<OpenOrdersFile[]> {
  if (USE_MOCK) return mockRawUploads();
  const res = await graphFetch<{ value: GraphChild[] }>(
    `${pathRef(basePath(RAW_UPLOADS_FOLDER))}/children?${CHILD_SELECT}`,
  );
  return (res?.value ?? [])
    .filter((c) => !c.folder)
    .map(toFile)
    .sort(newestFirst);
}

/** "Week of 2026-08-17" → that Monday. */
export function weekOfFromName(name: string): Date | null {
  const m = /(\d{4})-(\d{2})-(\d{2})/.exec(name);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12));
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Create the week folder if it isn't there, and return its name.
 *
 * `conflictBehavior: replace` on a FOLDER is a no-op when it already exists,
 * which is what makes this safe to call before every run. Graph answers 409
 * on some tenants regardless, so that's swallowed — the folder existing is
 * the desired end state either way.
 */
export async function ensureWeekFolder(runDate: Date): Promise<string> {
  const name = weekFolderName(runDate);
  if (USE_MOCK) return name;
  try {
    await graphFetch(`${pathRef(basePath())}/children`, {
      method: "POST",
      body: JSON.stringify({
        name,
        folder: {},
        "@microsoft.graph.conflictBehavior": "replace",
      }),
    });
  } catch (err) {
    if (!isAlreadyExists(err)) throw err;
  }
  return name;
}

/** Same, for the raw-uploads folder. */
export async function ensureRawUploadsFolder(): Promise<string> {
  if (USE_MOCK) return RAW_UPLOADS_FOLDER;
  try {
    await graphFetch(`${pathRef(basePath())}/children`, {
      method: "POST",
      body: JSON.stringify({
        name: RAW_UPLOADS_FOLDER,
        folder: {},
        "@microsoft.graph.conflictBehavior": "replace",
      }),
    });
  } catch (err) {
    if (!isAlreadyExists(err)) throw err;
  }
  return RAW_UPLOADS_FOLDER;
}

function isAlreadyExists(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /409|nameAlreadyExists|already exists/i.test(message);
}

/**
 * Graph's simple-PUT ceiling. Every workbook this tool makes is far under it —
 * the 2,031-line master is around 400 KB — so there is deliberately no
 * chunked-upload path here, unlike projectFiles.ts which takes whatever a user
 * drags in.
 */
const SIMPLE_UPLOAD_MAX_BYTES = 4 * 1024 * 1024;

export interface UploadTarget {
  /** Subfolder under OPEN ORDERS, or none for the root. */
  folder?: string;
  filename: string;
  body: ArrayBuffer;
}

/**
 * Write one generated workbook.
 *
 * **`conflictBehavior: replace` is deliberate.** Re-running a week must
 * OVERWRITE that week's files, not leave "…(1).xlsx" beside them: two files
 * for one customer and one week is worse than one file that was refreshed,
 * because whoever sends it has no way to tell which is current. The UI warns
 * about what it is about to replace before it gets here.
 */
export async function uploadOpenOrdersFile(target: UploadTarget): Promise<OpenOrdersFile> {
  if (target.body.byteLength > SIMPLE_UPLOAD_MAX_BYTES) {
    throw new Error(
      `"${target.filename}" came out at ${Math.round(target.body.byteLength / 1024)} KB, ` +
        "which is over the 4 MB single-request limit. That's far bigger than any " +
        "report this tool has produced — check the extract isn't carrying more " +
        "than one week of data.",
    );
  }
  if (USE_MOCK) {
    return {
      id: `mock-${target.filename}`,
      name: target.filename,
      sizeBytes: target.body.byteLength,
      lastModified: new Date(),
      webUrl: "",
      downloadUrl: null,
    };
  }
  const segments = target.folder ? basePath(target.folder, target.filename) : basePath(target.filename);
  const res = await graphFetch<GraphChild>(
    `${pathRef(segments)}/content?@microsoft.graph.conflictBehavior=replace`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      },
      body: target.body,
    },
  );
  return toFile(res);
}

/** Store the raw extract alongside the reports it produced. */
export async function uploadRawExtract(filename: string, body: ArrayBuffer): Promise<OpenOrdersFile> {
  await ensureRawUploadsFolder();
  // The raw file is NOT replaced — it's the evidence behind a run, and two
  // extracts pulled on the same day are two different sets of facts. Graph
  // renames a clash instead.
  if (USE_MOCK) {
    return {
      id: `mock-raw-${filename}`,
      name: filename,
      sizeBytes: body.byteLength,
      lastModified: new Date(),
      webUrl: "",
      downloadUrl: null,
    };
  }
  const res = await graphFetch<GraphChild>(
    `${pathRef(basePath(RAW_UPLOADS_FOLDER, filename))}/content?@microsoft.graph.conflictBehavior=rename`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      },
      body,
    },
  );
  return toFile(res);
}

/**
 * Download a file's bytes.
 *
 * The `downloadUrl` Graph hands back is pre-authenticated and must be fetched
 * WITHOUT our bearer token — attaching one gets the request rejected. It's
 * also short-lived, hence re-reading the item rather than caching the URL.
 */
export async function downloadOpenOrdersFile(fileId: string): Promise<Blob> {
  if (USE_MOCK) return new Blob(["mock"], { type: "text/plain" });
  const item = await graphFetch<GraphChild>(
    `/sites/${SITES.salesTeam}/drive/items/${fileId}?${CHILD_SELECT}`,
  );
  const url = item?.["@microsoft.graph.downloadUrl"];
  if (!url) throw new Error("That file has no download link — open it in SharePoint instead.");
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Couldn't download that file (${res.status}).`);
  return res.blob();
}

// -----------------------------------------------------------------------------
// Mock mode
// -----------------------------------------------------------------------------

function mockDate(daysAgo: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d;
}

function mockMasters(): OpenOrdersFile[] {
  return [
    {
      id: "mock-master-1",
      name: "Altronic_Open_Orders_Dashboard_2026-08-21.xlsx",
      sizeBytes: 412_000,
      lastModified: mockDate(3),
      webUrl: "",
      downloadUrl: null,
    },
    {
      id: "mock-master-2",
      name: "Altronic_Open_Orders_Dashboard_2026-08-14.xlsx",
      sizeBytes: 405_000,
      lastModified: mockDate(10),
      webUrl: "",
      downloadUrl: null,
    },
  ];
}

function mockWeeks(): OpenOrdersWeek[] {
  return [
    { id: "mock-week-1", name: "Week of 2026-08-17", weekOf: weekOfFromName("2026-08-17"), fileCount: 8 },
    { id: "mock-week-2", name: "Week of 2026-08-10", weekOf: weekOfFromName("2026-08-10"), fileCount: 7 },
  ];
}

function mockWeekFiles(weekName: string): OpenOrdersFile[] {
  const stamp = weekName.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? "2026-08-17";
  return [
    "Permian_Midstream_Partners",
    "Bayou_Gas_&_Compression,_Inc._Lafayette",
    "Cimarron_Compression",
    "Great_Lakes_Field_Services",
  ].map((name, i) => ({
    id: `mock-week-file-${i}`,
    name: `${name}_Open_Orders_${stamp}.xlsx`,
    sizeBytes: 30_000 + i * 4_000,
    lastModified: mockDate(3),
    webUrl: "",
    downloadUrl: null,
  }));
}

function mockRawUploads(): OpenOrdersFile[] {
  return [
    {
      id: "mock-raw-1",
      name: "OOR 8-21-2026 with customer tabs_R0.xlsx",
      sizeBytes: 268_000,
      lastModified: mockDate(3),
      webUrl: "",
      downloadUrl: null,
    },
  ];
}
