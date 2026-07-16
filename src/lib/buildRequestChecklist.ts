import type { BuildRequestPartType } from "@/types/task";

// =============================================================================
// Build Request item checklists — the boolean columns on the Build Request
// Items list, grouped by which Part Type they apply to. The UI shows the PCB
// data-package checklist only on PCB parts and the harness checklist only on
// Harness parts (confirmed with the team); other part types show no checklist.
//
// `field` is the SharePoint INTERNAL column name (what Graph reads/writes);
// `label` is the human-readable display name.
// =============================================================================

export interface ChecklistFieldDef {
  field: string;
  label: string;
}

/** The PCB data-package checklist — shown when Part Type = "PCB". */
export const PCB_CHECKLIST: ChecklistFieldDef[] = [
  { field: "Completed_x0020_BOM", label: "Completed BOM" },
  { field: "Flattened_x0020_BOM", label: "Flattened BOM" },
  { field: "BOM_x0020_Grouped_x0020_Surface_", label: "BOM Grouped Surface Mount" },
  { field: "MFG_x0020_PN", label: "MFG PN" },
  { field: "Active_x0020_Parts", label: "Active Parts" },
  { field: "Complete_x0020_Gerber_x0020_File", label: "Complete Gerber Files" },
  { field: "Coordinate_x0020_Data_x0020_Surf", label: "Coordinate Data Surface Mount" },
  { field: "ASCII_x0020_Files_x0020_Surface_", label: "ASCII Files Surface Mount" },
  { field: "PDF_x0020_Drawings", label: "PDF Drawings" },
  { field: "Schematic", label: "Schematic" },
  { field: "Panel_x0020_or_x0020_Frame", label: "Panel or Frame" },
  { field: "Fiducials", label: "Fiducials" },
  { field: "Test_x0020_Requirements", label: "Test Requirements" },
  { field: "HI_x002d_POT_x0020_Test", label: "HI-POT Test" },
];

/** The harness checklist — shown when Part Type = "Harness". */
export const HARNESS_CHECKLIST: ChecklistFieldDef[] = [
  { field: "Terminals_x0020_Ordered", label: "Terminals Ordered" },
  { field: "New_x0020_Terminal_x0020_Tool", label: "New Terminal Tool" },
  { field: "New_x0020_Harness_x0020_Processe", label: "New Harness Processes" },
];

/** Every checklist column — used by the mapper to read all booleans regardless of part type. */
export const ALL_CHECKLIST_FIELDS: ChecklistFieldDef[] = [...PCB_CHECKLIST, ...HARNESS_CHECKLIST];

/** Which checklist (if any) applies to a part of the given type. */
export function checklistForPartType(
  partType: BuildRequestPartType | null,
): ChecklistFieldDef[] {
  if (partType === "PCB") return PCB_CHECKLIST;
  if (partType === "Harness") return HARNESS_CHECKLIST;
  return [];
}

/** How many of the applicable checklist boxes are ticked, for progress display. */
export function checklistProgress(
  partType: BuildRequestPartType | null,
  checklist: Record<string, boolean>,
): { done: number; total: number } {
  const defs = checklistForPartType(partType);
  const done = defs.filter((d) => checklist[d.field]).length;
  return { done, total: defs.length };
}
