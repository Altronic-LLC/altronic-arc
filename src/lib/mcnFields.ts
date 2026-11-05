import type { McnAnswer, McnItem, McnScopeLine } from "@/types/mcn";

// =============================================================================
// Manufacturing Change Notices — the columns, as DATA.
//
// The "Requires…" and "Incorporate into" lines of MFGFRM-021 are ten Yes / No
// answers, nine of them with a reference beside them. Declared once here, they
// drive the mapper, the write payload, the $select, the detail cards and the
// card editors — the same arrangement as scnFields.ts. A line added to the form
// is one descriptor here plus one column in scripts/create-mcn-lists.ps1.
//
// The internal names are a CONTRACT with that script.
// =============================================================================

export type McnItemGroup = "requires" | "incorporate";

export interface McnItemField {
  /** Domain key — `Mcn.items[key]`. */
  key: string;
  group: McnItemGroup;
  /** The form's own wording. */
  label: string;
  /** The Yes / No choice column. */
  answerColumn: string;
  /** The reference text column; absent for Notify Customer, which has none. */
  referenceColumn?: string;
  /** What the reference box holds, as a placeholder. */
  referenceHint?: string;
}

export const MCN_ITEM_FIELDS: McnItemField[] = [
  {
    key: "bulkMaterial",
    group: "requires",
    label: "Requires review of bulk material related to the process",
    answerColumn: "ReqBulkMaterial",
    referenceColumn: "ReqBulkMaterialRef",
    referenceHint: "Part numbers or material reviewed",
  },
  {
    key: "workInstruction",
    group: "requires",
    label: "Requires work instruction change",
    answerColumn: "ReqWorkInstruction",
    referenceColumn: "ReqWorkInstructionRef",
    referenceHint: "e.g. MWI-0444 & MWI-564",
  },
  {
    key: "router",
    group: "requires",
    label: "Requires router change",
    answerColumn: "ReqRouter",
    referenceColumn: "ReqRouterRef",
    referenceHint: "e.g. 772124-1, -2, -4",
  },
  {
    key: "she",
    group: "requires",
    label: "Requires SHE process and/or documentation update",
    answerColumn: "ReqShe",
    referenceColumn: "ReqSheRef",
    referenceHint: "e.g. Add SDS for new material",
  },
  {
    key: "newPcbs",
    group: "incorporate",
    label: "New PCBs starting with date code",
    answerColumn: "IncNewPcbs",
    referenceColumn: "IncNewPcbsRef",
    referenceHint: "Date code",
  },
  {
    key: "newProduction",
    group: "incorporate",
    label: "New production starting serial no.",
    answerColumn: "IncNewProduction",
    referenceColumn: "IncNewProductionRef",
    referenceHint: "Serial number",
  },
  {
    key: "newAssemblies",
    group: "incorporate",
    label: "New assemblies starting with D/C",
    answerColumn: "IncNewAssemblies",
    referenceColumn: "IncNewAssembliesRef",
    referenceHint: "Date code",
  },
  {
    key: "notifyCustomer",
    group: "incorporate",
    label: "Notify customer",
    answerColumn: "IncNotifyCustomer",
  },
  {
    key: "other1",
    group: "incorporate",
    label: "Other 1",
    answerColumn: "IncOther1",
    referenceColumn: "IncOther1Ref",
    referenceHint: "What, and from when",
  },
  {
    key: "other2",
    group: "incorporate",
    label: "Other 2",
    answerColumn: "IncOther2",
    referenceColumn: "IncOther2Ref",
    referenceHint: "What, and from when",
  },
];

export function mcnItemsIn(group: McnItemGroup): McnItemField[] {
  return MCN_ITEM_FIELDS.filter((f) => f.group === group);
}

export const MCN_ANSWERS: readonly McnAnswer[] = ["Yes", "No"];

/** A stored answer → "Yes" / "No" / "" (anything else, older casing included, read loosely). */
export function readAnswer(raw: unknown): McnAnswer {
  if (typeof raw !== "string") return "";
  const v = raw.trim().toLowerCase();
  if (v === "yes") return "Yes";
  if (v === "no") return "No";
  return "";
}

/** Every item, blank — a new MCN's starting point. */
export function blankMcnItems(): Record<string, McnItem> {
  return Object.fromEntries(MCN_ITEM_FIELDS.map((f) => [f.key, { answer: "", reference: "" }]));
}

/** The one multi-choice column. It — and only it — takes the Collection(Edm.String) annotation. */
export const MCN_MULTI_CHOICE_COLUMNS: readonly string[] = ["Distribution"];

/**
 * Every column a read asks for. The three single-person columns and the
 * Operations task lookup select BOTH halves: Graph hands a single-value person
 * or lookup back as a bare `<Name>LookupId` whatever the $select says, and
 * asking for the friendly name alone is how a set column reads as nobody (see
 * "A single-person column needs BOTH halves selected" in CLAUDE.md).
 */
export const MCN_SELECT = [
  "Title",
  "McnDate",
  "Process",
  "Priority",
  "McnStatus",
  "OriginatedBy",
  "OriginatedByLookupId",
  "AssignedEngineer",
  "AssignedEngineerLookupId",
  "ApprovedBy",
  "ApprovedByLookupId",
  "ApprovedDate",
  "Description",
  "ScopeLines",
  "Distribution",
  ...MCN_ITEM_FIELDS.flatMap((f) => (f.referenceColumn ? [f.answerColumn, f.referenceColumn] : [f.answerColumn])),
  "DistributedTo",
  "DistributedAt",
  "DateImplemented",
  "AffectedCodes",
  "RejectionReason",
  "OperationsTaskRef",
  "OperationsTaskRefLookupId",
  "LegacyNote",
  "Watchers",
  "Communication",
  "Attachments",
  "Created",
  "Modified",
].join(",");

// -----------------------------------------------------------------------------
// The scope lines — JSON in one plain multi-line column.
// -----------------------------------------------------------------------------

/**
 * Read the stored scope. Blank is no lines. A value that isn't the expected
 * JSON is reported `corrupt` — the detail page shows it as text and the save
 * refuses to write over it, because replacing data ARC failed to read is the
 * one outcome worse than an error (the ECN checklist rule).
 */
export function parseScopeLines(raw: unknown): { lines: McnScopeLine[]; corrupt: boolean } {
  if (typeof raw !== "string" || !raw.trim()) return { lines: [], corrupt: false };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return { lines: [], corrupt: true };
    const lines = parsed
      .filter((l): l is Record<string, unknown> => !!l && typeof l === "object")
      .map((l) => ({
        departmentId: typeof l.departmentId === "number" && l.departmentId > 0 ? l.departmentId : null,
        department: typeof l.department === "string" ? l.department : "",
        process: typeof l.process === "string" ? l.process : "",
        equipment: typeof l.equipment === "string" ? l.equipment : "",
      }));
    return { lines, corrupt: false };
  } catch {
    return { lines: [], corrupt: true };
  }
}

/** A line with nothing in it is dropped, not stored. */
export function isBlankScopeLine(line: McnScopeLine): boolean {
  return !line.departmentId && !line.department.trim() && !line.process.trim() && !line.equipment.trim();
}

export function serializeScopeLines(lines: McnScopeLine[]): string {
  const kept = lines
    .filter((l) => !isBlankScopeLine(l))
    .map((l) => ({
      departmentId: l.departmentId,
      department: l.department.trim(),
      process: l.process.trim(),
      equipment: l.equipment.trim(),
    }));
  return kept.length ? JSON.stringify(kept) : "";
}

// A list of people as plain text — moved to the shared layer (lib/peopleLines.ts)
// when ECN distribution (BusinessIT#57) needed it too. Re-exported here so
// MCN code keeps its imports.
export { parsePeopleLines, serializePeopleLines } from "./peopleLines";
