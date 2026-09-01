import type {
  Equipment,
  GraphListItem,
  MaintenanceReferenceValue,
  Person,
  ProjectReference,
} from "@/types/task";
import { parseSpDateOnly } from "./spDates";
import {
  attachLookupTitle,
  fillPerson,
  lookupRef,
  personOrLookup,
  text,
} from "./maintenanceShared";
import {
  attachReference,
  referenceIndex,
  unmigratedReference,
} from "./maintenanceReferences";

// =============================================================================
// Graph item → Equipment (the Altronic Equipment List, 378 rows, PMO site).
//
// Two things this list needs that a plain title lookup doesn't:
//
//  - **`ResponsibleTech` is a SINGLE person column**, so Graph hands it back as
//    a bare `ResponsibleTechLookupId` however the `$select` is written. Both
//    halves are selected and `attachEquipmentPeople` fills the name in from the
//    PMO site's User Information List.
//  - **`ParentAsset` is a single lookup into this SAME list** — a sub-assembly
//    pointing at its parent machine — so its title is joined client-side
//    against the equipment list itself (`attachParentAssetTitles`).
//
// Its choice columns are NOT clamped to the const arrays in types/task.ts. The
// rows are an import from the previous maintenance system and the columns allow
// fill-in values, so an unrecognised type has to render as itself rather than
// disappear.
//
// **Department and Location are single LOOKUPS here since 2026-08-28**
// (`DepartmentRef` / `LocationRef`), into the two Maintenance reference lists.
// This list — and ONLY this list — also still carries the old `Department` /
// `Location` CHOICE columns, deliberately kept as a rollback path, and they
// are read as a FALLBACK when the lookup is empty:
//
//   * the migration populated 365 of 378 rows; 13 had neither value, so
//     nothing was lost — but a row edited through the old column in
//     SharePoint, or a rollback, would otherwise silently read as unset;
//   * a legacy value whose text matches a row on the reference list is
//     UPGRADED to that row's lookupId by `attachEquipmentReferences`, so it
//     groups and filters with every migrated row rather than beside them;
//   * one that matches nothing keeps `lookupId: 0` and still displays.
//
// The two work-order lists never had those columns. Selecting a column a list
// hasn't got 400s the whole read, so `MAINTENANCE_TASK_SELECT` and
// `SCHEDULED_MAINTENANCE_SELECT` must never gain them.
// =============================================================================

/** `$select` for a full Equipment read — both halves of every single-value column. */
export const EQUIPMENT_SELECT = [
  "Title",
  "Description",
  "SerialNo",
  "EquipmentType",
  // Both halves of the two lookups, PLUS the legacy choice columns they
  // replaced — this list still has those, and they are the fallback. See the
  // note at the top of this file.
  "DepartmentRef",
  "DepartmentRefLookupId",
  "LocationRef",
  "LocationRefLookupId",
  "Department",
  "Location",
  "Criticality",
  "AssetStatus",
  "ParentAsset",
  "ParentAssetLookupId",
  "InstallDate",
  "WarrantyExpiry",
  "ResponsibleTech",
  "ResponsibleTechLookupId",
  "Manufacturer",
  "ModelNumber",
  "Attachments",
].join(",");

/** A choice value, kept verbatim — "" reads as unset. */
function choice(raw: unknown): string | null {
  const value = text(raw).trim();
  return value ? value : null;
}

export function toEquipment(item: GraphListItem): Equipment {
  const f = item.fields ?? {};
  return {
    lookupId: parseInt(item.id, 10),
    name: text(f.Title).trim(),
    description: text(f.Description).trim(),
    serialNo: text(f.SerialNo).trim(),
    manufacturer: text(f.Manufacturer).trim(),
    modelNumber: text(f.ModelNumber).trim(),
    equipmentType: choice(f.EquipmentType),
    // Lookup first, legacy choice column second — see the note at the top.
    department:
      lookupRef(f.DepartmentRef, f.DepartmentRefLookupId) ?? unmigratedReference(choice(f.Department)),
    location:
      lookupRef(f.LocationRef, f.LocationRefLookupId) ?? unmigratedReference(choice(f.Location)),
    criticality: choice(f.Criticality),
    assetStatus: choice(f.AssetStatus),
    parentAsset: lookupRef(f.ParentAsset, f.ParentAssetLookupId),
    installDate: parseSpDateOnly(f.InstallDate),
    warrantyExpiry: parseSpDateOnly(f.WarrantyExpiry),
    responsibleTech: personOrLookup(f.ResponsibleTech, f.ResponsibleTechLookupId),
    hasAttachments: f.Attachments === true,
  };
}

/** Fill in `responsibleTech` from the site's user directory. Mutates in place. */
export function attachEquipmentPeople(
  equipment: Equipment[],
  siteUsers: Map<number, Person>,
): void {
  for (const e of equipment) {
    e.responsibleTech = fillPerson(e.responsibleTech, siteUsers);
  }
}

/**
 * Resolve each `parentAsset` title against the list itself. Mutates in place.
 *
 * Runs after the whole list is mapped, since a parent can appear anywhere in
 * it — including after the child that points at it.
 */
export function attachParentAssetTitles(equipment: Equipment[]): void {
  const byId = new Map(equipment.map((e) => [e.lookupId, { title: e.name }]));
  for (const e of equipment) {
    e.parentAsset = attachLookupTitle(e.parentAsset, byId);
  }
}

/**
 * Resolve every asset's Department / Location against the two reference lists.
 * Mutates in place, like `attachEquipmentPeople`.
 *
 * Does two jobs at once (`attachReference` in lib/maintenanceReferences.ts):
 * fills the title in for a lookup Graph handed back as a bare id, and upgrades
 * a legacy choice value to the matching reference row so it buckets with the
 * migrated ones. A value that resolves to neither still displays.
 */
export function attachEquipmentReferences(
  equipment: Equipment[],
  departments: MaintenanceReferenceValue[],
  locations: MaintenanceReferenceValue[],
): void {
  const departmentIndex = referenceIndex(departments);
  const locationIndex = referenceIndex(locations);
  for (const e of equipment) {
    e.department = attachReference(e.department, departmentIndex);
    e.location = attachReference(e.location, locationIndex);
  }
}

/**
 * The `{ lookupId, title }` shape every `EquipmentRef` picker in ARC already
 * speaks — including the Operations task form, whose `listOperationsEquipment()`
 * contract predates this module and is deliberately unchanged.
 */
export function equipmentReference(equipment: Equipment): ProjectReference {
  return { lookupId: equipment.lookupId, title: equipment.name };
}

/** Alphabetical by name, the order every picker and table wants. */
export function compareEquipment(a: Equipment, b: Equipment): number {
  return a.name.localeCompare(b.name) || a.lookupId - b.lookupId;
}

/** What to call an asset when its Title is blank — never an empty cell. */
export function equipmentLabel(equipment: Equipment): string {
  return equipment.name.trim() || equipment.serialNo.trim() || `Asset #${equipment.lookupId}`;
}
