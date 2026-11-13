import type { SapPart, SubAssemblyLine } from "@/types/pricing";
import { sapMaterialLookupKey } from "./sapMaterialCost";

// =============================================================================
// Filling a part's boxes from SAP as somebody types (Ray, 2026-10-22) — the
// rule for adding a component or a part on a New Product Pricing worksheet.
//
// SAP fills a box only when it is BLANK or still holds what SAP put there last
// time (`SapFill` remembers those values). So a typed description is never
// written over, while a description SAP brought in follows the next part
// looked up. The COST is the exception: it is SAP's base cost, so a part SAP
// costs always brings it in.
//
// Only TYPED numbers are looked up (`sapLookupArgs`). A number SAP filled in
// for the previous part must not steer the next lookup — otherwise changing
// the SAP # to one SAP lacks would fall back to the old Altronic # and bring
// the old part straight back.
// =============================================================================

export interface PartFields {
  altronic: string;
  sap: string;
  description: string;
  cost: number | null;
}

/** What SAP last put in each box. A box absent here was typed (or is blank). */
export type SapFill = Partial<PartFields>;

/** The numbers to look up — typed ones only. */
export function sapLookupArgs(f: PartFields, fill: SapFill): { altronicPartNumber: string; sapPartNumber: string } {
  const typed = (v: string, auto: string | undefined) => (auto !== undefined && v === auto ? "" : v.trim());
  return { altronicPartNumber: typed(f.altronic, fill.altronic), sapPartNumber: typed(f.sap, fill.sap) };
}

/** SAP found the part: fill what may be filled, and remember it. */
export function applySapPart(
  f: PartFields,
  fill: SapFill,
  part: SapPart,
): { fields: PartFields; fill: SapFill; costFromSap: boolean } {
  const next: PartFields = { ...f };
  const nextFill: SapFill = {};
  for (const key of ["altronic", "sap", "description"] as const) {
    const incoming = key === "altronic" ? part.altronicPartNumber : key === "sap" ? part.sapPartNumber : part.description;
    const mayFill = !f[key].trim() || (fill[key] !== undefined && f[key] === fill[key]);
    if (mayFill && incoming) {
      next[key] = incoming;
      nextFill[key] = incoming;
    } else if (mayFill && fill[key] !== undefined) {
      // SAP's value from the last part, and this part has none: clear it.
      next[key] = "";
    }
  }
  if (part.cost !== null) {
    next.cost = part.cost;
    nextFill.cost = part.cost;
    return { fields: next, fill: nextFill, costFromSap: true };
  }
  if (fill.cost !== undefined && f.cost === fill.cost) next.cost = null;
  return { fields: next, fill: nextFill, costFromSap: false };
}

/** SAP doesn't hold the number typed: take back whatever it filled for the last part. */
export function clearSapFill(f: PartFields, fill: SapFill): { fields: PartFields; fill: SapFill } {
  const next: PartFields = { ...f };
  for (const key of ["altronic", "sap", "description"] as const) {
    if (fill[key] !== undefined && f[key] === fill[key]) next[key] = "";
  }
  if (fill.cost !== undefined && f.cost === fill.cost) next.cost = null;
  return { fields: next, fill: {} };
}

// -----------------------------------------------------------------------------
// Adding SEVERAL at once (Ray, 2026-10-22) — numbers pasted like the SAP
// comparison's box, each looked up, each becoming one component (or one part).
// -----------------------------------------------------------------------------

/** How to ask SAP about one pasted number: a 10-digit one is an SAP #, anything else an Altronic #. */
export function lookupArgsFor(number: string): { altronicPartNumber: string; sapPartNumber: string } {
  const sap = sapMaterialLookupKey(number);
  return sap ? { altronicPartNumber: "", sapPartNumber: sap } : { altronicPartNumber: number.trim(), sapPartNumber: "" };
}

/**
 * One pasted number as a component line, quantity 1. Found: SAP's numbers,
 * description and cost (as the base, marked SAP). Not found — or SAP holds no
 * cost — it is a MANUAL line keeping the number typed, so its description and
 * cost can be typed in the table.
 */
export function lineFromLookup(number: string, part: SapPart | null): SubAssemblyLine {
  const asked = lookupArgsFor(number);
  if (!part) {
    return {
      partNumber: asked.altronicPartNumber,
      sapPartNumber: asked.sapPartNumber,
      description: "",
      quantity: 1,
      uploadedCost: null,
      adjustedCost: null,
      source: "manual",
    };
  }
  return {
    partNumber: part.altronicPartNumber || asked.altronicPartNumber,
    sapPartNumber: part.sapPartNumber || asked.sapPartNumber,
    description: part.description,
    quantity: 1,
    uploadedCost: part.cost,
    adjustedCost: null,
    source: part.cost !== null ? "sap" : "manual",
  };
}

/** The same part, by either number — case-insensitive, blanks never match. */
export function samePart(
  a: { partNumber: string; sapPartNumber?: string },
  b: { partNumber: string; sapPartNumber?: string },
): boolean {
  const eq = (x?: string, y?: string) => !!x?.trim() && x.trim().toLowerCase() === (y ?? "").trim().toLowerCase();
  return eq(a.partNumber, b.partNumber) || eq(a.sapPartNumber, b.sapPartNumber);
}
