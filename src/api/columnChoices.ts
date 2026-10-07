import { graphFetch } from "./graph";

/**
 * A Choice column's LIVE choices, read off the column definition, in
 * SharePoint's own order — so a status added or removed in SharePoint shows up
 * in ARC on the next load with no deploy.
 *
 * Falls back to `fallback` when the column can't be read or isn't there:
 * column metadata can be refused even when items aren't, and an empty picker
 * is worse than a slightly stale one. Nothing is cached here, so a failure is
 * retried by the next load (callers cache through React Query).
 */
export async function readColumnChoices(
  siteId: string,
  listId: string | undefined,
  column: string,
  fallback: readonly string[],
): Promise<string[]> {
  if (!listId) return [...fallback];
  try {
    const columns = await graphFetch<{
      value: Array<{ name?: string; choice?: { choices?: string[] } }>;
    }>(`/sites/${siteId}/lists/${listId}/columns?$select=name,choice`);
    const choices = columns.value?.find((c) => c.name === column)?.choice?.choices;
    return choices && choices.length > 0 ? choices : [...fallback];
  } catch {
    return [...fallback];
  }
}

/**
 * The live choices plus a record's CURRENT value if the column no longer
 * offers it. A picker that dropped the current value would show the wrong
 * thing, and the next save would quietly change a value nobody touched.
 */
export function withCurrentChoice(live: readonly string[], current: string | null | undefined): string[] {
  return current && !live.includes(current) ? [...live, current] : [...live];
}
