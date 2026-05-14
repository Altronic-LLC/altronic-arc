# Altronic Engineering Task System

A SharePoint-backed Kanban + list viewer for the Altronic Engineering team's
Project Task List. Built to be developed with Claude Code and hosted on
GitHub Pages.

## Quick start

```bash
# Install
npm install

# Run locally with mock data (no auth needed)
npm run dev
```

Open <[http://localhost:5173](https://altronic-llc.github.io/altronic-engineering-tasks)> and the app comes up with realistic sample data.
The data is in-memory, so changes (drag-drop status, new comments, mark
complete) work but reset on refresh.

## Going live with real SharePoint data

1. **Get the Entra ID client ID** from your admin (see `docs/admin-request.md`
   for the request template).
2. Copy `.env.example` to `.env.local` and fill in:
   - `VITE_USE_MOCK=false`
   - `VITE_AZURE_CLIENT_ID=<the client ID from the admin>`
   - The other values are already pre-populated with confirmed IDs.
3. The Entra ID app registration must list both
   `http://localhost:5173` (for dev) and your GitHub Pages URL
   (e.g. `https://<owner>.github.io/altronic-engineering-tasks/`) as SPA
   redirect URIs.
4. Run `npm run dev` and you'll be prompted to sign in with your Microsoft
   account on first load.

## Deploying to GitHub Pages

The included workflow at `.github/workflows/deploy.yml` builds and deploys
on every push to `main`.

**One-time setup:**

1. In GitHub → Settings → Pages, set Source to "GitHub Actions".
2. In GitHub → Settings → Secrets and variables → Actions → Variables,
   create variables for `VITE_USE_MOCK`, `VITE_AZURE_CLIENT_ID`,
   `VITE_AZURE_TENANT_ID`, `VITE_SP_SITE_ID`, `VITE_SP_LIST_ID`,
   and `VITE_SP_PROJECTS_LIST_ID`.
   - For initial deploys, set `VITE_USE_MOCK=true` so the public site shows
     the demo data. Flip to `false` once auth is wired up and the redirect
     URI is registered.
3. Push to `main`. The workflow runs automatically.

## Architecture

See `CLAUDE.md` for the full file-by-file guide intended for Claude Code.
Short version:

```
src/
├── auth/          MSAL configuration and provider
├── api/           Tasks API + Graph fetch wrapper
├── data/          Mock data for development
├── hooks/         React Query hooks
├── lib/           Pure utilities (parsers, mappers)
├── types/         Domain types
├── components/    Reusable UI pieces
├── views/         Page-level components (List, Kanban, Detail)
└── styles/        Tailwind + theme tokens
```

## Tech stack

- **React + Vite + TypeScript** — fast iteration, strict types
- **Tailwind CSS** — utility-first styling, CSS-var-driven theming
- **MSAL.js** — OAuth 2.0 PKCE flow with Entra ID
- **TanStack Query** — data fetching, caching, optimistic updates
- **dnd-kit** — Kanban drag-and-drop
- **React Router** — `/`, `/kanban`, `/task/:id`

## Switching from mock to real

The mock-to-real switch is governed by a single env var: `VITE_USE_MOCK`.
- `VITE_USE_MOCK=true` (default) — all data comes from `src/data/mockData.ts`.
- `VITE_USE_MOCK=false` — all data comes from Microsoft Graph.

Every API call goes through `src/api/tasks.ts`, which branches on `USE_MOCK`.
No other file knows about the difference. This means you can develop the
entire UI without ever touching auth or Graph, and the switch-over is a
single env-var flip.
