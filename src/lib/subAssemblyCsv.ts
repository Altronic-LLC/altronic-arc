import type { SubAssemblyLine } from "@/types/pricing";

// =============================================================================
// A sub-assembly's BOM, from a CSV (Ray, 2026-10-13): part number,
// description, current cost, qty. Pure — the file is read by the caller and
// handed over as text.
//
//  * Columns are matched by HEADER NAME, in any order, with spelling slack
//    ("Part #", "Part No", "Current Cost", "Unit Cost", "Qty", "Quantity").
//    A file missing one of the four is REFUSED, naming it — never half-read.
//  * The cost read here is the UPLOADED cost and is never changed by ARC. The
//    manager's adjustment is a separate field (`adjustedCost`).
//  * A blank row is skipped. A row with no part number, or a quantity or cost
//    that isn't a number, is reported by row and left out — the rest import.
//  * Re-uploading REPLACES the CSV lines but keeps each part's adjustment and
//    every line added by hand (`mergeUpload`), and says what changed.
// =============================================================================

/** RFC 4180-ish: commas, CRLF/LF, quoted fields with "" escapes. A leading BOM is dropped. */
export function parseCsvRows(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

type Column = "partNumber" | "sapPartNumber" | "description" | "cost" | "quantity";

// "Part Number" means the ALTRONIC number; SAP has its own column. A file
// needs at least ONE of the two number columns (Ray, 2026-10-13: components
// carry both), plus Description, Current Cost and Qty.
const ALIASES: Record<Column, string[]> = {
  partNumber: ["partnumber", "part", "partno", "pn", "itemnumber", "item", "altronicpartnumber", "altronicpart", "altronicpartno", "altronic"],
  sapPartNumber: ["sappartnumber", "sappart", "sappartno", "sapnumber", "sapno", "sap", "sapmaterial", "materialnumber", "material"],
  description: ["description", "desc", "partdescription", "itemdescription"],
  cost: ["currentcost", "cost", "unitcost", "price", "unitprice", "currentprice"],
  quantity: ["qty", "quantity", "qtyper", "qtyperassembly", "quantityper", "count"],
};

const LABELS: Record<Column, string> = {
  partNumber: "Part Number",
  sapPartNumber: "SAP Part Number",
  description: "Description",
  cost: "Current Cost",
  quantity: "Qty",
};

const REQUIRED: Column[] = ["description", "cost", "quantity"];
/** "Part #" → "part", "Current Cost ($)" → "currentcost". */
function normaliseHeader(h: string): string {
  return h.toLowerCase().replace(/#/g, "").replace(/[^a-z0-9]/g, "");
}

/** "$1,234.50" → 1234.5; blank → null; anything else → NaN (a problem to report). */
function money(raw: string): number | null {
  const v = raw.trim().replace(/[$,\s]/g, "");
  if (v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

export interface CsvImportResult {
  lines: SubAssemblyLine[];
  /** Why the WHOLE file was refused (a missing column, nothing in it). Empty when it imported. */
  errors: string[];
  /** Rows left out, by row number as a spreadsheet shows it. */
  skipped: string[];
}

/** Read a sub-assembly CSV. `errors` non-empty means nothing should be saved. */
export function importSubAssemblyCsv(text: string): CsvImportResult {
  const rows = parseCsvRows(text).filter((r) => r.some((c) => c.trim() !== ""));
  if (rows.length === 0) return { lines: [], errors: ["The file is empty."], skipped: [] };

  const header = rows[0].map(normaliseHeader);
  const index: Partial<Record<Column, number>> = {};
  for (const col of Object.keys(ALIASES) as Column[]) {
    const i = header.findIndex((h) => ALIASES[col].includes(h));
    if (i >= 0) index[col] = i;
  }
  const missing: string[] = REQUIRED.filter((c) => index[c] === undefined).map((c) => `"${LABELS[c]}"`);
  if (index.partNumber === undefined && index.sapPartNumber === undefined) {
    missing.unshift(`"${LABELS.partNumber}" or "${LABELS.sapPartNumber}"`);
  }
  if (missing.length > 0) {
    return {
      lines: [],
      errors: [
        `The file has no ${missing.join(", ")} column. ` +
          "It needs a Part Number and/or SAP Part Number, Description, Current Cost and Qty headers in the first row.",
      ],
      skipped: [],
    };
  }

  const lines: SubAssemblyLine[] = [];
  const skipped: string[] = [];
  rows.slice(1).forEach((r, i) => {
    const rowNo = i + 2;
    const cell = (c: Column) => (index[c] === undefined ? "" : (r[index[c]!] ?? "").trim());
    const altronic = cell("partNumber");
    const sapNo = cell("sapPartNumber");
    const partNumber = altronic || sapNo;
    if (!partNumber) {
      skipped.push(`Row ${rowNo}: no part number.`);
      return;
    }
    const qty = money(cell("quantity"));
    if (qty === null || Number.isNaN(qty) || qty <= 0) {
      skipped.push(`Row ${rowNo} (${partNumber}): quantity "${cell("quantity")}" isn't a number above 0.`);
      return;
    }
    const cost = money(cell("cost"));
    if (cost !== null && (Number.isNaN(cost) || cost < 0)) {
      skipped.push(`Row ${rowNo} (${partNumber}): cost "${cell("cost")}" isn't a number.`);
      return;
    }
    lines.push({
      partNumber: altronic,
      sapPartNumber: sapNo,
      description: cell("description"),
      quantity: qty,
      uploadedCost: cost,
      adjustedCost: null,
      source: "csv",
    });
  });
  if (lines.length === 0) {
    return { lines: [], errors: ["No usable rows in the file.", ...skipped], skipped: [] };
  }
  return { lines, errors: [], skipped };
}

export interface UploadChanges {
  added: string[];
  removed: string[];
  costChanged: { partNumber: string; from: number | null; to: number | null }[];
  /** Adjustments carried onto the new upload. */
  keptAdjustments: number;
  /** Lines added by hand that the file doesn't replace — kept as they were. */
  keptManual: number;
}

/** A component's identity for a re-upload: its Altronic number, else its SAP number. */
export function lineKey(l: Pick<SubAssemblyLine, "partNumber" | "sapPartNumber">): string {
  const altronic = l.partNumber.trim().toLowerCase();
  return altronic || `sap:${(l.sapPartNumber ?? "").trim().toLowerCase()}`;
}

/** What to call a component in a message: its Altronic number, else its SAP number. */
export function lineLabel(l: Pick<SubAssemblyLine, "partNumber" | "sapPartNumber">): string {
  return l.partNumber.trim() || (l.sapPartNumber ?? "").trim();
}

/**
 * Replace a sub-assembly's CSV lines with a new upload, keeping each part's
 * adjustment (matched by part number, case-insensitive). CSV parts no longer
 * in the file drop out, adjustment and all.
 *
 * Lines ADDED BY HAND are not the file's to remove (Ray, 2026-10-13): they are
 * kept, after the file's lines — unless the file now carries that part
 * number, in which case the file's line takes over and the adjustment
 * carries across like any other.
 */
export function mergeUpload(
  previous: SubAssemblyLine[],
  next: SubAssemblyLine[],
): { lines: SubAssemblyLine[]; changes: UploadChanges } {
  const before = new Map(previous.map((l) => [lineKey(l), l]));
  const after = new Set(next.map((l) => lineKey(l)));
  const manualKept = previous.filter((l) => l.source === "manual" && !after.has(lineKey(l)));
  let keptAdjustments = 0;
  const costChanged: UploadChanges["costChanged"] = [];
  const added: string[] = [];
  const lines = next.map((l) => {
    const old = before.get(lineKey(l));
    if (!old) {
      added.push(lineLabel(l));
      return l;
    }
    if (old.uploadedCost !== l.uploadedCost) {
      costChanged.push({ partNumber: lineLabel(l), from: old.uploadedCost, to: l.uploadedCost });
    }
    if (old.adjustedCost !== null) keptAdjustments++;
    return { ...l, adjustedCost: old.adjustedCost };
  });
  const removed = previous
    .filter((l) => l.source !== "manual" && !after.has(lineKey(l)))
    .map((l) => lineLabel(l));
  return {
    lines: [...lines, ...manualKept],
    changes: { added, removed, costChanged, keptAdjustments, keptManual: manualKept.length },
  };
}

/** The Lines JSON → lines. Unreadable JSON is `corrupt`, and must not be written over. */
export function parseSubAssemblyLines(raw: unknown): { lines: SubAssemblyLine[]; corrupt: boolean } {
  if (raw === null || raw === undefined || (typeof raw === "string" && !raw.trim())) return { lines: [], corrupt: false };
  if (typeof raw !== "string") return { lines: [], corrupt: true };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { lines: [], corrupt: true };
  }
  if (!Array.isArray(parsed)) return { lines: [], corrupt: true };
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  return {
    lines: parsed
      .filter((l): l is Record<string, unknown> => !!l && typeof l === "object")
      .map((l) => ({
        partNumber: typeof l.partNumber === "string" ? l.partNumber : "",
        sapPartNumber: typeof l.sapPartNumber === "string" ? l.sapPartNumber : "",
        description: typeof l.description === "string" ? l.description : "",
        quantity: num(l.quantity) ?? 0,
        uploadedCost: num(l.uploadedCost),
        adjustedCost: num(l.adjustedCost),
        // Lines saved before hand-added lines existed have no source: they came from a CSV.
        source: l.source === "manual" ? ("manual" as const) : l.source === "sap" ? ("sap" as const) : ("csv" as const),
      })),
    corrupt: false,
  };
}
