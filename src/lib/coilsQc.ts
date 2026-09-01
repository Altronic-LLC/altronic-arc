export const COIL_DEFECT_FIELDS = [
  "EndcapGapAlignment",
  "ErraticVoltage",
  "HighPotting",
  "HighSecondaryResistance",
  "HighPressure",
  "LowPotting",
  "LowVoltageOutput",
  "LeakFromLid",
  "OpenSecondary",
  "GluedtoPallet",
  "LeakinTower",
  "Other",
  "MisPour",
] as const;

export type CoilDefectField = (typeof COIL_DEFECT_FIELDS)[number];

/** One row stored in QCCoils' `OtherFaultTable` JSON payload. */
export interface OtherFaultTableRow {
  Defect: { Value: string };
  Count: number;
  Comment: string;
}

export interface CoilDefectLogEntry {
  id: string;
  coilPartNumber: string;
  date: string;
  produced: number;
  failed: number;
  defects: Record<CoilDefectField, number>;
  /** JSON as held in QCCoils' `OtherFaultTable` column. It is kept losslessly until saved. */
  otherFaultTable: string;
}

export type CoilDefectLogInput = Omit<CoilDefectLogEntry, "id">;

function otherFaultName(value: unknown): string {
  if (typeof value === "string") {
    try {
      return otherFaultName(JSON.parse(value));
    } catch {
      return value;
    }
  }
  if (Array.isArray(value)) {
    return value.map(otherFaultName).find(Boolean) ?? "";
  }
  if (!value || typeof value !== "object") return "";
  const defect = value as Record<string, unknown>;
  const nestedValue = defect.Value ?? defect.value;
  if (nestedValue !== undefined) return otherFaultName(nestedValue);
  // SharePoint commonly serializes a multi-value field under `results`.
  return otherFaultName(defect.results ?? defect.value ?? defect.items);
}

export function parseOtherFaults(value: string): OtherFaultTableRow[] | null {
  if (!value.trim()) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return null;
    return parsed.map((row) => {
      const source = row as Record<string, unknown>;
      return {
        // SharePoint persists the selected option beneath the `Defect.Value`
        // member. Some legacy rows return that member as serialized JSON, so
        // unwrap either representation before giving the form its label.
        Defect: { Value: otherFaultName(source.Defect ?? source.defect) },
        Count: Math.max(0, Number(source.Count) || 0),
        Comment: String(source.Comment ?? ""),
      };
    });
  } catch {
    return null;
  }
}

export function serializeOtherFaults(rows: OtherFaultTableRow[]): string {
  return rows.length ? JSON.stringify(rows) : "";
}

export function defectTotal(entry: CoilDefectLogEntry): number {
  return Object.values(entry.defects).reduce((total, count) => total + count, 0);
}