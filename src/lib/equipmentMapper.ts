import type { Equipment, GraphListItem, Person, ProjectReference } from "@/types/task";
import { parseSpDateOnly } from "./spDates";
import {
  attachLookupTitle,
  fillPerson,
  lookupRef,
  personOrLookup,
  text,
} from "./maintenanceShared";

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
// fill-in values, so an unrecognised type or location has to render as itself
// rather than disappear.
// =============================================================================

/** `$select` for a full Equipment read — both halves of every single-value column. */
export const EQUIPMENT_SELECT = [
  "Title",
  "Description",
  "SerialNo",
  "EquipmentType",
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
    department: choice(f.Department),
    location: choice(f.Location),
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
