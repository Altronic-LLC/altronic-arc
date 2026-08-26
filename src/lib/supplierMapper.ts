import type {
  GraphListItem,
  Person,
  Supplier,
  SupplierCoreCompetency,
  SupplierInput,
  SupplierLogoRef,
  SupplierStatus,
} from "@/types/task";
import { SUPPLIER_CORE_COMPETENCIES, SUPPLIER_STATUSES } from "@/types/task";
import { parseCommunication } from "./communicationParser";
import { parseSpDate } from "./spDates";
import { parsePersonField, parseSinglePersonField } from "./taskMapper";
import { multiPersonField } from "./graphFields";

// =============================================================================
// Graph item → Supplier, and back.
//
// The naming trap in this list: the column labelled "Logistical Performance"
// is internally `QualityPeformance` (missing the second R — a typo baked in
// at creation), and the one labelled "Quality Performance" is
// `QualityPerformance` (correctly spelled). Both are read/written here by
// their REAL internal names — verified against live sample rows, 2026-08-26.
//
// `Logo` is a modern SharePoint "Image" column — its Graph column type is
// unrecoverable from the /columns endpoint (no type key at all comes back),
// but the ITEM data tells the real story: the value is a JSON string
// describing a reserved (hidden) attachment on the same item —
//   {"fileName":"Reserved_ImageAttachment_...jpg","originalImageName":"..."}
// `parseSupplierLogo` reads that JSON; resolving it to an actual <img> src
// means matching `fileName` against the item's attachment list (see
// `SupplierLogo.tsx` and CLAUDE.md — unverified against a live real-mode
// tenant, since this parsing is inferred from the item payload's shape
// rather than any documented Graph/REST contract for Image columns).
// =============================================================================

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function toInt(raw: unknown, fallback: number): number {
  const n = typeof raw === "number" ? raw : parseInt(String(raw ?? ""), 10);
  return Number.isFinite(n) ? n : fallback;
}

function toNumberOrNull(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = typeof raw === "number" ? raw : parseFloat(String(raw));
  return Number.isFinite(n) ? n : null;
}

function toSupplierStatus(raw: unknown): SupplierStatus | null {
  const v = text(raw).trim();
  return (SUPPLIER_STATUSES as readonly string[]).includes(v) ? (v as SupplierStatus) : null;
}

function toCoreCompetencies(raw: unknown): SupplierCoreCompetency[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((v): v is SupplierCoreCompetency =>
    (SUPPLIER_CORE_COMPETENCIES as readonly string[]).includes(String(v)),
  );
}

/**
 * `Logo` arrives as a JSON-encoded string (or already-parsed object, in mock
 * mode's fixtures). Malformed or missing values are a supplier with no logo,
 * not an error — a column no one has filled in yet is the common case.
 */
export function parseSupplierLogo(raw: unknown): SupplierLogoRef | null {
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    if (typeof obj.fileName === "string" && obj.fileName) {
      return { fileName: obj.fileName, originalImageName: text(obj.originalImageName) };
    }
    return null;
  }
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed.fileName !== "string" || !parsed.fileName) return null;
    return { fileName: parsed.fileName, originalImageName: text(parsed.originalImageName) };
  } catch {
    return null;
  }
}

export function toSupplier(item: GraphListItem): Supplier {
  const f = item.fields ?? {};
  return {
    id: parseInt(item.id, 10),
    title: text(f.Title).trim(),
    companyName: text(f.CompanyName).trim(),
    businessPartnerNumber: text(f.BusinessPartnerNumber).trim(),
    address: text(f.Address).trim(),
    website: text(f.Website).trim(),
    supplierScore: text(f.SupplierScore).trim(),
    coreCompetencies: toCoreCompetencies(f.CoreCompetency),
    status: toSupplierStatus(f.Status),
    notes: text(f.Notes),
    assignedBuyer: parseSinglePersonField(f.AssignedBuyer),
    supplierIdentifier: text(f.SupplierIdentifier).trim(),
    watchers: parsePersonField(f.Watchers),
    pointOfContactId: f.PointofContactLookupId ? toInt(f.PointofContactLookupId, 0) || null : null,
    allDeliveries: toNumberOrNull(f.AllDeliveries),
    supplierPerformanceRate: toNumberOrNull(f.SupplierPerformanceRate),
    logisticalPerformance: toNumberOrNull(f.QualityPeformance),
    qualityPerformance: toNumberOrNull(f.QualityPerformance),
    logo: parseSupplierLogo(f.Logo),
    comments: parseCommunication(text(f.Communication)),
    hasAttachments: f.Attachments === true,
    createdAt: parseSpDate(f.Created) ?? new Date(0),
    modifiedAt: parseSpDate(f.Modified) ?? new Date(0),
  };
}

/** Title is app-derived, mirroring the convention the live data already uses: "{BP#}-{CompanyName}". */
function computedTitle(companyName: string, businessPartnerNumber: string): string {
  const name = companyName.trim();
  const bp = businessPartnerNumber.trim();
  if (bp && name) return `${bp}-${name}`;
  return name || bp;
}

export function buildSupplierCreateFields(
  input: SupplierInput,
  resolved: { assignedBuyer: Person | null; watchers: Person[] },
): Record<string, unknown> {
  return {
    Title: computedTitle(input.companyName, input.businessPartnerNumber),
    CompanyName: input.companyName.trim(),
    BusinessPartnerNumber: input.businessPartnerNumber.trim(),
    Address: input.address.trim(),
    Website: input.website.trim(),
    Status: input.status ?? null,
    AssignedBuyerLookupId: resolved.assignedBuyer?.lookupId ?? null,
    ...multiPersonField("Watchers", resolved.watchers),
  };
}

/**
 * Patch for the Details card — only the changed keys, PLUS a recomputed
 * Title whenever company name or BP number moves (Title tracks both, so
 * it's derived against the CURRENT supplier's other half rather than the
 * patch alone — patching just the BP number must not blank the name out of
 * Title).
 */
export function supplierDetailsPatch(
  current: Supplier,
  changed: Partial<
    Pick<SupplierInput, "companyName" | "businessPartnerNumber" | "address" | "website" | "status">
  > & { supplierScore?: string; notes?: string; supplierIdentifier?: string; coreCompetencies?: SupplierCoreCompetency[] },
): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  if (changed.companyName !== undefined) fields.CompanyName = changed.companyName.trim();
  if (changed.businessPartnerNumber !== undefined)
    fields.BusinessPartnerNumber = changed.businessPartnerNumber.trim();
  if (changed.companyName !== undefined || changed.businessPartnerNumber !== undefined) {
    fields.Title = computedTitle(
      changed.companyName ?? current.companyName,
      changed.businessPartnerNumber ?? current.businessPartnerNumber,
    );
  }
  if (changed.address !== undefined) fields.Address = changed.address.trim();
  if (changed.website !== undefined) fields.Website = changed.website.trim();
  if (changed.status !== undefined) fields.Status = changed.status ?? null;
  if (changed.supplierScore !== undefined) fields.SupplierScore = changed.supplierScore.trim();
  if (changed.notes !== undefined) fields.Notes = changed.notes.trim();
  if (changed.supplierIdentifier !== undefined)
    fields.SupplierIdentifier = changed.supplierIdentifier.trim();
  if (changed.coreCompetencies !== undefined) fields.CoreCompetency = changed.coreCompetencies;
  return fields;
}

/** What to call a supplier in a toast, an email subject or a page title. */
export function supplierLabel(supplier: Supplier): string {
  return supplier.title || supplier.companyName || `Supplier #${supplier.id}`;
}

/** Alphabetical by title — this is a maintained register, not a work queue. */
export function compareSuppliers(a: Supplier, b: Supplier): number {
  return supplierLabel(a).localeCompare(supplierLabel(b));
}
