import { formatSpDate } from "./spDates";
import { parseSpDate as parseDate } from "./spDates";
import type {
  GraphListItem,
  TeradyneEmployee,
  TeradyneLogEntry,
  TeradyneProduct,
  TeradyneRef,
  TeradyneRemark,
} from "@/types/task";

// =============================================================================
// Graph item → Teradyne domain objects.
//
// Field names come from live column discovery against the PMO site
// (scripts/discover-teradyne-lists.ps1, run 2026-07-28). Unlike the EIR list,
// none of these are mangled with _x00xx_ escapes — they're clean names
// (EnterDate, DefectiveParts, SAPNumber, …) because the lists were created by
// import rather than by hand in the SharePoint UI.
// =============================================================================

/** Coerce a Graph number field (which arrives as number OR numeric string). */
export function toNumberOrNull(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** Coerce a lookup id field (Graph hands these back as strings: "201"). */
export function toLookupId(raw: unknown): number | null {
  const n = toNumberOrNull(raw);
  return n !== null && Number.isInteger(n) && n > 0 ? n : null;
}

function toText(raw: unknown): string {
  return typeof raw === "string" ? raw : "";
}

// Date-only handling now lives in src/lib/spDates.ts so Engineering features can
// share it without importing from an Operations module. Re-exported here because
// this module is the Teradyne mapper's public face and callers already import
// them from it.
export {
  fromDateInputValue,
  parseSpDate,
  toDateInputValue,
  toSpDateOnly,
} from "./spDates";

/** Display a Teradyne date. Alias of the shared formatter; kept for call sites. */
export const formatTeradyneDate = formatSpDate;

/**
 * The log's `Title` column, as the existing rows are formatted:
 * "Moris Power Supply - U1" = product title, " - ", defective parts.
 *
 * The app owns this string (same arrangement as `NumberedTitle` on Engineering
 * tasks): it's a real writable text column, but no user types it — every
 * create/update recomputes it so it can never drift from the two fields it's
 * built from. Falls back gracefully when either half is missing so a
 * half-filled row still gets a usable label.
 */
export function buildTeradyneLogTitle(
  productTitle: string | null | undefined,
  defectiveParts: string | null | undefined,
): string {
  const product = (productTitle ?? "").trim();
  const parts = (defectiveParts ?? "").trim();
  if (product && parts) return `${product} - ${parts}`;
  return product || parts || "(untitled entry)";
}

/** An employee's `Title`, derived from the two name columns: "Dave Anderson". */
export function buildTeradyneEmployeeTitle(
  firstName: string | null | undefined,
  lastName: string | null | undefined,
): string {
  return `${(firstName ?? "").trim()} ${(lastName ?? "").trim()}`.trim();
}

export function toTeradyneEmployee(item: GraphListItem): TeradyneEmployee {
  const f = item.fields as Record<string, unknown>;
  const firstName = toText(f.First_Name);
  const lastName = toText(f.Last_Name);
  return {
    lookupId: parseInt(item.id, 10),
    // Prefer the stored Title (that's what the log's lookup column displays);
    // fall back to the derived name for rows imported without one.
    title: toText(f.Title) || buildTeradyneEmployeeTitle(firstName, lastName),
    firstName,
    lastName,
    clockNum: toNumberOrNull(f.ClockNum),
    workCenter: toText(f.Work_Center),
    idEmp: toNumberOrNull(f.IDEmp),
  };
}

export function toTeradyneProduct(item: GraphListItem): TeradyneProduct {
  const f = item.fields as Record<string, unknown>;
  return {
    lookupId: parseInt(item.id, 10),
    title: toText(f.Title),
    testOnStation: toText(f.TestOnStation),
    idProd: toNumberOrNull(f.IDProd),
  };
}

export function toTeradyneRemark(item: GraphListItem): TeradyneRemark {
  const f = item.fields as Record<string, unknown>;
  return {
    lookupId: parseInt(item.id, 10),
    title: toText(f.Title),
    idRem: toNumberOrNull(f.IDRem),
  };
}

/** Lookup id → title maps, built from the three reference lists. */
export interface TeradyneRefMaps {
  products: Map<number, string>;
  employees: Map<number, string>;
  remarks: Map<number, string>;
}

export function buildTeradyneRefMaps(
  products: TeradyneProduct[],
  employees: TeradyneEmployee[],
  remarks: TeradyneRemark[],
): TeradyneRefMaps {
  return {
    products: new Map(products.map((p) => [p.lookupId, p.title])),
    employees: new Map(employees.map((e) => [e.lookupId, e.title])),
    remarks: new Map(remarks.map((r) => [r.lookupId, r.title])),
  };
}

/**
 * Resolve one `<Field>LookupId` into a `TeradyneRef`. A lookup pointing at a
 * reference row that no longer exists still returns a ref — labelled by id —
 * rather than null, so a dangling pointer is visible in the UI instead of
 * silently reading as "no product selected".
 */
function resolveRef(rawId: unknown, titles: Map<number, string>): TeradyneRef | null {
  const lookupId = toLookupId(rawId);
  if (lookupId === null) return null;
  return { lookupId, title: titles.get(lookupId) ?? `(missing #${lookupId})` };
}

export function toTeradyneLogEntry(item: GraphListItem, maps: TeradyneRefMaps): TeradyneLogEntry {
  const f = item.fields as Record<string, unknown>;
  const product = resolveRef(f.ProductLookupId, maps.products);
  const defectiveParts = toText(f.DefectiveParts);
  return {
    id: parseInt(item.id, 10),
    // Trust the stored Title when present (that's what SharePoint views show),
    // but derive it when a row predates the app or was created without one.
    title: toText(f.Title) || buildTeradyneLogTitle(product?.title, defectiveParts),
    enterDate: parseDate(f.EnterDate),
    product,
    employee1: resolveRef(f.Employee1LookupId, maps.employees),
    employee2: resolveRef(f.Employee2LookupId, maps.employees),
    remark: resolveRef(f.RemarkLookupId, maps.remarks),
    employee1Clock: toNumberOrNull(f.Employee1Clock),
    employee2Clock: toNumberOrNull(f.Employee2Clock),
    defectiveParts,
    numberOfBoards: toNumberOrNull(f.NumberOfBoards),
    boardsTested: toNumberOrNull(f.BoardsTested),
    failuresPerBoard: toNumberOrNull(f.FailuresPerBoard),
    sapNumber: toText(f.SAPNumber),
    // "Altronic Part Number" to users; the SharePoint column is still
    // OldSAPNumber (see the note on TeradyneLogEntry in types/task.ts).
    altronicPartNumber: toText(f.OldSAPNumber),
    operatorNotes: toText(f.OperatorNotes),
    createdAt: new Date(item.createdDateTime),
    modifiedAt: new Date(item.lastModifiedDateTime),
  };
}

/**
 * Newest first: by Enter Date, then by id so same-day rows keep a stable,
 * insertion-ordered sequence. Rows with no date sort last — they're incomplete,
 * not current.
 */
export function compareTeradyneLogEntries(a: TeradyneLogEntry, b: TeradyneLogEntry): number {
  const at = a.enterDate?.getTime() ?? null;
  const bt = b.enterDate?.getTime() ?? null;
  if (at === null && bt === null) return b.id - a.id;
  if (at === null) return 1;
  if (bt === null) return -1;
  if (at !== bt) return bt - at;
  return b.id - a.id;
}
