# Backlog

Queued work for upcoming releases. Items at the top are highest-priority /
next-up. When picking something up, move it to a release in `CHANGELOG.ts`
(via the changelog protocol in `CLAUDE.md`) and delete it from this list.

This is intentionally informal — a running list of "things we want, in
roughly the order we want them." No tickets, no story points. If an item
needs detail, add a sub-bullet underneath it.

---

## Next up

- **Disable Kanban drag-and-drop on mobile phones only; keep it on tablet
  and desktop.** Phones (<640px width) should still show the Kanban view
  for read-only browsing, but tapping a card just opens the detail page
  — no drag interaction. Status changes on phone happen from the detail
  view's Status dropdown. Tablets (≥640px) and desktop keep the drag.

## Later

(add new items here as they come up)

## Done / shipped

When an item ships, move it into the corresponding CHANGELOG entry in
`src/data/changelog.ts` and delete it from this file. Don't keep a
"shipped" section here — the changelog is the record of what's done.
