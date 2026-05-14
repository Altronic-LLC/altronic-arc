# Backlog

Queued work for upcoming releases. Items at the top are highest-priority /
next-up. When picking something up, move it to a release in `CHANGELOG.ts`
(via the changelog protocol in `CLAUDE.md`) and delete it from this list.

This is intentionally informal — a running list of "things we want, in
roughly the order we want them." No tickets, no story points. If an item
needs detail, add a sub-bullet underneath it.

---

## Next up

- **Show users when someone else just commented on the same task they're
  viewing.** Polling-based, no realtime infrastructure required. When a
  task's detail view is open, poll the comments list every 15–30 seconds.
  If new comments appear since the user opened the page, show a small
  banner like "New comment from Bob — refresh to see" with a refresh
  button. When the user clicks Send on their own comment, do a quick
  pre-flight check: if someone else commented in the last few seconds,
  show a confirmation prompt ("Bob added a comment 5 seconds ago. Send
  yours anyway?") before posting.
  - This addresses the comment race-condition noted below (lost-update
    on the pipe-delimited Communication field) by *making the conflict
    visible* rather than preventing it. Race window shrinks from ~500ms
    to ~15–30s and users see what happened instead of silently losing
    data.
  - Pure client-side, ~80 lines, polls the existing Graph endpoint. No
    new backend, no Azure SignalR, no monthly cost.
  - GitHub / Jira / Linear all do this pattern on issue comments.

## Later

(empty)

## Done / shipped

When an item ships, move it into the corresponding CHANGELOG entry in
`src/data/changelog.ts` and delete it from this file. Don't keep a
"shipped" section here — the changelog is the record of what's done.

---

## Followups from the v0.2.0 batch

These are not formal backlog items, but flagging in case you want to track
them after a real-mode shakedown:

- **Comment race condition.** The `Communication` field is a single text
  blob that we read, prepend to, and write back. Two users commenting on
  the same task within ~500ms of each other can produce a lost-update
  where one comment overwrites the other. Same issue affects the Power
  App (same field, same write pattern), so this is not a regression. The
  "show me if someone else commented" feature in the Next-up section
  addresses this by making the conflict visible. A more durable fix
  would be either etag-based optimistic concurrency or moving comments
  to a separate SharePoint list — both bigger lifts.
- **Verify the parent-task field's actual internal name** in SharePoint.
  The mapper assumes `ParentTaskLookupId`; if the column is named
  something else (e.g. `Parent_x0020_Task_x0020_ReferLookupId`), update
  `src/lib/taskMapper.ts` and the GraphItemFields typedef.
- **Verify the multi-value related-projects field's internal name** —
  currently assumed to be `ProjectReference`. If it's not, same edits as
  above plus `ProjectReference` references throughout.
- **Verify the projects-list ID** and set `VITE_SP_PROJECTS_LIST_ID`. Run
  the lookup-discovery PowerShell snippet from CLAUDE.md once the parent
  app registration is in place.
- **Upload attachments to a SharePoint document library** in real mode.
  Today attachments are in-memory only (mock mode behavior). When the
  storage rules are decided, add the upload step inside `addComment` in
  `src/api/tasks.ts` — the `attachments` argument is already plumbed
  through; just needs the upload-to-SharePoint code.
- **Replace hardcoded admin allow-list** with SharePoint group
  membership. See `src/hooks/useIsAdmin.ts` for the current approach
  and TODO comment.
