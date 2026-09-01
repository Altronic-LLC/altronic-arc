# Backlog

Queued work for upcoming releases. Items at the top are highest-priority /
next-up. When picking something up, move it to a release in `CHANGELOG.ts`
(via the changelog protocol in `CLAUDE.md`) and delete it from this list.

This is intentionally informal — a running list of "things we want, in
roughly the order we want them." No tickets, no story points. If an item
needs detail, add a sub-bullet underneath it.

---

## Next up

- **New-user onboarding instructions.** A single document new engineers
  (and the IT / admin person setting them up) can read end-to-end to go
  from "I have an Altronic email" to "I can fully use the app." Put it
  somewhere both end users and admins can find it — likely a new
  `docs/ONBOARDING.md` at the repo root and a "Getting started" section
  in the in-app User Manual (`src/views/ManualView.tsx`) that summarises
  the user-facing parts.

  Cover at minimum:
  - **SharePoint site access.** Which site each list lives on, the AD /
    Entra group memberships the user needs to read + write each list
    (Project Task List, Projects, Test Results, EIRs, Admins). What the
    admin runs to grant access. How to verify access before opening the
    app.
  - **Shared mailbox permissions** for the @-mention + Report-issue
    email features. Specifically: the user needs **Send-As + FullAccess**
    (with `-AutoMapping:$false`) on `automation@altronic-llc.com`.
    Include the exact PowerShell one-liner IT can run for a new user:
    ```powershell
    Add-RecipientPermission automation@altronic-llc.com -Trustee NEW.USER@altronic-llc.com -AccessRights SendAs -Confirm:$false
    Add-MailboxPermission   automation@altronic-llc.com -User    NEW.USER@altronic-llc.com -AccessRights FullAccess -AutoMapping:$false
    ```
    Document *why* both are required (Send-As alone fails Graph's
    delegated sendMail; see CLAUDE.md's @-mention section).
  - **Entra app consent.** What the user sees on first sign-in (the
    Microsoft consent prompt listing User.Read, Sites.Selected,
    Mail.Send.Shared, etc.), what to click, what to do if their tenant
    has admin-consent-required and the prompt is blocked.
  - **First-use checklist.** Open the app, sign in, hit the Dashboard,
    create a test task, comment with an @-mention, confirm the mention
    email arrives — a one-page "does it work" walkthrough.
  - **What goes wrong + how to self-diagnose.** Point at the in-app
    "Report issue" button (life-buoy icon), explain it captures console
    errors automatically. Common symptoms (loading hangs = sign-in
    issue, mention email didn't arrive = Send-As/FullAccess missing,
    etc.) and their fixes.

  Once written, link it from the README, the in-app Footer "Help" area,
  and reference it from CLAUDE.md so future Claude sessions know where
  to look.

- **Catch-up notification on app open.** When a user lands on the app
  after being away, surface a short "while you were gone" summary —
  new tasks assigned to them, new comments on items they're watching,
  EIRs that changed status, and anything @-mentioning them. Driven by
  the user's last-seen timestamp (stored per-user, probably in
  `localStorage` keyed by email + bumped on every full app load) and
  the `lastModifiedDateTime` already on every Task / EIR / comment.
  Render as a dismissible banner under the header on the Dashboard
  with deep links into the affected items. Avoid emails for this —
  this is the "I came back to the app" recap, not a push.

- **PWA installable.** Wire the app so users can install it from the
  browser (Edge "Apps" / Chrome "Install" / mobile "Add to Home
  Screen"). Concrete steps: add `public/manifest.webmanifest` with
  name, short_name, theme + background colour (Cooper Red on white),
  icons (192/512 PNG + maskable), `display: "standalone"`,
  `start_url: "/altronic-arc/"`,
  `scope: "/altronic-arc/"`. Link from `index.html`,
  add `<meta name="theme-color">`. Register a minimal service worker
  (consider `vite-plugin-pwa` — handles manifest + SW + auto-update
  pattern cleanly) with a network-first strategy for Graph calls and
  cache-first for the built assets. Verify Lighthouse PWA score and
  the install prompt appears in Edge on a fresh visit. Don't bother
  with offline mode for SharePoint data yet — installable + chrome-
  less window is the goal, offline-first is a separate, much bigger
  effort.

- **CMMS follow-ups from the first walkthrough** (Ray, 2026-08-28). Five action
  items. Status against what is already built is noted on each — two are small,
  two are substantial, one is already done in SharePoint and needs the ARC side.

  **RE-RUN DISCOVERY FIRST.** Ray has changed the three lists since the last
  snapshot: an `Asset Tag` column on the Equipment List (surfaced as a lookup
  on both maintenance lists), an hour-meter option on the schedule trigger, and
  a current hour-meter reading on the asset as a number. The snapshots in
  `scripts/*-schema.json` are now stale, and nothing here should be coded
  against a guessed column name:
  ```powershell
  ./scripts/discover-list.ps1 -ListName "Altronic Equipment List","Altronic Maintenance Tasks","Scheduled Maintenance" -Site pmo
  ```

  1. **Attachments on PM schedules (PM Library).** *Not built.* Attachments are
     already enabled on the Scheduled Maintenance list in SharePoint, and
     `AttachmentsSection` already exists — this only needs a
     `scheduledMaintenance` entry in `AttachmentParent` / `PARENT_CONFIG`
     (`src/api/attachments.ts`, on `SP_PMO_SITE_URL`) and the card wiring into
     the schedule UI. **Small.** Manuals and instruction sheets attached to the
     PM, rather than to each work order it raises.

  2. **Distinguish PM-raised work orders from unscheduled ones.** *Half built.*
     The **calendar** already has it — a Type filter of Scheduled / One-off /
     Both, reading `scheduleRef != null`. The **work-order list and board do
     not**: their filter bar is Equipment / Assigned / Category / Department /
     Search. Add the same axis there. **Small**, and the data is already
     present — no schema change.
     - Reuse the calendar's semantics exactly: "Scheduled" means
       `scheduleRef != null`, NOT the `TaskType` column, so starting a PM
       doesn't drop it out of the Scheduled view the moment it becomes real.

  3. **Run-hours scheduling, alongside Fixed and Floating.** *Not built, and it
     reverses an earlier decision* — the module deliberately shipped
     calendar-only, on the grounds that keeping a live meter reading on every
     asset is the hard part rather than the maths. Ray has now added the meter
     choice and a current-reading field, so the premise has changed. **Largest
     of the three build items.**
     - `lib/maintenanceSchedule.ts` gains a meter path beside the date one.
       Keep it in that same pure, tested module — it is the one place a bug
       means a PM silently never comes due.
     - **The real risk is a stale reading, not the arithmetic.** A meter PM
       whose reading is never updated never becomes due, and nothing on screen
       would say so. It needs a visible "reading as of <date>" and probably a
       warning when a meter-based schedule's reading is older than its own
       interval. Decide that before building.
     - Still open: **who updates the readings, and how often?** Manual entry
       from the floor, or a feed off the equipment? That question was the
       reason this was deferred the first time and it has not been answered.

  4. **ARC admin UI for assets, departments and locations** — move the register
     off the SharePoint back end. *Not built.* **Biggest item by far.**
     - Asset CRUD over 378 rows, plus managing the `Department` (9) and
       `Location` (62) choice lists from inside ARC.
     - Editing a CHOICE COLUMN's allowed values is a Graph column PATCH, not a
       list-item write — `scripts/Add-CMMSColumns.ps1` already does exactly
       this, so the mechanism is proven, but it needs a much bigger permission
       scope than item writes and should be admin-gated hard.
     - This is also the natural home for the **Location cleanup** already on
       the team's plate (duplicates like `HARNESS` / `HARNESS DEPARMENT` /
       `HARNESS DEPARTMENT`, and the 13 blank rows). A merge tool in the UI
       beats a PowerShell script somebody has to be talked through.
     - Careful: removing a choice value while rows still hold it leaves those
       rows carrying a value the column no longer offers. The scrub script
       already gets this order right (remap rows first, then prune) — the UI
       must too.

  5. **Asset tag number, to coordinate with finance.** *Done in SharePoint by
     Ray; the ARC side is outstanding.* Needs the type, mapper, `$select` and
     display once discovery confirms the internal names.
     - **Check what shape the "lookup in scheduled and tasks" actually is.** If
       it is a PROJECTED column off the existing `EquipmentRef` lookup
       (SharePoint's "add additional columns from the target list"), it is
       read-only and free — the right answer, and the same shape as the CRM
       lists' `Customer_x003a__x0020_SAP_x0020_` columns. If instead it is a
       SECOND independent lookup into the Equipment List, then a work order can
       name one asset by tag and a different one by name, and they can
       disagree. Confirm before mapping it.
     - Worth surfacing on the asset page and in the equipment picker's label —
       finance will search by tag, not by "40 HP COMPRESSOR".

## Later

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
- **Verify the Software Revision field's internal name** in SharePoint.
  Currently assumed to be `SoftwareRevision`. Power App labels it
  "Software Revision" but the column's internal name may differ.
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
