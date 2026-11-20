import { graphFetchAll } from "./graph";
import {
  SITES,
  SP_ALTRONIC_EQUIPMENT_LIST_ID,
  SP_MAINTENANCE_LOCATIONS_LIST_ID,
  USE_MOCK,
} from "./config";
import { mockDelay } from "./mockLatency";
import { toLookupId } from "@/lib/graphValues";
import type { GraphListItem } from "@/types/task";
import type { CrimpMachine } from "@/types/crimp";
import { MOCK_CRIMP_MACHINES } from "@/data/crimpMockData";

// =============================================================================
// Crimp machines — the Altronic Equipment List (the CMMS asset register, PMO
// site), READ-ONLY, as the crimp screens need it (2026-11-12).
//
// Its own small read rather than the CMMS module's: Harness is a department
// of its own and doesn't import Operations code, and the crimp screens need
// five columns, not the asset register's thirty. Maintenance owns the rows;
// ARC's crimp screens never write them.
//
// Location is a SINGLE lookup into Maintenance Locations, read as a bare
// `LocationRefLookupId` and named from that list. The register still carries
// the old `Location` choice column as a rollback path, read when the lookup
// is empty — the CMMS mapper's rule.
// =============================================================================

const SELECT = "Title,EquipmentType,SerialNo,AssetStatus,LocationRefLookupId,Location";

function text(raw: unknown): string {
  return typeof raw === "string" ? raw : raw === null || raw === undefined ? "" : String(raw);
}

/** Every asset on the register — the screens filter to presses with `isCrimpMachine`. */
export async function listCrimpMachines(): Promise<CrimpMachine[]> {
  if (USE_MOCK) return mockDelay(MOCK_CRIMP_MACHINES.map((m) => ({ ...m })));
  if (!SP_ALTRONIC_EQUIPMENT_LIST_ID) {
    throw new Error("Cannot read the crimp machines: the Altronic Equipment List id is not configured.");
  }
  const [items, locations] = await Promise.all([
    graphFetchAll<GraphListItem>(
      `/sites/${SITES.pmo}/lists/${SP_ALTRONIC_EQUIPMENT_LIST_ID}/items?$expand=fields($select=${SELECT})&$top=999`,
    ),
    SP_MAINTENANCE_LOCATIONS_LIST_ID
      ? graphFetchAll<GraphListItem>(
          `/sites/${SITES.pmo}/lists/${SP_MAINTENANCE_LOCATIONS_LIST_ID}/items?$expand=fields($select=Title)&$top=999`,
        )
      : Promise.resolve([] as GraphListItem[]),
  ]);
  const locationTitle = new Map(
    locations.map((l) => [parseInt(l.id, 10), text((l.fields as Record<string, unknown> | undefined)?.Title)]),
  );
  return items.map((item) => {
    const f = (item.fields ?? {}) as Record<string, unknown>;
    const locationId = toLookupId(f.LocationRefLookupId);
    return {
      id: parseInt(item.id, 10),
      name: text(f.Title).trim(),
      equipmentType: text(f.EquipmentType).trim(),
      serialNo: text(f.SerialNo).trim(),
      location: (locationId !== null ? locationTitle.get(locationId) : "") || text(f.Location).trim(),
      retired: /^retired$/i.test(text(f.AssetStatus).trim()),
    };
  });
}
