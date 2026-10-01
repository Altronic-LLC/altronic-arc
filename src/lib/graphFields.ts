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

/**
 * Write payload for a genuine multi-select Choice column — SharePoint's
 * `MultiChoice` type, the one whose column definition reports
 * `choice.displayAs: "checkBoxes"`.
 *
 * Graph needs the **`Collection(Edm.String)` annotation**, exactly as
 * multi-value lookups need `Collection(Edm.Int32)`. A bare array is
 * refused with a bare `400 invalidRequest` naming no field:
 *
 *   PATCH .../items/70/fields   {"Operations":["Create Work Instruction"]}
 *   → 400 invalidRequest
 *
 * Reported 2026-09-24 by Femi Olugbon on build request 70 — Assembly,
 * Operations and Testing could not be ticked at all, while Part Status and
 * Disposition (single-value `dropDownMenu` choice columns) saved fine.
 *
 * **This annotation was here, then removed in v0.17.5, and that removal was
 * the bug.** It was taken out while fixing a write to `ProjectReference`,
 * which is NOT a multi-choice column — so dropping the annotation fixed that
 * field and the doc comment then generalised the one case into a rule
 * ("adding the annotation breaks the write on some tenants"), which
 * `api/buildRequestItems.ts` inherited. A single-value Choice column wants a
 * bare string and no annotation; a MultiChoice column wants this. The two
 * are indistinguishable in Graph's `/columns` output, which reports `choice`
 * for both — `displayAs` is the only signal.
 *
 * Example:
 *   multiChoiceField("Operations", ["Programming", "Machining"])
 *     ↓
 *   {
 *     "Operations@odata.type": "Collection(Edm.String)",
 *     "Operations": ["Programming", "Machining"],
 *   }
 *
 * Clearing is `[]` (with the annotation), never `null`.
 */
export function multiChoiceField(
  fieldName: string,
  values: string[],
): Record<string, unknown> {
  return {
    [`${fieldName}@odata.type`]: "Collection(Edm.String)",
    [fieldName]: values,
  };
}

/**
 * Add the `Collection(Edm.String)` annotation to every genuine multi-choice
 * column present in a write payload, leaving everything else untouched.
 *
 * Callers keep passing plain string arrays; this is applied once at each
 * module's PATCH/POST site, so no individual call site has to remember. The
 * failure it prevents is a bare `400 invalidRequest` naming no field, which
 * is expensive to diagnose — it took two rounds of investigation on
 * 2026-09-24, because the values, the column and the array shape all looked
 * correct in isolation.
 *
 * **`names` must list ONLY columns whose live definition reports
 * `choice.displayAs === "checkBoxes"`.** Graph's `/columns` output says
 * `type: "choice"` for single- and multi-value alike, so that field is the
 * only reliable signal. Annotating a SINGLE-value choice column breaks it the
 * same way omitting it here breaks a multi one.
 *
 * A non-array value is left alone — a caller clearing with `null` must stay
 * `null`, since annotating a null is its own 400.
 */
export function annotateMultiChoiceFields(
  fields: Record<string, unknown>,
  names: readonly string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...fields };
  for (const name of names) {
    if (!(name in out)) continue;
    const value = out[name];
    if (!Array.isArray(value)) continue;
    Object.assign(out, multiChoiceField(name, value as string[]));
  }
  return out;
}
