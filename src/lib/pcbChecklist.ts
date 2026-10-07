import type { TaskColumn } from "@/api/taskColumns";

// =============================================================================
// PCB checklist registry. The 19 fields users work through on a PCB task,
// keyed by SharePoint *display name* — that's the only stable identifier
// since internal names get encoded / truncated / renamed at will.
//
// ADDING AN ITEM: create the SharePoint column FIRST (see
// scripts/add-pcb-checklist-columns.ps1), with a display name matching the
// entry here exactly. An entry whose column doesn't exist yet renders as a
// red "column missing" box on every PCB task.
//
// Each item declares:
//   - displayName: must match the SharePoint column display name exactly
//   - kind: "boolean" for Yes/No, "choice" for choice columns
//   - column: which column on the layout (left or right), matching the
//     original Power Apps form's two-column layout
//   - order: top-down position within the column
// =============================================================================

export type PcbChecklistKind = "boolean" | "choice";
export type PcbChecklistColumn = "left" | "right";

export interface PcbChecklistItem {
  displayName: string;
  kind: PcbChecklistKind;
  column: PcbChecklistColumn;
  order: number;
}

export const PCB_CHECKLIST_ITEMS: PcbChecklistItem[] = [
  // Left column
  { displayName: "Schematic Part Number Pulled If new", kind: "boolean", column: "left", order: 1 },
  // Production requirements + design-improvement updates (Sarah Shaffer,
  // 2026-10-02) — deliberately directly after the schematic part number.
  { displayName: "Fiducials on top and bottom of actual PCB", kind: "boolean", column: "left", order: 2 },
  { displayName: "Design Rule Checks Completed and Resolved", kind: "boolean", column: "left", order: 3 },
  { displayName: "Place backup on archive server location", kind: "boolean", column: "left", order: 4 },
  { displayName: "Compare BOM from tool to what is in SAP if BOM already exists", kind: "boolean", column: "left", order: 5 },
  { displayName: "Output the 3D Model and send to CAD", kind: "boolean", column: "left", order: 6 },
  { displayName: "PCB revision updated and documented for the change", kind: "choice", column: "left", order: 7 },
  { displayName: "Pull part numbers for those parts", kind: "boolean", column: "left", order: 8 },
  { displayName: "Capture part costs if purchased on credit card or cost center PO (tracking via task system)", kind: "boolean", column: "left", order: 9 },
  { displayName: "Pre-release vs Released Process updating Drawings and SAP", kind: "boolean", column: "left", order: 10 },
  { displayName: "Order_Parts", kind: "choice", column: "left", order: 11 },

  // Right column
  { displayName: "PCB Part Number pulled if new", kind: "boolean", column: "right", order: 1 },
  { displayName: "Output files and put them on SMT Data", kind: "boolean", column: "right", order: 2 },
  { displayName: "Output the BOM and send to CAD", kind: "boolean", column: "right", order: 3 },
  { displayName: "Submit build request for boards to be built", kind: "boolean", column: "right", order: 4 },
  { displayName: "Schematic revision updated and documented for the change", kind: "choice", column: "right", order: 5 },
  { displayName: "Send Gerber Package for entering in SAP", kind: "choice", column: "right", order: 6 },
  { displayName: "Purchasing will only use what is in SAP for ordering", kind: "boolean", column: "right", order: 7 },
  { displayName: "Complete template for place of ordering and save it", kind: "boolean", column: "right", order: 8 },
];

/**
 * Resolved checklist item: registry definition merged with the actual
 * SharePoint column metadata (internal name + choice values).
 *
 * `column` is null when the SP column couldn't be found by display name —
 * the UI surfaces those as disabled with a helpful "column missing" note
 * so we know to investigate without crashing the page.
 */
export interface ResolvedChecklistItem extends PcbChecklistItem {
  column: PcbChecklistColumn;
  spColumn: TaskColumn | null;
}

/**
 * Match every PCB checklist item against the SharePoint column list,
 * returning the items in their declared order with the matching column
 * info attached. Match is case-insensitive on display name for safety.
 */
export function resolvePcbChecklist(
  spColumns: TaskColumn[],
): ResolvedChecklistItem[] {
  const byDisplay = new Map<string, TaskColumn>();
  for (const c of spColumns) {
    byDisplay.set(c.displayName.toLowerCase(), c);
  }
  return PCB_CHECKLIST_ITEMS.map((item) => ({
    ...item,
    spColumn: byDisplay.get(item.displayName.toLowerCase()) ?? null,
  }));
}
