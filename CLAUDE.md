# Claude Code instructions for this repository

This file is the working manual for Claude Code when iterating on this app.
Read it before making non-trivial changes.

## What this app is

A web-based viewer and editor for the Altronic Engineering team's SharePoint
"Project Task List". Two views — List (default) and Kanban — sit over the
same underlying data. Hosted on GitHub Pages, authenticated per-user via
Microsoft Entra ID, reads/writes via Microsoft Graph.

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

## File-by-file overview

```
src/
├── main.tsx                      Entry: providers (Auth, QueryClient, Router)
├── App.tsx                       Top-level routes
├── vite-env.d.ts                 TypeScript types for VITE_* env vars
│
├── auth/
│   ├── msalConfig.ts             Client ID, tenant, redirect URI, scopes
│   └── AuthProvider.tsx          MSAL bootstrap + MsalProvider wrapper
│
├── api/
│   ├── config.ts                 USE_MOCK flag and SharePoint identifiers
│   ├── graph.ts                  Authenticated fetch wrapper (graphFetch, graphFetchAll)
│   └── tasks.ts                  All task CRUD (mock + real branches)
│
├── data/
│   └── mockData.ts               Sample tasks, projects, people — matches real schema
│
├── hooks/
│   ├── useTasks.ts               React Query hooks for tasks/projects/mutations
│   └── useTheme.ts               Dark/light toggle with localStorage persistence
│
├── lib/
│   ├── cn.ts                     clsx + tailwind-merge helper
│   ├── communicationParser.ts    Parse and serialize the Communication field
│   └── taskMapper.ts             Graph item → Task domain object
│
├── types/
│   └── task.ts                   All domain types (Task, Status, etc.) + constants
│
├── components/
│   ├── Header.tsx                Top bar with view switcher and theme toggle
│   ├── StatusPills.tsx           Top counter row on the list view
│   ├── FilterBar.tsx             Project / Assigned / Search / Created By filters
│   ├── TaskRow.tsx               One row in the list view
│   ├── KanbanCard.tsx            One card in the Kanban view (uses dnd-kit/sortable)
│   ├── CommentThread.tsx         Renders a sorted list of comments
│   ├── CommentComposer.tsx       Textarea + Send button for new comments
│   └── atoms.tsx                 Small reusable atoms (badges, chips, icons)
│
├── views/
│   ├── ListView.tsx              The default list page
│   ├── KanbanView.tsx            The drag-and-drop board
│   └── DetailView.tsx            Task detail with description, sidebar, comments
│
└── styles/
    └── globals.css               Tailwind + CSS variable theme tokens
```

## Data model

The source of truth for field names and shapes is `src/types/task.ts`. The
SharePoint internal column names (which is what Graph returns under
`item.fields`) are:

| Domain field | SharePoint internal name | Notes |
|---|---|---|
| `id` | (from `item.id`, not fields) | Numeric string in Graph, parsed to int |
| `title` | `Title` | |
| `numberedTitle` | `NumberedTitle` | Calculated, read-only |
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

For writing: SharePoint expects person fields as `LookupId` only. The
TaskField mutator (when added) needs to send e.g. `{ AssignedLookupId: 46 }`
or for multi-person `{ AssignedLookupId: { results: [46, 87] } }`. **This is
not yet implemented** — only Status and Communication updates are wired up.

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
- **Task List ID:** `42fb8c19-5f33-4fdd-9ef7-df6f21433588`
- **Task List name:** Project Task List

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

### Hook up the Header view switcher to add more views

Add another `<Link>` block in `src/components/Header.tsx`, matching the
pattern of the existing List and Kanban links.

## Known limitations / TODO

- **Person picker (write):** Assigning users isn't wired up — currently the
  detail view only edits Status. Adding it requires writing to the
  `AssignedLookupId` field (see "Person fields" above).
- **Rich-text comment editor:** The composer is plain text wrapped in `<p>`
  tags. The Power Apps version uses a full WYSIWYG. If you want feature
  parity, swap `CommentComposer.tsx` for a Tiptap-based editor.
- **Attachments:** Not yet implemented. Graph's support for list-item
  attachments is limited; the SharePoint REST API at
  `/_api/web/lists(guid'<list-id>')/items(<id>)/AttachmentFiles` works
  better. The same MSAL token works for both endpoints.
- **Workflow buttons** (New Test, New Field Trial, Form E028, Form E029)
  from the original app are intentionally not implemented in the MVP.
- **Parent project resolution:** Needs the projects list ID
  (`VITE_SP_PROJECTS_LIST_ID`) — currently falls back to empty title until set.

## Testing checklist when you change things

After any non-trivial change:

1. `npm run typecheck` — no TS errors
2. `npm run dev` — app loads with mock data, no console errors
3. Click around all three views (list, kanban, detail)
4. Try drag-and-drop on the Kanban (a card should move and persist)
5. Try adding a comment (it should appear at the top of the thread)
6. Toggle the theme (everything should re-skin cleanly)
7. `npm run build` — production build succeeds

For real-mode testing, set `VITE_USE_MOCK=false` and confirm:
- Login pops up on first navigation
- List loads from Graph
- A drag-and-drop status change persists in SharePoint
- A new comment appears in SharePoint when viewed in the original app
