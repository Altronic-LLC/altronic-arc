// =============================================================================
// Files LINKED to an Engineering task from the project-folder library
// (BusinessIT#62, Robert Ferrante via ARC Feature Request #36; Tim, 2026-11-25).
//
// Engineers save files into a project's subfolders in SharePoint first, then
// attach them to a task. Attaching used to UPLOAD them again, so every file
// ended up twice in the library — once where it belongs, once at the top of
// the project folder. A linked file is never copied: the task stores WHICH
// file, and the file stays where it is.
//
// The links live in the task's `LinkedFiles` column — multi-line plain text
// holding a JSON array, because Graph can't write a Hyperlink column at all.
// Each entry names the file by its drive item ID, which survives a rename or a
// move inside the library; the name, link and folder are kept too, so a file
// that has gone still shows what it was.
//
// Pure — no React, no Graph. The rules:
//  - a value ARC can't read is CORRUPT, and is never written over (the ECN
//    checklist rule): the caller refuses and says so;
//  - blank is an empty list, not corrupt;
//  - one link per file (by id) — linking a linked file changes nothing;
//  - entries that aren't recognisably a link are dropped on read, never
//    guessed at.
// =============================================================================

export interface LinkedFile {
  /** The drive item id in the Engineering Documents library. */
  id: string;
  /** The file's name when it was linked (or last seen). */
  name: string;
  /** Its SharePoint page — opens in Office for the web, or downloads. */
  webUrl: string;
  /** Where it sits below General / Project Folders, "381-MT / Misc / Actuators". */
  folderPath: string;
  /** Who linked it. */
  linkedBy: string;
  linkedByEmail: string;
  /** When, as an ISO timestamp. */
  linkedAt: string;
}

/** A file picked in the library browser — a link before it has an author. */
export interface PickedLibraryFile {
  id: string;
  name: string;
  webUrl: string;
  folderPath: string;
}

/** The SharePoint column. */
export const LINKED_FILES_COLUMN = "LinkedFiles";

/**
 * The longest value ARC will write. A multi-line text column holds far more,
 * but past this a task has hundreds of links, which is a mistake, not a use.
 */
export const LINKED_FILES_MAX_CHARS = 60_000;

/** Joins folder names in a path shown to people. */
export const FOLDER_PATH_SEPARATOR = " / ";

export interface ParsedLinkedFiles {
  files: LinkedFile[];
  /** The stored value couldn't be read — never write over it. */
  corrupt: boolean;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** Read the column. Blank is no links; unreadable is `corrupt`. */
export function parseLinkedFiles(raw: unknown): ParsedLinkedFiles {
  if (raw === null || raw === undefined) return { files: [], corrupt: false };
  if (typeof raw !== "string") return { files: [], corrupt: true };
  const text = raw.trim();
  if (!text) return { files: [], corrupt: false };
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { files: [], corrupt: true };
  }
  if (!Array.isArray(value)) return { files: [], corrupt: true };
  const seen = new Set<string>();
  const files: LinkedFile[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const id = str(e.id).trim();
    const name = str(e.name).trim();
    if (!id || !name || seen.has(id)) continue;
    seen.add(id);
    files.push({
      id,
      name,
      webUrl: str(e.webUrl),
      folderPath: str(e.folderPath),
      linkedBy: str(e.linkedBy),
      linkedByEmail: str(e.linkedByEmail),
      linkedAt: str(e.linkedAt),
    });
  }
  return { files, corrupt: false };
}

/** The value to write. Empty → `null`, which clears the column. */
export function serializeLinkedFiles(files: LinkedFile[]): string | null {
  if (files.length === 0) return null;
  const json = JSON.stringify(files);
  if (json.length > LINKED_FILES_MAX_CHARS) {
    throw new Error(
      `This task has too many linked files to save (${files.length}). Unlink some first.`,
    );
  }
  return json;
}

/**
 * The links with `picked` added — after the existing ones, in the order
 * picked, skipping any file already linked. `linkedAt` and the author are
 * stamped on the new ones only.
 */
export function addLinkedFiles(
  existing: LinkedFile[],
  picked: PickedLibraryFile[],
  by: { name: string; email: string },
  at: Date,
): LinkedFile[] {
  const have = new Set(existing.map((f) => f.id));
  const added: LinkedFile[] = [];
  for (const p of picked) {
    if (!p.id || have.has(p.id)) continue;
    have.add(p.id);
    added.push({
      id: p.id,
      name: p.name,
      webUrl: p.webUrl,
      folderPath: p.folderPath,
      linkedBy: by.name,
      linkedByEmail: by.email,
      linkedAt: at.toISOString(),
    });
  }
  return [...existing, ...added];
}

/** The links without `fileId`. */
export function removeLinkedFile(existing: LinkedFile[], fileId: string): LinkedFile[] {
  return existing.filter((f) => f.id !== fileId);
}

/** Do two link lists name the same files in the same order? */
export function sameLinkedFiles(a: LinkedFile[], b: LinkedFile[]): boolean {
  return a.length === b.length && a.every((f, i) => f.id === b[i].id);
}

/** The folder names below General / Project Folders, as people read them. */
export function folderPathText(names: string[]): string {
  return names.join(FOLDER_PATH_SEPARATOR);
}

/**
 * The folders BELOW `General/Project Folders` from a Graph
 * `parentReference.path` ("/drives/b!…/root:/General/Project%20Folders/381/Misc").
 * A path outside Project Folders keeps every folder below the library root.
 */
export function folderNamesBelowProjectFolders(
  parentPath: string | undefined,
  projectFoldersPath: string,
): string[] {
  if (!parentPath) return [];
  const at = parentPath.indexOf("root:");
  if (at < 0) return [];
  const names = parentPath
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
  const prefix = projectFoldersPath.split("/").filter(Boolean);
  const under =
    names.length >= prefix.length &&
    prefix.every((p, i) => p.toLowerCase() === names[i].toLowerCase());
  return under ? names.slice(prefix.length) : names;
}
