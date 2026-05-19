/**
 * Helpers for shaping SharePoint list-item `fields` payloads against
 * Microsoft Graph v1.0.
 *
 * The most useful one is `multiLookupField` — Graph rejects the older
 * SharePoint REST `{ results: [...] }` shape for multi-value lookups
 * and instead expects:
 *
 *   "{Field}LookupId@odata.type": "Collection(Edm.Int32)",
 *   "{Field}LookupId": [123, 456]
 *
 * Forgetting either part causes a generic 400 invalidRequest with no
 * detail in the response — which is what burned us repeatedly during
 * the task-create work. Always use this helper for multi-person /
 * multi-value-lookup writes (Assigned, Watchers, anything similar on
 * other lists like Test Results).
 */

import type { Person } from "@/types/task";

/**
 * Build the two-key object that writes a multi-value lookup/person field
 * to Graph. Pass the field's internal name without the `LookupId` suffix.
 *
 * Always emits the annotated shape — even for empty arrays — so updates
 * can clear a field by passing `[]`. Callers that want "skip the field
 * entirely on create" should check `lookupIds.length === 0` themselves
 * and not call this.
 *
 * Example:
 *   multiLookupField("Assigned", [12, 87])
 *     ↓
 *   {
 *     "AssignedLookupId@odata.type": "Collection(Edm.Int32)",
 *     "AssignedLookupId": [12, 87],
 *   }
 */
export function multiLookupField(
  fieldName: string,
  lookupIds: number[],
): Record<string, unknown> {
  const idKey = `${fieldName}LookupId`;
  return {
    [`${idKey}@odata.type`]: "Collection(Edm.Int32)",
    [idKey]: lookupIds,
  };
}

/**
 * Convenience for multi-person fields: drops people without a resolved
 * SharePoint lookupId, then calls `multiLookupField`. Always emits the
 * annotated shape so an update can clear the field by passing [] or by
 * passing only-unresolved people.
 */
export function multiPersonField(
  fieldName: string,
  people: Person[],
): Record<string, unknown> {
  const lookupIds = people.map((p) => p.lookupId).filter((x): x is number => !!x);
  return multiLookupField(fieldName, lookupIds);
}
