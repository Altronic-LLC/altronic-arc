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

- **Add pictures and attachments to comments.** Users should be able to
  attach images and files when posting a comment. Eventually these will
  be stored in a SharePoint document library with specific naming/folder
  rules (to be defined later). For now, just stub the upload UI in the
  comment composer (file picker + drag-drop zone, image preview) and
  capture attachments in memory; the actual SharePoint storage wiring
  comes later when the storage rules are decided.

- **Full Project Reference support: parent + related + admin page.**
  Three related sub-items, build together:
  - **Parent Project Reference dropdown on task edit.** The existing
    `Parent_x0020_Project_x0020_ReferLookupId` field already drives the
    "Parent Project" display on cards and details. Add an editor: when
    creating or editing a task, the user picks a project from a dropdown
    populated from the Project Overview SharePoint list. Needs
    `VITE_SP_PROJECTS_LIST_ID` populated first (run the lookup-discovery
    PowerShell snippet from CLAUDE.md to find it).
  - **Multi-value "Related Projects" field.** The task has an additional
    `ProjectReference` field that's a multi-value lookup into the same
    Project Overview list. Display as a list of project chips on the
    detail view, with an "add" picker. Came back as `{}` empty in our
    PowerShell exploration — confirm the field's internal name and
    whether it's truly multi-value before building.
  - **Admin page to create new Project References.** Today, one person
    (manually) adds entries to the Project Overview list when a new
    project number is assigned. Expose this in the app as a dedicated
    `/admin/projects` route. Gating to be decided later — preferences
    in rough order: SharePoint group membership > permissions list > a
    hardcoded allow-list. The page shows the existing projects, lets
    authorized users add a new one (project number, title, any other
    fields the Project Overview list has). Non-authorized users just
    don't see the nav link or the page (404 if they navigate there
    directly).
  - Open questions to resolve before starting:
    - Internal field name of the multi-value "Related Projects" field
      (PowerShell lookup query against the task list's columns)
    - Schema of the Project Overview list (run the same column-listing
      query against its list ID)
    - Choice of admin gating mechanism

- **Parent/child task relationships with bidirectional links.** Tasks
  should be able to be tied to other tasks as parent/child (a task can
  have one parent task, and any number of child tasks). Both directions
  show as clickable links: open a child, see its parent at the top;
  open a parent, see a list of children. Also link references to
  Project References (parent + related) similarly — clicking the
  project chip on a task detail navigates to a project-overview page
  (which itself shows all tasks tied to that project).
  - The parent-task field already exists in SharePoint — no schema
    changes needed. Confirm the internal field name via column discovery
    before building.
  - Open questions to resolve before starting:
    - Project-overview page is a new route — confirm scope (just list
      tasks, or show project metadata + tasks?)
    - Cycle detection — prevent a task from being its own ancestor

- **Watch / unwatch a task.** A "Watch" button on the task detail view
  that adds the current user to the existing `Watchers` person-multi
  field on the SharePoint list. Unwatching removes them. This is what
  drives the existing Power Automate flows that email watchers on task
  updates — same field, same flows, no integration changes needed.
  Also surface "Active Watching: N" in the StatusPills as a filter
  (matches the existing Power Apps version's seventh pill).
  - Existing detail-view header already shows a static "N watchers"
    indicator — replace with a real toggle button labeled "Watch" /
    "Watching" depending on current state.
  - The signed-in user's identity comes from the MSAL account in real
    mode; mock mode uses the placeholder "You" user we already have.

## Later

(add new items here as they come up)

## Done / shipped

When an item ships, move it into the corresponding CHANGELOG entry in
`src/data/changelog.ts` and delete it from this file. Don't keep a
"shipped" section here — the changelog is the record of what's done.
