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
│   ├── ecns.ts                   ECN CRUD + comments (Engineering) — no delete
│   ├── faits.ts                  FAIT CRUD + comments (Supply Chain) — no delete
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
│   ├── visitReports.ts           Visit Reports CRUD (Sales, salesTeam site) — no delete
│   ├── openOrdersFiles.ts        Open Orders SharePoint folder — list/upload/download
│   ├── openOrdersCustomers.ts    Open Orders managed customer list CRUD
│   ├── openOrdersRoles.ts        Open Orders role tags (report manager) CRUD
│   ├── grayMarketRequests.ts     Gray Market Requests CRUD + comments (PMO site) — no delete
│   ├── whereAmI.ts               Where am I? CRUD (Engineering out-of-office calendar)
│   ├── autoWatch.ts              Shared @-mention → watcher resolution (per-site)
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
│   ├── visitReportMockData.ts    Sample visit reports
│   ├── openOrdersMockData.ts     Sample open order lines + report customers
│   ├── grayMarketMockData.ts     Sample gray market requests
│   ├── whereAmIMockData.ts       Sample out-of-office entries (dated from today)
│   ├── ecnMockData.ts            Sample ECNs (rich-text fields, a revision)
│   ├── faitMockData.ts           Sample FAITs (empty Titles, as the live list has)
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
│   ├── useVisitReports.ts        Visit Report queries + mutations
│   ├── useOpenOrdersReports.ts   Parse an extract, generate + upload, download
│   ├── useOpenOrdersCustomers.ts Customer list + role CRUD (+ useMyOpenOrdersAccess)
│   ├── useGrayMarketRequests.ts  Gray Market queries, mutations + comment thread
│   ├── useWhereAmI.ts            Where am I? queries + mutations
│   ├── useEcns.ts                ECN queries + mutations (submitter-only notifications)
│   ├── useFaits.ts               FAIT queries + mutations
│   ├── useVisitReportFilters.ts  URL-backed Visit Report filters (+ filterSearch)
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
│   ├── eirTriage.ts              Chasing a new EIR until it has a project + an engineer
│   ├── eirStatusAlerts.ts        Response Accepted / Not Accepted work requests
│   ├── eirProjectReference.ts    Who may change an EIR's Project Reference (hard-coded)
│   ├── recipientAudit.ts         Checks configured alert addresses against the directory
│   ├── listWriteErrors.ts        A refused SharePoint write, in words
│   ├── ecnFields.ts              ECN column descriptors (field_2 … field_12 decoded)
│   ├── ecnMapper.ts              Graph item → Ecn, Log# parsing/sorting
│   ├── faitFields.ts             FAIT column descriptors (51 columns, 19 booleans)
│   ├── faitMapper.ts             Graph item → Fait
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
│   ├── visitReportMapper.ts      Graph item → VisitReport (+ RM/year options)
│   ├── grayMarketFields.ts       Gray Market column descriptors (columns are DATA)
│   ├── grayMarketMapper.ts       Graph item → GrayMarketRequest, and back
│   ├── grayMarketNumber.ts       nextGrayMarketLogNo() — GMR_YYYY-### numbering
│   ├── grayMarketAlerts.ts      Gray Market intake alert (new request → the config list)
│   ├── recipientList.ts         Parsing the env-configured recipient lists (shared)
│   ├── calendarGrid.ts           Shared month-grid maths for every calendar view
│   ├── whereAmI.ts               Where am I? mapper, grouping, date-range expansion
│   ├── visitReportFilters.ts     Pure Visit Report filter/group predicates (list + calendar)
│   ├── openOrders.ts             Open Orders maths — aging, rollups, repairs split, filenames
│   ├── openOrdersFields.ts       The 27 SAP extract columns as DATA (+ aliases)
│   ├── openOrdersParse.ts        Raw grid to OpenOrderLine[] + warnings (pure)
│   ├── openOrdersExcel.ts        The ONLY file that knows an upload is xlsx
│   ├── openOrdersWorkbook.ts     The master + per-customer workbook builders
│   ├── teradyneMapper.ts         Graph item → Teradyne entities; derived titles
│   ├── spDates.ts                Shared SharePoint date-only helpers (midday-UTC rule)
│   ├── changeAlerts.ts           Change-alert email construction (pure)
│   ├── graphFields.ts            multiPersonField / multiLookupField / multiChoiceField
│   ├── sanitiseHtml.ts           DOMPurify wrapper for stored HTML
│   ├── richText.ts               Plain text ⇄ HTML for the EIR rich-text columns
│   ├── errorBuffer.ts            Bounded console-error capture (Report issue)
│   ├── authErrors.ts             AADSTS codes that mean "fix your account", in plain English
│   ├── emailIdentity.ts          Matching a person to a stored address (sign-in name ≠ mailbox)
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
│   ├── VisitReportFormModal.tsx  Create/edit a visit report
│   ├── GrayMarketRequestFormModal.tsx  Raise a gray market request
│   ├── WhereAmIFormModal.tsx     Add/edit an out-of-office entry (+ date range)
│   ├── ProjectFolderFormModal.tsx  Create a project folder + tag its Project Reference
│   ├── EcnFormModal.tsx          Raise an ECN
│   ├── FaitFormModal.tsx         Raise a FAIT
│   ├── FieldEditModal.tsx        Shared "edit this card's fields" modal (Gray Market + ECN)
│   ├── YesNoField.tsx            A boolean column as two labelled Yes / No choices
│   ├── ChoicePills.tsx          Any short choice set as pills (Yes/No, Pass/Fail, …)
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
│   ├── visitReportAtoms.tsx      Customer-status chip (Sales)
│   ├── grayMarketAtoms.tsx       Request-status + Pass/Fail chips (Supply Chain)
│   ├── ecnAtoms.tsx              On-hold / flag / stock-disposition chips (ECNs)
│   ├── faitAtoms.tsx             Status / sign-off / first-pass chips (FAITs)
│   ├── VisitReportFilterBar.tsx  Shared filter bar for both Visit Report views
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
│   ├── VisitReportsView.tsx      Visit Reports list (Sales)
│   ├── OpenOrdersView.tsx        Open Orders Report Tool — upload, generate, download
│   ├── OpenOrdersCustomersView.tsx  The managed customer list (+ import from an extract)
│   ├── AdminOpenOrdersRolesView.tsx Admin -> Open Orders Roles
│   ├── GrayMarketRequestsView.tsx      Gray Market Requests list (Supply Chain)
│   ├── WhereAmIView.tsx          Where am I? — month grid on desktop, agenda on a phone
│   ├── EcnsView.tsx              ECNs list (search covers the descriptions)
│   ├── FaitsView.tsx             FAITs list (Supply Chain)
│   ├── FaitDetailView.tsx        One FAIT — five workflow cards, sign-offs, comments
│   ├── EcnDetailView.tsx         One ECN — workflow cards, attachments, comments
│   ├── GrayMarketRequestDetailView.tsx Gray Market request — workflow cards, comments, attachments
│   ├── VisitReportsCalendarView.tsx  Visit Reports month calendar (desktop only)
│   ├── VisitReportDetailView.tsx Visit report detail + attachments
│   ├── TestSheetsView.tsx        Test sheets list
│   ├── TestSheetDetailView.tsx   Test sheet detail
│   ├── AdminProjectsView.tsx     Admin → Project References
│   ├── AdminOperationsProjectsView.tsx  Admin → Operations Projects
│   ├── AdminPanelProjectsView.tsx  Admin → Panel Projects
│   ├── AdminPanelRolesView.tsx   Admin → Panel User Roles
│   ├── AdminAdminsView.tsx       Admin → Admins
│   ├── AdminEirRolesView.tsx     Admin → EIR Roles
│   ├── AdminNotificationRecipientsView.tsx  Admin → Notification recipients
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

**At Risk Parts IGNORES the status pill** (Ray, 2026-08-25). It is a REGISTER of
every part flagged `riskPart === "Active"`, whatever its EIR's status, mirroring
SharePoint's At Risk View — so narrowing it by status hid closed EIRs on at-risk
parts, which is exactly what that screen exists to list. Every other tab is a
work queue, where the pill is right.

The rule is `eirViewIgnoresStatus(view)` + `effectiveEirStatusFilter(view,
statusFilter)` in `lib/eirFilters.ts`, deliberately NOT a `view === "at-risk"`
ternary in the view: `EirsView` has no test file, so a ternary would ship
uncovered, and the PILL RENDERING has to agree with the row filtering or the
pills lie about what is on screen.

Three details that go with it:

- **The pills stay visible but inert** on that view, with a `title` explaining
  why. They're still a useful breakdown of what's on screen, and a highlighted
  "Closed" pill above Under Review rows would be worse than no pill at all.
- **`aria-disabled`, NOT `disabled`.** Chrome and Edge suppress the native
  tooltip on a disabled form control, so the one explanation of why the pills
  don't respond would never appear — and `disabled` drops them out of the tab
  order, hiding the counts from a keyboard or screen reader.
- **`?status=` IS cleared** when entering the view (`setView` deletes the key).
  Leaving it parked was the first attempt, on the theory that the selection
  stayed visible in the pills. It doesn't: those pills deliberately render as
  inactive there, so the filter was invisible and then silently re-narrowed the
  list the moment another tab was picked. Clearing it is the only version with
  no hidden state — caught in review, 2026-08-25.
- **The counts are computed pre-pill** (`countByStatus` / `openCount` read
  `filteredByView`), so on this view they already read as "every active at-risk
  part, broken down by status". Don't "tidy" them onto the filtered set.

The board never applied the status pill at all — its columns ARE the statuses —
so it needed no change.

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

This is not hypothetical. `setRelatedProjects` hand-built `{ ProjectReference: [ids] }` — bare array, un-suffixed name — so **a task's related projects never saved in real mode**, from whenever it was written until 2026-08-20, when two people hit it within an hour. It survived because the MOCK branch read that same hand-built shape, so every test and every demo passed. `tasks.relatedProjects.test.ts` now asserts the request shape with `USE_MOCK` forced off, which is the only way this class of bug is visible from a test.

## Hyperlink columns: never in the create POST, only a follow-up PATCH

`EIRReference` on the Task list (a Hyperlink column, written as
`{ Url, Description }`) is written correctly but at the WRONG TIME if it
travels in the same POST that creates the item — Graph does not support
setting a Hyperlink/Picture column's value at item-creation, and answers with
a bare `400 invalidRequest` naming no field. Confirmed live 2026-08-26,
promoting EIR_2026-0245 to a task: the whole create failed, so the task was
never created at all — not a partial write, the entire request rejected.

`createTask()` in `src/api/tasks.ts` now POSTs the item without `EIRReference`
(and without `Communication`, which happened to travel in the same failing
request and is moved out for the same reason rather than re-guessed at
separately), then issues a follow-up `PATCH` for both. This is the same
"another list's write is unsupported at create time" family as the Person
fields' `LookupId` shape above — this repo had never actually promoted an EIR
in real mode before, only against the mock store, which is why it went
undiscovered since the feature shipped in v0.36.0 (Jul 2026).

**The follow-up is best-effort, and it says so.** `createTask` throws a
`TaskFollowUpWriteError` (carrying the already-created `task`) rather than
silently swallowing the PATCH failure — the task is real at that point, so a
caller like `usePromoteEirToTask` catches it, still completes the promotion
(EIR stamp, notification, cache seed, navigation), and surfaces a toast naming
what didn't save (the EIR link and/or the carried-over discussion) instead of
the old console.error-only behaviour nobody watching the app would ever see.
Pinned by `tasks.eirReferenceWrite.test.ts` (the two-call shape, real mode)
and `useEirs.promote.test.tsx` (the warning path).

**Promoting an EIR also copies its attachments onto the new task** —
`copyAttachments()` in `src/api/attachments.ts`, added alongside this fix.
EIR files and task files live in two separate SP REST attachment stores (see
"Attachments" below), so nothing links them automatically; this downloads
each of the EIR's files and re-uploads them to the task. Best-effort per file
— one failed copy doesn't lose the rest, and a total or partial failure warns
rather than silently going missing, the same as the EIRReference/Communication
follow-up.

**And the promoted task must be seeded into the tasks-list cache
immediately, not just invalidated.** `useTask()` derives its data from the
same `["tasks", "list"]` React Query cache `useTasks()` populates, and
`PromoteEirModal` navigates to `/task/:id` the instant the mutation resolves.
An `invalidateQueries` call alone only schedules a background refetch, so that
navigation landed on a still-stale list without the brand-new task —
DetailView flashed "Task not found" until the refetch eventually caught up.
`useCreateTask` already carried the fix for ordinary task creation (see its
onSuccess comment); `usePromoteEirToTask` went through `createTask` directly
rather than that hook and needed the identical `setQueryData` seeding.

**Promoting also requires a parent project, same as New Task, for the same
reason `computeNumberedTitle` needs one** (`T{n}-{project code}-{title}`, see
`src/lib/taskNumbering.ts`): with no project, the code falls back to `"0000"`,
which is indistinguishable from a real project that happens to be numbered
0000. `TaskFormModal` already required a project on create; `PromoteEirModal`
didn't, and a promotion without one produced exactly that — reported
2026-08-26 as `EIR_2026-0069` promoting to `T3-0000-…`. Fixed by disabling
**Create task** (and validating in `handleConfirm`, belt-and-suspenders) until
a project is chosen, mirroring `TaskFormModal`'s `required={mode === "create"}`
treatment of the same field exactly.

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
| `salesTeam` | ALTRONICSALESTEAM → Customer Service / Sales (Visit Reports) | `…,dd86bf69-a010-481a-9920-78b079c5ec1e,aa6b9467-3f57-4213-bbd4-60b94403421a` |
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
- **EIR Roles List ID:** `e85aeb77-9dbf-4962-ade2-08cb977a5b79` (env: `VITE_SP_EIR_ROLES_LIST_ID`) — admin-managed list on the Engineering site (Title = email, plus `DisplayName`, `Note`, and `Roles` text columns). `Roles` holds a lowercase CSV of role tags (`engineer`, `supply chain`). Gates which EIR fields a user may edit (see "EIR field permissions" below). Managed at `/admin/eir-roles`.

  **The list EXISTS** — confirmed live 2026-08-24. This entry said "not yet created" for months and was wrong; the id above is the one the site returned. There is deliberately **no default in `config.ts`**: adding one turns EIR field gating ON at the next deploy, and every engineer not on the list would lose fields they can edit today. Set the env var only once the list is populated — that decision is Ray's, not a tidy-up.
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

### FAITs (First Article Inspection Tests)

`d655b5d6-ee28-45c4-85ab-128198569508` (env: `VITE_SP_FAIT_LIST_ID`) on
**`SITES.engineering`** — a **Supply Chain** feature whose list lives on the
Engineering site, not PMO. Worth writing down because PMO is where we looked
first and spent a while: 23 lists there, none of them it. Schema captured
2026-08-20 in `scripts/fait-schema.json`.

51 editable columns — **19 booleans**, 18 text, 6 choices, 3 lookups, 3 person,
2 dates — so the columns are DATA (`src/lib/faitFields.ts`), grouped into the
five cards the detail page renders: Part → Request → Inspection → Results →
Sign-off.

Four things about this list:

- **`Title` is empty on every row.** People identify a FAIT by SAP Part Number
  + Description, which is what the list view leads with and what `faitLabel`
  falls back through. The column is still read and written in case someone
  starts using it.
- **The three lookups are unused so far** — Project Reference, EIR Reference
  and Test Document Reference all exist and are blank on the 36 rows that
  predate ARC. The project filter will look empty until people fill them in;
  that's the data, not a bug.
- **`Communication` and `Watchers` were added for ARC** on 2026-08-20 via
  `scripts/add-fait-columns.ps1`. `Project Reference` and attachments already
  existed.
- **Two date-only columns** (`FailedFirstPassDate`, `WaivedDate`) go through
  the usual `parseSpDateOnly` midday pivot.

**Append Changes is the gotcha.** Graph reports
`appendChangesToExistingText: true` on the Communication column however it's
created, and a PATCH setting it false is accepted without error and changes
nothing. If that flag is genuinely on, the comment thread corrupts — ARC
rewrites the whole value each post, and append mode concatenates instead. It
could not be settled from the API, so **verify behaviourally**: post two
comments on a FAIT and confirm the second replaces rather than doubling the
thread. The list settings UI is the authority.

**No delete** — a FAIT records an inspection that happened; a superseded one is
closed. `faits.test.ts` asserts the module exports nothing matching
/delete|remove/.

### ECNs (Engineering Change Notices)

`f6917bf4-bdd1-4ff9-ba71-0a17b22b1ecc` (env: `VITE_SP_ECNS_LIST_ID`) on
`SITES.engineering`. **1,813 rows.** Schema captured 2026-08-19 in
`scripts/ecn-new-schema.json`.

**Every workflow column is called `field_N`.** The list came out of a
migration and the internal names carry no information whatsoever:

| Internal name | Actually is |
|---|---|
| `field_2` | Log# |
| `field_3` | On Hold |
| `field_4` | Final Assembly Part Numbers |
| `field_5` | Detailed Description (rich text) |
| `field_6` | Serial Numbers (rich text) |
| `field_7` | In House Stock |
| `field_8` | Field Returns Impacted (**boolean**) |
| `field_9` | Drawings Complete? (**boolean**) |
| `field_10` | Engineering Comments (rich text) |
| `field_12` | Sign-off status |

Plus **`ProjectReference`** — a genuine, readable name, because it was added
later (Ray, 2026-08-19) rather than arriving with the import. It's a **single**
lookup into the Projects list (`6280c711-…`), the same target Tasks and EIRs
use.

`src/lib/ecnFields.ts` is the ONLY place that translation exists, and the
mapper, write payload, `$select`, detail cards and create form all run off it.
**`field_1` and `field_11` don't exist** — dropped somewhere in the import.
Don't infer a column from the gap; selecting one that isn't there 400s the
whole read.

Five things that shape the feature:

- **No Watchers column, and no requester column.** So ECN comments notify the
  **submitter plus anyone @-mentioned, and nobody else** (Ray, 2026-08-19) —
  the one comment thread in ARC that doesn't follow the watcher rules. The
  rule is `ecnCommentRecipients` in `lib/mentions.ts`, deliberately NOT
  `commentNotifyRecipients`, and there is no watch button because there is
  nowhere to store a watch. A mention emails once; it doesn't subscribe.
- **The project is a SINGLE lookup.** Graph returns it as
  `ProjectReferenceLookupId` with no title attached, so the title is joined
  client-side against the loaded Projects list — exactly how a task's parent
  project works. Writing it is a **bare integer** (`projectPatch`), and `null`
  clears it; `multiLookupField`'s `Collection(Edm.Int32)` shape is for
  multi-value lookups and 400s here. It drives the ECN list's Project filter
  and the dashboard card's project scoping.
- **`submittedBy` is Graph's item-level `createdBy`**, which is why the read
  passes `$select=id,createdBy,…` alongside `$expand=fields(...)`. For the
  1,809 rows that arrived with the 2026-08-12 migration that's the migration
  account (Ray), not the engineer who raised the original notice. Fixing that
  properly needs a person column on the list.
- **The Log# is typed, never generated** (Ray, 2026-08-19). It reads `YY####`
  (`260059`) with an `R#` suffix on a revision (`260059R1`) — and a revision
  keeps the number of the notice it revises, so a generated "next number"
  would be wrong exactly when it mattered. The create form shows the latest
  number and refuses a duplicate; that's the whole enforcement.
- **Two columns are real booleans.** They're carried in `values` as `"Yes"` /
  `""` so the record stays one shape, and turned back into `true`/`false` on
  write. A create always sends both, because leaving the column null makes
  SharePoint's own views read it as blank rather than No.
- **The long fields hold SharePoint rich text** (`<div class="ExternalClass…">`
  with `&#58;` / `&#160;` entities), so they render sanitised and write through
  `toStoredRichText` — the same arrangement as the EIR long fields and Gray
  Market's `WhereUsed`.

**No delete**, in the UI or the API module — an ECN is a controlled record of a
change that was made, and a superseded notice is revised rather than removed.
`ecns.test.ts` asserts the module exports nothing matching /delete|remove/.

1,813 rows is under the 5,000-item threshold, so the list is fetched whole and
filtered in the browser — which is what makes searching the Detailed
Description for a part number possible at all. `EcnsView` renders 150 rows with
a "show all"; the filters and the count always run over everything.

Attachments are enabled on the list (kind `ecn` in `api/attachments.ts`).

### "Where am I?" (Engineering out-of-office calendar)

`9483c2c9-8af4-42cb-9e15-a170c8cac225` (env: `VITE_SP_WHERE_AM_I_LIST_ID`) on
`SITES.engineering`. Schema captured 2026-08-19 in
`scripts/where-am-i-schema.json`. Two columns that matter:

| Domain field | Column | Notes |
|---|---|---|
| `title` | `Title` | free text carrying BOTH the person and the reason ("Sarah - half day vacation") — there is no person column |
| `date` | `Date` | date-only, **required** |

Four things to keep in mind:

- **No end date.** A week away is one row per day. The add form expands a
  `Through` date into one entry per day (`datesInRange`, capped at
  `MAX_RANGE_DAYS` = 60 so a mistyped year can't write thousands of rows), but
  the data model is one row per day and the UI says so rather than pretending
  otherwise.
- **Its dates are stored at 06:00Z** — local midnight in US Central, this
  site's regional setting. Gray Market stores 23:00Z and Visit Reports 22:00Z;
  the SAME `parseSpDateOnly` midday pivot reads all three correctly, which is
  the reason that rule isn't a per-list offset.
- **It HAS a delete**, unlike Visit Reports and Gray Market Requests. Those
  record something that happened; this records an intention, and intentions get
  cancelled. Anyone signed in can add, edit and remove — including other
  people's entries (Ray, 2026-08-19).
- **~1,000 rows** since late 2023, two small columns, so it's fetched whole and
  both views slice it in the browser.

**One route, two renderings** (`views/WhereAmIView.tsx`). Desktop gets the
month grid; a phone gets an **upcoming agenda** grouped by day — Today /
Tomorrow / "Thu, Aug 21" — because seven columns are unreadable at that width.
This is NOT the Visit Reports calendar's arrangement, which redirects a phone
to its list view: here there is no other view to redirect to, so the phone gets
a rendering of its own that answers the question people open it to ask.

The month-grid maths (`calendarDays`, month keys, labels) lives in
**`src/lib/calendarGrid.ts`**, shared with the Visit Reports calendar — pulled
out when this second calendar arrived, before there was a copy to drift.

### Gray Market Requests (Supply Chain, PMO site)

`bf5e3786-d2c1-4e8d-8bd1-c8d5bab9c85b` (env: `VITE_SP_GRAY_MARKET_LIST_ID`) on
**`SITES.pmo`** — not a Supply Chain site. That's where the list has always
lived, and the PMO grant already covers it. Schema captured 2026-08-19 in
`scripts/gray-market-request-schema.json`.

**A Supply Chain feature** (Ray, 2026-08-19). Engineering's part of the
workflow — the testing and sign-off fields — lives on the same record, and it
briefly appeared in the Engineering nav group and dashboard too; that was
removed. One department, one place in the nav.

**The columns are DATA** (`src/lib/grayMarketFields.ts`). Thirty-odd editable
columns spanning four teams' parts of one workflow: declaring them once drives
the mapper, the write payload, the `$select`, the five detail cards and the
form. A column added in SharePoint is one descriptor line here.

**Four internal names do NOT say what they mean**, which is the main reason
that table exists:

| Internal name | Actually is |
|---|---|
| `QANotes` | labelled **"Inspection Flag"** (Yes / Pending) — not a notes field |
| `QtyofPartsforW_x002e_O_x002e_` | labelled **"Qty of Parts for BR"** |
| `InCircuitPCBW_x002e_O_x002e__x00` | **truncated** internal name, "In Circuit PCB W.O. #" |
| `FinalAssemblyW_x002e_O_x002e__x0` | **truncated** too |
| `Parts_x0020_Location` | a **person** column, despite the name |
| `Title` | the Altronic assembly number |

Also:

- **`LogNo_x002e_Raw` carries `GMR_YYYY-###`**, generated by
  `nextGrayMarketLogNo()`; SharePoint's calculated **Log No.** derives from it,
  so only the raw column is ever written — the EIR No arrangement exactly.
- **Dates are stored at 23:00Z** (local midnight in the site's regional
  timezone — the same tenant quirk as Visit Reports' 22:00Z rows, an hour apart
  because those samples were summer). `parseSpDateOnly` handles it.
- **`WhereUsed` holds SharePoint rich text** (`<div class="ExternalClass…">`),
  so it renders sanitised and writes through `toStoredRichText`.
- **`Communication` and `Watchers` already existed on the list**, which is why
  the standard comment thread wired up with no SharePoint changes.

**No delete**, in the UI or the API module — a request records a part that was
bought. `grayMarketRequests.test.ts` asserts the module exports nothing
matching /delete|remove/.

**Every create emails an INTAKE list** (Ray, 2026-08-23) —
`GRAY_MARKET_NEW_REQUEST_ALERTS` (env `VITE_GRAY_MARKET_NEW_REQUEST_ALERTS`),
defaulting to Katie Fleming, Alexandra Russell and Glenn Terry. Nothing watches
the SharePoint list, so a raised request used to sit until somebody opened ARC
and noticed it.

Three things this is deliberately NOT:

- **It is not the watcher mechanism.** The recipients are config, not the
  request's Watchers column, so they are told about the create and nothing
  else; later comments and changes still follow the normal watcher rules. The
  email says to press Watch for the rest of the thread. Adding them as watchers
  instead would subscribe three people to every request in the company.
- **It is not a per-user preference.** There is no opt-out short of changing the
  setting — it's an intake queue. Three named people didn't justify a
  SharePoint list and the admin screen that comes with it, the same call as the
  EIR triage lists.
- **It is not sent to the person who raised it** — unless that would leave
  nobody, the `withoutActorUnlessEmpty` rule shared with EIR triage.

`buildNewGrayMarketRequestEmails` (`lib/grayMarketAlerts.ts`) is pure and
returns `ChangeEmail[]`, so the wording is tested without touching Graph;
`fireNewGrayMarketRequestAlert` in `api/email.ts` sends it. **Blank details are
dropped from the email** — a new request is mostly empty by design, since
purchasing, engineering and inspection fill their own stages in later, and a
grid of dashes reads as a fault.

**`Testing Required` is NOT required on create** (Ray, 2026-08-23) — whether
testing is needed is decided later in the workflow. The pills carry a "Not set"
option, and `buildGrayMarketCreateFields` OMITS `ProductionTest` when it's
blank rather than sending `""`, like every other blank column on a create. If
the SharePoint column is still marked Required in list settings, the create
will be refused there regardless of what ARC sends — that setting is the place
to look if new requests start failing.

### @-mention auto-watch is ONE function now, and it takes a resolver

`autoWatchFromMentions` in **`src/api/autoWatch.ts`** is shared by all six
comment threads. It used to be a private copy in five department hooks.

The copies looked identical and were not: each resolved a cold-start mention
against **its own site** — `resolveCurrentUserLookupId` (Engineering),
`resolvePmoSiteUserLookupId` (PMO), `resolvePanelSiteUserLookupId` (Panels). A
site user lookupId is per site collection, so sharing them naively would have
written a wrong (or non-existent) user into the person columns on Operations,
Panels and Gray Market. `resolveLookupId` is therefore a **required
parameter** — a new caller has to say which site it means.

### Visit Reports (Customer Service / Sales, salesTeam site)

`7cc4db39-6612-4c2d-b1b2-1af34d0564e7` (env: `VITE_SP_VISIT_REPORTS_LIST_ID`)
on `SITES.salesTeam`. Schema discovered live 2026-08-18 —
`scripts/visit-reports-schema.json` is the snapshot; re-run
`./scripts/discover-list.ps1 -ListName "Visit Reports" -Site salesTeam` if the
columns change.

| Domain field | Column | Notes |
|---|---|---|
| `customerName` | `Title` | **The list repurposes Title as the Customer Name** — there is no "title" in the domain type (same as CSA Listings). |
| `rmName` | `RMName` | choice — the regional manager |
| `reasonForVisit` | `ReasonForVisit` | choice |
| `visitSummary` | `VisitSummary` | multi-line, **required** |
| `actionItems` | `ActionItems` | multi-line |
| `visitDate` | `VisitDate` | date-only; midday UTC on write (`src/lib/spDates.ts`) |
| `customerStatus` | `CustomerStatus` | choice — drives the colour chip |
| `product` | `Product` | text ("Product(s)") |
| `city` | `City0` | **the trailing zero is real** |
| `state` | `State0` | choice, the 50 states spelled out |
| `hasAttachments` | `Attachments` | attachments enabled; kind `visitReport` in `api/attachments.ts` |

Five things to keep in mind:

- **`City0` / `State0`.** A City/State pair existed before and was replaced;
  SharePoint suffixed the new columns. Writing `City` saves nothing, silently.
- **`Month`, `Year`, `Day` and `Cal Title` are CALCULATED** off Visit Date and
  read-only. `VISIT_REPORT_SELECT` leaves them out and the write payload never
  includes them (a write is a 400) — the year filter derives from `visitDate`.
- **The RM Name choices do NOT cover the data.** Reports run back to 2022;
  managers have left ("Neal Keeton" is in the data, not the column), and one
  person appears under two spellings ("Paul McHenry" / "Paul Mchenry"). So
  `rmNameOptions()` offers the column's choices UNION whatever the rows hold.
  Offering only the choices would make an old report un-editable without
  silently reassigning it, and filtering on choices alone hides real reports.
- **Existing rows store the date at 22:00Z — local midnight in a site two hours
  ahead of UTC.** Reading the UTC date showed the day BEFORE the one the list
  view displays ("app says June 21, list says June 22"). `parseSpDateOnly` in
  `src/lib/spDates.ts` applies a midday pivot: a stored time after 12:00 UTC
  belongs to the next day. **Do NOT check this against the calculated
  `Month`/`Year`/`Day` columns** — SharePoint computes those in UTC, so on this
  list they disagree with the date users read. The list view is the truth.
- **Edits send only the columns that changed** (`buildVisitReportFields(input,
  previous)`). The choice columns' stored data has drifted outside their choice
  lists — managers who have left, one spelled two ways — and re-sending such a
  value makes SharePoint reject the whole PATCH, so fixing a typo on a 2022
  report would fail for an unrelated reason.
- **~1,000 rows and growing.** Under SharePoint's 5,000-item threshold, so the
  list is fetched whole (`graphFetchAll`) and filtered in the browser; the
  table renders 150 rows with a "show all". If it ever nears 5,000, copy
  `listTeradyneLog`'s year scope — and index `VisitDate` first.

**Two views, one filtered set.** `VisitReportsView` (`/sales/visit-reports`)
and `VisitReportsCalendarView` (`/sales/visit-reports/calendar`) share
`lib/visitReportFilters.ts` (pure predicates + `groupVisitsByDay`),
`hooks/useVisitReportFilters.ts` (the URL state + `visitReportFilterSearch`
for the switcher) and `components/VisitReportFilterBar.tsx` — the same
arrangement as the EIR list/board pair, and for the same reason: two copies of
a filter is how a fix reaches only one view.

**The calendar is desktop / large-tablet only** (Ray, 2026-08-18). It gates on
`useKanbanAvailable()` — the orientation-independent check the Kanban boards
use, so a phone turned sideways can't sneak in — the Header hides the Calendar
button below that size, and the view itself redirects to the list, because a
bookmark or a shared link would otherwise land a phone on a seven-column grid.

**Every date in the calendar is handled in UTC terms** (`visitDayKey`,
`calendarDays`). A date-only value is held at midday UTC once
`parseSpDateOnly` has normalised it; local getters would put every visit on the
day before for anyone west of Greenwich.

**There is no delete — not in the UI, and not in `api/visitReports.ts`**
(Ray, 2026-08-18). A visit report is a record of something that happened:
correcting one is an edit, removing one is a deliberate trip to SharePoint.
The absence from the API is the point, so a future screen or bulk action can't
quietly acquire one; `visitReports.test.ts` asserts the module exports nothing
matching /delete|remove/.

Creating and editing is open to **any signed-in user** — no admin gate, no
role gating. The list is **Sales-only**: nothing else reads it, and it imports
nothing from another department.

### Open Orders Report Tool (Customer Service / Sales)

A once-a-week job, run by a person: somebody exports the open orders report out
of SAP, uploads the xlsx at `/sales/open-orders`, and ARC builds one branded
master dashboard plus one workbook per customer on a managed list. **ARC has no
server and no scheduler** — the screen states the cadence in words, because
nothing here happens by itself.

**The screen leads with the FILES, not the upload form** (Ray, 2026-08-24).
The latest master, then this week's customer workbooks already expanded, then a
button that opens the generating tool. One person runs this weekly; everybody
else arrives to download, and an upload form at the top made the page read as a
job to do rather than a shelf to take a file off. The newest week is expanded on
arrival for the same reason.

**Where the files go** — `General/Order Management/OPEN ORDERS` in the default
document library of `SITES.salesTeam`; masters at the root, customer workbooks
in `Week of <Monday>`, raw extracts in `RAW UPLOADS`.

The path was **not** taken from the sharing link Ray supplied. A share token can
be regenerated — the two links he sent carried different `e=` values — so it was
derived from the OneDrive sync mapping for that same folder (`MountPoint` and
`UrlNamespace` under `HKCU:\Software\SyncEngines\Providers\OneDrive`), which
resolves to the path above. `scripts/verify-open-orders-folder.ps1` proves it
against live Graph, read-only, and can also resolve the share link to compare.

**Six things the SAP extract does NOT tell you from its headers**, all verified
against a live export (2,031 rows, 2026-08-21) and documented in
`lib/openOrdersFields.ts`:

1. **`Ship Date` is OUR promise; `Customer required date` is theirs.** They
   differ on 743 of 2,031 rows, so they are two real dates rather than a
   duplicate pair. Aging keys off Ship Date (Ray, 2026-08-24).
2. **There is no shipped-quantity column** — only Order Quantity and Open
   quantity, so shipped is derived. 55 rows are part-shipped.
3. **Repairs are NOT ZS1 in this extract.** `Sales Document Type` carries the
   literal lower-case `repair` on 442 rows, and `Repair order` carries a number
   on exactly those same 442. ZS1 is still accepted, since that is what people
   call these orders and another export may use it.
4. **Every repair line is unpriced** — all 442 at Net Price 0. So "repairs = $0"
   is the data, not a bug, and the workbooks say so rather than showing a table
   of zeros.
5. **`Customer Name` is truncated at 30 characters** ("Wabtec Transportation
   Systems,", "INNIO Waukesha Canada Corporat"). This is exactly why the managed
   customer list holds its own `CustomerName`: a file a CUSTOMER receives must
   not be named after a truncation.
6. **The extract can mix currencies** — 2,029 USD and 2 EUR. Money is carried
   per line and totalled PER CURRENCY; no exchange rate is applied and there is
   no single combined figure.

**The repairs rule cost real money before the live data corrected it.** An
earlier version also matched the word "repair" in the material description, as a
"safety net". The extract has six priced ZTA lines reading `REPAIR KIT,
ALTRONIC V` and `ALTRONIC REPAIR KIT, ALTRK3U-F` — parts orders for a repair-KIT
product — and that match pulled **$16,037 of Global Compression Services'
genuine parts backlog** out of their standard table. It caught nothing the two
real signals missed. `isRepairLine` now reads the order type and the repair-order
number only, and those kit strings are fixtures and tests. The lesson
generalises: SAP says what an order IS in the order type, and a product name
containing "repair" is a product name.

**`Comments` is not prose.** 147 of the 166 comments in the live extract are
DATES — somebody types a revised expected ship date into the column — and the 19
that are words say the same thing ("Shipping in September. Exact date is pending
when the tooling is received"). A date comment is kept as a real Excel date so
it sorts and filters; prose stays prose. `dateCellOnly()` accepts a Date or an
Excel serial and refuses loose strings, because running the ordinary date parser
over "ship 3 by 08-28 / 20 to ship 09-14" invents a date nobody typed.

**ALTRONIC branding, not Cooper.** Both brand systems exist in this org and
these workbooks are Altronic: monochrome black and white, greys for structure,
gold (#CBA052 — the ignition spark) as a sparing accent, and the **official
wordmark embedded as an image** (`src/assets/brand/`).

That mark is the **12KB transparent PNG, not the 630KB JPG** sitting beside it
in the same folder. Fifty times smaller, and a JPEG can't be transparent so it
would sit in a white box on the sheet — across a weekly run of seventy-odd
workbooks the difference is about 45MB of logo. It is held as base64 in a TS
module so the identical code path works in the browser bundle and in the Node
sample generator; an asset URL would need fetching in one and resolving from
disk in the other. Its display width is derived from its own aspect ratio, so it
can't come out stretched.

**Row shading is STRUCTURE, never meaning.** Rows were once washed gold when a
line was past due, which gave the banding two jobs at once and made the table
look patchy rather than banded (Ray, 2026-08-24). Banding is now strictly
alternate Light Grey / white, and past due is marked by WEIGHT — the ship date
in bold — so the one signal the report exists for survives without colour. An earlier version was Cooper Red throughout, which
was simply the wrong company. `openOrdersWorkbook.test.ts` fails if any Cooper
colour reappears, and its colour scan reads BORDERS as well as fills and fonts —
the gold accent on the master is a hairline under the header band, so a
fill-and-font-only scan reported no gold at all.

Fonts are the brand's **Office alternatives** — Segoe UI Semibold for headings,
Arial for body. Excel has no font-fallback list, so naming Manrope on a machine
without it renders as whatever Excel substitutes, which is worse than the
sanctioned alternative.

**The sheets mirror THIS WEEK'S raw extract, column for column, in its order —
whatever that turns out to be** (Ray, 2026-08-24: "do not rearrange columns";
2026-08-26: "use the raw uploaded files columns and names as they can change
week on week... sometimes it may contain more or less columns and their
headers can change. The layout always should match the raw file"). SAP's
column set is not fixed, so the layout is built fresh from each run's own
parsed header row (`layoutFromColumns` in `openOrdersFields.ts`, fed a
`RawColumnOrder[]` produced by `parseOpenOrdersGrid`) rather than from a
hardcoded list. A recognised column still gets its tuned width/format/
alignment (`FIELD_PRESENTATION`, keyed by field); a column ARC has no field
for still appears, verbatim, sourced from `OpenOrderLine.raw[index]` rather
than a typed field. `RAW_LAYOUT` survives only as the DEFAULT for a caller
with no live parse to build a layout from — tests, and the local sample
generator run with no upload yet — never as what a real generate uses.

This replaced an earlier version where `RAW_LAYOUT` WAS the layout: a fixed
array copied from one historical extract ("OOR 8-21-2026..."), so a week that
renamed a column showed the OLD label over the NEW data, and a week that added
one lost it entirely (only surfaced as an "unmapped column" warning, never in
the report). Business logic — aging, repair detection, the per-customer split
— was never affected either way, since that always went through the typed
fields resolved by alias regardless of a column's exact wording or position;
only the WRITTEN LAYOUT was frozen to one file's shape. People reconcile these
sheets against the raw file side by side, so a column silently missing (or a
helpfully reordered one) turns that into a hunt — this is still the one thing
here not to tidy, just against a moving target now instead of a fixed one.

**Every workbook is ONE sheet** (Ray, 2026-08-24: "i do not need all of those
tabs either just the consolidated raw file", then "all should be single
sheet"). The master's Dashboard / By Customer / Aging / Repairs / Coverage tabs
and the customer file's Summary tab were all built and then removed on request.

**The one difference between master and customer:** a customer's sheet SPLITS
the repair orders into a second table below the standard ones, each with its own
header and totals ("one difference on the customer single sheet split by repair
still"). The master is one undivided table — pinned both ways in
`openOrdersWorkbook.test.ts`, since "make them consistent" is exactly the
tidy-up that would erase the distinction. The figures the Summary tab carried
survive as a single line under the customer's title.

**Customer workbooks carry the FULL column set, comments included** (Ray,
2026-08-24: "comments are customer safe show all columns for customer"). What
never appears is another customer's rows — a customer file is filtered to one
sold-to.

**Aging** is Past due / 0–30 / 31–60 / 61–90 / 90+ / No promise date, measured
on the promise date against the **run date** — passed in, never `new Date()`, so
a report regenerated on Wednesday for Monday's run produces Monday's numbers. A
line promised for the run date itself is not late yet. A line with no promise
date gets its OWN bucket rather than inflating the past-due figure the whole
report leads with.

**One customer can be rebuilt on its own**, from the extract already in RAW
UPLOADS — `useGenerateCustomerReport`, behind the "Build report" button on a
customer's row. The case: somebody is added to the list on a Thursday, after the
week has run (Ray, 2026-08-24), and the alternative is finding the extract again
and rebuilding all seventy files.

Two things it deliberately does NOT do:

- **It does not date the file today.** The run date is read back out of the
  newest master's FILENAME (`runDateFromMasterName`), so a late addition lands
  in the same week folder and is aged against the same date as the files built
  alongside it. Today's date would be the right week only by luck, and would age
  the report a few days out from its neighbours.
- **It does not rebuild the master.** Adding somebody to the report list changes
  who receives a file; it doesn't change the consolidated extract, which already
  contains their lines.

It refuses, saying which it is, when there's no master to date against, no raw
extract to rebuild from, or no open lines for that customer — rather than
writing an empty workbook.

**The past-due count EXCLUDES repair orders** (Ray, 2026-08-25) —
`metrics.pastDueStandardLines`, with `pastDueLines` still carrying every late
line for anything that wants it. On the live extract that is 146 rather than
505: repairs are unpriced and on their own workflow, so counting them made the
headline read three and a half times worse than the parts backlog is.

The summary line **says how many it left out** ("146 lines past due (excluding
359 repair)"), because the detail table below still shows those repair lines —
a reader counting by hand would otherwise get a different number and not know
which to trust. Past-due VALUE is deliberately unchanged: repairs are unpriced,
so they contribute nothing to it and excluding them would be a no-op dressed up
as a rule.

Both the master and the customer workbooks read the same `summaryLine`, so the
count means the same thing on both. Two definitions of "past due" across two
files that land in the same inbox is worse than one applied slightly wider than
asked.

**Adding or removing a customer is ADMIN-only** (Ray, 2026-08-25) —
`canAddOrRemove` on `useMyOpenOrdersAccess`, deliberately narrower than
`isReportManager`, which still governs editing. Who receives an external report
each week is a different kind of decision from correcting a name or taking
somebody off this week's run. It also matches what SharePoint will allow:
deleting a list item needs more permission than editing one, and Hailey Sturtz
hit that as a raw 403 on a button ARC had offered her. Enforced in the view AND
in each mutation's `mutationFn`.

**An account with no open lines gets no workbook** — an empty spreadsheet
arriving at a customer reads as a mistake. The master's **Coverage** tab names
them instead, which is the answer to "why did my customer get no report".

**Writes replace; raw extracts do not.** Re-running a week overwrites that
week's files, because two workbooks for one customer in one week is worse than
one that was refreshed — whoever sends it cannot tell which is current. The UI
confirms first, naming what it will replace. Raw extracts use `rename` instead:
two exports pulled on the same day are two different sets of facts.

**One list on the Sales site** (`scripts/create-open-orders-lists.ps1` creates
it, idempotently, with `-WhatIf`):

| List | env | Shape |
|---|---|---|
| Open Orders Report Customers | `VITE_SP_OPEN_ORDERS_CUSTOMERS_LIST_ID` | `Title` = sold-to number, `CustomerName`, `Active`, `Notes` |

**There is deliberately NO Open Orders Roles list** (Ray, 2026-08-24: "i only
want customer list not roles"). The roles code is built and dormant —
`api/openOrdersRoles.ts`, `useMyOpenOrdersAccess`, `/admin/open-orders-roles` —
and with no list id configured `OPEN_ORDERS_ROLES_ENFORCED` is false, so **any
signed-in user can run the weekly job and edit the customer list**. That matches
Visit Reports, the other Sales feature, and SharePoint's own list and folder
permissions remain the real boundary. `create-open-orders-lists.ps1
-IncludeOpenOrdersRoles` turns it on if that ever needs locking down.

**Do NOT point `VITE_SP_OPEN_ORDERS_ROLES_LIST_ID` at the EIR Roles list** to
avoid making one. Both screens parse their own tag set and DROP unrecognised
tags on save, so editing a shared row in `/admin/eir-roles` would silently strip
`report manager`, and the reverse would strip `engineer`. One list per tag
namespace.

- **Account matching goes through `sameAccount`**, never `===`: SAP pads
  sold-to numbers ("0001042" against a typed "1042").
- **A missing `Active` column reads as ACTIVE.** The opposite would silently
  empty the weekly run the moment somebody added the column.
- **Role gating is OFF until the roles list id is set**
  (`OPEN_ORDERS_ROLES_ENFORCED`), the same lockout-safety shape as
  `EIR_ROLES_ENFORCED`, and **admins always count** — otherwise a list nobody
  holds the role on is a door locked from the inside. One tag today:
  `report manager`, needed to run the job and to edit the customer list.
  Everyone signed in can download.

**A new `VITE_*` var must be added to `.github/workflows/deploy.yml`.** The
workflow passes a NAMED list, so a variable that isn't in it can never reach a
production build however carefully somebody sets the repo variable. The Open
Orders customer list id shipped missing from that list, and since it has no
default in `config.ts` the feature would have reported itself "not set up" for
ever (caught 2026-08-24, during a pre-go-live audit). Most list ids survive the
omission only because they carry documented defaults.

And `VITE_*` values are baked in at BUILD time, so setting a repo variable does
nothing until the next deploy — the setup notice on the customer list screen
says so, because that is the step people miss.

**Never `conflictBehavior: replace` on a FOLDER.** On a file it means overwrite,
which is what the workbooks want. On a folder it replaces the folder — its
contents included — so `ensureWeekFolder` would have deleted the week's
customer files before rewriting them, and a run that failed half way would have
left the week empty. `fail` plus swallowing the name conflict is the same
idempotency without the risk. Pinned in `openOrdersFiles.test.ts`, verified by
reintroducing it and watching the test fail.

**ExcelJS is dynamically imported**, once, on the first parse or generate — it is
~950KB and has no business in the main bundle for somebody reading a task list.
The Sales views are their own lazy route chunk.

Performance on the live extract: 2,031 lines parsed in ~370ms and nine workbooks
built in ~1s, so all 71 customers run comfortably in a browser.

`scripts/generate-open-orders-from-file.mjs <extract.xlsx>` builds the whole set
locally through the app's own parser and builders — the way to eyeball a change
to the workbooks without a round trip through SharePoint.

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

## EIR triage — chasing a new EIR until someone owns it

A raised EIR belongs to nobody until it has a project reference AND an
engineer, and both used to be chased by someone noticing (Ray, 2026-08-20).
The chain, in `src/lib/eirTriage.ts`:

| When | Who's emailed | What it asks |
|---|---|---|
| Raised with **no** project reference | `EIR_TRIAGE_PROJECT_REVIEWERS` | "Please add a project reference" |
| A project reference **lands** on one that had none | `EIR_TRIAGE_ASSIGNERS` | "Please assign an engineer" |
| Raised **with** a project reference | `EIR_TRIAGE_ASSIGNERS` | Skips the first step entirely |

Each email says what happens next, so a recipient can see they're one link in a
chain rather than the end of it.

Recipients are config, not a list: `VITE_EIR_TRIAGE_PROJECT_REVIEWERS` and
`VITE_EIR_TRIAGE_ASSIGNERS`, comma-separated `Name <email>` or bare addresses,
parsed by `parseRecipientList`. Three named people didn't justify another
SharePoint list and the admin screen that comes with it.

`parseRecipientList`, `withoutActorUnlessEmpty` and `nameList` live in
**`src/lib/recipientList.ts`**, shared with the Gray Market intake alert —
moved there when the second configured list arrived, before there was a copy
to drift.

Five rules that are load-bearing, each with tests:

- **Only the empty → set transition fires the handover.** Swapping one project
  for another isn't a handover and must not re-chase anyone. `projectIdsFromFields`
  returns `null` (not `[]`) when a write doesn't touch project references at
  all — conflating those fires the email on unrelated edits.
- **An EIR that already has an engineer is never chased for one**, however its
  project changes.
- **An EIR missing both is chased only for the project.** The assigners can't
  sensibly pick an engineer without knowing the project.
- **The actor is excluded — unless that would leave nobody.** Not notifying
  someone of their own action is the rule everywhere in ARC, but these are
  work-queue requests: a queue going silent because the only reviewer happened
  to raise the EIR is worse than one redundant email.
- **The project's NAME comes from the Projects cache** (`projectTitleFor`), not
  the EIR — an EIR carries lookupIds only, so without that the email would name
  a number.

Wired in `useCreateEir` (both create paths) and `useUpdateEirFields` (the
handover), reusing the `ChangeEmail[]` + `notifyChangeEmails` machinery so the
wording is unit-testable without touching Graph.

**A test that lies:** the "swapping projects stays quiet" case originally used a
fixture EIR that happened to have a project — and passed with the empty-to-set
guard deleted, because the fixture also had an engineer, so a different guard
was doing the work. It now sets a project and then changes it. If you touch
these guards, check the test fails when you remove the one you're changing.

## Only two people may change an EIR's Project Reference

Hard-coded, in `lib/eirProjectReference.ts` — `EIR_PROJECT_REFERENCE_EDITORS`,
Sheila Horn and Ray White (Ray, 2026-08-25). Deliberately NOT a tag on the EIR
Roles list: setting a project reference is what hands an EIR from "needs a
project" to "needs an engineer" and fires that alert, so it is two named people
rather than anybody holding a role. Changing who needs a code change and a
deploy; that is the point.

- **Detail view only.** The New EIR form is untouched, so whoever raises an EIR
  can still pick a project — the same arrangement as the role-gated EIR fields,
  which lock once the EIR is submitted.
- **Matched through `matchesAnyEmail`**, against every address the account
  carries. A UPN is not a mailbox and in this tenant they differ; comparing
  `account.username` alone is what cost Steven Pirko his EIR role access, and
  here it would grey Sheila out of her own field with no explanation.
- **NOT subject to `enforced`.** That flag exists so a missing EIR Roles list
  can't lock anyone out, and there is no list here to be missing.
- **`MultiSelect` has no `disabled` prop**, so the locked state renders the
  assigned projects as static chips with the hint as a tooltip, rather than
  teaching the shared component a prop for one caller.
- **This rule is documented in `ManualView` but deliberately NOT in the
  changelog** (Ray, 2026-08-25: "Do not show this in the rev notes only in the
  manual"). The usual protocol is every user-visible change gets an entry; this
  is an explicit exception, recorded here so a later tidy-up doesn't "fix" it by
  adding one.

## Admin → Notification recipients

`/admin/notification-recipients` lists every configured recipient list and
checks each address against the staff directory ARC already loads for the people
pickers.

It exists because Glenn Terry didn't receive an "assign an engineer" alert that
Ray received from the same send (2026-08-25). The list and the trigger were both
right; nothing anywhere could tell you whether the ADDRESS was. Mail goes out as
one `sendMail` per recipient, **Graph accepts a message for a mailbox that
doesn't exist**, the bounce lands in the shared mailbox nobody reads, and
`saveToSentItems: false` means there isn't even a sent copy — so a wrong address
in one of these lists is silent for ever.

Two things about `lib/recipientAudit.ts`:

- **It matches the FULL address, strictly — not `sameEmail`.** That helper falls
  back to comparing the local part, which is right for deciding whether to grey
  out a field and exactly wrong here: it would call
  `glenn.terry@altronic-llc.com` a match for `glenn.terry@hoerbiger.com` and
  hide the single most likely fault in a tenant assembled from two companies.
- **An empty directory reports nothing**, rather than every address as missing.
  `useDirectoryPeople` tolerates an empty result, and a slow request must not
  render a screen full of false alarms.

The failure toast for a bad send goes to the ACTOR, incidentally — so when
Sheila's action fails to reach Glenn, Ray never sees it. That's why the check
had to be a screen an admin can open rather than a better toast.

## EIR status alerts — the two transitions that need somebody to act

Two status changes raise a work request rather than a notification (Ray,
2026-08-25). Both were previously spotted by someone happening to look.

| Transition | Who's emailed | What it asks |
|---|---|---|
| → **Response Accepted** | `EIR_RESPONSE_ACCEPTED_ALERTS` (Sheila Horn, Ray White) | "Please close it" |
| → **Response Not Accepted** | the EIR's **assigned engineers** | "Please revisit and give a more detailed response" |
| → **Response Not Accepted**, no engineer reachable | `EIR_TRIAGE_ASSIGNERS` | "No engineer is assigned" — different wording, see below |

Wording lives in `lib/eirStatusAlerts.ts` (pure, returns `ChangeEmail[]`);
`fireEirResponseAcceptedAlert` / `fireEirResponseNotAcceptedAlert` in
`api/email.ts` parse the configured list and send. Both hook into the ONE
`if ("Status" in fields)` block in `useUpdateEirFields` — the only hook that can
write Status, so the sidebar picker, the board drag and the linked-task
completion path are all covered by one call site.

Six rules that are load-bearing:

- **`to !== from` is OUR guard.** `"Status" in fields` is PRESENCE, not change.
  The only existing transition test lives inside `buildFieldChangeEmails`, which
  these alerts don't go through, so re-saving the same status would otherwise
  email people about a transition that never happened. The "stays quiet" tests
  use a fixture **already at** the target status — with one starting elsewhere
  they pass whether the guard exists or not, which is the trap this repo has
  already been caught by twice.
- **`"EIR Not Accepted"` does NOT fire the engineer alert.** That status means
  the request was rejected, not the engineer's answer, so "give a more detailed
  response" would be the wrong instruction. Only `"Response Not Accepted"`.
- **THREE cases, three sentences.** Engineers reachable → "revisit and give
  more detail". Nobody assigned → "no engineer is assigned". Assigned but not
  reachable → *"the assigned engineer couldn't be asked"*. That third sentence
  exists because the first version sent the second one: a `Person` with no
  mailbox is indistinguishable from an empty list once the unmailable are
  filtered out, so an EIR that DID have an engineer told the assigners it
  didn't — pointing them at replacing an engineer who was already on it
  (caught in review, 2026-08-25).
- **The actor is excluded STRICTLY from the engineer alert**, unlike the
  accepted-response queue. An engineer marking their own response Not Accepted
  doesn't need an email telling them to revisit it and naming them as the
  person who rejected it; `withoutActorUnlessEmpty` would have sent exactly
  that when they were the only engineer. Instead it falls through to the
  assigners, so somebody other than the actor hears about it.
- **The generic status note is deliberately NOT suppressed.** The specific
  alerts go only to the people who must act, so dropping the generic one would
  stop the REPORTER hearing that their own EIR was accepted. Some people get
  two emails: one says what happened, one says what to do.
- **Its own env var**, `VITE_EIR_RESPONSE_ACCEPTED_ALERTS`, not a reuse of
  `EIR_TRIAGE_PROJECT_REVIEWERS` — the default pair is identical today, but that
  list is the "missing project reference" queue and re-pointing it must not
  silently re-point this. It is wired in `deploy.yml`; a `VITE_*` var absent
  from that named allowlist can never be set in production (see v0.112.6).
- **Undo sends no retraction.** `buildUndo` calls the bare `updateEirFields`
  API rather than the mutation, so undoing a mis-drag to Response Accepted
  leaves Sheila with a "please close this" email and nothing to correct it.
  Pre-existing for the generic status alert; more consequential now, and stated
  rather than silently accepted (Ray, 2026-08-25 — accepted as-is).

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

### Detail pages read; a card's Edit button writes

Gray Market requests and ECNs both used to edit field by field: an "Edit" link
per text column that swapped it for an input with its own Save, next to choice
columns and checkboxes that committed the moment you touched them. One card
carried half a dozen edit affordances in half a dozen places, under two
different rules about when a change was saved (Ray, 2026-08-19: *"the edit
button locations do not make sense"*).

Now **the page is read-only and each card header has ONE Edit button**, behind
which sits `src/components/FieldEditModal.tsx` — shared, not copied per
department, because two editors is how a fix reaches only one of them. It's
descriptor-driven like everything else on those pages: a view maps its own
field descriptors to `EditableFieldSpec[]`.

Three things to preserve:

- **Only changed fields come back.** `onSave` receives just the keys that
  moved. On Gray Market that's load-bearing rather than tidy: several stored
  choice values have drifted outside their column's choice list, and
  re-sending one makes SharePoint reject the whole PATCH — the same reason
  Visit Reports diffs its writes.
- **Rich-text columns are handed over as PLAIN TEXT.** The caller converts
  (`toPlainTextForEditing`) before opening and converts back through its
  field-patch helper on save. Editing raw `<div class="ExternalClass…">` in a
  textarea is how that markup gets corrupted.
- **Drafts are seeded once.** The list behind the page refetches on its own
  cadence; re-seeding from it would wipe whatever is half-typed.

A new card of fields on either page needs no new editor — add the descriptors
and point the Edit button at the section.

### A short choice list is pills, never a dropdown or a checkbox

`src/components/ChoicePills.tsx` is the control for any choice set of
`MAX_PILL_OPTIONS` (3) or fewer — Yes/No, Yes/Pending, Pass/Fail, In
Process/Yes/No. `YesNoField.tsx` is a thin wrapper over it for real boolean
columns.

Two complaints produced this, a day apart:

- A bare checkbox left people reading a tick to work out what it meant, with
  no visible "No" to choose (Ray, 2026-08-19).
- Two or three options behind a dropdown cost a click to open, a read to find
  the option you already knew you wanted, and a second click to pick it (Ray,
  2026-08-19: *"make sure all yes no are selections throughout the apps and
  modals. Easy to toggle."*).

The rule lives in the renderers, not at each call site: `FieldEditModal`,
`EcnFormModal` and `GrayMarketRequestFormModal` all send a `choice` field to
pills when it has ≤ 3 options and to `ChoiceSelect` otherwise, so a new
descriptor gets the right control automatically.

Four things to preserve:

- **Blank is usually a real state.** Most of these are TEXT columns where the
  majority of rows have never been answered, so the pills carry a **Not set**
  option (`allowUnset`). Without it, opening a record and saving quietly
  answers a question nobody had answered. A field the list marks *required*
  (Gray Market's Testing Required on create) omits it — nothing is selected
  until it's picked, and validation catches the empty.
- **`allowUnset` forces the literal "No".** On a real boolean column No IS
  blank, so No and Not set would share a value and both light up. A column
  needing a distinct "not answered" is a text/choice column by definition.
- **Stored casing varies** — older rows carry `yes` / `no` lower case — so
  matching is loose and the canonical form is written back.
- **A pill group can't sit inside a `<label>`**: its options carry their own
  labels, which nest and steal the click. Wrappers are `<div>`s (the `plain`
  prop on each form's `Field`), and neighbouring controls name themselves with
  `aria-label`.

**What deliberately stays a checkbox:** the PCB task checklist
(`PcbChecklistCard`) and the Build Request Items PCB/Harness checklists
(`BuildRequestItemCard`). Those are 13 and 17 boolean columns rendered as a
progress list you tick as you go — turning them into 30 radio pairs would make
them harder to use, not easier, and a checklist is not a Yes/No question. The
description checklists, the comment "notify everyone again" option, and the
EIR role tags are UI affordances, not stored Yes/No fields, and stay as they
are too.

### A lazy route needs a Suspense boundary, and the app needs ONE error boundary

Every `lazy()` view in `App.tsx` is wrapped in its own `<Suspense>`. The Open
Orders routes shipped without one (2026-08-24): React has nowhere to park a
suspended component, so rendering one throws, and the app had **no error
boundary at all** — so the whole page went blank until a manual refresh,
*including navigating away*, because the crash unmounts the router. Ray
reported it as "every navigation to and from requires me to refresh to load".

The mistake was invisible at the call site: the route was copied from
`/sales/visit-reports`, whose view is **eagerly imported** and therefore needs
no boundary. Two guards now exist:

- **`src/App.routes.test.ts`** reads `App.tsx` and fails if any `lazy()`
  component is rendered in a `<Route>` block with no `Suspense` in it, naming
  the offender. It was verified by reintroducing the bug and watching it fail —
  the first version of that test passed with the bug present, because the
  injection had silently not applied.
- **`src/components/RouteErrorBoundary.tsx`** wraps the whole route tree. It is
  the app's only error boundary.

Three things about the boundary worth keeping:

- **It is keyed on `location.pathname`** and clears on change, so one broken
  page doesn't make the rest of ARC unreachable until a reload. Going back to
  the broken page throws again, which is honest.
- **A stale chunk gets its own wording.** ARC deploys hashed filenames to GitHub
  Pages, so a tab open across a deploy asks for a chunk that no longer exists
  and the dynamic import rejects. That isn't a fault in the page being opened
  and reloading definitely fixes it, so `looksLikeStaleChunk` (a set of
  patterns, because every browser words it differently) switches the message to
  "a newer version of ARC is available".
- **The error text is shown, not hidden.** Whoever presses Report issue has to
  be able to quote it.

### Escape closes ONE thing at a time

A dropdown open inside a modal used to mean two `document` keydown listeners
waiting on the same key — the dropdown's and the modal's. Escape fired both, so
dismissing a menu you'd opened by mistake also closed the dialog and threw away
everything typed into it. Alexander Masgras lost a part-filled New Task that
way on 2026-08-20.

`dropdownKeyHandler` in `useDropdownClose.ts` handles Escape on the dropdown's
**container** and calls `stopPropagation`. React's root sits inside `document`,
so stopping the native event there ends its journey and the modal never sees
it. With no panel open the handler does nothing and Escape reaches the modal as
it should.

**Any new overlay that closes on Escape needs the same discipline**: handle the
key on your own container and stop it, or you'll close whatever is behind you.
`SuggestInput` already did this; the shared dropdown didn't.

### Every dropdown closes the same four ways

`src/components/useDropdownClose.ts` owns when a panel closes, and both
dropdown implementations (`DropdownShell` in `SearchableSelect.tsx`, and
`SuggestInput`) use it. They used to close on an outside click or Escape and
nothing else, so after picking in a multi-select the only way out was clicking
some empty part of the page, and tabbing onward left the panel hanging open
(Ray, 2026-08-19: *"all drop downs make you click away to close"*).

1. **Focus leaves the control** → close.
2. **Another dropdown opens** → close. One panel app-wide, tracked in a
   module-level claim (`claimOpenDropdown`); it's a module variable rather
   than context because dropdowns live in unrelated trees and there is one
   document.
3. Outside mousedown → close.
4. Escape → close.

Two details that are easy to get wrong:

- **A blur with no `relatedTarget` is ignored.** That's what a click on the
  panel's own padding or a scrollbar produces, and closing on those shuts the
  panel mid-use. Genuine outside clicks are already rule 3's job.
- **The container ref must wrap the trigger AND the panel**, so focus moving
  between them reads as movement *within* the control.

**A multi-select still doesn't close on a pick** — ticking several is the
point — which is why it now carries a **Done** row. If you add a dropdown that
stays open, give it a visible way out.

Testing note: `resetOpenDropdown()` in a `beforeEach`, or a claim left by a
previous test closes the one under test. And jsdom does NOT populate
`relatedTarget` on a programmatic `.focus()`, so drive the focusout rule with
`fireEvent.focusOut(el, { relatedTarget })` or `userEvent.tab()` — a test
written with `.focus()` passes whether the rule exists or not.

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

As of 2026-08-18 the *detector* is shared too —
`detectMentionQuery(text, caret)` in `lib/mentions.ts` — because both files
also carried identical copies of the backwards-walk that decides whether the
caret is inside a mention.

**A mention query may contain ONE space.** It used to close the picker at the
first whitespace, so `@Jerrod W` was unreachable and anyone who had to be
disambiguated by surname couldn't be mentioned at all. Two spaces ends it (the
user has moved on to a sentence) and a newline always does. Nothing renders
when there are no candidates, so an over-long query hides the picker by
itself.

### The EIR list opens UNFILTERED, however you arrive

`/eirs` shows every EIR — every status, every engineer — until somebody sets a
filter. Nothing applies one on their behalf.

The dashboard's EIRs card used to send `engineer=<me>` whenever the dashboard
was in **Mine** scope, which is its default. So following that card landed
people on their own EIRs only, and it was reported as the filter being broken —
"users see only a limited number of EIRs instead of all of them" (Ray,
2026-08-25). The list itself was innocent: `useEirFilters` defaults every axis
to empty, `matchesEirView` returns true for `all`, `applyEirStatusFilter`
returns everything for a null pill, and `EirsView` renders `filtered.map` with
no row cap.

**Note the deliberate asymmetry with the Tasks card**, which DOES carry
`assigned=<me>`: the task list's Assigned filter defaults to the current user
anyway, so that param matches where the list lands on its own. The EIR list has
no such default, so injecting one made it behave differently depending on which
link you followed. Don't "make them consistent" by adding a person default to
EIRs, or by stripping it from tasks.

A picked project still travels from the dashboard — that's an explicit choice
made on that screen. Pinned in `DashboardView.test.tsx` (the card navigates to
exactly `/eirs`) and `EirsView.unfiltered.test.tsx` (the list shows all of them,
closed included, and still honours an engineer filter that was actually asked
for). The second was verified by injecting a default-to-me and watching three of
its four cases fail.

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

### Big lists cap what's RENDERED, not what's filtered or counted

`ListView` (tasks) and `EirsView` had no cap on how many rows hit the DOM —
every other big list in ARC (`EcnsView`, `TeradyneLogView`) already learned
this lesson. Reported 2026-08-26: "searching EIRs and tasks really slows down
the app and computer" — hundreds of `TaskRow`/`EirRow` components (each
computing its own checklist/child-task/badge derivations) re-mounting on every
debounced keystroke is real, visible main-thread work, not a false alarm; on a
list that's grown into the hundreds it's a genuine freeze, not a stutter.

Both views now follow the established `INITIAL_ROWS = 150` + "Show all"
pattern: `shown = showAll ? filtered : filtered.slice(0, INITIAL_ROWS)`,
rendered instead of `filtered`, with a button that flips `showAll` and a
`useEffect` that resets it to `false` whenever the filters (or, for EIRs, the
view/status pill) change — the cap is for the unfiltered case, not to keep
hiding rows once someone has already narrowed down to a few.

Two things that must NOT be capped: **filtering, sorting, and every count**
("Showing N of M", status-pill counts) always run over the full set — only
what's mapped into JSX is capped. For EIRs' At Risk Parts view specifically,
the RiskPart-Level grouping is built from the CAPPED set (`shown`), not
`filtered` — grouping from the uncapped set would render every group in full
and the cap would only ever bite on the other views.

A new big list gets the same treatment from the start, not after someone
reports a freeze: cap what's rendered, never what's filtered.

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

### Creators and assignees watch what they're involved in

Watchers drive every notification, so the watcher list has to fill itself.
Three of the four routes onto it are automatic (Ray, 2026-08-18):

| Route | Where it happens |
|---|---|
| **You created it** | the `useCreate*` hook wraps `mutationFn` and passes `autoWatchers(input.watchers, <assignee>, actor)` |
| **It's assigned to you** | the API's `set*Assigned` / `set*Engineer` writes Assigned **and** Watchers in ONE PATCH |
| **You were @-mentioned** | `autoWatchFromMentions` (tasks/ops/panels/BRs) and `autoWatchEirFromMentions` (EIRs), already there |
| You were added by hand | the Watchers field / Watch button |

`autoWatchers()` in `src/lib/people.ts` is the union — it takes people and
lists of people in any mix (Operations, panels and build requests assign ONE
person; tasks and EIRs take several) and dedupes through `mergePeople`, which
keeps the copy carrying a `lookupId` because only that one can be written to a
person column.

Two things to preserve:

- **Nobody is ever removed.** Unassigning leaves the person watching; Unwatch
  is the deliberate way off. Auto-removing would also silently undo someone
  adding *themselves*.
- **The assign path re-reads the item** rather than trusting the caller's
  cache, so a watcher added elsewhere isn't clobbered, and writes both columns
  together so they can't disagree.

A new entity with a Watchers column gets the same treatment in its create hook
and its assign path — that's six departments doing it identically now.

### Comment timestamps are on one clock, not the author's

The `Communication` record starts with a bare `MM/DD/YYYY HH:MM:SS AM/PM` and
**no time zone**. It used to be written in the author's local time and read
back in the reader's, so records weren't comparable: 09:00 IST (03:30 UTC)
sorts after 08:00 CDT (13:00 UTC) even though it was posted 9½ hours earlier.
Threads with authors in different zones came out shuffled (reported
2026-08-18).

The format can't change — the Power Apps app and SharePoint's own views read
the same column — so `src/lib/communicationParser.ts` writes and reads every
record in ONE zone, `COMMENT_TIMEZONE = "America/New_York"`. Altronic is in
Girard, Ohio, so existing records (nearly all written by Eastern-time authors)
keep the time they always showed, and new records from any zone line up with
them. Parsing yields a true instant; the UI still formats it in each reader's
local time, so nobody sees Eastern unless they're in it.

`formatSpDate`/`parseSpDate` do the conversion via `Intl.DateTimeFormat` — no
dependency, DST handled by re-checking the offset at the instant being solved
for. Don't reintroduce `d.getHours()` / `new Date(y, m, d, …)` here: those are
the author's-local-time bug. Tests set `process.env.TZ` explicitly, because
"it depends where you are" IS the bug.

### Matching a person to a stored address: `lib/emailIdentity.ts`

Anywhere ARC decides "is the signed-in user this row", it goes through
`sameEmail` / `matchesAnyEmail`. Two things that are easy to get wrong and
both cost someone their access silently:

- **`account.username` is the UPN — the name you SIGN IN with — not your
  mailbox.** They're allowed to differ, and in a tenant assembled from more
  than one company they do. Steven Pirko was tagged `engineer` on the EIR
  Roles list and had every gated field greyed out, because the lookup used
  his sign-in name while the list held his `@altronic-llc.com` mailbox
  (2026-08-20). `useCurrentUserEmails()` returns every address the account
  carries — `username` plus the `email` / `preferred_username` / `upn`
  claims — and matching checks all of them.
- **The token alone isn't enough**, because `email` is an OPTIONAL claim that
  has to be configured on the app registration, and ARC doesn't request the
  `email` scope — so in practice the token carries only the UPN. So
  `resolveMyIdentity()` reads `/me?$select=mail,userPrincipalName,otherMails`
  once per session (on the **User.Read** scope the app already has). Its
  `primary` is the **mailbox**, falling back to the UPN; `all` is every address
  the person answers to. A failed call returns an empty identity, clears its
  cached promise for a later retry, and the app degrades to the sign-in name —
  what it used before — rather than locking anyone out.
- **`useCurrentUser().email` is the MAILBOX**, not `account.username`. Steve
  Pirko signs in as `steve.pirko@altronic-llc.com` and receives mail at
  `Steven.Pirko@altronic-llc.com` — ONE account, two spellings. Everything
  stored about a person holds the mailbox, so using the UPN meant the app
  didn't recognise him as himself: his EIR role tags didn't apply, and the
  Assigned filter's default of "me" matched none of his own tasks. The
  lookupId resolution now waits for `/me`, since the User Information List is
  searched by address and searching it for a sign-in name that isn't his
  address finds nothing.
- **Two spellings of one person is NOT a duplicate account.** `steve.pirko`
  was briefly added to `VITE_HIDDEN_PEOPLE`'s default on that assumption and
  hid the only real Steve from every picker in ARC. Confirm two accounts exist
  before hiding either.
- **A match is tried whole first, then on the local part**, so a differing
  domain doesn't hide someone. The false positive that buys — two people
  sharing a local part across two domains — doesn't occur in this tenant, the
  lists involved are small and admin-curated, and what's being decided is
  whether a control is greyed out. SharePoint's per-list permissions remain
  the real boundary.

**Never gate on a display name.** Names aren't unique, they arrive written
several ways ("Pirko, Steven"), and it's how the wrong person gets access.
`looksLikeEmail` exists so a screen can TELL an admin a column holds a name
— `/admin/eir-roles` flags such a row "not an email", since it silently
grants nothing.

### Who reaches a people picker

Three filters sit between the tenant directory and every picker in ARC, all in
`mapDirectoryUsers` (api/directory.ts) and `isHiddenPerson` (lib/people.ts):

- **No mailbox, or an `#EXT#` guest** → out. Service accounts and externals.
- **`accountEnabled === false`** → out. Leavers, and the stale half of a
  duplicated person. Note the explicit `=== false`: some tenants don't return
  the property at all, and treating "unknown" as disabled would empty every
  picker in the app.
- **`admin.first.last`, or a person in `VITE_HIDDEN_PEOPLE`** → out. The
  built-in default hides `david.phillips` (keeping Dave Phillips). Setting the
  env var REPLACES that default rather than adding to it.

`VITE_HIDDEN_PEOPLE` is a comma-separated list, for a person who exists twice
under two enabled accounts where only one should be pickable — Ray hit this
with a "David Phillips" beside the real "Dave Phillips" (2026-08-20), and
`david.phillips` is the default. It's config rather than names in code because
which account is the stale one is DATA.

An entry can be a full address OR just the local part. The bare form means
nobody has to know which domain a mailbox is on, and getting a domain wrong
hides nobody *silently* — the failure that's hardest to notice.

**It matches on the email AND the display name**, the name compared
order- and punctuation-insensitively (`nameTokenKey`: "David Phillips",
"Phillips, David" and "david.phillips" all reduce to one key). Email-only
matching was the rule until 2026-08-20 and let the duplicate survive TWO
fixes: the pickers are built from SharePoint person columns, where Graph
routinely returns LookupId + LookupValue and no `Email` at all, so the person
being hidden arrived with nothing to match on. The cost is that a genuine
namesake would be hidden too — accepted, because entries are configured
deliberately, one named person at a time, and the near-misses that must
survive ("Dave Phillips", "Steven Pirko") reduce to different keys.

**Two funnels, not one.** The directory filters above only cover people who
come FROM the directory. Every list view's filter bar builds its options from
the ITEMS instead — `withPerson(collectXPeople(items), currentUser)` — so a
duplicate account that has been assigned real work keeps appearing there
however clean the directory is. `withPerson` therefore drops hidden people
too; it's the single funnel all ten filter bars pass through. Detail-page
pickers go through `mergePeople`, which does the same.

**It's cosmetic, not a permission** — a hidden account can still be assigned
work directly in SharePoint, and hiding it does NOT reassign the items already
pointing at it. Those keep their assignee and simply can't be filtered by that
name any more, which is the trade for getting it out of the dropdowns. A
duplicate that shouldn't exist is better disabled in Entra, and the items
reassigned to the surviving account.

### People search is token-based, and hides `admin.` accounts

Two rules for anything that lets a user pick a person.

**Every word must match, in any order.** `matchesTokens(text, query)` in
`lib/itemSearch.ts` (built on the same `tokenizeQuery` the list views use) is
the one matcher — used by `SearchablePanel` in `SearchableSelect.tsx` and by
`rankMentionCandidates`. A plain `label.includes(query)` was there before and
broke the moment a space was typed: display names come out of Entra as
`Waldron, Jerrod`, so `Jerrod W` matched nobody (Ray, 2026-08-18). Typing a
first name and then a space is how people search for a person, so this is the
default everywhere, not a people-picker special case.

The panel also matches an option's **`value` when it is an email** — people
options are keyed by address, so typing `jerrod.waldron` finds them. Options
keyed by a numeric id (projects, tasks) are matched on label ONLY; matching
those would make `5` pull in every id containing a five.

**`admin.first.last` accounts are hidden.** `isHiddenDirectoryAccount()` in
`lib/people.ts` is applied in `mapDirectoryUsers` (api/directory.ts) and again
in `mergePeople`, so it holds whether the person came from the tenant
directory or off an existing item. They don't receive mail — assigning work or
a notification to one sends it nowhere — and listing every colleague twice
makes picking the right one a coin flip.

It matches the exact `admin.` prefix on the display name or the email's local
part, and nothing looser: a colleague surnamed Adminski, and a shared
`admin@` mailbox people really do assign to, both have to survive. Don't
"improve" this into a general `admin` contains-match.

### A SharePoint write that is refused says what to ask for

ARC's role gating is UI-level; **the SharePoint permission is the real
boundary**, so a write can fail after the app has happily offered the button.
Hailey Sturtz hit that removing a customer from the Open Orders list and got the
raw Graph error in a toast — `Graph 403 Forbidden at
https://graph.microsoft.com/v1.0/sites/…/items/5: {"error":{"code":
"accessDenied"…}}` (2026-08-25) — which told her nothing she could act on and
told whoever she asked nothing about what to change.

`lib/listWriteErrors.ts` turns a failed list write into a sentence.
`describeListWriteFailure(err, { action, site, alternative })`:

- **It does NOT guess which permission layer said no.** Two can: the app's
  `Sites.Selected` grant on the site, and the signed-in user's own SharePoint
  role. From the browser they are indistinguishable, and naming the wrong one
  sends somebody to change the wrong setting — so it names both.
- **It offers the cheaper alternative where one exists.** Deleting a list item
  needs more permission than editing one, so a refused delete says you can set
  the customer to not active instead — an UPDATE, which takes them off the
  weekly run just as well.
- **404 is its own message**, not a permission one: the row was already removed,
  usually by somebody else, and the list is refetched.
- **Anything unrecognised keeps its real message.** A wrong explanation is worse
  than a raw one.

A refused delete also invalidates the query, because nothing was removed and the
row is still on screen — without the refetch the list can drift from SharePoint
after a failure.

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

### "Attachments unavailable" has two causes, not one

The SharePoint REST token is acquired silently and never interactively — a
deliberate rule, because prompting from every detail page produced "why am I
signing in every time I open a task". When that silent acquisition fails,
`sharepoint.ts` used to report ONE cause: an admin hasn't granted the scope.

That's wrong about half the time. The other half is the **signed-in person's
own session** — MFA expired for the SharePoint resource (`AADSTS50078`), or a
password change. Telling them to chase an admin sends someone to raise a ticket
for something they can fix in ten seconds (Ray, 2026-08-20, on the ECN
attachments card).

`SharePointUnavailableError` now carries a `cause`:

- **`"reauth"`** — classified via `isReauthenticable` in `lib/authErrors.ts`.
  The notice states the real reason and offers a **Sign in again** button
  wired to `refreshSharePointAccess()`, then refetches.
- **`"consent"`** — the historical case. Keeps the admin instructions, and
  deliberately shows NO button, since pressing one couldn't help.

An unrecognised error falls through to `"consent"`: a plain failure is not
evidence of either cause, and a sign-in button that can't fix anything is worse
than none.

**`refreshSharePointAccess` is the one interactive exception, and it is only
ever called from a button.** The silent-only rule still holds for automatic
paths — don't wire this into a retry or an effect.

### A sign-in error the user must ACT on doesn't belong on nine cards

Some AADSTS failures aren't token problems the app can retry — the account
needs attention before any request will work. Ray hit `AADSTS50135`
("password change is required due to account risk") on 2026-08-20 and got nine
dashboard cards each showing the raw paragraph, trace IDs and all, with nine
Retry buttons that failed identically. Nothing in it said "change your
password".

`src/lib/authErrors.ts` maps the small set of those codes — expired password,
account risk, disabled account, blocked by policy, MFA needed — to a sentence
and a next step. `graph.ts` turns a match into a `SessionExpiredError` carrying
that text, which puts it through the existing re-auth path: one sign-in screen,
one explanation, instead of the same paragraph nine times.

Three things to keep:

- **The set is deliberately narrow.** Several AADSTS codes are normal
  silent-auth outcomes the app already handles by degrading — `50058` is just
  "nobody is signed in". Routing those to a sign-in screen would be worse than
  the problem. Unknown codes fall through untouched.
- **The code number stays in the message.** Whoever contacts IT needs to say
  which one it was.
- **`markSessionExpired(reason?)` keeps the FIRST reason.** Nine queries fail
  together; they must not overwrite each other's message.

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

**Engineering can create a project folder from ARC** (Ray, 2026-08-20) —
`createProjectFolder(name, projectLookupId)` in `api/projectFiles.ts`, behind
the "New project folder" button at the ROOT of `/project-folders`. It creates
the folder and then tags it, in two calls, because a folder's metadata can only
be set once the item exists.

Four things it has to get right, all for the same reason —
`resolveFolderForProject` picks the FIRST folder matching a project, so a
duplicate makes task uploads land arbitrarily:

- **A project that already has a folder is refused**, naming the folder it has.
  The form also labels those projects "— has a folder" rather than hiding them,
  so it's obvious why one can't be picked.
- **The create uses `conflictBehavior: fail`**, so a clashing name errors
  instead of silently becoming "0017-AMP-5000 Refresh 1".
- **The write key is discovered, not hardcoded** (`projectRefWriteKey`).
  Reading already auto-detects the Project Reference column because its
  internal name varies by site; writing needs the exact key, so it's learned
  from a folder that already carries one — Graph returns a `…LookupId` sibling
  for a lookup column and that's the writable half. Falls back to
  `ProjectReferenceLookupId` on an empty library.
- **A failed tag says the folder exists.** The folder is created either way, so
  the error tells the user to set Project Reference in SharePoint or delete it
  and retry — rather than implying nothing happened.

Creating also invalidates `["project-files", "folders"]`, the separate cache
the task-upload router reads. Without that, a task on the new project keeps
routing uploads to Miscellaneous until that cache ages out five minutes later.

Only top-level folders carry the tag, so the button appears only at the root —
inside a folder the action is Upload.

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

### Copying attachments between two list-items (EIR → Task promotion)

The EIR's and the task's list-item attachments are two separate SP REST
stores, keyed by parent kind (`"eir"` vs `"task"`), and Graph gives no way to
move or link them across list items. `copyAttachments(from, fromId, to, toId)`
in `src/api/attachments.ts` (added alongside the EIR promotion fix,
2026-08-26) downloads each of the source's files and re-uploads them to the
target — used by `usePromoteEirToTask` when the EIR carries any attachments.

Best-effort **per file**: one failed copy doesn't lose the ones that
succeeded, and the function never throws — it returns `{ copied, failed }` so
the caller can decide what to do with a partial result rather than the copy
going quiet about it. See "Hyperlink columns" above for how the caller
surfaces a failure here as a warning rather than swallowing it.

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
