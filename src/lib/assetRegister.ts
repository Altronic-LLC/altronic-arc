import type { Equipment, MaintenanceReferenceValue, ProjectReference } from "@/types/task";
import { matchesTokens } from "./itemSearch";
import { compareEquipment, equipmentLabel } from "./equipmentMapper";
import { referenceKey, referenceLabel } from "./maintenanceReferences";
import { toSpDateOnly } from "./spDates";

// =============================================================================
// The pure half of the asset register screen — searching, filtering, the
// "needs attention" rule, and the diffed write payload for an edit.
//
// Pure and in `lib/` so the RULES are testable without a rendered table, and
// so the filter bar, the counters and the row badges can't disagree about what
// counts as a gap. The screen is the only caller today; a second one (a
// dashboard "register health" card, say) should read these rather than
// re-deriving them.
//
// **The register is half empty, and the screen's job is to say so.** Roughly
// half the 378 rows have no Department; Asset Tag, Criticality and Current
// Machine Hours are largely blank. A prettier table over the same data would
// have hidden that, so the gaps are first-class here: countable, filterable,
// and sortable to the top.
//
// The one gap that costs money rather than tidiness is `currentMachineHours`.
// It is what a meter-based PM counts against, so a reading that never moves is
// a PM that never comes due — silently, with nothing on any screen saying so.
// =============================================================================

// -----------------------------------------------------------------------------
// Gaps — what "needs attention" means, in one place
// -----------------------------------------------------------------------------

/** One thing missing from an asset row. Ordered by how much it costs. */
export type AssetGap = "machineHours" | "department" | "criticality" | "assetTag" | "location";

/** Every gap, in the order the UI should list them. */
export const ASSET_GAPS: readonly AssetGap[] = [
  "machineHours",
  "department",
  "criticality",
  "assetTag",
  "location",
];

/** Short label for a gap, for a chip or a filter option. */
export const ASSET_GAP_LABELS: Record<AssetGap, string> = {
  machineHours: "No machine hours",
  department: "No department",
  criticality: "No criticality",
  assetTag: "No asset tag",
  location: "No location",
};

/** Why the gap matters — the tooltip, so a chip isn't just a scold. */
export const ASSET_GAP_HINTS: Record<AssetGap, string> = {
  machineHours:
    "No hourmeter reading has ever been recorded. A meter-based PM counts against this number, " +
    "so it can never come due until somebody enters one.",
  department: "No owning department, so this asset is missing from every department rollup.",
  criticality: "No criticality, so this asset can't be ranked against the rest when work stacks up.",
  assetTag: "No asset tag, so the number painted on the machine doesn't lead back to this row.",
  location: "No location, so nobody can be told where to go.",
};

/**
 * A RETIRED asset is never "needing attention".
 *
 * A machine that has left the plant does not need its hourmeter read, its tag
 * chased or its department decided — counting it would put permanent,
 * un-fixable rows in a queue that exists to be worked down to nothing, which
 * is how a queue stops being looked at.
 */
export function isRetiredAsset(asset: Equipment): boolean {
  return (asset.assetStatus ?? "").trim().toLowerCase() === "retired";
}

/** What is missing from this asset. Empty for a complete row, and for a retired one. */
export function assetGaps(asset: Equipment): AssetGap[] {
  if (isRetiredAsset(asset)) return [];
  const gaps: AssetGap[] = [];
  // null, not 0 — a machine sitting at zero hours has been read; one that has
  // never been read has not. See the note on `currentMachineHours`.
  if (asset.currentMachineHours === null) gaps.push("machineHours");
  if (!asset.department) gaps.push("department");
  if (!asset.criticality) gaps.push("criticality");
  if (!asset.assetTag.trim()) gaps.push("assetTag");
  if (!asset.location) gaps.push("location");
  return gaps;
}

export function needsAttention(asset: Equipment): boolean {
  return assetGaps(asset).length > 0;
}

/** How many assets are missing each field, across the WHOLE register. */
export function assetGapCounts(assets: Equipment[]): Record<AssetGap, number> {
  const counts = Object.fromEntries(ASSET_GAPS.map((g) => [g, 0])) as Record<AssetGap, number>;
  for (const asset of assets) for (const gap of assetGaps(asset)) counts[gap] += 1;
  return counts;
}

// -----------------------------------------------------------------------------
// Filters
// -----------------------------------------------------------------------------

/**
 * The sentinel for "this field is empty" in a filter dropdown.
 *
 * A real reference key is either a numeric id or `title:<something>`, so this
 * can never collide with one — and offering "No department" as an option is
 * how somebody gets from the coverage number to the actual list of rows.
 */
export const NO_VALUE = "__none__";

export interface AssetFilters {
  q: string;
  department: string | null;
  location: string | null;
  criticality: string | null;
  status: string | null;
  equipmentType: string | null;
  /** null = every asset; a gap = only assets missing that field. */
  gap: AssetGap | null;
  /** True = only assets missing at least one field. */
  needsAttention: boolean;
}

export const EMPTY_ASSET_FILTERS: AssetFilters = {
  q: "",
  department: null,
  location: null,
  criticality: null,
  status: null,
  equipmentType: null,
  gap: null,
  needsAttention: false,
};

export function hasActiveAssetFilters(filters: AssetFilters): boolean {
  return (
    filters.q.trim() !== "" ||
    filters.department !== null ||
    filters.location !== null ||
    filters.criticality !== null ||
    filters.status !== null ||
    filters.equipmentType !== null ||
    filters.gap !== null ||
    filters.needsAttention
  );
}

/**
 * Everything one asset can be found by.
 *
 * Deliberately wide: people arrive with a serial off a nameplate, a tag off
 * the machine, a model number out of a manual or half a department name, and
 * a search that only covered the Title would answer none of those.
 */
export function assetHaystack(asset: Equipment): string {
  return [
    asset.name,
    asset.assetTag,
    asset.description,
    asset.serialNo,
    asset.manufacturer,
    asset.modelNumber,
    asset.equipmentType ?? "",
    asset.criticality ?? "",
    asset.assetStatus ?? "",
    referenceLabel(asset.department),
    referenceLabel(asset.location),
    asset.responsibleTech?.displayName ?? "",
    asset.parentAsset?.title ?? "",
    String(asset.lookupId),
  ].join(" ");
}

/** The key a reference filters on — `NO_VALUE` when the field is empty. */
function refKey(ref: ProjectReference | null): string {
  return ref ? referenceKey(ref) : NO_VALUE;
}

/** A choice value's filter key — `NO_VALUE` when unset. */
function choiceKey(value: string | null): string {
  const trimmed = (value ?? "").trim();
  return trimmed || NO_VALUE;
}

export function applyAssetFilters(assets: Equipment[], filters: AssetFilters): Equipment[] {
  return assets.filter((asset) => {
    if (filters.department && refKey(asset.department) !== filters.department) return false;
    if (filters.location && refKey(asset.location) !== filters.location) return false;
    if (filters.criticality && choiceKey(asset.criticality) !== filters.criticality) return false;
    if (filters.status && choiceKey(asset.assetStatus) !== filters.status) return false;
    if (filters.equipmentType && choiceKey(asset.equipmentType) !== filters.equipmentType) {
      return false;
    }
    if (filters.gap && !assetGaps(asset).includes(filters.gap)) return false;
    if (filters.needsAttention && !needsAttention(asset)) return false;
    if (filters.q.trim() && !matchesTokens(assetHaystack(asset), filters.q)) return false;
    return true;
  });
}

// -----------------------------------------------------------------------------
// Sorting
// -----------------------------------------------------------------------------

export type AssetSort = "name" | "gaps" | "hours";

export const ASSET_SORT_LABELS: Record<AssetSort, string> = {
  name: "Name (A–Z)",
  gaps: "Most gaps first",
  hours: "Oldest edit first",
};

/**
 * Sort a copy of the rows.
 *
 * `gaps` is the one that earns its keep: it puts the rows somebody can
 * actually go and fix at the top, which is worth more on this register than
 * any amount of alphabetising. Ties fall back to name so the order is stable
 * between renders.
 *
 * `hours` sorts by the row's last-edited date, oldest first — the closest
 * honest answer to "which readings are stale", since SharePoint keeps no
 * per-column timestamp. A row that has never been edited at all (no
 * `modifiedAt`) sorts first, because that is the stalest case there is.
 */
export function sortAssets(assets: Equipment[], sort: AssetSort): Equipment[] {
  const rows = [...assets];
  if (sort === "gaps") {
    return rows.sort(
      (a, b) => assetGaps(b).length - assetGaps(a).length || compareEquipment(a, b),
    );
  }
  if (sort === "hours") {
    return rows.sort(
      (a, b) =>
        (a.modifiedAt?.getTime() ?? 0) - (b.modifiedAt?.getTime() ?? 0) || compareEquipment(a, b),
    );
  }
  return rows.sort(compareEquipment);
}

// -----------------------------------------------------------------------------
// Filter options — built from the ROWS, not from the reference lists
// -----------------------------------------------------------------------------

export interface AssetFilterOption {
  value: string;
  label: string;
}

/**
 * Department / Location options for the filter bar, built from the rows on
 * screen plus a "No department" entry when any row is missing one.
 *
 * From the ROWS, not from the reference lists, on purpose: a retired
 * department that assets still point at has to stay filterable, and offering
 * an active value nothing points at would give an option that returns nothing.
 * (The EDIT form is the opposite — see `referenceOptions`, which offers only
 * Active values for a new selection.)
 */
export function assetReferenceOptions(
  assets: Equipment[],
  pick: (asset: Equipment) => ProjectReference | null,
  noneLabel: string,
): AssetFilterOption[] {
  const byKey = new Map<string, string>();
  let anyMissing = false;
  for (const asset of assets) {
    const ref = pick(asset);
    if (!ref) {
      anyMissing = true;
      continue;
    }
    const key = referenceKey(ref);
    if (!byKey.has(key)) byKey.set(key, referenceLabel(ref));
  }
  const options = [...byKey.entries()]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
  return anyMissing ? [{ value: NO_VALUE, label: noneLabel }, ...options] : options;
}

/** The same, for a plain choice column. */
export function assetChoiceOptions(
  assets: Equipment[],
  pick: (asset: Equipment) => string | null,
  noneLabel: string,
  order?: readonly string[],
): AssetFilterOption[] {
  const seen = new Set<string>();
  let anyMissing = false;
  for (const asset of assets) {
    const value = (pick(asset) ?? "").trim();
    if (!value) anyMissing = true;
    else seen.add(value);
  }
  const values = [...seen].sort((a, b) => {
    // A known choice order (Critical → Important → Standard) beats
    // alphabetical, which would rank them Critical, Important, Standard only
    // by accident and Down, In Service, Retired, Standby definitely wrongly.
    if (order) {
      const ai = order.indexOf(a);
      const bi = order.indexOf(b);
      if (ai !== -1 || bi !== -1) {
        if (ai === -1) return 1;
        if (bi === -1) return -1;
        return ai - bi;
      }
    }
    return a.localeCompare(b, undefined, { numeric: true });
  });
  const options = values.map((value) => ({ value, label: value }));
  return anyMissing ? [{ value: NO_VALUE, label: noneLabel }, ...options] : options;
}

// -----------------------------------------------------------------------------
// Editing — the diffed write payload
// -----------------------------------------------------------------------------

/** What the edit form holds. Everything ARC may write on an asset row. */
export interface AssetEditInput {
  name: string;
  assetTag: string;
  description: string;
  manufacturer: string;
  modelNumber: string;
  serialNo: string;
  equipmentType: string | null;
  /** A reference-list lookupId. `null` clears the field. */
  departmentLookupId: number | null;
  locationLookupId: number | null;
  criticality: string | null;
  assetStatus: string | null;
  currentMachineHours: number | null;
  installDate: Date | null;
  warrantyExpiry: Date | null;
}

/** Seed the form from the row being edited. */
export function assetEditInput(asset: Equipment): AssetEditInput {
  return {
    name: asset.name,
    assetTag: asset.assetTag,
    description: asset.description,
    manufacturer: asset.manufacturer,
    modelNumber: asset.modelNumber,
    serialNo: asset.serialNo,
    equipmentType: asset.equipmentType,
    departmentLookupId: asset.department?.lookupId ?? null,
    locationLookupId: asset.location?.lookupId ?? null,
    criticality: asset.criticality,
    assetStatus: asset.assetStatus,
    currentMachineHours: asset.currentMachineHours,
    installDate: asset.installDate,
    warrantyExpiry: asset.warrantyExpiry,
  };
}

/**
 * Seed the form for a brand-new asset — every field blank, Asset Status
 * defaulted to **In Service** since a machine being entered for the first
 * time is presumably running, not one of the three states that say otherwise.
 */
export function blankAssetEditInput(): AssetEditInput {
  return {
    name: "",
    assetTag: "",
    description: "",
    manufacturer: "",
    modelNumber: "",
    serialNo: "",
    equipmentType: null,
    departmentLookupId: null,
    locationLookupId: null,
    criticality: null,
    assetStatus: "In Service",
    currentMachineHours: null,
    installDate: null,
    warrantyExpiry: null,
  };
}

/** Same UTC-day comparison the date-only columns are stored under. */
function sameDay(a: Date | null, b: Date | null): boolean {
  if (a === null || b === null) return a === b;
  return toSpDateOnly(a) === toSpDateOnly(b);
}

/**
 * The SharePoint field payload for an edit — **only the columns that changed**.
 *
 * Three reasons this diffs rather than sending the whole row:
 *
 *  1. **The two reference lookups can hold an UNMIGRATED value** — lookupId 0,
 *     read out of the legacy `Department` / `Location` choice column when the
 *     row has no lookup (see lib/maintenanceReferences.ts). Writing
 *     `DepartmentRefLookupId: 0` would be a write of a row id that cannot
 *     exist, so an unchanged 0 is never sent. Deliberately CLEARING the field
 *     (to `null`) still is: that is a real edit.
 *  2. **`EquipmentType` and the other choice columns allow fill-in values**
 *     carried over from the previous maintenance system, so re-sending a value
 *     nobody touched is a write that can only go wrong — the same reason Visit
 *     Reports diffs its own writes.
 *  3. A no-op save should be a no-op, not a Modified stamp that makes every
 *     "last edited" reading on the register lie about being fresh.
 */
export function buildAssetUpdateFields(
  input: AssetEditInput,
  previous: Equipment,
): Record<string, unknown> {
  const fields: Record<string, unknown> = {};

  const textField = (key: string, next: string, before: string) => {
    if (next.trim() !== before.trim()) fields[key] = next.trim();
  };
  textField("Title", input.name, previous.name);
  textField("AssetTag", input.assetTag, previous.assetTag);
  textField("Description", input.description, previous.description);
  textField("Manufacturer", input.manufacturer, previous.manufacturer);
  textField("ModelNumber", input.modelNumber, previous.modelNumber);
  textField("SerialNo", input.serialNo, previous.serialNo);

  const choiceField = (key: string, next: string | null, before: string | null) => {
    const a = (next ?? "").trim() || null;
    const b = (before ?? "").trim() || null;
    if (a !== b) fields[key] = a;
  };
  choiceField("EquipmentType", input.equipmentType, previous.equipmentType);
  choiceField("Criticality", input.criticality, previous.criticality);
  choiceField("AssetStatus", input.assetStatus, previous.assetStatus);

  // SINGLE lookups — a BARE integer, never multiLookupField's
  // Collection(Edm.Int32) shape, which is for multi-value columns and 400s
  // here (api/operationsEquipment.ts says the same thing).
  const lookupField = (key: string, next: number | null, before: ProjectReference | null) => {
    const beforeId = before?.lookupId ?? null;
    if (next === beforeId) return;
    // 0 is the unmigrated sentinel, not a row id: never write it.
    if (next === 0) return;
    fields[key] = next;
  };
  lookupField("DepartmentRefLookupId", input.departmentLookupId, previous.department);
  lookupField("LocationRefLookupId", input.locationLookupId, previous.location);

  if (input.currentMachineHours !== previous.currentMachineHours) {
    fields.CurrentMachineHours = input.currentMachineHours;
  }

  // Date-only columns: midday UTC on the wire, so they don't render as the day
  // before for anyone west of Greenwich.
  if (!sameDay(input.installDate, previous.installDate)) {
    fields.InstallDate = input.installDate ? toSpDateOnly(input.installDate) : null;
  }
  if (!sameDay(input.warrantyExpiry, previous.warrantyExpiry)) {
    fields.WarrantyExpiry = input.warrantyExpiry ? toSpDateOnly(input.warrantyExpiry) : null;
  }

  return fields;
}

/**
 * The SharePoint field payload for a brand-new asset row.
 *
 * Unlike `buildAssetUpdateFields`, there is no diffing against a previous
 * row — every field the form holds goes in, since there's nothing to compare
 * against. The one thing carried over from the edit path: a lookupId of `0`
 * (the unmigrated-legacy sentinel) is never written, even though a create
 * form has no way to produce one today — cheap insurance against a future
 * caller that seeds `AssetEditInput` from something other than a blank form.
 */
export function buildAssetCreateFields(input: AssetEditInput): Record<string, unknown> {
  const fields: Record<string, unknown> = {
    Title: input.name.trim(),
    AssetTag: input.assetTag.trim(),
    Description: input.description.trim(),
    Manufacturer: input.manufacturer.trim(),
    ModelNumber: input.modelNumber.trim(),
    SerialNo: input.serialNo.trim(),
    EquipmentType: (input.equipmentType ?? "").trim() || null,
    Criticality: (input.criticality ?? "").trim() || null,
    AssetStatus: (input.assetStatus ?? "").trim() || null,
    CurrentMachineHours: input.currentMachineHours,
    InstallDate: input.installDate ? toSpDateOnly(input.installDate) : null,
    WarrantyExpiry: input.warrantyExpiry ? toSpDateOnly(input.warrantyExpiry) : null,
  };
  if (input.departmentLookupId !== null && input.departmentLookupId !== 0) {
    fields.DepartmentRefLookupId = input.departmentLookupId;
  }
  if (input.locationLookupId !== null && input.locationLookupId !== 0) {
    fields.LocationRefLookupId = input.locationLookupId;
  }
  return fields;
}

/**
 * Parse what somebody typed into the hours box.
 *
 * `""` is `null` (cleared), not 0 — the same distinction the column itself
 * carries. Anything that isn't a finite, non-negative number is rejected
 * rather than coerced, because an hourmeter reading nobody can read back is
 * worse than no reading.
 */
export function parseMachineHours(raw: string): { ok: true; value: number | null } | { ok: false } {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: true, value: null };
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0) return { ok: false };
  return { ok: true, value };
}

/** The hours as text — "Never recorded" is the UI's job, this returns "". */
export function machineHoursText(asset: Equipment): string {
  return asset.currentMachineHours === null ? "" : String(asset.currentMachineHours);
}

/** An asset's display name in a table row. */
export function assetRowLabel(asset: Equipment): string {
  return equipmentLabel(asset);
}

/**
 * The Active values a picker may offer, plus whatever this row already points
 * at — thin wrapper naming the rule so a caller doesn't have to remember it.
 *
 * A row pointing at a RETIRED value must still display it: dropping it from
 * the picker would quietly clear the field on the next save.
 */
export function activeOrCurrent(
  values: MaintenanceReferenceValue[],
  current: ProjectReference | null,
): MaintenanceReferenceValue[] {
  const active = values.filter((v) => v.active);
  if (!current) return active;
  if (active.some((v) => v.lookupId === current.lookupId)) return active;
  const known = values.find((v) => v.lookupId === current.lookupId);
  return known ? [known, ...active] : active;
}
