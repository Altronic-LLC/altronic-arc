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

**Skip the changelog AND short-form the commit** only for: internal-only
refactors with zero behavior change, dependency bumps without user impact,
comment edits, typo fixes in code comments. For these, a one-line commit
like `chore: tidy useTasks comments` is fine and no changelog entry needed.
When in doubt, do the full protocol — it's free.

The footer reads `CURRENT_VERSION` automatically, so bumping the top entry
of `CHANGELOG` is the only place you need to change the version itself.

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
│   ├── mockData.ts               Sample tasks, projects, people — matches real schema
│   └── changelog.ts              Version history (drives the footer + history modal)
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
│   ├── Header.tsx                Top bar with logos, view switcher, theme toggle
│   ├── Footer.tsx                Maintainer contact + version (opens changelog modal)
│   ├── StatusPills.tsx           Top counter row on the list view
│   ├── FilterBar.tsx             Project / Assigned / Search / Created By filters
│   ├── TaskRow.tsx               One row in the list view
│   ├── KanbanCard.tsx            One card in the Kanban view (whole card draggable)
│   ├── CommentThread.tsx         Renders a sorted list of comments
│   ├── CommentComposer.tsx       Textarea + Send button for new comments
│   ├── atoms.tsx                 Small reusable atoms (badges, chips, icons)
│   └── brand/
│       ├── Brandmark.tsx         Official Altronic "A" mark — theme-aware
│       └── Wordmark.tsx          Official ALTRONIC wordmark — theme-aware
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
- **Task List ID:** `42fb8c19-5f33-4fdd-9ef7-df6f21433588`
- **Task List name:** Project Task List
- **Projects List ID:** `6280c711-14f6-4546-b730-8781b9d3c960` (env: `VITE_SP_PROJECTS_LIST_ID`)
- **Test Results List ID:** `52173cd3-74ca-4d30-95c4-7a6b2d765edc` (env: `VITE_SP_TEST_RESULTS_LIST_ID`) — drives the Test Sheets view and the "Create Test Sheet" button on tasks. Both Project Reference and Task Reference columns point back to the lists above, so creating from a task is just two `LookupId` writes.
- **EIRs List ID:** `8d00a762-288c-4678-afc4-cba2f24ac965` (env: `VITE_SP_EIRS_LIST_ID`) — Engineering Information Request list. Has its own Status / Resolution / Request Type workflows + a Communication field for comments. Project Reference is a lookup to the same Projects list; Task Reference is free-text. See `src/lib/eirMapper.ts` for the field-name quirks (`MFGP_x002f_N`, `Current_x0020_Price`, truncated `Requested_x0020_Completion_x0020`, the `Priority` choice column vs `Priority0` numeric column).
- **Shared mailbox** (env: `VITE_SHARED_MAILBOX`) — email address that @-mention notifications send FROM. See setup below.

## @-mention email notifications

When a user posts a comment with `@SomeoneName` chips (picked from the mention dropdown in CommentComposer), the app POSTs `/users/{shared-mailbox}/sendMail` for each mentioned person. The mail comes from the configured shared mailbox via Send-As, so every recipient sees a consistent "From" address rather than the sender's personal mailbox.

**One-time setup for the shared mailbox (Exchange admin task):**

1. Create the shared mailbox in the Exchange admin centre (e.g. `engineering-tasks@altronic-llc.com`).
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

`src/views/AboutView.tsx` holds two Mermaid diagrams (system flow + data
model) that double as the README for this app. They get out of date the
moment we add a piece and don't update them.

**Anything that's structurally visible to a user belongs in the diagram.
That means update the source strings at the top of `AboutView.tsx` in
the SAME commit when you:**

- Add or rename a route / view.
- Add a new hook category (e.g. `useTestSheets`, `useProjects`).
- Add a new module in `src/api/` (e.g. a third SharePoint list).
- Add a new SharePoint list to the data model, or a new field that
  introduces a new relationship between lists.

Preview your edits at <https://mermaid.live/> before pasting back in.
No code-review hand-wringing, no separate ticket — just edit the strings
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
