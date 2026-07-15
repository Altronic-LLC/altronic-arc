import { graphFetchAll } from "./graph";
import { SITES, SP_ALTRONIC_EQUIPMENT_LIST_ID, USE_MOCK } from "./config";
import type { GraphListItem, ProjectReference } from "@/types/task";
import { MOCK_OPERATIONS_EQUIPMENT } from "@/data/operationsMockData";

// =============================================================================
// Altronic Equipment List — read-only reference for the Operations task
// form's Equipment picker. No admin CRUD in ARC; equipment is managed
// directly in SharePoint. Modelled as ProjectReference (same {lookupId,
// title} shape) since it's just another simple lookup directory, same as
// Operations Projects.
// =============================================================================

/** List every piece of equipment, sorted alphabetically by name. */
export async function listOperationsEquipment(): Promise<ProjectReference[]> {
  if (USE_MOCK) {
    return [...MOCK_OPERATIONS_EQUIPMENT].sort((a, b) => a.title.localeCompare(b.title));
  }

  const path =
    `/sites/${SITES.pmo}/lists/${SP_ALTRONIC_EQUIPMENT_LIST_ID}/items` +
    `?$expand=fields($select=Title)&$top=500`;
  const items = await graphFetchAll<GraphListItem>(path);
  const equipment = items.map((item) => ({
    lookupId: parseInt(item.id, 10),
    title: (item.fields.Title as string) ?? `(equipment #${item.id})`,
  }));
  equipment.sort((a, b) => a.title.localeCompare(b.title));
  return equipment;
}
