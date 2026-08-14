import { LABELS, type Label } from "@/types/task";

/**
 * The single place that knows what shape SharePoint's `Labels` column takes.
 *
 * `Labels` is a **single-value `choice` column** (verified against the live
 * list, 2026-08-14 — `scripts/discover-list.ps1 -ListName "Project Task List"`).
 * It is NOT multi-choice: `Assigned` and `ProjectReference` are annotated
 * `multi` in that dump and `Labels` is not, and real rows come back as bare
 * strings — `"documentation"`, `"question"` — never arrays.
 *
 * Writing `["bug"]` to it made Graph reject the whole create with
 * `400 invalidRequest`, which is why a task with a label wouldn't save while
 * the same task without one would. Joining with `";#"` doesn't work either:
 * `"bug;#documentation"` isn't one of the nine allowed choices, so anything
 * past the first label would fail exactly the same way.
 *
 * The domain keeps `labels: Label[]` because every list, card and print view
 * renders it as a collection, but it now holds AT MOST ONE entry, and the
 * pickers are single-select to match. Route every read and write through the
 * two functions here so the shapes can't drift apart again.
 */

/**
 * What goes on the wire: the one chosen label, or null to clear the column.
 *
 * Takes loose strings because `CreateTaskInput.labels` is `string[]`, and
 * validates against the column's allowed choices — writing a value the column
 * doesn't offer is the other way to earn a 400 here.
 */
export function toLabelsField(labels: readonly string[] | undefined): string | null {
  if (!labels) return null;
  return labels.find((l): l is Label => (LABELS as readonly string[]).includes(l)) ?? null;
}

/**
 * Read the column into the domain shape.
 *
 * Accepts what SharePoint actually sends (a bare choice string) and tolerates
 * a `;#`-joined string or an array too, so an old value written before this
 * was pinned down — or a column later switched to multi-choice — still maps
 * cleanly instead of throwing.
 */
export function fromLabelsField(raw: unknown): Label[] {
  if (!raw) return [];
  const parts = Array.isArray(raw)
    ? raw.map((x) => String(x))
    : String(raw).split(/[;#,]/);
  return parts
    .map((s) => s.trim())
    .filter((p): p is Label => (LABELS as readonly string[]).includes(p));
}
