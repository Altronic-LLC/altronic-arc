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

```
src/
├── main.tsx                      Entry: providers + installErrorCapture()
├── App.tsx                       Top-level routes (all pages wired here)
├── vite-env.d.ts                 TypeScript types for VITE_* env vars
│
├── auth/
│   ├── msalConfig.ts             Client ID, tenant, redirect URI, scopes
│   ├── AuthProvider.tsx          MSAL bootstrap + MsalProvider wrapper
│   ├── AuthGate.tsx              Blocks the app until signed in (real mode)
│   └── SignInPage.tsx            Sign-in screen (+ Report-issue button)
│
├── api/                          All mock/real branches live here (USE_MOCK)
│   ├── config.ts                 USE_MOCK, SharePoint list IDs, EIR_ROLES_ENFORCED
│   ├── graph.ts                  graphFetch / graphFetchAll + JWT claim decode
│   ├── sharepoint.ts             SharePoint REST helper (list-item attachments)
│   ├── tasks.ts                  Task CRUD
│   ├── taskColumns.ts            Task list column metadata / choice discovery
│   ├── eirs.ts                   EIR CRUD
│   ├── eirRoles.ts               EIR role tags (engineer / supply chain) CRUD
│   ├── testSheets.ts             Test Results CRUD
│   ├── admins.ts                 Admins list CRUD
│   ├── csaListings.ts            CSA Listings CRUD (Engineering certification register)
│   ├── drawingLogs.ts            Drawing File Logs — 4 registers, one parametrised module
│   ├── teradyneLog.ts            Teradyne Log CRUD (Operations, PMO site)
│   ├── teradyneRefs.ts           Teradyne Employees/Products/Remarks (one parametrised module)
│   ├── projectFiles.ts           Documents-library project folders + files
│   ├── attachments.ts            List-item attachments (task | eir) via SP REST
│   ├── currentUser.ts            Resolve the signed-in user's SP lookupId
│   ├── email.ts                  @-mention notification mail (shared mailbox)
│   └── errorReport.ts            "Report issue" mail to the app manager
│
├── data/
│   ├── mockData.ts               Sample tasks, EIRs, projects, people
│   ├── dashboardMockData.ts      Sample dashboard metrics
│   ├── csaMockData.ts            Sample CSA certification files
│   ├── drawingLogMockData.ts     Sample drawings + sketches (incl. sparse & full change logs)
│   ├── teradyneMockData.ts       Sample Teradyne log + reference rows
│   └── changelog.ts              Version history (drives footer + history modal)
│
├── hooks/
│   ├── useTasks.ts               Tasks/projects queries + mutations
│   ├── useEirs.ts                EIR queries + mutations (optimistic + undo)
│   ├── useEirRoles.ts            EIR roles CRUD + useMyEirRoles() (field gating)
│   ├── useCsaListings.ts         CSA Listings queries + mutations
│   ├── useDrawingLogs.ts         Drawing log queries + admin-guarded mutations
│   ├── useTeradyne.ts            Teradyne log + ref-list queries/mutations (+ usage counts)
│   ├── useTestSheets.ts          Test sheet queries + mutations
│   ├── useAdmins.ts              Admins list CRUD
│   ├── useIsAdmin.ts             Is the signed-in user an admin? (+ bootstrap set)
│   ├── useCurrentUser.ts         Signed-in user as a Person
│   ├── useTaskFiles.ts           Project-folder + list-item files for a task
│   ├── useAttachments.ts         List-item attachment upload/list/delete
│   ├── useFilters.ts             URL-backed task filter state
│   ├── useTheme.ts               Dark/light toggle (localStorage)
│   └── useIsPhone.ts             Narrow-viewport media query
│
├── lib/
│   ├── cn.ts                     clsx + tailwind-merge helper
│   ├── communicationParser.ts    Parse/serialize the Communication field
│   ├── mentions.ts               @-mention parsing for comments
│   ├── taskMapper.ts             Graph item → Task
│   ├── eirMapper.ts              Graph item → Eir (field-name quirks)
│   ├── eirNumber.ts              nextEirNo() — EIR_YYYY-#### auto-numbering
│   ├── testSheetMapper.ts        Graph item → TestSheet
│   ├── csaListingMapper.ts       Graph item → CsaListing (+ label, sort, search)
│   ├── drawingLogMapper.ts       Graph item → DrawingLogEntry + the 16-slot change-log codec
│   ├── certificationExpiry.ts    Expiry buckets for dated certificates (built, not yet wired)
│   ├── spDates.ts                Shared SharePoint date-only helpers (midday-UTC rule)
│   ├── teradyneMapper.ts         Graph item → Teradyne entities; derived titles + date-only helpers
│   ├── taskGraph.ts              Parent/child task relationships + cycle checks
│   ├── taskFilters.ts            Pure task filter predicates
│   ├── graphFields.ts            multiPersonField / multiLookupField writers
│   ├── sanitiseHtml.ts           DOMPurify wrapper for stored HTML
│   ├── errorBuffer.ts            Bounded console-error capture (Report issue)
│   └── pcbChecklist.ts           PCB-category task checklist logic
│
├── types/
│   └── task.ts                   All domain types + constants (Task, Eir,
│                                 EirRole/EirRoleEntry, AdminEntry, Person, …)
│
├── components/
│   ├── Header.tsx                Top nav (view switcher, Admin link, theme, Report issue)
│   ├── Footer.tsx                Maintainer contact + version → changelog modal
│   ├── UserMenu.tsx              Account avatar menu
│   ├── Toast.tsx                 Toast + undo container
│   ├── LoadingTasks.tsx          Skeleton loading state
│   ├── StatusPills.tsx           Task list status counters
│   ├── FilterBar.tsx             Task Project / Assigned / Search / Created By filters
│   ├── SearchableSelect.tsx      Single/Multi select (summary + chips variants)
│   ├── AutoGrowTextarea.tsx      <textarea> that grows to fit content (typed/pasted)
│   ├── PersonMultiField.tsx      Multi-person picker (pills + add)
│   ├── TaskRow.tsx               One task row (list view)
│   ├── KanbanCard.tsx            One Kanban card
│   ├── EirRow.tsx                One EIR row (EIRs list)
│   ├── TaskFormModal.tsx         Create/edit task
│   ├── EirFormModal.tsx          Create/edit EIR
│   ├── TestSheetFormModal.tsx    Create/edit test sheet
│   ├── CsaListingFormModal.tsx   Create/edit a CSA listing (+ attachments when editing)
│   ├── DrawingLogDetailModal.tsx  Drawing detail + change log (+ record a change)
│   ├── DrawingLogCreateModal.tsx  Add a drawing to a register
│   ├── TeradyneLogFormModal.tsx  Create/edit a Teradyne log entry
│   ├── CommentThread.tsx         Sorted comment list
│   ├── CommentComposer.tsx       New-comment editor (+ @-mentions)
│   ├── AttachmentsSection.tsx    EIR/comment attachments UI
│   ├── TaskAttachmentsSection.tsx  Task attachments (dual storage)
│   ├── PcbChecklistCard.tsx      PCB checklist on a task
│   ├── NotifyAppManagerButton.tsx  "Report issue" button + modal
│   ├── MermaidDiagram.tsx        (legacy) Mermaid renderer
│   ├── atoms.tsx                 Badges, chips, status colours
│   └── brand/{Brandmark,Wordmark}.tsx   Official Altronic marks
│
├── views/
│   ├── DashboardView.tsx         Landing dashboard (metric cards + breakdown)
│   ├── ListView.tsx              Task list
│   ├── KanbanView.tsx            Task drag-and-drop board
│   ├── DetailView.tsx            Task detail (description, sidebar, comments)
│   ├── PrintTaskView.tsx         Chrome-less printable task page
│   ├── ProjectView.tsx           Single-project task rollup
│   ├── EirsView.tsx              EIRs list — View tabs (All / New / Needs Assigned),
│   │                             status pills, filter bar
│   ├── EirDetailView.tsx         EIR detail (+ role-gated fields, see below)
│   ├── CsaListingsView.tsx       CSA Listings table (Engineering, admin-gated writes)
│   ├── DrawingLogsView.tsx       Drawing File Logs — four tabbed registers
│   ├── TeradyneLogView.tsx       Teradyne Log table + "Manage lists" menu (Operations)
│   ├── TeradyneRefListView.tsx   Edit one Teradyne reference list (:kind)
│   ├── TestSheetsView.tsx        Test sheets list
│   ├── TestSheetDetailView.tsx   Test sheet detail
│   ├── AdminProjectsView.tsx     Admin → Project References (/admin/projects)
│   ├── AdminAdminsView.tsx       Admin → Admins (/admin/admins)
│   ├── AdminEirRolesView.tsx     Admin → EIR Roles (/admin/eir-roles)
│   ├── AboutView.tsx             In-app architecture + ER diagrams
│   └── ManualView.tsx            In-app user manual
│
└── styles/
    └── globals.css               Tailwind + CSS variable theme tokens
```

### EIR list views (workflow tabs)

`EirsView` has a **View** tab bar above the status pills, driven by a `view`
URL param. The bucket predicate is `matchesEirView(eir, view)` (exported from
`EirsView.tsx`, unit-tested):

- **All** — no extra filter.
- **New** — no project reference AND no engineer assigned (fresh, needs triage).
- **Needs Assigned** — has a project reference but still no engineer assigned.
- **At Risk Parts** — `riskPart === "Active"` (mirrors the SharePoint "At Risk View"); grouped by RiskPart Level (Unassigned, then Level 1/2/3), each group collapsible.
- **LTB** — `ltbDate != null` (any EIR with a last-time-buy date set); sorted soonest-first. The LTB date also shows as a chip on EIR cards (`EirRow`).

Views compose with the status pills and the filter bar; all three axes live in
the URL so a view is shareable. To add another view: extend the `EirView` union
+ `matchesEirView` predicate, add a `<ViewTab>`, and document it here and in the
EIRs section of `ManualView.tsx`.

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
| `labels` | `Labels` | Multi-choice, parsed from `;#` delimited string |
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
into another list — the "Projects" list — which we haven't identified yet.

To find its list ID, run in PowerShell:

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

**There is NO expiry column** on this list. `certificationExpiry.ts` exists
(buckets, urgency sort, counts, tested) but is deliberately **not wired to
anything**: Ray chose to hold off on the expiry feature until the real data has
been used in the app. Wiring it needs a decision first — a new Expiry Date column
in SharePoint, or a rule deriving it from `DateCertified`.

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

**Clock numbers are read-only on the log form.** `Employee1Clock` /
`Employee2Clock` are real columns the app writes, but they're derived from the
picked employee's `ClockNum` and rendered as a display box, not an input — the
clock number belongs to the employee, maintained once on the Employees list.
The value is seeded from the entry being edited rather than re-derived on open,
so an old entry keeps the clock number it was logged with.

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

## EIR field permissions (roles)

Several EIR fields are edit-gated by role tags from the **EIR Roles** list:

- **Engineering Response**, **Technical Priority** → require the `engineer` role.
- **Buyer Code**, **Risk Part**, **Risk Part Level** → require the `supply chain` role.

These are editable on the EIR detail (the Part Details choice fields, gated via
`InlineSelectField`'s `disabled` prop) and also appear on the New EIR form's
Purchasing section. Every other EIR field stays editable by any signed-in user. A user can hold
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

This fires for comments on **both tasks and EIRs** — wired in `useTasks` / `useEirs` onSuccess → `notifyMentions()` in `src/api/email.ts`. The HTML template (`renderMentionEmail`) is shared and parametrised on `kind: "task" | "eir"` (wording, callout label, and the "Open this task/EIR" button). Design notes: the header bar is **Cooper Red** (a near-black header gets washed to muddy grey by Outlook dark mode; saturated red survives), with the ARC wordmark + intro + tagline; the button URL is built from `import.meta.env.BASE_URL` so it keeps the `/altronic-arc/` Pages sub-path. The Report-issue email (`src/api/errorReport.ts`) shares the same red-header styling.

**One-time setup for the shared mailbox (Exchange admin task):**

1. Create the shared mailbox in the Exchange admin centre (the app uses `automation@altronic-llc.com`).
2. Under **Mailbox delegation → Send As**, add every user who can post comments.
3. In the Entra ID app registration, ensure `Mail.Send.Shared` is included in the requested scopes (already in `src/auth/msalConfig.ts`). The first user to send mail will trigger an admin-consent prompt for this scope — an admin needs to consent.
4. Set the repo variable `VITE_SHARED_MAILBOX` to the mailbox address.

If `VITE_SHARED_MAILBOX` is unset, the app falls back to a console.warn (real mode) or console.info (mock mode) — no mail goes out, comments still post normally.

## Theming

Two themes, light and dark, controlled by a `.dark` class on `<html>`.
All colours flow through CSS variables defined in `src/styles/globals.css`
and exposed to Tailwind as `bg-bg`, `text-fg`, `border-border`, etc.
Adding a new colour means adding a CSS var first and then a Tailwind alias.

The accent colour is Cooper Red (`#CB2C30`). Cooper brand secondary colours
are available as Tailwind classes (`text-cooper-green`, `bg-ajax-yellow`, etc.).

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

- **Person picker (write):** Assigning users isn't wired up — currently the
  detail view only edits Status. Adding it requires writing to the
  `AssignedLookupId` field (see "Person fields" above).
- **Rich-text comment editor:** The composer is plain text wrapped in `<p>`
  tags. The Power Apps version uses a full WYSIWYG. If you want feature
  parity, swap `CommentComposer.tsx` for a Tiptap-based editor.
- **Attachments — dual routing:** Tasks store uploads in TWO places at once
  (best-effort on the list-item side, source-of-truth on the project folder
  side). See **Attachments** section below for the full picture.
- **Workflow buttons** (New Test, New Field Trial, Form E028, Form E029)
  from the original app are intentionally not implemented in the MVP.
- **Parent project resolution:** Needs the projects list ID
  (`VITE_SP_PROJECTS_LIST_ID`) — currently falls back to empty title until set.

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
