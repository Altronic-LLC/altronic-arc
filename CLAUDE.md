# Claude Code instructions for this repository

This file is the working manual for Claude Code when iterating on this app.
Read it before making non-trivial changes.

## What this app is

**ARC — the Altronic Resource Center** (*"Every team. One ARC. Always forward."*)
— a company-wide platform that unifies every Altronic department's tools behind
one Microsoft sign-in. Hosted on GitHub Pages, authenticated per-user via
Microsoft Entra ID, reads/writes SharePoint via Microsoft Graph.

**Engineering is the first team aboard** and is what's built **today**: a
SharePoint "Project Task List" viewer/editor (List + Kanban), EIRs, and Test
Sheets. The project's scope is expanding to more departments — read the next
section before reasoning about structure.

(Repo: `altronic-arc`; Pages base path `/altronic-arc/`; live at
<https://altronic-llc.github.io/altronic-arc/>.)

## Project direction — company-wide platform (read this)

This app is **no longer an Engineering-only tool.** It is becoming a single
company-wide platform the whole company (200+ people) uses through **one login**
(Entra ID SSO via MSAL, `Sites.Selected` on SharePoint via Microsoft Graph).
One codebase, one app — replacing what would otherwise be separate per-department
tools. Departments: Engineering (exists today), then Purchasing, Supply Chain,
Operations, Customer Service, with more SharePoint lists added over time.

### Data model — NOT department silos

This is **not** five isolated department silos. There is heavy cross-department
collaboration — multiple departments work on the same items. Some data is shared
company-wide; some is department-specific. Therefore:

- **Do not assume one-list-per-department isolation.** Assume a mix: some
  SharePoint lists are shared across departments, some are department-scoped.
  Permission scope is decided **per-list**, not by a blanket rule.
- **Role-based field-level permissions are a core, load-bearing pattern** — not
  an Engineering-only feature. The same item may be edited by multiple
  departments, each able to edit only certain fields. The existing **EIR
  field-permission system** (`useMyEirRoles` + the `disabled`/`disabledHint`
  gating in `EirDetailView`, backed by the EIR Roles list) is the foundation to
  **generalize from**.
- **SSO/group membership drives UI navigation only** (which dashboards/tools a
  user sees) — for UX, **not** security. The bundle is static and readable by
  any authenticated user. **Real enforcement lives at the SharePoint/Graph
  permission layer, per list.** Never treat client-side gating as a security
  boundary.

### Architecture rules as departments are added

- **Each department is a lazy-loaded route bundle (code-split).** Do this when
  adding the first new department — now, not "eventually." **No cross-department
  imports** between department bundles.
- **Shared layer** (auth, Graph client, React Query config, UI kit, shared
  types) is imported *by* departments; **nothing in the shared layer imports
  back into a department.** One-way dependency only.
- **Keep the existing per-list pattern:** `api/<list>.ts` module + React Query
  hooks (`use<List>`) + views, one set per SharePoint list. New lists follow it.
- **Preserve the `USE_MOCK` boundary** so new department features can be built
  and demoed against mock data before the real SharePoint list exists.

### Default questions when adding a department or list

When asked to add a department or a list, **default to asking first**:
1. Is this list **shared** across departments or **department-scoped**?
2. **Which fields are editable by which roles?**

Don't assume isolation — confirm scope and per-field role permissions up front.

## The mock/real boundary

The single most important architectural rule:

> **Every API call goes through `src/api/tasks.ts`, which branches on
> `USE_MOCK` (from `src/api/config.ts`).**

`USE_MOCK` is `true` by default and `false` when `VITE_USE_MOCK=false` in
the environment. No other file should care which mode it's in.

When adding a new operation (e.g. updating attachments):
1. Add the function to `src/api/tasks.ts`.
2. In the function, do `if (USE_MOCK) { ...mock impl... } else { ...graph impl... }`.
3. Add a React Query hook in `src/hooks/useTasks.ts`.
4. Use the hook from components.

This pattern keeps the mock and real implementations explicit, side by side,
in one place — easy to compare, easy to keep in sync.

## Backlog (`BACKLOG.md`)

Queued work that hasn't been picked up yet lives in `BACKLOG.md` at the
repo root. It's an informal running list — no tickets, no points.

**When the user asks to "queue something up" or "add to the list":**
1. Open `BACKLOG.md`.
2. Add a new item under `## Next up` (or `## Later` if they say so).
3. Use a short title + a sub-paragraph of context if helpful.
4. Do NOT make a code change for the item — just record it.
5. Commit the BACKLOG.md update on its own with a message like
   `docs: queue <thing> in backlog`. No changelog entry needed for
   backlog edits — they describe future work, not shipped work.

**When the user asks to pick something up from the backlog or work on
"the next thing":**
1. Open `BACKLOG.md` and pick the top item under `## Next up`.
2. Implement it following the normal protocol (changelog entry +
   matching commit message).
3. Delete the item from `BACKLOG.md` in the SAME commit.
4. The commit message and changelog entry describe what was built; the
   `BACKLOG.md` delete is automatic cleanup.

Never leave items in both places. The changelog records what shipped;
the backlog records what hasn't.

## Changelog protocol (REQUIRED on every change)

The app shows its current version in the footer, with a "View history" modal
that lists all releases. This is driven by `src/data/changelog.ts`.

**From now on, every user-visible change must be versioned and recorded in
`src/data/changelog.ts` before it is pushed.** This includes UI text, layout,
navigation, feature visibility, and any change that affects what users see or
how they interact with the app.

**Every time you make a user-visible change, you MUST do both of these:**

### 1. Add a changelog entry

1. Open `src/data/changelog.ts`.
2. Add a new entry at the **top** of the `CHANGELOG` array (newest first).
3. Bump the version using semver-lite:
   - PATCH (0.1.0 → 0.1.1): bug fix, copy change, small UI polish
   - MINOR (0.1.x → 0.2.0): new feature (added view, new editor, etc.)
   - MAJOR (1.x.x → 2.0.0): rework, breaking data-model changes
4. Use today's date in `YYYY-MM-DD` format.
5. Write each change as a one-liner from the user's POV (not "refactored
   useTasks hook" but "tasks now reload after a network blip").
6. Group related changes in one entry. If you're only making one tiny
   fix, that's still its own entry.

### 2. Use the same content in the commit message

The Git commit message must mirror the changelog entry so the Git log
stays readable without opening the app. Format:

```
v<version>: <short summary>

- <change 1>
- <change 2>
- <change 3>
```

The short summary is a one-line description that fits in the 50-char
GitHub commit-list column. The bullet list below is the SAME bullets you
just put in `CHANGELOG`. Example:

```
v0.2.0: add person picker for task assignment

- Add user dropdown when editing a task's Assigned field
- Show current assignees as removable chips on the detail page
- Fix Kanban card text wrapping for long assignee lists
```

When you run `git commit`, use the multi-line `-m` syntax or write the
message in `git commit -F-` heredoc style so the bullets are preserved.
Do NOT collapse everything onto one line.

### 3. Bump `public/version.json` to the SAME version

This file is the deploy-detection signal. `useVersionCheck` polls
`public/version.json` and, when its `version` differs from the running
bundle's `CURRENT_VERSION`, shows the "A new version of ARC is available"
banner so users refresh to the latest build.

**It must always equal the version you just put at the top of `CHANGELOG`.**
If you bump the changelog but forget this file, every user already on the
new build sees a spurious "new version available (old number)" banner
(the two version sources have drifted). Update it in the SAME commit:

```json
{ "version": "0.35.5" }
```

There is no changelog/commit exception here — whenever you bump
`CURRENT_VERSION`, bump `public/version.json` to match.

**Skip the changelog AND short-form the commit** only for: internal-only
refactors with zero behavior change, dependency bumps without user impact,
comment edits, typo fixes in code comments. For these, a one-line commit
like `chore: tidy useTasks comments` is fine and no changelog entry needed
(and no `version.json` bump, since the version didn't change).
When in doubt, do the full protocol — it's free.

The footer reads `CURRENT_VERSION` automatically, so the two places you
change the version are the top entry of `CHANGELOG` and `public/version.json`
— and they must always match.

## File-by-file overview

Keep this current when adding/removing files (see "Architectural changes"
below). Tests live next to their source as `*.test.ts(x)` and are omitted here.
This list went 85 files stale once — whole departments were missing — so when
you add a file, add its line in the same commit.

```
src/
├── main.tsx                      Entry: providers + installErrorCapture()
├── App.tsx                       Top-level routes (all pages wired here)
├── vite-env.d.ts                 TypeScript types for VITE_* env vars
│
├── auth/
│   ├── msalConfig.ts             Client ID, tenant, redirect URI, scopes
│   ├── AuthProvider.tsx          MSAL bootstrap + MsalProvider wrapper
│   ├── AuthGate.tsx              Blocks the app until signed in; shows SignInPage on expiry
│   └── SignInPage.tsx            Sign-in screen (first sign-in AND re-auth)
│
├── api/                          All mock/real branches live here (USE_MOCK)
│   ├── config.ts                 USE_MOCK, SITES registry, every list ID, role-enforcement flags
│   ├── graph.ts                  graphFetch / graphFetchAll, throttle retry, ONE shared interactive sign-in
│   ├── sharepoint.ts             SharePoint REST helper (list-item attachments)
│   ├── directory.ts              Tenant staff directory (Graph /users) for the pickers
│   ├── siteUsers.ts              On-demand SharePoint user resolution ("ensure user")
│   ├── currentUser.ts            Resolve the signed-in user's SP lookupId
│   ├── tasks.ts                  Engineering task CRUD
│   ├── taskColumns.ts            Task list column metadata / choice discovery
│   ├── eirs.ts                   EIR CRUD
│   ├── eirRoles.ts               EIR role tags (engineer / supply chain) CRUD
│   ├── testSheets.ts             Test Results CRUD
│   ├── admins.ts                 Admins list CRUD
│   ├── csaListings.ts            CSA Listings CRUD (Engineering certification register)
│   ├── drawingLogs.ts            Drawing File Logs — 4 registers, one parametrised module
│   ├── buildRequests.ts          Build Requests (master) CRUD
│   ├── buildRequestItems.ts      Build Request Items (detail) CRUD
│   ├── operationsTasks.ts        Operations Task List CRUD (PMO site)
│   ├── operationsProjects.ts     Operations Projects reference list
│   ├── operationsEquipment.ts    Altronic Equipment List — read-only reference
│   ├── teradyneLog.ts            Teradyne Log CRUD, year-scoped (Operations, PMO site)
│   ├── teradyneRefs.ts           Teradyne Employees/Products/Remarks (one parametrised module)
│   ├── panelOrders.ts            Panel Orders CRUD (panelTeam site)
│   ├── panelTasks.ts             Panel Tasks CRUD
│   ├── panelProjects.ts          Panel Project Reference list
│   ├── panelRoles.ts             Panel User Roles list CRUD
│   ├── projectFiles.ts           Documents-library project folders + files
│   ├── attachments.ts            List-item attachments (task | eir | csaListing) via SP REST
│   ├── email.ts                  Mention + change-alert mail; reports sends that FAIL
│   ├── errorReport.ts            "Report issue" mail to the app manager
│   └── editFailureReport.ts      Emails the user their input when a write can't be saved
│
├── data/
│   ├── mockData.ts               Sample tasks, EIRs, projects, people
│   ├── dashboardMockData.ts      Sample dashboard metrics
│   ├── csaMockData.ts            Sample CSA certification files
│   ├── drawingLogMockData.ts     Sample drawings + sketches (incl. sparse & full change logs)
│   ├── teradyneMockData.ts       Sample Teradyne log + reference rows
│   ├── operationsMockData.ts     Sample Operations tasks + projects
│   ├── panelMockData.ts          Sample panel orders + panel tasks
│   ├── buildRequestMockData.ts   Sample build requests + items
│   └── changelog.ts              Version history (drives footer + history modal)
│
├── hooks/
│   ├── useTasks.ts               Task queries + OPTIMISTIC mutations (see below)
│   ├── useEirs.ts                EIR queries + mutations (optimistic + undo)
│   ├── useEirRoles.ts            EIR roles CRUD + useMyEirRoles() (field gating)
│   ├── useCsaListings.ts         CSA Listings queries + admin-guarded mutations
│   ├── useDrawingLogs.ts         Drawing log queries + admin-guarded mutations
│   ├── useTeradyne.ts            Teradyne log + ref-list queries/mutations (+ usage counts)
│   ├── useOperationsTasks.ts     Operations task queries + mutations
│   ├── usePanelOrders.ts         Panel order queries + mutations
│   ├── usePanelTasks.ts          Panel task queries + mutations
│   ├── usePanelRoles.ts          Panel User Roles CRUD (admin-guarded)
│   ├── useBuildRequests.ts       Build Requests + Items queries/mutations
│   ├── useTestSheets.ts          Test sheet queries + mutations
│   ├── useAdmins.ts              Admins list CRUD
│   ├── useIsAdmin.ts             Is the signed-in user an admin? (+ useAdminAccess)
│   ├── useCurrentUser.ts         Signed-in user as a Person
│   ├── useDirectory.ts           Tenant directory for pickers (+ diagnostics probe)
│   ├── useTaskFiles.ts           Project-folder + list-item files for a task
│   ├── useProjectFolders.ts      Project-folder browsing queries
│   ├── useAttachments.ts         List-item attachment upload/list/delete
│   ├── useFilters.ts             URL-backed task filter state + filterSearch()
│   ├── useEirFilters.ts          URL-backed EIR filter state + eirFilterSearch()
│   ├── useSessionExpiry.ts       Shared "the token died" flag AuthGate watches
│   ├── useVersionCheck.ts        Polls version.json → update banner
│   ├── useUnseenMentions.ts      Unseen-@-mention badge state
│   ├── useTheme.ts               Dark/light toggle (localStorage)
│   └── useIsPhone.ts             Narrow-viewport media query
│
├── lib/
│   ├── cn.ts                     clsx + tailwind-merge helper
│   ├── communicationParser.ts    Parse/serialize the Communication field
│   ├── mentions.ts               @-mention parsing, recipients, rankMentionCandidates
│   ├── mentionDetector.ts        Detecting @-mentions in stored comment HTML
│   ├── people.ts                 Merge/dedupe Person lists (by lowercased email)
│   ├── itemSearch.ts             Shared multi-keyword all-fields search for list views
│   ├── adminAccess.ts            Bootstrap admin set (admins before the list loads)
│   ├── appUrl.ts                 Absolute in-app links that keep the Pages sub-path
│   ├── descriptionChecklist.ts   Checklist parse/toggle/stamp + sub-task indent
│   ├── taskMapper.ts             Graph item → Task
│   ├── taskNumbering.ts          NumberedTitle computation (the app owns that column)
│   ├── taskGraph.ts              Parent/child task relationships + cycle checks
│   ├── taskFilters.ts            Pure task filter predicates
│   ├── eirFilters.ts             Pure EIR filter/sort/count predicates (list + board)
│   ├── eirMapper.ts              Graph item → Eir (field-name quirks)
│   ├── eirNumber.ts              nextEirNo() — EIR_YYYY-#### auto-numbering
│   ├── eirPromotion.ts           EIR → Task promotion helpers
│   ├── testSheetMapper.ts        Graph item → TestSheet
│   ├── csaListingMapper.ts       Graph item → CsaListing (+ label, sort, search)
│   ├── drawingLogFields.ts       Per-register column descriptors (columns are DATA)
│   ├── drawingLogMapper.ts       Graph item → DrawingLogEntry + the 16-slot change-log codec
│   ├── buildRequestMapper.ts     Graph item → BuildRequest / BuildRequestItem
│   ├── buildRequestNumber.ts     Next BR No for a new Build Request
│   ├── buildRequestChecklist.ts  Build Request item checklist columns + progress
│   ├── operationsTaskMapper.ts   Graph item → OperationsTask
│   ├── operationsTaskFilters.ts  Pure Operations task filter predicates
│   ├── operationsTaskNumbering.ts Operations task numbering (mirrors taskNumbering)
│   ├── panelOrderMapper.ts       Graph item → PanelOrder
│   ├── panelTaskMapper.ts        Graph item → PanelTask
│   ├── panelRoles.ts             Panel role → editing-rights mapping (pure)
│   ├── teradyneMapper.ts         Graph item → Teradyne entities; derived titles
│   ├── spDates.ts                Shared SharePoint date-only helpers (midday-UTC rule)
│   ├── changeAlerts.ts           Change-alert email construction (pure)
│   ├── graphFields.ts            multiPersonField / multiLookupField / multiChoiceField
│   ├── sanitiseHtml.ts           DOMPurify wrapper for stored HTML
│   ├── richText.ts               Plain text ⇄ HTML for the EIR rich-text columns
│   ├── errorBuffer.ts            Bounded console-error capture (Report issue)
│   └── pcbChecklist.ts           PCB-category task checklist logic
│
├── types/
│   └── task.ts                   All domain types + constants (Task, Eir, Panel*, …)
│
├── components/
│   ├── Header.tsx                Top nav (departments menu, view switcher, theme, Report issue)
│   ├── Footer.tsx                Maintainer contact + version → changelog modal
│   ├── UserMenu.tsx              Account avatar menu
│   ├── Toast.tsx                 Toast + undo container (pushToast)
│   ├── UpdateAvailableBanner.tsx "A new version of ARC is available"
│   ├── LoadingTasks.tsx          Skeleton loading state
│   ├── RequireAdmin.tsx          Route guard for /admin/*
│   ├── DetailTopBar.tsx          Shared "you are here" bar on detail pages
│   ├── StatusPills.tsx           Task list status counters
│   ├── OperationsStatusPills.tsx Operations equivalent
│   ├── FilterBar.tsx             Task Project / Assigned / Search / Created By filters
│   ├── EirFilterBar.tsx          EIR Project / Engineer / Search / Reporter filters
│   ├── EirViewTabs.tsx           EIR workflow view tabs + counts (list + board)
│   ├── SearchInput.tsx           Shared debounced search box
│   ├── SearchableSelect.tsx      MultiSelect / SingleSelect / ChoiceSelect (all searchable)
│   ├── SuggestInput.tsx          Text field that behaves like a choice field (CAD initials)
│   ├── AutoGrowTextarea.tsx      <textarea> that grows to fit content
│   ├── RichTextEditor.tsx        Bold/italic/underline/lists editor (EIR text fields)
│   ├── useFileDrop.ts            Drag-a-file-onto-a-card drop target (attachments)
│   ├── PersonMultiField.tsx      Multi-person picker (pills + add)
│   ├── useOverlayDismiss.ts      Backdrop dismissal that survives a text-selection drag
│   ├── DescriptionView.tsx       Renders a Description incl. checklists + sub-tasks
│   ├── TaskRow.tsx               One task row (list view)
│   ├── KanbanCard.tsx            One Kanban card
│   ├── OperationsTaskRow.tsx     One Operations task row
│   ├── OperationsKanbanCard.tsx  One Operations Kanban card
│   ├── PanelOrderRow.tsx         One panel order row
│   ├── PanelTaskRow.tsx          One panel task row
│   ├── BuildRequestRow.tsx       One build request row
│   ├── BuildRequestItemCard.tsx  One part on a build request
│   ├── EirRow.tsx                One EIR row (EIRs list)
│   ├── EirKanbanCard.tsx         One EIR card (EIRs board)
│   ├── TaskFormModal.tsx         Create/edit task
│   ├── TaskResolutionModal.tsx   "Mark complete" resolution capture
│   ├── OperationsTaskFormModal.tsx  Create/edit Operations task
│   ├── PanelOrderFormModal.tsx   Create/edit panel order
│   ├── PanelTaskFormModal.tsx    Create/edit panel task
│   ├── BuildRequestFormModal.tsx Create/edit build request
│   ├── BuildRequestItemFormModal.tsx  Add/edit a part
│   ├── EirFormModal.tsx          Create/edit EIR
│   ├── PromoteEirModal.tsx       Promote an EIR into a task
│   ├── TestSheetFormModal.tsx    Create/edit test sheet
│   ├── CsaListingFormModal.tsx   Create/edit a CSA listing (+ attachments when editing)
│   ├── DrawingLogDetailModal.tsx Drawing detail + change log (+ record a change)
│   ├── DrawingLogCreateModal.tsx Add a drawing to a register
│   ├── DrawingLogFields.tsx      Descriptor-driven detail grid + form inputs
│   ├── TeradyneLogFormModal.tsx  Create/edit a Teradyne log entry
│   ├── CommentThread.tsx         Sorted comment list + inline edit (own mention picker)
│   ├── CommentComposer.tsx       New-comment editor (+ @-mentions)
│   ├── AttachmentsSection.tsx    EIR/comment attachments UI
│   ├── TaskAttachmentsSection.tsx  Task attachments (dual storage)
│   ├── PcbChecklistCard.tsx      PCB checklist on a task
│   ├── NotifyAppManagerButton.tsx  "Report issue" button + modal
│   ├── MermaidDiagram.tsx        (legacy) Mermaid renderer
│   ├── atoms.tsx                 Badges, chips, status colours
│   ├── operationsAtoms.tsx       Operations-specific badges/chips
│   ├── panelAtoms.tsx            Panel-specific badges/chips
│   ├── buildRequestAtoms.tsx     Build-request-specific badges/chips
│   └── brand/{Brandmark,Wordmark}.tsx   Official Altronic marks
│
├── views/
│   ├── DashboardView.tsx         Landing dashboard (metric cards + breakdown)
│   ├── ListView.tsx              Engineering task list
│   ├── KanbanView.tsx            Engineering task board
│   ├── DetailView.tsx            Task detail (description, sidebar, comments)
│   ├── PrintTaskView.tsx         Chrome-less printable task page
│   ├── ProjectView.tsx           Single-project task rollup
│   ├── ProjectFoldersView.tsx    Nested browser over the Documents library folders
│   ├── EirsView.tsx              EIRs list — View tabs, status pills, filter bar
│   ├── EirKanbanView.tsx         EIRs board — one column per EIR status, drag to set it
│   ├── EirDetailView.tsx         EIR detail (+ role-gated fields, see below)
│   ├── CsaListingsView.tsx       CSA Listings table (Engineering, admin-gated writes)
│   ├── DrawingLogsView.tsx       Drawing File Logs — four tabbed registers
│   ├── PrintDrawingSheetView.tsx CAD Drawing Work Sheet (FORM #E006), letter portrait
│   ├── BuildRequestsView.tsx     Build Requests list
│   ├── BuildRequestDetailView.tsx  One request + its parts
│   ├── BuildRequestItemRedirect.tsx  Deep-link target for part-comment emails
│   ├── PrintBuildRequestItemView.tsx  One part per page, for the floor
│   ├── OperationsListView.tsx    Operations task list
│   ├── OperationsKanbanView.tsx  Operations task board
│   ├── OperationsDetailView.tsx  Operations task detail
│   ├── TeradyneLogView.tsx       Teradyne Log table + "Manage lists" menu
│   ├── TeradyneRefListView.tsx   Edit one Teradyne reference list (:kind)
│   ├── PanelOrdersView.tsx       Panel Orders list
│   ├── PanelOrderDetailView.tsx  Panel order detail
│   ├── PanelTasksView.tsx        Panel Tasks list
│   ├── PanelTaskDetailView.tsx   Panel task detail
│   ├── TestSheetsView.tsx        Test sheets list
│   ├── TestSheetDetailView.tsx   Test sheet detail
│   ├── AdminProjectsView.tsx     Admin → Project References
│   ├── AdminOperationsProjectsView.tsx  Admin → Operations Projects
│   ├── AdminPanelProjectsView.tsx  Admin → Panel Projects
│   ├── AdminPanelRolesView.tsx   Admin → Panel User Roles
│   ├── AdminAdminsView.tsx       Admin → Admins
│   ├── AdminEirRolesView.tsx     Admin → EIR Roles
│   ├── AboutView.tsx             In-app architecture + ER diagrams
│   └── ManualView.tsx            In-app user manual
│
└── styles/
    └── globals.css               Tailwind + CSS variable theme tokens + @page (letter)
```

### EIR list views (workflow tabs)

Both EIR views have a **View** tab bar (`EirViewTabs`) at the top, driven by a
`view` URL param. The bucket predicate is `matchesEirView(eir, view)` in
`src/lib/eirFilters.ts` (unit-tested):

- **All** — no extra filter.
- **New** — no project reference AND no engineer assigned (fresh, needs triage).
- **Needs Assigned** — has a project reference but still no engineer assigned.
- **At Risk Parts** — `riskPart === "Active"` (mirrors the SharePoint "At Risk View"); grouped by RiskPart Level (Unassigned, then Level 1/2/3), each group collapsible.
- **LTB** — `ltbDate != null` (any EIR with a last-time-buy date set); sorted soonest-first. The LTB date also shows as a chip on EIR cards (`EirRow`).

Views compose with the status pills and the filter bar; all three axes live in
the URL so a view is shareable. To add another view: extend the `EirView` union
+ `matchesEirView` predicate in `lib/eirFilters.ts`, add an entry to the `tabs`
array in `EirViewTabs.tsx`, and document it here and in the EIRs section of
`ManualView.tsx`.

### EIRs: one filtered set, two views (list + board)

`EirsView` (`/eirs`) and `EirKanbanView` (`/eirs/kanban`) are two views of ONE
filtered set, exactly like List/Kanban for tasks. Everything they share lives
outside both of them, because two copies of a filter is how a fix reaches only
one view (see the @-mention pickers below):

- **`lib/eirFilters.ts`** — pure predicates: `applyEirFilters` (bar),
  `matchesEirView` (tab), `applyEirStatusFilter` (pill), `sortEirsForView`,
  `countEirsByStatus`, `collectEirPeople`. No React, no URL.
- **`hooks/useEirFilters.ts`** — the URL state (`q`, `project`, `reporter`,
  `engineer`, `view`, `status`) plus `eirFilterSearch()` for the switcher.
- **`EirFilterBar` / `EirViewTabs`** — the shared chrome above each view.

Two things that are deliberate:

- **`eirFilterSearch` carries everything EXCEPT `status`.** The task helper
  (`filterSearch`) only knows the task keys and would silently drop
  reporter/engineer/view — don't point the EIR switcher at it. `status` stays
  behind because on the board the columns ARE the statuses, so carrying
  `status=Closed` across leaves four empty columns, which reads as broken.
- **A drop writes Status through `useUpdateEirFields`** — no dedicated API
  function, since that mutation is already optimistic with rollback, toast,
  Undo and the watcher/engineer/reporter status-change email. Status is not
  one of the role-gated EIR fields, so any signed-in user can drag.

## Data model

The source of truth for field names and shapes is `src/types/task.ts`. The
SharePoint internal column names (which is what Graph returns under
`item.fields`) are:

| Domain field | SharePoint internal name | Notes |
|---|---|---|
| `id` | (from `item.id`, not fields) | Numeric string in Graph, parsed to int |
| `title` | `Title` | |
| `numberedTitle` | `NumberedTitle` | Writable text column, but the app owns it: format `T{n}-{projectRef}-{title}` where n = count of tasks already under the chosen project + 1. Form computes it; `createTask` writes it. |
| `description` | `Description` | HTML or plain text |
| `status` | `Status` | One of `STATUSES` |
| `priority` | `Priority` | One of `PRIORITIES`, nullable |
| `category` | `Category` | One of `CATEGORIES`, nullable |
| `labels` | `Labels` | **Single-value `choice`, NOT multi** — the wire value is a bare string (`"documentation"`). Verified against the live list 2026-08-14. Writing an array 400s; `";#"`-joining 400s too (not an allowed choice). The domain keeps `Label[]` for rendering but holds at most one. Read/write ONLY through `fromLabelsField`/`toLabelsField` in `src/lib/labels.ts`. |
| `dueDate` | `DueDate` | ISO 8601 string |
| `assigned` | `Assigned` | Person-or-group (single or multi), shape varies |
| `watchers` | `Watchers` | Multi-person |
| `parentProject` | `Parent_x0020_Project_x0020_ReferLookupId` | Lookup, see below |
| `comments` | `Communication` | Pipe-delimited records, parsed in `communicationParser.ts` |
| `hasAttachments` | `Attachments` | Boolean |

### Allowed values (from PowerShell discovery)

- **Status:** `BACKLOG`, `SELECTED FOR DEVELOPMENT`, `In Progress`, `On Hold`, `Blocked`, `Complete`
- **Priority:** `Low`, `Medium`, `High`
- **Category:** Software, Hardware, UI, Drawing, Documentation, Field Trial, Build Request, Product Certification, Label Change, PCB
- **Labels:** bug, documentation, duplicate, enhancement, good first issue, help wanted, invalid, question, wontfix

These are mirrored as TypeScript const arrays in `src/types/task.ts`. Update
both places if the SharePoint choices change.

## The Communication field

A single string field on each task containing the entire comment thread.
Format (one record per comment, concatenated with no extra delimiter):

```
MM/DD/YYYY HH:MM:SS AM/PM|||Author Name|||author.email@domain|||<html>
```

- `parseCommunication()` splits it into `Comment[]` (newest first).
- `appendComment()` adds a new record to the end and returns the new full string.

When the user posts a comment, we fetch the current Communication value,
append, and PATCH it back as a single field update.

## Person fields

Person-or-group fields (`Assigned`, `Watchers`) come back in different shapes
depending on whether the column is single- or multi-person:

```ts
// Single
{ LookupId: 46, LookupValue: "Sarah Shaffer", Email: "..." }

// Multi
[ { LookupId: 46, ... }, { LookupId: 87, ... } ]
```

`parsePersonField()` in `taskMapper.ts` normalises to `Person[]` either way.

For writing: SharePoint person fields go in via `LookupId` only.

- **Single-person:** `{ "TesterLookupId": 46 }` — just the integer.
- **Multi-person:** `{ "AssignedLookupId@odata.type": "Collection(Edm.Int32)", "AssignedLookupId": [46, 87] }` — the **two-key** shape Graph v1.0 demands. The plain array (without the `@odata.type` annotation) and the older `{ results: [...] }` envelope both return a useless 400 invalidRequest.

**Always go through the helper.** `src/lib/graphFields.ts` exports `multiPersonField(fieldName, people)` and `multiLookupField(fieldName, ids)` — they emit the correct two-key shape every time. Don't hand-build the payload elsewhere; you will forget the annotation and lose hours debugging the same 400.

## Parent project resolution

The `Parent_x0020_Project_x0020_ReferLookupId` field is a SharePoint lookup
into the "Projects" list, which IS identified:
`6280c711-14f6-4546-b730-8781b9d3c960` (env `VITE_SP_PROJECTS_LIST_ID`, with
that value as the built-in default). Project titles resolve today.

Kept because the discovery recipe below is the one to reuse for the NEXT lookup
column on a list nobody has mapped yet:

```powershell
$siteId = "coopermachineryservices.sharepoint.com,ddb5fc80-ea51-4d56-b008-ce6a82af49b0,aa6b9467-3f57-4213-bbd4-60b94403421a"
$listId = "42fb8c19-5f33-4fdd-9ef7-df6f21433588"

$cols = Invoke-MgGraphRequest -Method GET `
  -Uri "https://graph.microsoft.com/v1.0/sites/$siteId/lists/$listId/columns"

$cols.value | Where-Object { $_.ContainsKey('lookup') } | ForEach-Object {
    "=== $($_['displayName']) ==="
    "  Target list ID: $($_['lookup']['listId'])"
    "  Column shown:   $($_['lookup']['columnName'])"
}
```

Paste the target list ID into `.env.local` as `VITE_SP_PROJECTS_LIST_ID`.
Once set, `listProjects()` in `tasks.ts` will resolve project names; without
it, project lookups show as empty strings.

## SharePoint identifiers

Already confirmed (don't change without re-verifying):

- **Tenant ID:** `bde86e02-c641-4952-97f2-99ea6d9b8e29`
- **Site ID:** `coopermachineryservices.sharepoint.com,ddb5fc80-ea51-4d56-b008-ce6a82af49b0,aa6b9467-3f57-4213-bbd4-60b94403421a`
- **Site URL:** <https://coopermachineryservices.sharepoint.com/sites/Altronic_Engineering>

### Multi-site registry (`SITES` in `src/api/config.ts`)

ARC is going multi-site — one SharePoint site per team. `Sites.Selected` is
granted **per site collection** (write, by an admin, via
`POST /sites/{siteId}/permissions`); a **subsite shares its parent collection's
grant**. New cross-site `api/<list>.ts` modules reference `SITES.<name>` (env-
overridable via `VITE_SP_*_SITE_ID`, else the documented default) instead of the
single `SP_SITE_ID`.

| `SITES` key | Team / ARC dept | Graph site ID |
|---|---|---|
| `engineering` | Altronic_Engineering | `…,ddb5fc80-ea51-4d56-b008-ce6a82af49b0,aa6b9467-3f57-4213-bbd4-60b94403421a` |
| `panelTeam` | ALTRONICPANELTEAM → Panels | `…,fdf31131-2076-4618-923b-a1856e6b0f2a,3eb6cb9c-6535-4c69-a8d7-e90b2f90a9eb` |
| `salesTeam` | ALTRONICSALESTEAM → Customer Service / Sales | `…,dd86bf69-a010-481a-9920-78b079c5ec1e,aa6b9467-3f57-4213-bbd4-60b94403421a` |
| `salesOrderEntry` | ALTRONICSALESTEAM/OrderEntry (**subsite** of salesTeam — same collection, shares its grant) | `…,dd86bf69-a010-481a-9920-78b079c5ec1e,583688a6-3238-4f79-aed5-8e2d8ce38c41` |
| `pmo` | Altronic_PMO | `…,915a6183-2b71-4dfd-a8b9-181126dfbe78,3eb6cb9c-6535-4c69-a8d7-e90b2f90a9eb` |

(`…` = `coopermachineryservices.sharepoint.com`.) All granted **read + write**.
- **Task List ID:** `42fb8c19-5f33-4fdd-9ef7-df6f21433588`
- **Task List name:** Project Task List
- **Projects List ID:** `6280c711-14f6-4546-b730-8781b9d3c960` (env: `VITE_SP_PROJECTS_LIST_ID`)
- **Test Results List ID:** `52173cd3-74ca-4d30-95c4-7a6b2d765edc` (env: `VITE_SP_TEST_RESULTS_LIST_ID`) — drives the Test Sheets view and the "Create Test Sheet" button on tasks. Both Project Reference and Task Reference columns point back to the lists above, so creating from a task is just two `LookupId` writes.
- **EIRs List ID:** `8d00a762-288c-4678-afc4-cba2f24ac965` (env: `VITE_SP_EIRS_LIST_ID`) — Engineering Information Request list. Has its own Status / Resolution / Request Type workflows + a Communication field for comments. Project Reference is a lookup to the same Projects list; Task Reference is free-text. See `src/lib/eirMapper.ts` for the field-name quirks (`MFGP_x002f_N`, `Current_x0020_Price`, truncated `Requested_x0020_Completion_x0020`, the `Priority` choice column vs `Priority0` numeric column). **EIR No** (`EIRNo`)
is generated on create as `EIR_YYYY-####` — the next sequence for the current
year (highest existing + 1) via `src/lib/eirNumber.ts` — and SharePoint's
calculated **EIR Log No.** derives from it, so we only write `EIRNo`.
- **EIR Roles List ID** (env: `VITE_SP_EIR_ROLES_LIST_ID`) — admin-managed list (Title = email, plus `DisplayName`, `Note`, and `Roles` text columns). `Roles` holds a lowercase CSV of role tags (`engineer`, `supply chain`). Gates which EIR fields a user may edit (see "EIR field permissions" below). Not yet created — set the env var once the list exists. Managed at `/admin/eir-roles`.
- **Shared mailbox** (env: `VITE_SHARED_MAILBOX`) — email address that @-mention notifications send FROM. See setup below.
- **App manager email** (env: `VITE_APP_MANAGER_EMAIL`) — recipient of "Report issue" reports sent from the life-buoy button in the header. Falls back to `ray.white@altronic-llc.com` if unset, so the button works on day one. Sent FROM the same shared mailbox, with the reporter CC'd. See `src/api/errorReport.ts`.

### Drawing File Logs (Engineering)

Four registers behind one tabbed screen at `/drawing-logs`, all on
`SITES.engineering`. IDs discovered live 2026-07-29.

| Log | env / id | Shape |
|---|---|---|
| CAD Drawings | `d1f818e9-a547-4277-a233-a9a790b79762` (1,000+ rows) | drawing + change log |
| CCC Drawings | `0ac690f8-1374-4df1-8057-35eb4220e54b` (105 rows) | drawing + change log |
| CEC Drawings | `5d2d478a-ae19-47a9-8836-453001b756dc` (263 rows) | drawing + change log |
| Engineering Sketches | `dc9c015c-5284-43b4-ab90-40d73d515896` (1,000+ rows) | sketch, **no change log** |

**The four registers share almost NO columns.** This looked like one shape with
variations and isn't:

| | CCC / CEC | CAD | Sketches |
|---|---|---|---|
| identifier | `Title` | `Title` **plus** separate `CADNumber` | `Title` |
| description | `DESCR` | `DrawingTitle` | — |
| part | `PARTNO` | — | — |
| size | `DWG_SIZE` | `SIZE` | `DWG_SIZE` |
| revision | `REV_NO` | `NewRevision` | — |
| dates | `DATE_ST`, `DATE_REV` | `DateCompleted`, `DrawingDATE`, `LogBookDate` | `DATE_ST`, `DATE_REV` |
| own fields | — | `NewDrawing`, `Software` | `SK_Num`, `V_CODE`, `VENTURA` |
| legacy id | `CCC_ID` / `CEC_ID` | `PrimKey` | `SK_ID` |
| change log | 16 slots | 16 slots | **none** |

So **the columns are DATA, not code**: each register declares its fields once in
`src/lib/drawingLogFields.ts`, and the mapper, write payload, `$select`, table,
detail panel and edit form are all driven from that. `DrawingLogEntry.values` is a
keyed map rather than fixed properties for the same reason. A fifth register
should be a descriptor and nothing else.

That structure exists because the first version mapped CAD with CCC's names and
every CAD field rendered blank — the failure mode of guessing that two
similar-looking lists match.

Note `CADNumber` is NOT a duplicate of `Title`: e.g. Title `"501 505"` vs
CADNumber `"501505"`. Both are shown.

**`By`, `EnteredBy` and `Software` are CAD-ONLY text columns that behave like
choice fields.** Declared `suggest: true`, which makes the form offer the values
already stored in that register (`suggestionsFor()` → `distinctValues()`, ordered
by frequency) while still accepting a new one — so a value entered today becomes a
suggestion tomorrow, with no list to maintain and no SharePoint Choice column to
keep in step. `SuggestInput` is the control. These three exist on CAD only;
declaring them elsewhere would put them in another register's `$select` and 400
the tab.

**`NewDrawing` is `readOnly`** — dropped from the new-drawing and edit forms
(Ray, 2026-07-30) while still showing on the detail panel, since existing rows
carry values.

**Change-log entries are editable in place** (`updateDrawingChange` →
`buildChangeUpdateFields`). Unlike appending, that writes ONLY the slot's three
columns — correcting a 1994 typo must not make 1994 the drawing's latest
revision. Clearing all three empties the slot and frees it for reuse, which is
the only way to undo a mistaken change on a fixed sixteen-slot log.

**The Drawing Work Sheet is a physical form, reproduced** —
`views/PrintDrawingSheetView.tsx` at `/drawing-logs/:kind/:id/print`, from Ray's
marked-up FORM #E006 REV. 7 (2026-07-30). Two rules come from that markup and
should survive future edits:

- **It prints everything the register holds.** The form Hoerbiger generates omits
  the `By` / `EnteredBy` initials and change slots 9–16 — both annotated "in DB
  but doesn't print". So the sheet renders all 16 slots (padded, not filtered:
  it's a fixed grid of ruled lines) and every CAD field including read-only ones.
- **Half of it is deliberately blank.** Prototype / Preliminary / Production, the
  checked-approved / entered-in-system / to-mylar dates, and the whole Print
  Distribution block have no SharePoint columns behind them and are filled in by
  hand. Printing them as empty ruled lines IS the feature — don't "clean up" the
  unbound fields.

`@page` in `globals.css` states `size: letter portrait` rather than relying on
the browser default, because a machine defaulted to A4 rescales the form.
**CAD only**: the labels are CAD's and the other registers have no
`By`/`EnteredBy`/`Software`, so pointing it at one would print blank rows.

A log with no configured id doesn't appear as a tab at all
(`availableDrawingLogs()`). All four are configured now, but that tolerance is
what let the screen ship useful while CAD's id was still unknown.

**Discovery gotcha worth remembering:** `/sites/{id}/lists` is PAGED. The
Engineering site has more lists than one `$top=200` page, and an unpaged call
silently returned a subset — which made CAD look missing when it was there all
along. `discover-list.ps1` now follows `@odata.nextLink`, and matches a list by
display name, URL name, OR the webUrl's trailing segment (SharePoint fixes a
list's URL at creation and keeps it through later renames, so the three drift
apart).

**The change log is 16 FIXED SLOTS across 48 columns**: `CH_DAT01…16`,
`CH_ECN01…16`, `CH_REV01…16`. That spreadsheet habit is contained entirely in
`src/lib/drawingLogMapper.ts` — everything above sees a `changes` array. Three
things it handles that will bite anyone who bypasses it:

- **Slots are sparse.** Real rows have gaps (01 and 03 used, 02 empty), so
  `nextFreeChangeSlot()` fills the FIRST gap rather than `highest + 1` — on a
  list with only sixteen slots, skipping one wastes it.
- **A slot counts as used if ANY of its three columns has a value.** A change
  with an ECN but no date is still a change.
- **There is no seventeenth slot.** `appendDrawingChange` re-reads the row before
  writing (so two people recording minutes apart don't target the same slot) and
  THROWS when full rather than overwriting the oldest entry. The UI disables the
  button and explains.

Recording a change also advances the row's own `REV_NO` / `DATE_REV`, because
otherwise the table disagrees with the change log beneath it.

**Two shapes, one type.** Sketches has no `PARTNO` / `DESCR` / `REV_NO` / `CH_*`
columns and carries `SK_Num` / `V_CODE` / `VENTURA` instead. `hasChangeLog` and
`hasSketchFields` on the `DRAWING_LOGS` spec drive which columns are selected,
written and displayed — writing a column a list hasn't got is a 400.

**Writes are admin-only**, in the view and in every mutation
(`useDrawingLogs.guard.test.tsx`). Reading and searching are open; search
deliberately covers the change log's ECNs, since "which drawing did ECN-0031
change?" is otherwise unanswerable.

### CSA Listings (Engineering)

`758defd2-693c-4324-9e0b-dd2a12c341fa` (env: `VITE_SP_CSA_LISTINGS_LIST_ID`) on
`SITES.engineering`. Schema discovered live 2026-07-29.

| Domain field | Column | Notes |
|---|---|---|
| `fileNumber` | `Title` | **The list repurposes Title as the CSA File Number** — there is no "title" anywhere in the domain type. |
| `product` | `Product` | text |
| `alsoCover` | `AlsoCover` | multi-line |
| `partNoIncluded` | `PartNoIncluded` | multi-line |
| `history` | `History` | multi-line |
| `dateCertified` | `DateCertified` | date-only; use `src/lib/spDates.ts` (midday-UTC rule) |
| `csaId` | `CSA_ID` | legacy id from the original data — **read-only, never written** |
| `hasAttachments` | `Attachments` | attachments are enabled on the list; kind `csaListing` in `api/attachments.ts` |

**Adding / editing / deleting is admin-only**, enforced in TWO places: the view
hides the controls (`useAdminAccess()`), and each mutation in
`useCsaListings.ts` re-checks `useIsAdmin()` and throws before touching the API —
the same defence-in-depth as `useAdmins` / `useEirRoles`, so a future screen or
bulk action can't write without the check. Pinned by
`useCsaListings.guard.test.tsx`. Reading and searching are open to any signed-in
user, and the real boundary remains SharePoint's per-list permissions. Search deliberately covers the
multi-line fields — a part number people are chasing lives in `PartNoIncluded`,
not in the file number, and the table can only show its first line.

**There is NO expiry column** on this list, and no expiry feature. A
`certificationExpiry.ts` (buckets, urgency sort, counts, tested) sat unwired here
from 2026-07-29 and was **deleted on 2026-07-30** at Ray's request rather than
kept waiting for a decision — dead code that looks load-bearing is worse than no
code. If expiry comes back, it needs the decision first: a new Expiry Date column
in SharePoint, or a rule deriving it from `DateCertified`. Recover the old
implementation from git history rather than rewriting it (`git log --
src/lib/certificationExpiry.ts`).

### Teradyne lists (Operations, PMO site)

Four lists on `SITES.pmo`, discovered live 2026-07-28
(`scripts/discover-teradyne-lists.ps1`). All env-overridable:

| List | env | Default ID |
|---|---|---|
| Teradyne Log | `VITE_SP_TERADYNE_LOG_LIST_ID` | `1fc8d786-cbc0-4c0d-8473-b1eb7aca8f3d` |
| Teradyne Employees | `VITE_SP_TERADYNE_EMPLOYEES_LIST_ID` | `1d7900c4-a6a0-4a14-86f7-62024d846a7a` |
| Teradyne Products | `VITE_SP_TERADYNE_PRODUCTS_LIST_ID` | `0113f8d2-4c8b-4bba-955f-323c90a91a16` |
| Teradyne Remarks | `VITE_SP_TERADYNE_REMARKS_LIST_ID` | `3d7ccd9a-e1d8-4faa-9d46-bcbf94d76e3b` |

Four things about this data that will bite if forgotten:

1. **Lookups come back as ids only.** `$expand=fields` returns
   `ProductLookupId: "201"` with **no** `LookupValue`, so display names must be
   joined client-side. `listTeradyneLog()` fetches the log + all three reference
   lists in parallel and returns entries with lookups already resolved. A lookup
   whose target is gone resolves to `(missing #n)` rather than null, so a
   dangling pointer stays visible.
2. **These are SINGLE-value lookups** — write a bare integer
   (`ProductLookupId: 201`). Do **not** use `multiLookupField`; the
   `Collection(Edm.Int32)` annotation is for multi-value lookups and 400s here.
   Employee 1 and Employee 2 are two separate columns, not one multi-value one.
3. **`Title` is app-derived on two lists.** Teradyne Log's Title is
   `{Product} - {Defective Parts}`; an Employee's Title is `{First} {Last}`.
   Both are writable text columns that no user types — `teradyneMapper.ts` owns
   the formats and every create/update recomputes them (same arrangement as
   `NumberedTitle` on Engineering tasks).
4. **`EnterDate` is a date-only column stored at midday UTC**
   (`2026-02-17T12:00:00Z`). Match that on write. Midnight UTC renders as the
   previous day for every US timezone — use `toSpDateOnly` / `parseSpDate` and
   format with `timeZone: "UTC"`.

**Volume — the log is fetched ONE YEAR AT A TIME.** Legacy history was imported
in 2026, taking the list past **16,000 rows**, and it grows. Almost all of that
is historical: ARC is for the current year's work, and the legacy rows are read
directly in SharePoint for reporting. So `listTeradyneLog(scope)` filters
server-side by `EnterDate` year and defaults to `CURRENT_YEAR_SCOPE()`.

**The year picker is ADMIN-ONLY** (Ray, 2026-07-28): the log is this year's log
for everyone, but admins can step back up to `ADMIN_YEARS_BACK` (5) years,
because an entry made on 30 December still needs correcting on 2 January and
would otherwise be unreachable. `?year=` is honoured only for admins and only
inside that range — non-admins always get the current year whatever the URL
says, and a past year shows a banner plus a one-click way back so it can't be
mistaken for "this year's entries are missing". The React Query key is scoped per
year, so mutations invalidate the `["teradyneLog"]` *prefix*.

**The date literal must be BARE, not quoted.** Graph is OData v4:
`fields/EnterDate ge 2026-01-01T00:00:00Z`. Quoting it (`ge '2026-01-01…'`)
makes it a string literal and SharePoint rejects the comparison — that shipped in
v0.72.0 and made the log fall back to downloading all 2,926 rows on a list well
under the 5,000-item threshold, so the "index it" advice was a red herring.
`scopeFilterVariants()` now tries bare first, then quoted, and both forms are
pinned by tests. Encode with `encodeFilter()`, not `encodeURIComponent` — the
latter turns the literal's colons into `%3A`, which some OData parsers reject.

**Above ~5,000 items `EnterDate` also needs an INDEX** (list settings → Indexed
columns): past the threshold SharePoint refuses to filter or sort on an unindexed
column however few rows match — which is where the PMO list now sits, so the
server-side filter is currently being refused.

That is a **performance** concern only, and is deliberately NOT surfaced in the
UI. When the filter is refused the API fetches the list and applies the same year
filter in the browser, so the user still sees exactly the year they asked for;
`filteredServerSide: false` + `filterError` are returned for diagnostics and
logged to the console, and `serverFilterUnavailable` remembers the refusal for
the rest of the page session so a doomed request isn't repeated on every load. An
earlier version showed a warning banner about this — it read as a fault when
nothing was actually wrong. Don't re-add it.

Two consequences worth remembering:

- **Lookup-usage counts have their own all-years query**
  (`listTeradyneLookupUsage`, keyed `["teradyneLookupUsage"]`). The delete guard
  on the reference lists asks "does ANY log row use this", and a product used
  only by 2019 rows is still in use — scoping that to the loaded year would make
  the guard confidently wrong. It selects only the four lookup-id columns, so
  16k rows is a small payload, and it only loads on the manage screens.
- **Anything time-windowed must match the loaded scope.** The dashboard card
  counts "this year", not a rolling 30 days: a 30-day window reaches into the
  previous year every January, which is no longer fetched.

Rendering is capped separately: `TeradyneLogView` shows `INITIAL_ROWS` (200) with
a "Show all" escape hatch, because thousands of rows × 10 cells makes typing in
the search box stutter. Filters and totals always run over the whole loaded
scope — only the rows put in the DOM are capped.

**Name and clock number are two pickers over the same person, and each fills the
other** (Ray, 2026-07-30). `Employee1Clock` / `Employee2Clock` are real columns
the app writes; the clock control is a `SingleSelect` over the Employees list
keyed on `ClockNum`, so picking a number sets the employee lookup and picking an
employee sets the number. Clearing either clears both — they identify one person,
and a name left behind a cleared number is exactly the mismatch this shape
prevents.

**The clock options are bare numbers — no name on the label** (Ray, 2026-07-30).
They briefly read `#Clock · Name`, which repeated what the Employee box beside it
already says. The employee picker's own label keeps `Name · #Clock · WorkCentre`,
because that one filters on label text and finding someone by number is the point.

Neither box is free text, so an entry can't carry a clock number that disagrees
with the employee record; a number is still maintained once on the Employees
list. It was a read-only display box until 2026-07-30 — the reason it isn't an
`<input>` now is the same reason it was read-only then.

Two details in `TeradyneLogFormModal`:

- Clock options are **deduped by number** — the legacy import can repeat one, and
  two options sharing a value makes the pick ambiguous.
- `clockOptionsWith()` prepends a **stand-in option for a stored number that
  matches nobody** (`9001 · not on the employee list`). The log keeps its own
  copy of the number, so an old entry can carry one whose employee was since
  renumbered or removed; without the stand-in the picker falls back to its
  placeholder, the entry looks like it never had a clock number, and saving
  quietly agrees. The clock state is still seeded from the entry being edited
  rather than re-derived on open, so an old entry keeps what it was logged with.

**"Altronic Part Number" lives in the `OldSAPNumber` column.** The field was
renamed for users (2026-07-28); the SharePoint column was deliberately NOT
renamed, since existing SharePoint views and anything reporting off the list
point at `OldSAPNumber`. The domain field is `altronicPartNumber` and the
mapping is pinned by tests in `teradyneLog.test.ts` / `teradyneMapper.test.ts`.
It's a separate value from `sapNumber` — don't collapse the two into one column
again; a fallback between them shows one under the other's heading.

**`IDRem` is writable; `IDEmp` and `IDProd` are not.** The remark number is a
code operators use, so it's entered when adding a remark and editable after —
which is why `readOnlyLegacyIdOf` in `teradyneRefs.ts` deliberately omits
`idRem` (re-applying the old value after an edit would silently revert it).
Employee and product legacy ids stay read-only import artefacts. Remark numbers
are NOT enforced unique — SharePoint doesn't, and no rule was specified.

**Who can do what on the log:** anyone signed in can **add** an entry and
**edit** one; only admins can **delete** (Ray, 2026-07-29). The asymmetry is
deliberate — an edit leaves a corrected record, a delete leaves nothing, so an
operator fixing their own typo at the bench shouldn't need an admin. Enforced in
the view AND in `useDeleteTeradyneLogEntry`'s `mutationFn`.

Use `useAdminAccess()` rather than `useIsAdmin()` wherever the UI would otherwise
say "you lack access" before the Admins list has loaded — it reports
`isResolving` so the message can wait. As ever this is UI-level gating;
SharePoint list permissions are the real boundary.

**An employee is findable by name OR clock number.** The picker filters on option
label text, so the label is `Name · #Clock · WorkCentre`; people on the floor
identify themselves by either. Don't shorten it back to just the name.

**Operator notes render inline** under Defective Parts. That dates from when the
form was admin-only and the pencil was the only way to read them; it's still the
better default for scanning a shift's failures.

The three reference lists are editable by **any signed-in user** from the
"Manage lists" menu on the Teradyne Log — no admin gate, by design. Deleting a
row is blocked while the log still references it (`useTeradyneRefUsage`), since
these lists don't have SharePoint referential integrity enabled. That guard also
holds while the log query is still loading, when every row would otherwise look
unused. `IDEmp` / `IDProd` / `IDRem` are legacy ids from the original import —
read and preserved, never written.

## Dates: always `DateField`, never `<input type="date">`

**Every date in the app is picked from a calendar. Never add a bare
`<input type="date">`** (Ray, 2026-08-14) — use `src/components/DateField.tsx`.

A native date input reports a COMPLETE value as soon as all three segments hold
anything, so typing the year of 05/01/2026 emits `0002-05-01` after the first
keystroke, then `0020-`, `0202-`, `2026-`. Fields that save on change PATCHed
each one. SharePoint DateTime can't store a year below 1900 and Graph rejects it
as a misleading `404 itemNotFound` — which reached users as "Couldn't save
changes — reverted. Graph 404 Not Found" on the EIR's LTB Date.

`DateField` has no text entry at all, so an out-of-range or half-formed date
isn't reachable. It speaks `yyyy-mm-dd` (`""` = unset) like the native input did,
takes `disabled`/`title` for role-gated fields, and forwards a ref to its trigger
for modal autofocus.

Date maths goes through `src/lib/dateInput.ts` — `parseIsoDate` / `toIsoDate`
build and read LOCAL dates. Don't use `new Date("2026-05-01")` (parses as UTC,
lands on the previous day in every US timezone) or `.toISOString().slice(0, 10)`
(same shift in reverse). `isCommittableDate` and the 1900–2999 bounds remain as
the last line of defence for any value arriving from elsewhere.

## EIR field permissions (roles)

Several EIR fields are edit-gated by role tags from the **EIR Roles** list:

- **Engineering Response**, **Technical Priority** → require the `engineer` role.
- **Buyer Code**, **Risk Part**, **Risk Part Level**, **LTB Date** → require the
  `supply chain` role.

These are editable on the EIR detail (the Part Details choice fields, gated via
`InlineSelectField`'s `disabled` prop; LTB Date is a sidebar date input gated the
same way, with `SidebarField`'s `locked` prop drawing the padlock) and also appear
on the New EIR form's Purchasing section. **Gating is detail-view only** — the New
EIR form deliberately leaves them open, so whoever raises the EIR can fill in an
LTB date; it locks to Supply Chain once the EIR is submitted.
Every other EIR field stays editable by any signed-in user. A user can hold
both roles. This is **UI-level gating only** — it disables/locks the controls;
it is not a server-side security boundary (a user with SharePoint write access
could still edit the column directly in SharePoint).

Pieces:

- `src/api/eirRoles.ts` + `src/hooks/useEirRoles.ts` — CRUD over the EIR Roles
  list (mock + real), mirroring the Admins feature. `useMyEirRoles()` resolves
  the current user's `{ isEngineer, isSupplyChain, enforced }`.
- `src/views/AdminEirRolesView.tsx` (`/admin/eir-roles`) — admin-gated UI to
  tag users. Only admins (`useIsAdmin`) can modify it.
- The field→role map lives **inline in `src/views/EirDetailView.tsx`**: the
  `EditableTextCard`/`InlineTextField` helpers take a `disabled`/`disabledHint`
  prop, and the view passes `enforced && !isEngineer` / `enforced && !isSupplyChain`.
  To gate another field, add the same `disabled` prop where it's rendered.
- **Lockout safety:** `EIR_ROLES_ENFORCED` (in `src/api/config.ts`) is
  `USE_MOCK || !!SP_EIR_ROLES_LIST_ID`. In real mode, until the list is
  configured, gating is OFF so nobody is locked out. Admins are NOT auto-granted
  roles — they must add themselves to the EIR Roles list to edit gated fields.

## @-mention email notifications

When a user posts a comment with `@SomeoneName` chips (picked from the mention dropdown in CommentComposer), the app POSTs `/users/{shared-mailbox}/sendMail` for each mentioned person. The mail comes from the configured shared mailbox via Send-As, so every recipient sees a consistent "From" address rather than the sender's personal mailbox.

**Recipients = every watcher + every @-mentioned person** (computed by
`commentNotifyRecipients()` in `src/lib/mentions.ts`), deduped by email, **minus
the comment's author** — even if the author is a watcher — **unless the author
explicitly @-mentioned themselves**. Each recipient carries a `reason`:
`"mentioned"` people get the "You were mentioned…" email; `"watching"` people get
a "New comment on…" variant. Mentioning someone still auto-adds them as a watcher
(so they keep getting future comment emails). Comment **edits** notify only the
*newly* added mentions, not all watchers.

This fires for comments on **six entities** — Engineering tasks, EIRs, Operations tasks, panel orders, panel tasks and build-request parts — wired in each of `useTasks` / `useEirs` / `useOperationsTasks` / `usePanelOrders` / `usePanelTasks` / `useBuildRequests` onSuccess → `notifyMentions()` in `src/api/email.ts` (20 call sites, all fire-and-forget). The HTML template (`renderMentionEmail`) is shared and parametrised on `kind: "task" | "eir"` (wording, callout label, and the "Open this task/EIR" button). Design notes: the header bar is **Cooper Red** (a near-black header gets washed to muddy grey by Outlook dark mode; saturated red survives), with the ARC wordmark + intro + tagline; the button URL is built from `import.meta.env.BASE_URL` so it keeps the `/altronic-arc/` Pages sub-path. The Report-issue email (`src/api/errorReport.ts`) shares the same red-header styling.

**One-time setup for the shared mailbox (Exchange admin task):**

1. Create the shared mailbox in the Exchange admin centre (the app uses `automation@altronic-llc.com`).
2. Under **Mailbox delegation → Send As**, add every user who can post comments.
3. In the Entra ID app registration, ensure `Mail.Send.Shared` is included in the requested scopes (already in `src/auth/msalConfig.ts`). The first user to send mail will trigger an admin-consent prompt for this scope — an admin needs to consent.
4. Set the repo variable `VITE_SHARED_MAILBOX` to the mailbox address.

If `VITE_SHARED_MAILBOX` is unset, the app falls back to a console.warn (real mode) or console.info (mock mode) — no mail goes out, comments still post normally.

**A send that FAILS is no longer silent** — see "Mail that doesn't send says so" under Cross-cutting rules. Step 2 above (Send As per user) is the one that bites in practice: a person who was never added notifies nobody, and before the toast existed nothing anywhere said so.

## Theming

Two themes, light and dark, controlled by a `.dark` class on `<html>`.
All colours flow through CSS variables defined in `src/styles/globals.css`
and exposed to Tailwind as `bg-bg`, `text-fg`, `border-border`, etc.
Adding a new colour means adding a CSS var first and then a Tailwind alias.

The accent colour is Cooper Red (`#CB2C30`). Cooper brand secondary colours
are available as Tailwind classes (`text-cooper-green`, `bg-ajax-yellow`, etc.).

## Cross-cutting rules (each one is here because a bug taught it)

These apply app-wide, not to one department. They were all learned from a real
report, and each has tests pinning it — if you change one, expect a test to
argue with you.

### Modal backdrops: use `useOverlayDismiss`, never a bare `onClick`

`<div className="fixed inset-0 …" onClick={onClose}>` LOSES USER WORK. The
browser fires `click` on the nearest common ancestor of `mousedown` and
`mouseup`, so selecting text in a field and releasing a few pixels outside the
dialog dispatches a click whose target is the overlay — and the modal closes with
everything typed in it. `e.target === e.currentTarget` does NOT save you: on that
drag the target genuinely IS the overlay.

`src/components/useOverlayDismiss.ts` requires the press, the release AND the
click to be on the overlay. Spread it on every modal overlay:
`<div className="fixed inset-0 …" {...useOverlayDismiss(onClose, busy)}>`. It is
applied to all 21 modals; a new modal must use it too.

**Also cap tall modals.** A modal whose content can grow (a change log, a long
description) needs `flex max-h-[calc(100vh-2rem)] flex-col` with the body in a
`min-h-0 flex-1 overflow-y-auto` scroller and the header/footer pinned OUTSIDE
it. Otherwise the dialog grows past the viewport and the header scrolls away,
taking its buttons with it.

### Every dropdown in a form is searchable

`SearchableSelect.tsx` exports three: `MultiSelect`, `SingleSelect`, and
`ChoiceSelect` — a drop-in for a plain `<select>` that maps `""` ↔ `null` so
callers keep their existing string state and takes bare string arrays for choice
constants. **Do not add a native `<select>` to a form.** 23 of them were
converted at once; there are none left in a modal.

- `clearable={false}` for a field that must always hold a value (a task's Status,
  an EIR's Request Type) — hides the clear button and makes re-picking a no-op.
- `disabled` greys it out for a form that's mid-save.
- Single-select shows a bare check, multi-select a checkbox. A checkbox on a
  single-select promises "tick several" and is wrong.
- Dropping a native `required` in favour of a picker is a FIX, not a regression:
  the browser's validation bubble was pre-empting the form's own message, so the
  better wording never appeared. Both the task form and the CSA form hit this.

### @-mentions: two pickers, one ranking

`rankMentionCandidates()` in `src/lib/mentions.ts` owns filtering, ranking and
the cap (`MENTION_CANDIDATE_LIMIT`, currently 50), and returns `total` +
`truncated` alongside the list. It was a silent `slice(0, 6)`, which made a
common first name unreachable in a 200-person tenant with nothing saying so.

**There are TWO mention pickers** — `CommentComposer` (new comment) and
`CommentThread` (editing an existing one). They had separate copies of the
filter, so the first fix reached only one of them. Change both, or better, change
the shared helper. If a cap ever bites, SAY SO in the list ("Showing 50 of 62 —
keep typing to narrow"); a silently truncated list reads as "that's everyone".

### Task filters live in the URL and must survive navigation

`filterSearch(search)` in `useFilters.ts` extracts the filter params
(`q`, `project`, `assigned`, `createdBy`) so links between List and Kanban carry
them. The switcher used to link to bare paths, which reset the filters — most
visibly the Assigned filter, which DEFAULTS TO THE CURRENT USER, so widening it
to "Anyone" got silently undone.

Two details: a present-but-empty `assigned=` is preserved (that's how "Anyone" is
encoded — drop it and the default comes back), and `status=` is deliberately NOT
carried, since the status pills are component state the URL isn't kept in step
with. Keep the URL as the source of truth — a filtered view being shareable is
promised in the manual.

### Task writes are optimistic; the form closes immediately

`useTasks.ts` patches the cache, then `reconcile()` lands the `Task` the write
returns, and only then invalidates. Four things worth not breaking:

- **Use the returned row.** Every task write returns the canonical `Task`.
  Throwing it away and waiting for `invalidateQueries` means waiting on a full
  list download before the true value shows.
- **Patch every cached list.** Use `getQueriesData`/`setQueriesData` against
  `TASK_LIST_FILTER`, not the exact key — several list queries can be cached.
- **Roll back only what you snapshotted.** Writing `[]` into a list query that
  had no data yet renders "no tasks" and then survives the rollback.
- **Don't clobber a sibling write.** `settleTasks()` skips reconcile/invalidate
  while another task write is in flight, because a row read before the second
  write was sent doesn't contain it.

`TaskFormModal`'s edit path fires its writes in PARALLEL (they touch different
columns) and calls `onClose()` without awaiting them. That's safe because a
failed write rolls its own field back and toasts, and React Query finishes
mutations after unmount. Validation still runs first.

### Description checklists: sub-tasks and attribution

- **Indent = sub-task.** A checklist line indented with tab, spaces or NBSP is a
  child of the item above it. ONE level only. `Tab` in the description indents,
  `Shift+Tab` outdents — but ONLY when the caret is on a checklist line
  (`indentChecklistLine`), because hijacking Tab everywhere traps keyboard users
  in the textarea.
- **A parent never auto-ticks.** Ticking a parent because its children are done
  would stamp a name and time on a box nobody clicked, and wipe a real person's
  record when a child is unticked. Parents show a read-only `1/2` count instead.
- **A manual edit is stamped like a click.** Typing `- [ ]` into `- [x]` used to
  move the box with no attribution, leaving any earlier stamp contradicting it.
  `stampManualChecklistEdits` re-stamps items whose state CHANGED and leaves
  everything else alone — including hand-edited timestamps, which are
  indistinguishable from real ones.
- Indentation and the post-`]` gap round-trip verbatim. This text lives in a
  SharePoint field and is re-parsed, so anything lossy corrupts real data.

### The EIR long-text columns are Enhanced rich text — write HTML

`Description`, `EngineeringResponse` and `WhereUsed` on the EIRs list are
**Enhanced rich text** columns (confirmed by Ray, 2026-08-18). They hold HTML,
and everything that renders them — SharePoint's own views, the original Power
Apps form, an email preview — renders it as HTML, where a bare newline is
insignificant whitespace. Text saved verbatim out of a `<textarea>` therefore
came back as one run-on block: *"When I saved my EIR the formatting was not
saved. All sentences/paragraphs were smooshed together"* (Jerrod Waldron,
2026-08-18).

The conversion lives in **`withRichText()` in `src/api/eirs.ts`**, deliberately
on the write path rather than in the SharePoint column — the column keeps its
type, and every other consumer of the list keeps working. Rules (all in
`src/lib/richText.ts`, all tested):

- **Plain text in → paragraphs out.** Blank line = new `<p>`, single newline =
  `<br/>`, everything escaped first.
- **Already-HTML values pass through** — the rich editor's output and legacy
  Power Apps content are left exactly as they are.
- **Checklist text stays plain.** `- [ ]` is parsed line-by-line out of the raw
  stored string, so wrapping those lines in `<p>` would silently kill every
  checkbox on the EIR. `keepsPlainText()` is that guard; don't remove it.

`RichTextEditor` (bold / italic / underline / lists, no dependency) is the
editor for these fields, and everything it emits goes through `sanitiseHtml`.
A field whose stored value is a checklist falls back to the plain textarea —
"Turn into checklist" makes that swap explicitly.

If another list turns out to have rich-text columns, reuse `toStoredRichText`
in that module's write path; don't re-derive it.

### Mail that doesn't send says so

`notifyMentions` / `notifyChangeEmails` return a `MailSendResult` and raise a
toast when a send fails. They used to `console.error` and return `void`, so a
comment that notified NOBODY looked exactly like one that notified everyone.
**Send-As on the shared mailbox is granted per user in Exchange**, so a new
starter's mentions silently went nowhere until an admin added them.

403/401 (or an `ErrorAccessDenied` body) is classified `"permission"` and gets a
message naming the grant to ask for; anything else is `"other"` and reported
separately, because access wouldn't fix a bad address or a throttle. An unset
`VITE_SHARED_MAILBOX` is deliberately NOT toasted — it breaks every notification
for everyone, so a per-comment toast would be noise rather than something one
person can act on.

### Session expiry: one prompt, then the sign-in screen

MSAL allows ONE interactive request at a time. The dashboard fires nine queries,
so when a token died each called `acquireTokenPopup` independently: one popup
opened and the other eight rejected instantly with `interaction_in_progress`,
leaving eight failed queries that only a manual Retry cleared.

`graph.ts` now serialises interactive sign-in behind a single shared promise —
every waiter re-reads the fresh token from the cache, so one prompt recovers the
whole page. `interaction_in_progress` is treated as "wait for the prompt already
open", not a failure. When the session IS dead, `AuthGate` renders
`SignInPage reason="expired"` rather than the app behind a banner, and signing in
clears the query cache so nothing comes back still showing the old errors.

## Common changes — recipes

### Add a new field to display on the task card

1. Confirm it exists on the SharePoint column list (PowerShell discovery).
2. Add the property to the `Task` interface in `src/types/task.ts`.
3. Map it in `toTask()` in `src/lib/taskMapper.ts`.
4. Add it to the mock fixtures in `src/data/mockData.ts`.
5. Use it in `TaskRow.tsx`, `KanbanCard.tsx`, or `DetailView.tsx`.

### Add a new mutation (e.g. update priority)

1. Add the function to `src/api/tasks.ts` (mock + real branches).
2. Add a React Query hook in `src/hooks/useTasks.ts`.
3. Use it from the relevant component.

### Add a new view

1. Create the view component in `src/views/`.
2. Add a `<Route>` in `src/App.tsx`.
3. Add a nav link in `src/components/Header.tsx`.
4. **Update the system-flow diagram in `src/views/AboutView.tsx`** so the
   new view appears in the architectural overview. See the rule below.

### Hook up the Header view switcher to add more views

Add another `<Link>` block in `src/components/Header.tsx`, matching the
pattern of the existing List and Kanban links.

### Architectural changes — REQUIRED: update the About page diagrams

`src/views/AboutView.tsx` is the in-app README. It renders two diagrams,
hand-built as React/SVG (we used to use Mermaid; replaced it because the
parser kept choking on edge cases):

1. **System flow** — defined by the `SYSTEM_TIERS` array near the top.
   Vertical tiers (User → React SPA → Auth & transport → SharePoint
   lists) with colour-coded chips.
2. **Data model** — a real ER diagram drawn on an SVG canvas. Tables
   come from the `SCHEMA_TABLES` array (each entry has hand-tuned
   `x` / `y` / `width` + columns); foreign-key relationships come from
   the `CONNECTIONS` array with crow's-foot cardinality. Both are at the
   top of `AboutView.tsx`.

**Anything that's structurally visible to a user belongs in these
diagrams. That means update the data at the top of `AboutView.tsx` in
the SAME commit when you:**

- Add or rename a route / view → add it to `SYSTEM_TIERS[].nodes`.
- Add a new hook category (e.g. `useTestSheets`, `useProjects`) → add it
  to the React SPA tier's Hooks chip.
- Add a new module in `src/api/` (e.g. a third SharePoint list API) → add
  it to the React SPA tier's API chip.
- Add a new SharePoint list → add a `SCHEMA_TABLES` entry with position
  + columns, AND add it to the SharePoint lists tier in `SYSTEM_TIERS`.
- Add a new column on an existing entity → add a row in that table's
  `columns` array (mind the height — neighbour positions may need a
  small `y` bump if the new column pushes the bottom edge into another
  table).
- Add a new foreign-key relationship between lists → add a `CONNECTIONS`
  entry with the FK column / target / cardinality.

Tip when positioning tables: each row is `ROW_HEIGHT` (22px) tall and the
header is `HEADER_HEIGHT` (50px). Total table height = HEADER + rows*22
+ ~6px padding — use that to budget vertical space between cards.

No code-review hand-wringing, no separate ticket — just edit the arrays
in the same commit. The footer "About" link is the source of truth that
new team members see when they want to understand the system.

### User-visible changes — REQUIRED: update the user manual

`src/views/ManualView.tsx` is the in-app User Manual end users see when
they click "User Manual" on the About page. Like the About diagrams, it
goes stale fast if we don't maintain it deliberately.

**Update the manual in the same commit when you:**

- Add a user-facing feature (new view, new form, new toolbar action).
- Change how an existing feature works (rename a field, move a button,
  change a default).
- Add/remove a keyboard shortcut.
- Change a notification path (email recipients, who gets pinged, etc.).
- Modify the filter / search semantics.

Sections in the manual are organised by user task — drop additions into
the right section rather than starting new ones. Keep section ids stable
so external links don't break. Tone: declarative, present-tense, "you do
X to get Y." Skip implementation detail.

## Attachments

Tasks store every uploaded file in TWO places at once. This is intentional —
the two storages serve different purposes and the redundancy is by design.

### 1. Project folder (Documents library)

Files land in `General/Project Folders/<Project Folder>/` on the site's
default Documents library. Each project folder carries a `Project Reference`
lookup metadata column tied to the Projects list — that's how the app
finds the right folder for a task's project. If no folder matches the
task's project, the file goes into a `Miscellaneous` folder with the
project code prefixed onto the filename so it stays findable by search.

Comment attachments use this path EXCLUSIVELY (they end up as
hyperlinks inlined into the comment body HTML, so there's no list-item
to attach them to).

Code: `src/api/projectFiles.ts`, hooks in `src/hooks/useTaskFiles.ts`.
Auth: standard Graph `Sites.Selected` — no extra scope needed.

### 2. SharePoint list-item attachment (SP REST)

Same file ALSO gets posted to the task list-item via the SharePoint REST
endpoint `/_api/web/lists(guid'<list-id>')/items(<id>)/AttachmentFiles`.
This makes the file visible inline on the task in the native SharePoint UI
and in any downstream automation that reads list-item attachments.

This path is **best-effort** — if the user's tenant hasn't admin-consented
to `AllSites.Manage` (Office 365 SharePoint Online), or `VITE_SP_SITE_URL`
isn't set, the list-item upload silently no-ops and the project-folder
copy still goes through. The mutation `useUploadTaskFile` always returns
the project-folder result so callers (incl. the comment composer) keep
working uniformly.

Code: `src/api/attachments.ts` (parametrised over `"task" | "eir"`).

### UI layout

The Attachments card on the task detail view shows two sub-lists:

1. **On this task (N)** — task-specific list-item attachments. Shown first
   because they're specific to this task vs. shared across the project.
2. **From `<folder name>` (N)** — project-folder files. Shown second.

Deletes are scoped per-storage — removing a file from "On this task" only
deletes the list-item attachment; removing from the project folder only
deletes the file in SharePoint. The other copy is untouched. This is by
design: users may want one but not the other to disappear.

### Adding a new attachment-related field

If you add a new attachment field to either entity, update:
1. `src/api/attachments.ts` (list-item path) or `src/api/projectFiles.ts`
   (project folder path), depending on which storage it lives on.
2. The Attachment table in `SCHEMA_TABLES` and any new connection in
   `CONNECTIONS` in `src/views/AboutView.tsx`.
3. The Attachments section in `src/views/ManualView.tsx`.
4. The changelog + this section.

## Known limitations / TODO

- **Rich-text comment editor:** The composer is plain text wrapped in `<p>`
  tags. The Power Apps version uses a full WYSIWYG. If you want feature
  parity, swap `CommentComposer.tsx` for a Tiptap-based editor.
- **Attachments — dual routing:** Tasks store uploads in TWO places at once
  (best-effort on the list-item side, source-of-truth on the project folder
  side). See **Attachments** section below for the full picture.
- **Workflow buttons** (New Test, New Field Trial, Form E028, Form E029)
  from the original app are intentionally not implemented in the MVP.
- **Detail views and admin screens still have native `<select>`s.** The
  modals were all converted to searchable `ChoiceSelect`; the inline pickers on
  the task / EIR / panel / build-request detail pages and two admin screens were
  not. Same swap when someone asks.
- **The no-access notice has no "check again".** A user whose SharePoint access
  was just granted has no way to re-check from the app short of knowing to
  reload, so the fix routes through whoever granted it.

## Testing standard

**This project targets 100% unit-test coverage** — lib, api, hooks, components,
and views. Every change ships with tests for the code being added or modified.
See `src/test/` for the runner setup (Vitest + React Testing Library +
jsdom + a shared provider wrapper at `src/test/render.tsx`).

Test files live next to source: `foo.ts` → `foo.test.ts`,
`Bar.tsx` → `Bar.test.tsx`. Coverage thresholds in `vite.config.ts` are
currently off pending a backfill of the existing codebase; once that lands,
they'll be flipped to 100% across the board and gate CI.

## Testing checklist when you change things

After any non-trivial change:

1. `npm run typecheck` — no TS errors
2. `npm run test` — full unit suite green
3. `npm run dev` — app loads with mock data, no console errors
4. Click around all three views (list, kanban, detail)
5. Try drag-and-drop on the Kanban (a card should move and persist)
6. Try adding a comment (it should appear at the top of the thread)
7. Toggle the theme (everything should re-skin cleanly)
8. `npm run build` — production build succeeds

For real-mode testing, set `VITE_USE_MOCK=false` and confirm:
- Login pops up on first navigation
- List loads from Graph
- A drag-and-drop status change persists in SharePoint
- A new comment appears in SharePoint when viewed in the original app
