# ARC MCP server — Phase 1 plan (read-only Tasks + EIRs)

**Issue:** [BusinessIT#10](https://github.com/Altronic-LLC/BusinessIT/issues/10) — requested by Thomas Terhune
**Branch:** `feat/10-arc-mcp-server`
**Status:** DRAFT for review — plan and the sign-in check (`mcp/scripts/test-signin.mjs`) only; the server itself is not built yet (2026-10-06)

## 1. What we're building

A small program people install on their own machine that lets Claude look
things up in ARC. Claude Desktop, Claude Code and the Claude Code VS Code
extension launch it locally (MCP over stdio). It signs the person in with
their own Microsoft account and reads SharePoint through Graph, exactly as
the web app does — so it can see what that person can see in ARC, and
nothing more.

**Decisions already made (Tim, 2026-10-05):**

| Question | Answer |
|---|---|
| Which Claude? | Desktop, Code, and the VS Code extension → a **local** server covers everyone. No hosting, no backend. |
| Writes in v1? | **No — read-only.** |
| First lists | **Engineering Tasks and EIRs.** |
| When writes come | They **must send the regular ARC notification emails.** |
| Where the code lives | **`mcp/` in this repo** (recommended; see §3). Confirm on review. |

**Out of scope for Phase 1:** writes of any kind, attachments/files, every
list other than Tasks + EIRs (+ the Projects list they both need), a hosted
server for claude.ai web/mobile.

## 2. What the spike proved

Run against this repo on 2026-10-05 (throwaway, in the session scratchpad):

- **`esbuild` bundles the `src/lib` mappers for plain Node** with only an
  `@` alias and an `import.meta.env` define — `taskMapper`, `eirMapper`,
  `taskGraph`, `taskFilters`, `eirFilters`, `itemSearch`, `people`,
  `communicationParser` and `api/config.ts` came to **39 KB**, nothing
  browser-only pulled in.
- **They run correctly in Node.** A sample task mapped with its assignee and
  comment; the comment's `MM/DD/YYYY 08:00:00 AM` came back as `12:00Z`
  (the Eastern-time rule held). An EIR with a bare `ReporterLookupId`
  resolved its name through `attachEirReferences`, and `matchesEirView(e,
  "new")` answered correctly.
- **HTML → readable text works with no DOM.** `toPlainTextForEditing` turned
  `<div class="ExternalClass…"><p>Line one&#58; <strong>bold</strong></p><ul>…`
  into `"Line one: bold\na\nb"`. `sanitiseHtml` (DOMPurify) is NOT needed —
  the server returns text, never HTML to render.

So the reuse story is real: the hard-won SharePoint knowledge (field names,
the bare-LookupId trap, the comment timestamp clock, the filter semantics)
does not get re-typed.

## 3. Where the code lives — `mcp/` in this repo

People never clone either way; they install one release file. What decides
the repo is that the server must import the same mappers the web app uses,
and that Phase 2 (writes + email) means moving notification logic out of
the React hooks into shared code both sides call. Both are one-commit
changes in one repo and a cross-repo versioning exercise in two.

```
mcp/
├── package.json            own version + deps (sdk, msal-node, zod)
├── CHANGELOG.md            the server's own release notes (NOT src/data/changelog.ts)
├── build.mjs               esbuild: alias @ → ../src, define import.meta.env
├── manifest.json           Claude Desktop extension (.mcpb) manifest
└── src/
    ├── index.ts            McpServer + StdioServerTransport; registers tools
    ├── auth.ts             msal-node PublicClientApplication + encrypted cache
    ├── graph.ts            Node Graph client: token, retry, paging, errors
    ├── data.ts             listTasks / listEirs / listProjects / siteUsers + TTL cache
    ├── format.ts           Task/Eir → compact text-friendly JSON
    └── tools/
        ├── tasks.ts        arc_search_tasks, arc_get_task
        ├── eirs.ts         arc_search_eirs, arc_get_eir
        └── common.ts       arc_whoami, arc_list_projects
```

**The one-way rule, enforced by a test:** `mcp/src/**` may import
`@/lib/*`, `@/types/*` and `@/api/config` — and nothing else from `src/`.
Nothing in `src/` ever imports from `mcp/`. (Same spirit as the existing
"shared layer never imports a department" rule and `App.routes.test.ts`.)

**Open choice — how `npm test` picks it up.** Recommended: npm
**workspaces** (`"workspaces": ["mcp"]` at the root) plus a Vitest
`projects` entry for `mcp/` with `environment: "node"`. Then the existing
deploy gate (`npm test`) covers the server too and one `npm ci` installs
both. The cost is that the root `package-lock.json` gains the server's
dependencies. The alternative — a separate workflow that only runs on
`mcp/**` changes — keeps the web app's install untouched but means a
mapper change can break the server without the deploy noticing. I'd take
the workspace.

## 4. Prep refactors in the web app (zero behaviour change)

Small moves so the server can import what it needs without dragging in
MSAL-browser or React. Each is a `chore:` commit with no changelog entry.

| # | Move | Why |
|---|---|---|
| R1 | `TASK_FIELD_SELECT` from `api/tasks.ts` → exported from `lib/taskMapper.ts` | The column list must match the mapper; co-locating them is what its own comment asks for, and the server needs the identical `$select`. |
| R2 | EIR `select` array from `api/eirs.ts` → `EIR_FIELD_SELECT` in `lib/eirMapper.ts` | Same. It carries the Reporter-needs-both-halves fix. |
| R3 | `Filters` interface from `components/FilterBar.tsx` → `lib/taskFilters.ts` (FilterBar re-exports) | `lib/` currently type-imports a component. Erased at build, but it would trip the boundary test and is backwards anyway. |
| R4 | `parseRetryAfterMs` / `retryDelayMs` / `fetchWithRetry` / `GraphError` from `api/graph.ts` → `api/graphRetry.ts` (no imports) | `graph.ts` imports MSAL-browser at the top, so the throttle retry can't be reused today. One retry policy for both. |
| R5 | The User Information List item → `Person` mapping from `api/eirs.ts` `listSiteUsers` → `lib/siteUserMapper.ts` | EIR reporter names depend on it. |

`lib/people.ts` reads `import.meta.env.VITE_HIDDEN_PEOPLE`; the build
define covers that, no move needed.

## 5. Sign-in

- **`@azure/msal-node` `PublicClientApplication`, ARC's own client ID and
  tenant.** Both are already public (they're in the web bundle). Reusing the
  app registration keeps every existing `Sites.Selected` site grant — a new
  registration would need fresh grants on all five site collections.
- **Scopes:** `User.Read`, `Sites.Selected`. (`Mail.Send.Shared` waits for
  Phase 2.)
- **Flow:** `acquireTokenSilent` first; `acquireTokenInteractive` (opens the
  system browser, catches the redirect on a loopback port) only when MSAL
  says interaction is required. Interactive sign-ins are serialised behind
  one shared promise — the `graph.ts` lesson: parallel tool calls must not
  each open a browser.
- **More than one cached account → never pick one silently.** The
  `AuthGate` rule from CLAUDE.md applies verbatim: ask with
  `prompt: "select_account"`.
- **Token cache encrypted at rest** via `@azure/msal-node-extensions`
  (DPAPI CurrentUser on Windows, Keychain on macOS), under
  `%LOCALAPPDATA%\ARC MCP\`.
- **A setup command**, `arc-mcp login`, so the first sign-in happens at
  install time rather than in the middle of somebody's first question.
- **stdout belongs to the protocol.** All logging goes to stderr; a stray
  `console.log` corrupts the stdio stream.

**Entra prerequisite (IT, one change):** ARC app registration →
Authentication → Add a platform → **Mobile and desktop applications** →
custom redirect URI `http://localhost`. Checked 2026-10-05: today only SPA
redirects exist (`http://localhost:5173/` and the two Pages URLs). An SPA
redirect can't be used — Entra only lets a browser redeem those codes
(`AADSTS9002327`), and SPA ports must match exactly while msal-node's
loopback port is random. "Allow public client flows" can stay **off**
(only device-code needs it). Also worth asking IT: does Conditional Access
allow a desktop app sign-in for this app?

**Checking it:** `cd mcp && npm install && npm run test-signin`
(`mcp/scripts/test-signin.mjs`). It signs in exactly as the server will and
reads one task, so one run reports the redirect (AADSTS50011 if missing),
Conditional Access (AADSTS53xxx) and the Sites.Selected grant (403) as
separate PASS/FAIL lines. The quick config-only check is
`az ad app show --id <client id> --query "publicClient.redirectUris"` —
`[]` means not added yet (still the case on 2026-10-06).

## 6. Data layer

Mirrors `listTasks()` / `listEirs()` in `src/api/`, using the moved
`$select` lists and the same joins:

| Read | Requests (parallel) | Joins |
|---|---|---|
| Tasks | Task list items (paged), Projects list | `toTask` → `attachTaskRelationships` → `attachProjectTitles` |
| EIRs | EIR list items (paged), Projects list, Engineering User Information List (best-effort) | `toEir` → `attachEirReferences` |
| Me | `/me?$select=mail,userPrincipalName,otherMails` | the mailbox-vs-UPN rule (`lib/emailIdentity`) so "assigned to me" works for Steve Pirko too |

- **Whole-list fetch, in-memory cache, ~2 minute TTL** (the web app's React
  Query staleness), with a `refresh: true` input on the search tools. A
  conversation asks several questions in a row; re-downloading the task
  list for each is the expensive part.
- **List IDs are baked in at build time**, the same `VITE_*` values
  `deploy.yml` passes. `SP_SITE_ID` and `SP_LIST_ID` have no defaults in
  `config.ts`, so the release workflow must pass them (the "a new `VITE_*`
  var must be in `deploy.yml`" lesson, applied to a second workflow).
- **A 403 is said out loud, never returned as an empty list.** Tool results
  carry `"You don't have SharePoint access to the EIRs list — ask an
  admin"` (the same wording the web app uses). A zero-row read where
  SharePoint reports rows (`listItemCount`'s untrimmed count) gets the same
  treatment in a later pass.
- **A 401 / dead session** triggers one interactive sign-in, not an error.

## 7. Tools (v1)

All carry `annotations: { readOnlyHint: true, openWorldHint: false }`.
Inputs are zod shapes; outputs are compact JSON text, every item with its
ARC link (`https://altronic-llc.github.io/altronic-arc` + `appItemPath`).

| Tool | Inputs | Returns |
|---|---|---|
| `arc_whoami` | — | who the server is signed in as (name, mailbox, sign-in name) |
| `arc_list_projects` | `query?` | id + title, so "AMP-5000" can become a project filter |
| `arc_search_tasks` | `query?`, `project?` (id or name), `status?` (one of `STATUSES` or `ALL_ACTIVE`), `assigned?` (`"me"` / email / name), `watching?`, `createdBy?`, `limit` (25, max 100), `refresh?` | rows: id, numbered title, status, priority, due, assignees, project, link; plus total match count |
| `arc_get_task` | `id`, `commentLimit?` (20) | every mapped field, description as text, checklist items, parent + child tasks, comments newest first (author, time, text), link |
| `arc_search_eirs` | `query?`, `view?` (`all`/`new`/`needs-assigned`/`at-risk`/`ltb`), `status?` (or `ALL_OPEN`), `engineer?`, `reporter?`, `project?`, `limit`, `refresh?` | rows: id, EIR No, title, status, resolution, engineers, project, LTB date, link |
| `arc_get_eir` | `id` **or** `eirNo` (`EIR_2026-0245`) | every mapped field incl. engineering response and where-used as text, comments, link |

Semantics come from the shared code, not a re-implementation:
`applyFilters` / `tokenizeQuery` for tasks, `applyEirFilters` +
`matchesEirView` + `effectiveEirStatusFilter` + `sortEirsForView` for EIRs
(so At Risk ignores the status filter, exactly as the screen does).

**Tool descriptions say the content is user-written.** Descriptions and
comments are typed by many people; a tool result can contain text that
looks like an instruction. With read-only tools the blast radius is small,
but the habit matters before Phase 2 adds writes.

## 8. Packaging and install

| Who | How |
|---|---|
| Claude Desktop | A **`.mcpb` extension** (`@anthropic-ai/mcpb pack`) — double-click to install; Desktop runs it on its bundled Node. |
| Claude Code (CLI + VS Code extension) | Unzip the release folder, then `claude mcp add --scope user arc -- node "<folder>\server\index.mjs"` |

- **Desktop and Code do NOT share MCP servers.** Installing the `.mcpb`
  in Desktop doesn't make it available in Code: `claude mcp
  add-from-claude-desktop` only works on macOS/WSL, and it reads Desktop's
  config file, not its extensions. Somebody using both installs it twice.
  Pointing Code at the folder Desktop unpacked the extension into is
  fragile (the path can move on update, and Desktop's bundled Node isn't
  on PATH).
- **Both installs share one sign-in.** The token cache lives at a fixed
  per-user path (`%LOCALAPPDATA%\ARC MCP\`), not inside the install
  folder, so signing in from either one signs in both.
- Built by a new **`.github/workflows/mcp-release.yml`**, triggered by an
  `mcp-v*` tag, attaching both to a GitHub Release. Nothing secret ships:
  client ID, tenant and list IDs are already in the public web bundle.
- **Risk to verify first in scaffolding:** `msal-node-extensions` uses a
  native module for DPAPI/Keychain, so the server can't be one single `.mjs`
  file — it ships with its `node_modules`. Fine inside `.mcpb` and a zip;
  confirm the prebuilt binary loads on Desktop's bundled Node.
- **Risk:** Claude Code's native installer doesn't need Node, so some
  people may not have it. Options if that bites: point them at the `.mcpb`
  (if they also have Desktop), or a Node single-executable build later.
  Worth asking who'd be in the first batch.
- **In-app:** a "Using ARC with Claude" section in `ManualView` (with the
  install steps and the download link) — that IS a user-visible web change,
  so it gets a normal `changelog.ts` entry + `version.json` bump when it
  ships. The server itself versions separately in `mcp/CHANGELOG.md`.

## 9. Tests

Repo standard is full coverage; the server's tests are mostly about the
request shapes and the rules that are invisible without real mode.

- **Boundary guard** — reads `mcp/src/**` and fails on any `src/` import
  outside `lib/`, `types/`, `api/config` (the `App.routes.test.ts` style),
  verified by adding a forbidden import and watching it fail.
- **Graph client** — retry on 429 with `Retry-After`, paging via
  `@odata.nextLink`, 403 → `NoAccessError`, 401 → one interactive retry.
- **Request shapes** — Tasks and EIRs `$select` equal the mapper's exported
  lists; EIR select includes both `Reporter` and `ReporterLookupId`.
- **Auth** — one cached account is used silently; two cached accounts force
  `select_account`; parallel calls share one interactive prompt.
- **Tools** — fixtures through each handler: filters, `"me"` resolving
  through every address the account carries, At Risk ignoring status, the
  `limit` cap with the total still reported, `eirNo` lookup, 403 wording.
- **Timezone** — tests pin `process.env.TZ` (the comment-clock lesson).
- **No `.env.local` dependency** — fixtures built by hand, not read from
  config (the CI-has-no-env lesson).

## 10. Work order (proposed commits)

1. `chore:` R1–R5 prep moves (web app tests stay green, no behaviour change).
2. `feat(mcp):` scaffold — workspace, build, `index.ts`, `arc_whoami`,
   auth + encrypted cache, Graph client. **Stop here and try sign-in on a
   real machine** — this is the step with the Entra and native-module risks.
3. `feat(mcp):` `arc_list_projects`, `arc_search_tasks`, `arc_get_task`.
4. `feat(mcp):` `arc_search_eirs`, `arc_get_eir`.
5. `feat(mcp):` `.mcpb` manifest, release workflow, install docs.
6. `v0.x.y:` "Using ARC with Claude" manual section + CLAUDE.md file
   overview + AboutView diagram node — the web-visible part.
7. Pilot with Thomas and a couple of others before announcing.

## 11. Phase 2 preview — writes with the regular emails

Not part of this plan, but it shapes it. Every side effect of a write lives
in the React Query hooks today, so a Graph-direct write would skip it:

- **Task comment:** `Communication` append with the eTag-conflict retry
  (`rewriteCommunication`), mention parsing, `notifyMentions` to watchers +
  mentioned people, auto-watch on mention (resolved against the right site).
- **Task create:** `computeNumberedTitle`, creator/assignee auto-watch,
  the `EIRReference`/`Communication` follow-up PATCH rule.
- **EIR changes:** status alerts, triage handover alerts, role-gated fields.

The plan for then: extract each hook's "what happens after a write"
into a shared `src/services/` (or `lib/` + a Graph-port interface) that
both the hook and the server call, so there is one copy of each alert rule.
Sending mail also needs `Mail.Send.Shared` and the per-user Send-As grant,
exactly as the web app does — a person who can't send from ARC can't send
from Claude either.

## 12. Open questions for review

1. OK with `mcp/` + npm workspaces (§3)?
2. Can IT add the Mobile and desktop `http://localhost` redirect, and is
   Conditional Access OK with a desktop sign-in?
3. Who's in the pilot, and do they have Node / Claude Desktop?
4. Tool names prefixed `arc_` — fine, or something else?
5. Any EIR or task fields people would ask about that the web mapper
   doesn't carry today (the server can only return what `toTask` / `toEir`
   map)?
