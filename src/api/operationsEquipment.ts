import { graphFetch, graphFetchAll } from "./graph";
import {
  SITES,
  SP_ALTRONIC_EQUIPMENT_LIST_ID,
  SP_PMO_SITE_URL,
  USE_MOCK,
} from "./config";
import { listSiteUserDirectory, resolvePersonLookupId } from "./siteUsers";
import type { Equipment, GraphListItem, Person, ProjectReference } from "@/types/task";
import {
  EQUIPMENT_SELECT,
  attachEquipmentPeople,
  attachEquipmentReferences,
  attachParentAssetTitles,
  compareEquipment,
  equipmentReference,
  toEquipment,
} from "@/lib/equipmentMapper";
import { listMaintenanceReferenceLists } from "./maintenanceReferenceLists";
import { toSpDateOnly } from "@/lib/spDates";
import { MOCK_EQUIPMENT } from "@/data/maintenanceMockData";

// =============================================================================
// Altronic Equipment List (378 rows, PMO site).
//
// Two shapes of the same list, on purpose:
//
//  - `listOperationsEquipment()` returns bare `ProjectReference`s. That is the
//    contract the Operations task form's Equipment picker has always spoken,
//    and it is UNCHANGED — new work here must not break it.
//  - `listEquipment()` returns the full `Equipment` record, for the CMMS
//    screens that need an asset's criticality, status, location and
//    responsible tech rather than just its name.
//
// Both read the same rows, so a work order and an Operations task naming the
// same asset agree about which one it is.
//
// **There is deliberately NO create and NO delete, and that still stands.** An
// asset row comes into existence when the plant buys a machine, and deleting
// one orphans every work order and PM schedule pointing at it — retiring is
// `AssetStatus = "Retired"`, which is why that choice exists. Everything else
// about a row IS editable from ARC now: the asset register screen
// (/operations/maintenance/assets) edits the nameplate, the two reference
// lookups, criticality, status and the hourmeter reading, and the asset detail
// page keeps the two quick edits a technician makes with a work order open.
// Every one of those writes is gated by `manageAssetsGate` in the hook layer.
// =============================================================================

let mockStore: Equipment[] = MOCK_EQUIPMENT.map((e) => ({ ...e }));

/** Demo-mode-only: reset to the bundled seed. */
export function resetEquipmentMockStore(): void {
  mockStore = MOCK_EQUIPMENT.map((e) => ({ ...e }));
}

function listPath(): string {
  return `/sites/${SITES.pmo}/lists/${SP_ALTRONIC_EQUIPMENT_LIST_ID}/items`;
}

/**
 * Every piece of equipment as a bare `{ lookupId, title }`, sorted by name.
 *
 * The Operations task form depends on this exact return type. It reads the
 * same underlying rows as `listEquipment()`.
 */
export async function listOperationsEquipment(): Promise<ProjectReference[]> {
  if (USE_MOCK) {
    return [...mockStore].sort(compareEquipment).map(equipmentReference);
  }

  const path = `${listPath()}?$expand=fields($select=Title)&$top=500`;
  const items = await graphFetchAll<GraphListItem>(path);
  const equipment = items.map((item) => ({
    lookupId: parseInt(item.id, 10),
    title: (item.fields.Title as string) ?? `(equipment #${item.id})`,
  }));
  equipment.sort((a, b) => a.title.localeCompare(b.title));
  return equipment;
}

/**
 * Resolve Department / Location against the two Maintenance reference lists.
 *
 * Run in BOTH modes, not just the real one: a mock write stores the lookupId
 * it was given and nothing else, so without this the demo shows an asset whose
 * department is set and blank — the one thing lib/maintenanceReferences.ts
 * exists to prevent.
 */
async function resolveEquipmentReferences(equipment: Equipment[]): Promise<void> {
  const { departments, locations } = await listMaintenanceReferenceLists();
  attachEquipmentReferences(equipment, departments, locations);
}

/** Every asset in full, alphabetically, with people and parent titles resolved. */
export async function listEquipment(): Promise<Equipment[]> {
  if (USE_MOCK) {
    const equipment = [...mockStore].sort(compareEquipment).map((e) => ({ ...e }));
    await resolveEquipmentReferences(equipment);
    return equipment;
  }

  // `ResponsibleTech` is a SINGLE person column, so it arrives as a bare
  // lookupId — the site-user directory read in parallel is what turns it into
  // a name. Best-effort: a failure leaves "User #n", never a blank.
  const [items, siteUsers, references] = await Promise.all([
    graphFetchAll<GraphListItem>(`${listPath()}?$expand=fields($select=${EQUIPMENT_SELECT})&$top=500`),
    listSiteUserDirectory(SITES.pmo),
    // The two reference lists in parallel with the items: DepartmentRef and
    // LocationRef come back as bare lookupIds, so without this every asset's
    // department reads as a number nobody can act on.
    listMaintenanceReferenceLists(),
  ]);
  const equipment = items.map(toEquipment);
  attachEquipmentPeople(equipment, siteUsers);
  attachEquipmentReferences(equipment, references.departments, references.locations);
  // Parent assets point back into this same list, so their titles can only be
  // joined once every row has been read.
  attachParentAssetTitles(equipment);
  return equipment.sort(compareEquipment);
}

export async function getEquipment(lookupId: number): Promise<Equipment | null> {
  const all = await listEquipment();
  return all.find((e) => e.lookupId === lookupId) ?? null;
}

/** Patch columns on an asset by their SharePoint names. */
export async function updateEquipmentFields(
  lookupId: number,
  fields: Record<string, unknown>,
): Promise<Equipment> {
  if (USE_MOCK) {
    const idx = mockStore.findIndex((e) => e.lookupId === lookupId);
    if (idx < 0) throw new Error(`Equipment ${lookupId} not found`);
    const next: Equipment = { ...mockStore[idx] };
    applyMockFields(next, fields);
    // A mock write stores a bare lookupId; resolve its title straight away so
    // the caller's optimistic patch shows the value's name, not a blank.
    await resolveEquipmentReferences([next]);
    mockStore = [...mockStore.slice(0, idx), next, ...mockStore.slice(idx + 1)];
    return { ...next };
  }

  await graphFetch(`${listPath()}/${lookupId}/fields`, {
    method: "PATCH",
    body: JSON.stringify(fields),
  });
  const reloaded = await getEquipment(lookupId);
  if (!reloaded) throw new Error(`Equipment ${lookupId} disappeared after update`);
  return reloaded;
}

function applyMockFields(next: Equipment, fields: Record<string, unknown>) {
  const str = (v: unknown) => (v === null || v === undefined ? null : String(v));
  if ("Title" in fields) next.name = String(fields.Title ?? "");
  if ("Description" in fields) next.description = String(fields.Description ?? "");
  if ("SerialNo" in fields) next.serialNo = String(fields.SerialNo ?? "");
  if ("Manufacturer" in fields) next.manufacturer = String(fields.Manufacturer ?? "");
  if ("ModelNumber" in fields) next.modelNumber = String(fields.ModelNumber ?? "");
  if ("EquipmentType" in fields) next.equipmentType = str(fields.EquipmentType);
  // Single lookups — the mock mirrors the real column names, so a write is a
  // bare integer here too. Titles are filled in by resolveEquipmentReferences.
  if ("DepartmentRefLookupId" in fields) {
    const v = fields.DepartmentRefLookupId;
    next.department = v ? { lookupId: Number(v), title: "" } : null;
  }
  if ("LocationRefLookupId" in fields) {
    const v = fields.LocationRefLookupId;
    next.location = v ? { lookupId: Number(v), title: "" } : null;
  }
  if ("Criticality" in fields) next.criticality = str(fields.Criticality);
  if ("AssetStatus" in fields) next.assetStatus = str(fields.AssetStatus);
  if ("InstallDate" in fields) {
    next.installDate = fields.InstallDate ? new Date(String(fields.InstallDate)) : null;
  }
  if ("WarrantyExpiry" in fields) {
    next.warrantyExpiry = fields.WarrantyExpiry ? new Date(String(fields.WarrantyExpiry)) : null;
  }
  if ("ResponsibleTech" in fields) {
    next.responsibleTech = (fields.ResponsibleTech as Person | null) ?? null;
  }
  if ("ParentAssetLookupId" in fields) {
    const v = fields.ParentAssetLookupId;
    next.parentAsset = v ? { lookupId: Number(v), title: next.parentAsset?.title ?? "" } : null;
  }
  if ("AssetTag" in fields) next.assetTag = String(fields.AssetTag ?? "").trim();
  if ("CurrentMachineHours" in fields) {
    const v = fields.CurrentMachineHours;
    // Null stays null — see the note on `machineHours` in lib/equipmentMapper.
    // Clearing a reading is a real edit ("that number was wrong"), and turning
    // it into 0 here would fake a meter read that never happened.
    next.currentMachineHours = v === null || v === undefined || v === "" ? null : Number(v);
  }
  // SharePoint stamps Modified on every write, so the mock has to as well —
  // otherwise the register's "last edited" column never moves in demo mode and
  // the one signal that says "this reading is stale" reads as broken.
  next.modifiedAt = new Date();
}

/**
 * Mark an asset down / back in service.
 *
 * The one equipment edit a technician makes from a work order rather than from
 * SharePoint: a machine that has just failed is Down, and one whose repair has
 * just been signed off is back In Service.
 */
export async function setEquipmentAssetStatus(
  lookupId: number,
  assetStatus: string | null,
): Promise<Equipment> {
  return updateEquipmentFields(lookupId, { AssetStatus: assetStatus });
}

/** Set the responsible technician (or clear with `null`). */
export async function setEquipmentResponsibleTech(
  lookupId: number,
  person: Person | null,
): Promise<Equipment> {
  if (USE_MOCK) return updateEquipmentFields(lookupId, { ResponsibleTech: person });
  const resolved = await resolvePersonLookupId(SITES.pmo, SP_PMO_SITE_URL, person);
  // Asked for and unresolvable is REFUSED — writing null here would silently
  // clear the column it was told to set (see api/faits.ts's requireResolved).
  if (person && !resolved?.lookupId) {
    throw new Error(
      `Couldn't set Responsible Tech to ${person.displayName || person.email || "that person"}: ` +
        `SharePoint has no user record for them on the Altronic PMO site, and one couldn't be ` +
        `created. Ask an admin to check your SharePoint access, then try again.`,
    );
  }
  // A SINGLE person column: a bare integer.
  return updateEquipmentFields(lookupId, { ResponsibleTechLookupId: resolved?.lookupId ?? null });
}

/**
 * Move an asset to a different department (or clear with `null`).
 *
 * A SINGLE lookup, so a BARE integer — never `multiLookupField`'s
 * `Collection(Edm.Int32)` shape, which is for multi-value columns and 400s
 * here. The legacy `Department` choice column is deliberately NOT written:
 * it is kept only as a rollback path, and writing both would leave two
 * sources of truth disagreeing the moment one of them was edited elsewhere.
 */
export async function setEquipmentDepartment(
  lookupId: number,
  departmentLookupId: number | null,
): Promise<Equipment> {
  return updateEquipmentFields(lookupId, { DepartmentRefLookupId: departmentLookupId });
}

/** Move an asset to a different location (or clear with `null`). A BARE integer. */
export async function setEquipmentLocation(
  lookupId: number,
  locationLookupId: number | null,
): Promise<Equipment> {
  return updateEquipmentFields(lookupId, { LocationRefLookupId: locationLookupId });
}

/**
 * Record the hourmeter reading (or clear it with `null`).
 *
 * Its own function rather than a `updateEquipmentFields` call at each site
 * because it is the one asset edit that has to be a ONE-FIELD action: a
 * reading nobody updates is a meter-based PM that never comes due, and making
 * somebody open a full edit form to type one number is how that happens. The
 * register offers it inline for the same reason.
 */
export async function setEquipmentMachineHours(
  lookupId: number,
  hours: number | null,
): Promise<Equipment> {
  return updateEquipmentFields(lookupId, { CurrentMachineHours: hours });
}

/** Set an asset's warranty expiry (a date-only column — midday UTC on the wire). */
export async function setEquipmentWarrantyExpiry(
  lookupId: number,
  date: Date | null,
): Promise<Equipment> {
  return updateEquipmentFields(lookupId, { WarrantyExpiry: date ? toSpDateOnly(date) : null });
}
