import type { Fait, FaitInput, GraphListItem, Person, ProjectReference } from "@/types/task";
import { FAIT_FIELDS, FAIT_FIELD_BY_KEY } from "./faitFields";
import { parseCommunication } from "./communicationParser";
import { parseSpDate, parseSpDateOnly, toSpDateOnly } from "./spDates";
import { parsePeople, parseSinglePerson } from "./grayMarketMapper";

// =============================================================================
// Graph item → Fait, and back.
//
// Driven by the descriptor table in faitFields.ts, so a column added there is
// read, written, selected and rendered without touching this file.
//
// Three shapes worth knowing:
//
//  - **Nineteen real boolean columns.** Carried in `values` as "Yes" / "" so
//    the record stays one string-keyed shape, and turned back into a real
//    boolean on write — the same arrangement as the ECN register.
//  - **Two date-only columns** (`FailedFirstPassDate`, `WaivedDate`). Read
//    through `parseSpDateOnly`'s midday pivot and written at midday UTC, so
//    they show the day the SharePoint view shows.
//  - **Three single-value lookups** — project, EIR, test document. Graph hands
//    these back as `<Name>LookupId` with no title, so titles are joined
//    client-side. Writing one is a BARE INTEGER.
// =============================================================================

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** `<Name>LookupId` → a number, or null when unset. */
export function readLookupId(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const id = typeof raw === "number" ? raw : parseInt(String(raw), 10);
  return Number.isFinite(id) && id > 0 ? id : null;
}

export function toFait(item: GraphListItem): Fait {
  const f = item.fields ?? {};
  const values: Record<string, string> = {};
  for (const field of FAIT_FIELDS) {
    const raw = f[field.column];
    if (field.kind === "boolean") {
      values[field.key] = raw === true ? "Yes" : "";
    } else if (field.kind === "date") {
      const d = parseSpDateOnly(raw);
      values[field.key] = d ? d.toISOString() : "";
    } else {
      values[field.key] = text(raw).trim();
    }
  }

  const projectId = readLookupId(f.ProjectReferenceLookupId);

  return {
    id: parseInt(item.id, 10),
    title: text(f.Title).trim(),
    status: text(f.Status).trim(),
    parentProject: projectId ? { lookupId: projectId, title: "" } : null,
    eirLookupId: readLookupId(f.EIR_x0020_ReferenceLookupId),
    testDocumentLookupId: readLookupId(f.TestDocumentReferenceLookupId),
    initiator: parseSinglePerson(f.Initiator),
    assignedEngineer: parseSinglePerson(f.AssignedEngineer),
    kam: parseSinglePerson(f.KAM),
    watchers: parsePeople(f.Watchers),
    comments: parseCommunication(text(f.Communication)),
    hasAttachments: f.Attachments === true,
    values,
    createdAt: parseSpDate(f.Created) ?? new Date(0),
    modifiedAt: parseSpDate(f.Modified) ?? new Date(0),
  };
}

/** One descriptor value → what SharePoint should be sent for that column. */
function columnValue(key: string, value: string): unknown {
  const field = FAIT_FIELD_BY_KEY[key];
  if (!field) throw new Error(`Unknown FAIT field: ${key}`);
  if (field.kind === "boolean") return value === "Yes";
  if (field.kind === "date") {
    if (!value) return null;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : toSpDateOnly(d);
  }
  return value.trim();
}

/**
 * Create payload. Blank text is omitted — on a create SharePoint would rather
 * not hear about a column than be handed an empty string — but booleans are
 * always sent, because "No" is a real answer to "New Part" and a null reads as
 * blank rather than No in SharePoint's own views.
 */
export function buildFaitCreateFields(input: FaitInput): Record<string, unknown> {
  const fields: Record<string, unknown> = {
    Title: input.title.trim(),
    Status: input.status,
  };
  if (input.projectLookupId) fields.ProjectReferenceLookupId = input.projectLookupId;
  for (const field of FAIT_FIELDS) {
    const value = (input.values[field.key] ?? "").trim();
    if (field.kind === "boolean") {
      fields[field.column] = value === "Yes";
      continue;
    }
    if (!value) continue;
    fields[field.column] = columnValue(field.key, value);
  }
  return fields;
}

/** One descriptor field → its SharePoint patch. */
export function faitFieldPatch(key: string, value: string): Record<string, unknown> {
  const field = FAIT_FIELD_BY_KEY[key];
  if (!field) throw new Error(`Unknown FAIT field: ${key}`);
  return { [field.column]: columnValue(key, value) };
}

/** The project lookup's patch — a bare integer, null to clear. */
export function faitProjectPatch(lookupId: number | null): Record<string, unknown> {
  return { ProjectReferenceLookupId: lookupId ?? null };
}

/**
 * What to call a FAIT.
 *
 * Title is empty on every row the list already holds, so the part number is
 * the identifier in practice — falling back through description to the id.
 */
export function faitLabel(fait: Fait): string {
  const part = fait.values.sapPartNumber?.trim();
  const desc = fait.values.description?.trim();
  if (part && desc) return `${part} — ${desc}`;
  return part || desc || fait.title.trim() || `FAIT #${fait.id}`;
}

/** Newest first. Created is the only ordering this list supports. */
export function compareFaits(a: Fait, b: Fait): number {
  const diff = b.createdAt.getTime() - a.createdAt.getTime();
  return diff !== 0 ? diff : b.id - a.id;
}

/** Everyone already on a FAIT — the @-mention picker's starting point. */
export function collectFaitPeople(faits: Fait[]): Person[] {
  const out: Person[] = [];
  for (const f of faits) {
    for (const p of [f.initiator, f.assignedEngineer, f.kam, ...f.watchers]) {
      if (p) out.push(p);
    }
  }
  return out;
}

/** Resolve a project title from the loaded Projects catalogue. */
export function faitProjectTitle(
  fait: Fait,
  projects: ProjectReference[],
): string {
  if (!fait.parentProject) return "";
  return projects.find((p) => p.lookupId === fait.parentProject!.lookupId)?.title ?? "";
}
