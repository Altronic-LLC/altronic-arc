# ARC — Altronic Resource Center

**Every team. One ARC. Always forward.**

A company-wide platform that brings every Altronic department's tools into one
web app, behind a single Microsoft sign-in. One codebase, one app — replacing
what would otherwise be separate Power Apps, Power Automate flows and one-off
SharePoint views. Any new department tool should land here.

Hosted at <https://altronic-llc.github.io/altronic-arc/>.
Built to be iterated on with [Claude Code](https://claude.com/claude-code) —
**`CLAUDE.md` is the working manual** (file-by-file guide, every list's
quirks, and the rules each one was learned from). Read it before a
non-trivial change.

## What's in the app

Each department is its own lazy-loaded section; they share sign-in, the
SharePoint/Graph layer, the UI kit and one theme.

| Department | Tools |
|---|---|
| **Engineering** | Tasks (list + board), EIRs (list + board), Test Sheets, ECNs + the MFGFRM-038 checklist, Build Requests, Drawing File Logs, CSA Listings, Parts List, Project Folders, Where am I? |
| **Panels** | Panel Orders, Panel Tasks, QC Time Tracking, Panel QC Issue Tracker (with label printing) |
| **Operations** | Operations Tasks, Maintenance (work orders, PM schedules, assets, calendar), Teradyne Log, Harness Production Log |
| **Coils** | Potting Sample Log, Coil Defect Log |
| **Quality Control** | QC Forms (CPU-95 test sheet), Digital QC Defect Log, Ignition QC Defect Log |
| **Supply Chain** | Suppliers (SRM), FAITs, Gray Market Requests, MRB, Cost Impact Notices, SCNs + SCN Documents, Supply Chain Files, Insourcing Quotes |
| **Customer Service / Sales** | Visit Reports, Customers (CRM), Open Orders Report, Sales Documentation, Pricing *(in review — one reviewer only)* |
| **Everyone** | Dashboard, My Agenda, ARC Feature Requests, User Manual (`/manual`), About (`/about`), Admin (`/admin/*`) |

Reports (fixed KPI dashboards and a kiosk view) exist but are reached by URL
only — see CLAUDE.md.

**Data:** SharePoint lists and libraries across several team sites, read and
written through Microsoft Graph v1.0 with **`Sites.Selected`** (granted per
site collection). The Pricing tool's Calculator also reads SAP cost from the
**Fabric SAP warehouse** through Fabric's API for GraphQL — read-only.

**Access:** Microsoft Entra ID (MSAL, PKCE). Which tools a person sees comes
from their SharePoint access and ARC's role lists — that is navigation, **not
security**. The bundle is public JavaScript; the real boundary is
SharePoint's (and Fabric's) own permissions, per list.

## By the numbers

As of v0.191.0, 2026-10-16:

| | |
|---|---|
| Tests | **7,932** in **617** test files, all passing — about 6½ minutes in CI |
| Source | **691** files, about **206,000** lines (tests add **105,000** more) |
| Screens | **121** views across **124** routes |
| Building blocks | **155** components · **92** hooks · **98** API modules · **172** pure-logic modules |
| SharePoint | **93** list ids configured, across **7** sites |
| History | **450** releases in the changelog · **553** commits |
| Scripts | **42** in `scripts/` (list creation, data loads, schema discovery) |

The test figures are the deploy's own (`gh run view <run> --log`, the
**Test Files** and **Tests** lines); the rest are `git ls-files` counts, test
files excluded from the source figures.

## Running it locally

```bash
npm install
npm run dev        # http://localhost:5173/
```

There are three ways to run it, chosen by environment files (all git-ignored):

| Mode | How | What you get |
|---|---|---|
| **Demo** | `npm run dev` with no env files | Sample data for every tool, no sign-in, no network. Press **Continue as Demo User** (a Pricing admin, so every screen can be walked). |
| **Demo + live Calculator** | `.env.development.local` with `VITE_USE_MOCK="true"`, `VITE_FABRIC_IN_DEMO="true"`, `VITE_AZURE_CLIENT_ID` and `VITE_AZURE_TENANT_ID` | Demo data everywhere, but Pricing's Calculator looks SAP cost up **live** from Fabric, after a one-off **Sign in to SAP** popup. Dev server only — no build can switch it on. |
| **Fully live** | `npx vite --mode fabric --port 5173`, with the repo's `VITE_*` variables in `.env.fabric.local` and `VITE_USE_MOCK="false"` | Signs in as you and reads and writes **real SharePoint** — be careful. `/dev/fabric-test` runs any Fabric GraphQL query by hand. |

To fill `.env.fabric.local` from the repo's variables:

```bash
gh variable list --json name,value \
  -q '.[] | select(.name|startswith("VITE_")) | select(.name!="VITE_QZ_CERTIFICATE" and .name!="VITE_USE_MOCK") | "\(.name)=\"\(.value)\""' \
  > .env.fabric.local
echo 'VITE_USE_MOCK="false"' >> .env.fabric.local
```

(`VITE_QZ_CERTIFICATE` is multi-line and only needed for label printing.)
The Entra app lists `http://localhost:5173/` and the Pages URL as SPA
redirect URIs, so sign-in works on that port.

## Configuration

Every `VITE_*` value is baked in at **build** time from **GitHub repo
Variables** (Settings → Secrets and variables → Actions → Variables) — setting
one does nothing until the next deploy. `src/api/config.ts` is the one place
they're read; most list ids carry a documented default there, and some are
deliberately unset so a feature stays off until it's turned on.

**A new `VITE_*` variable must also be added to the named list in
`.github/workflows/deploy.yml`**, or it can never reach a production build.

## Deploying

`.github/workflows/deploy.yml` tests, builds and deploys to GitHub Pages on
every push to `main`. **`npm test` gates the deploy** — a red suite ships
nothing. `main` is protected: changes go in through a pull request, squash
merged. `.github/workflows/pr.yml` runs the typecheck and the same tests on
every pull request, so a red suite is caught before it reaches `main`; make
its `verify` job a required status check so that holds.

**Rolling back:** run *Deploy to GitHub Pages* by hand (Actions → Run
workflow) and put the last known-good commit SHA in the `ref` box — that
build is tested and redeployed exactly as it was, no revert commit needed.
Then fix forward on a branch. `git revert` + merge works too, just slower.

Every user-visible change gets a changelog entry in `src/data/changelog.ts`
(shown in the footer's version history) and the same version in
`public/version.json` — that file is what tells people already in the app that
a new version is out. CLAUDE.md has the full protocol, including what release
notes may and may not say.

## Checks

```bash
npm run typecheck   # tsc
npm test            # Vitest + React Testing Library — 7,900+ tests
npm run build       # production build
```

Tests run in Vitest's `test` mode and never read your `.env.*.local` files —
the deploy has none, so a test must not depend on one.

jsdom can't see layout, so UI changes are also checked by eye:

```bash
node scripts/screenshot-page.mjs http://localhost:5173/<route> '<css selector>' out.png [light|dark]
```

It drives your installed Chrome headless, signs in as the demo user and
captures one element. `SHOT_WIDTH`, `SHOT_CLICK`, `SHOT_TYPE`,
`SHOT_THEN_CLICK` and `SHOT_WAIT_MS` cover other widths, dialogs and forms; it
warns when the page scrolls sideways and prints any page errors.

## Architecture

```
src/
├── auth/          MSAL config + provider, sign-in screens
├── api/           One module per SharePoint list (and Fabric), each with a
│                  mock branch and a real one — the only code that knows which
├── hooks/         React Query hooks per list, optimistic writes, role gates
├── lib/           Pure rules: mappers, numbering, pricing maths, alerts
├── types/         Domain types
├── components/    Shared UI + per-department atoms and forms
├── views/         One component per route
├── data/          Mock data + the changelog
└── styles/        Tailwind + CSS-variable themes (light and dark)
```

The rule that holds it together: **every data call goes through
`src/api/<list>.ts`, which branches on `USE_MOCK`** — so any feature can be
built and demoed on mock data before its SharePoint list exists. A new list
follows the same `api/` → `hooks/` → `views/` shape, and a new table ships
with sorting and column filters. CLAUDE.md has the recipes, including keeping
the About page diagrams and the User Manual current.

## Tech stack

- React 18 + Vite + TypeScript
- Tailwind CSS, CSS-variable theming
- MSAL.js (Entra ID, PKCE) and Microsoft Graph v1.0
- TanStack Query — caching and optimistic updates with undo
- React Router v6, dnd-kit (boards)
- ExcelJS and jsPDF, loaded only when a report or PDF is made
- Vitest + React Testing Library

## Where to look

- **User Manual** (`/manual`) — how each tool is used.
- **About** (`/about`) — system flow and the data-model diagram.
- **`CLAUDE.md`** — the working manual for changing the code.
- **`BACKLOG.md`** — what's queued.
- **`docs/`** — design notes (Insourcing Quotes, guest notifications).
