# ARC — Altronic Resource Center

**Every team. One ARC. Always forward.**

A company-wide platform that brings every Altronic department's tools and
processes into one web app, behind a single Microsoft sign-in. One codebase,
one app — replacing what would otherwise be separate per-department tools.

**Engineering** is the first team aboard. Its modules live here today: Task
tracking (list + kanban), Engineering Information Requests (EIRs), and Test
Sheets, sharing authentication, a SharePoint backend, a single theme, and an
in-app admin section. Purchasing, Supply Chain, Operations, and Customer
Service follow, each as its own module over the same foundation. Any tool that
would otherwise spawn its own Power App, Power Automate flow, or one-off
SharePoint view should land here instead.

Hosted at <https://altronic-llc.github.io/altronic-arc/>.
Built to be iterated on with [Claude Code](https://claude.com/claude-code).

## What's in the app today

| Module | Where it lives | Backed by |
|---|---|---|
| Dashboard | `/` | aggregates Tasks + EIRs |
| Tasks | `/list`, `/kanban`, `/task/:id` | SharePoint **Project Task List** |
| EIRs | `/eirs`, `/eir/:id` | SharePoint **Engineering Information Request** list |
| Test Sheets | `/test-sheets`, `/test-sheet/:id` | SharePoint **Test Results** list |
| Projects (admin) | `/admin/projects` | SharePoint **Projects** list |
| Admins (admin) | `/admin/admins` | SharePoint **Admins** list |
| Attachments | inline on task detail | SharePoint **Documents** library, project-folder routed |
| User Manual | `/manual` | In-app documentation |
| About | `/about` | System flow + ER diagram |

Sign-in is Microsoft Entra ID (MSAL, PKCE). Reads/writes use Microsoft
Graph v1.0 with the `Sites.Selected` scope — granted per-site on the
Altronic Engineering team site.

## Attachments

Tasks **do not** use SharePoint list-item attachments. Files are routed
to the team's `Documents/General/Project Folders/` library:

1. Every project folder there is tagged with a `Project Reference` lookup
   column pointing at the Projects list.
2. When you upload a file on a task, the app looks up the task's
   project, finds the folder tagged with that project, and uploads
   there. The task shows the 5 most-recently-modified files in that
   folder with a **View all in SharePoint →** link to the folder.
3. If no folder is tagged with the task's project, the file goes into
   the shared **Miscellaneous** folder with the project code prefixed
   onto the filename (`349-MT-ACI_drawing.pdf`) so it stays findable.
4. The same routing applies to **comment attachments**: drop a file into
   the comment composer and it uploads to the project folder, then
   inlines a hyperlink to it in the comment body.

EIRs still use list-item attachments for now (see the backlog if you
want that migrated).

## Quick start

```bash
# Install
npm install

# Run with mock data — no auth, no network
npm run dev
```

Open <http://localhost:5173/> and the app boots with realistic sample
data: tasks, EIRs, test sheets, projects, comments, admins. Changes
work locally and persist to `localStorage`; clear it to reset.

## Going live with real SharePoint data

1. Get the Entra app's **Client ID** from your admin (see
   `docs/admin-request.md` for the request template if you need to ask
   for one).
2. Copy `.env.example` to `.env.local` and fill in:
   - `VITE_USE_MOCK=false`
   - `VITE_AZURE_CLIENT_ID=<client id>`
   - The other variables are already pre-populated with confirmed list
     and site IDs.
3. The Entra app must list both `http://localhost:5173/` (dev) and your
   GitHub Pages URL (`https://altronic-llc.github.io/altronic-arc/`)
   as SPA redirect URIs.
4. `npm run dev` — you'll be prompted to sign in on first load.

## Required environment variables

Set these as **GitHub repo Variables** (Settings → Secrets and
variables → Actions → Variables) so they bake into the production
bundle:

| Variable | Purpose |
|---|---|
| `VITE_USE_MOCK` | `false` for real-mode deploys |
| `VITE_AZURE_CLIENT_ID` | Entra app registration's client id |
| `VITE_AZURE_TENANT_ID` | Already known: `bde86e02-…` |
| `VITE_SP_SITE_ID` | Altronic Engineering site id |
| `VITE_SP_LIST_ID` | Project Task List list id |
| `VITE_SP_PROJECTS_LIST_ID` | Projects list id |
| `VITE_SP_TEST_RESULTS_LIST_ID` | Test Results list id |
| `VITE_SP_EIRS_LIST_ID` | EIR list id |
| `VITE_SP_ADMINS_LIST_ID` | Admins list id |
| `VITE_SHARED_MAILBOX` | Mailbox for @-mention notifications |
| `VITE_SP_SITE_URL` | Optional, only needed if EIRs migrate to SP REST attachments |

## Deploying

The workflow at `.github/workflows/deploy.yml` builds and deploys on
every push to `main`.

**One-time setup:**
1. GitHub → Settings → Pages → Source: **GitHub Actions**.
2. Add the variables above under Settings → Secrets and variables →
   Actions → Variables.
3. Push to `main`.

## Architecture

The full file-by-file guide lives in `CLAUDE.md`. Short version:

```
src/
├── auth/          MSAL config + provider
├── api/           Graph fetch wrapper + per-list modules
│                  (tasks, eirs, testSheets, admins, attachments,
│                   projectFiles, sharepoint)
├── data/          Mock data + changelog
├── hooks/         React Query hooks (useTasks, useEirs,
│                  useTestSheets, useAdmins, useTaskFiles, …)
├── lib/           Pure utilities (mappers, parsers, sanitiseHtml)
├── types/         Domain types
├── components/    Reusable UI pieces (Header, atoms, modals,
│                  AttachmentsSection, TaskAttachmentsSection, …)
├── views/         Page-level views — one per route
└── styles/        Tailwind + CSS-var theme
```

The app-wide rule: **every API call goes through a single function in
`src/api/<list>.ts`, which branches on `USE_MOCK`.** No other file
knows whether it's talking to a mock store or to Graph. New engineering
modules added to this app should follow the same shape.

## Tech stack

- React 19 + Vite + TypeScript — fast iteration, strict types
- Tailwind CSS — utility styling, CSS-var-driven theming, light + dark
- MSAL.js — OAuth 2.0 PKCE flow with Entra ID
- TanStack Query — data fetching, caching, optimistic updates with undo
- dnd-kit — Kanban drag-and-drop
- React Router v6 — every list / detail / admin route
- Vitest + React Testing Library — unit tests (currently ~250)

## Adding a new module

Treat ARC as the canonical home for any new department tool. Sketch:

1. Add a SharePoint list (or reuse an existing one).
2. Drop a new `src/api/<thing>.ts` with `list/get/create/update`
   functions and a mock branch.
3. Add a `src/hooks/use<Thing>.ts` with React Query wrappers.
4. Add `src/views/<Thing>sView.tsx` + `src/views/<Thing>DetailView.tsx`.
5. Wire routes in `src/App.tsx` and a nav entry in
   `src/components/Header.tsx` (under the "Engineering Requests"
   dropdown if it's a list-style module).
6. Update `src/views/AboutView.tsx` — add the new list to
   `SYSTEM_TIERS`'s SharePoint band, a new entry to `SCHEMA_TABLES`
   for the ER diagram, and any new foreign keys to `CONNECTIONS`.
7. Add a Manual section under `src/views/ManualView.tsx`.
8. Bump version + add a changelog entry in `src/data/changelog.ts`.

CLAUDE.md spells out the changelog + diagram update protocols in more
detail.

## Mock vs. real

A single env var: `VITE_USE_MOCK`.
- `true` (default) — data from `src/data/mockData.ts`, no auth.
- `false` — data from Microsoft Graph + the live SharePoint site.

Develop the entire UI without ever touching auth or Graph; the switch
is a single flip.

## Where to ask questions

- **In-app User Manual** (`/manual`) — answers most user questions.
- **About page** (`/about`) — visual system flow + ER diagram.
- **`CLAUDE.md`** — the working manual for whoever (or whatever) is
  modifying the code.
- **`BACKLOG.md`** — what's queued, what's shipped.
