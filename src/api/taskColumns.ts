import { graphFetch } from "./graph";
import { SP_LIST_ID, SP_SITE_ID, USE_MOCK } from "./config";

// =============================================================================
// SharePoint Task list column metadata — internal names + display names +
// (for Choice columns) allowed values. Used by the PCB checklist card to
// resolve display-name → field-name without having to guess at the wild
// encoding rules SharePoint applies (spaces → _x0020_, truncation at 32
// chars, etc.). Cached for 5 min via the React Query layer.
// =============================================================================

export type TaskColumnKind = "boolean" | "choice" | "text" | "number" | "dateTime" | "other";

export interface TaskColumn {
  /** SharePoint internal name (`Schematic_x0020_Part_x0020_Numbe`, etc.). */
  name: string;
  /** Human-readable label as set in SharePoint. */
  displayName: string;
  kind: TaskColumnKind;
  /** Allowed values for Choice columns; empty for other kinds. */
  choices: string[];
  /** Whether a Choice column allows free-text entry alongside the choices. */
  allowTextEntry: boolean;
}

interface GraphColumnDef {
  name?: string;
  displayName?: string;
  boolean?: object;
  choice?: { choices?: string[]; allowTextEntry?: boolean };
  text?: object;
  number?: object;
  dateTime?: object;
  lookup?: object;
  personOrGroup?: object;
}

// Mock columns mirror the PCB checklist schema in the SharePoint screenshots
// so demo mode has something realistic to render against.
const MOCK_TASK_COLUMNS: TaskColumn[] = [
  ...pcbBoolean("Schematic Part Number Pulled If new"),
  ...pcbBoolean("Fiducials on top and bottom of actual PCB"),
  ...pcbBoolean("Design Rule Checks Completed and Resolved"),
  ...pcbBoolean("PCB Part Number pulled if new"),
  ...pcbBoolean("Place backup on archive server location"),
  ...pcbBoolean("Output files and put them on SMT Data"),
  ...pcbBoolean("Output the 3D Model and send to CAD"),
  ...pcbBoolean("Compare BOM from tool to what is in SAP if BOM already exists"),
  ...pcbBoolean("Output the BOM and send to CAD"),
  ...pcbBoolean("Purchasing will only use what is in SAP for ordering"),
  ...pcbBoolean("Complete template for place of ordering and save it"),
  ...pcbBoolean("Submit build request for boards to be built"),
  ...pcbBoolean("Pull part numbers for those parts"),
  ...pcbBoolean("Capture part costs if purchased on credit card or cost center PO (tracking via task system)"),
  ...pcbBoolean("Pre-release vs Released Process updating Drawings and SAP"),
  ...pcbChoice("Schematic revision updated and documented for the change", [
    "If pre-release update using letters and a short description",
    "If released then update with ECN",
  ]),
  ...pcbChoice("PCB revision updated and documented for the change", [
    "If pre-release update using letters and a short description",
    "If released then update with ECN",
  ]),
  ...pcbChoice("Send Gerber Package for entering in SAP", [
    "Purchasing will only use what is in SAP for ordering",
    "Complete template for place of ordering and save it",
  ]),
  ...pcbChoice("Order_Parts", ["Yes", "No", "N/A"]),
];

function pcbBoolean(displayName: string): TaskColumn[] {
  return [
    {
      name: encodeMockInternal(displayName),
      displayName,
      kind: "boolean",
      choices: [],
      allowTextEntry: false,
    },
  ];
}
function pcbChoice(displayName: string, choices: string[]): TaskColumn[] {
  return [
    {
      name: encodeMockInternal(displayName),
      displayName,
      kind: "choice",
      choices,
      allowTextEntry: false,
    },
  ];
}
function encodeMockInternal(displayName: string): string {
  return displayName
    .replace(/ /g, "_x0020_")
    .replace(/\//g, "_x002f_")
    .slice(0, 32);
}

function classifyKind(def: GraphColumnDef): TaskColumnKind {
  if (def.boolean) return "boolean";
  if (def.choice) return "choice";
  if (def.text) return "text";
  if (def.number) return "number";
  if (def.dateTime) return "dateTime";
  return "other";
}

export async function listTaskColumns(): Promise<TaskColumn[]> {
  if (USE_MOCK) return [...MOCK_TASK_COLUMNS];
  if (!SP_LIST_ID) return [];
  const res = await graphFetch<{ value: GraphColumnDef[] }>(
    `/sites/${SP_SITE_ID}/lists/${SP_LIST_ID}/columns` +
      `?$select=name,displayName,boolean,choice,text,number,dateTime`,
  );
  return (res.value ?? [])
    .filter((c) => c.name && c.displayName)
    .map((c) => ({
      name: c.name!,
      displayName: c.displayName!,
      kind: classifyKind(c),
      choices: c.choice?.choices ?? [],
      allowTextEntry: !!c.choice?.allowTextEntry,
    }));
}
