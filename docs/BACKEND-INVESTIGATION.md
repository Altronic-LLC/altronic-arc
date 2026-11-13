# A small backend for ARC: investigation

**Status:** investigation only. Nothing is built or provisioned.
**Branch:** `investigate/small-backend`
**First written:** 2026-10-20, against v0.193.0.
**Reviewed:** 2026-11-13, against v0.221.0 on `main` plus the branches in
progress (`shopfloor-management`, `plant-management`, `64-harness-pull-test`,
`feat/10-arc-mcp-server`). §2a lists what changed; §11 is the roadmap.
**Closes, if built:** SEC-02 (QZ key in the bundle), SEC-04 (per-user Send-As),
part of SEC-03 (public bundle) and SEC-06 (no CSP). See the 2026-10-16 review
and the "Decisions on record" table in `CLAUDE.md`.

This repository is public. Nothing in this document is a secret, and nothing
the backend needs will ever be committed: secrets live in Azure Key Vault,
and deploys authenticate with OIDC, not stored credentials.

---

## 1. The short answer

Build **one Azure Function App** with a **managed identity** and a **Key
Vault**, and keep SharePoint as the database. The SPA keeps its MSAL sign-in
and calls the Function App with a token for an API scope ARC exposes.
Hosting the SPA itself on **Azure Static Web Apps** is a separate step that
can happen before, after or alongside.

The 2026-11-13 review doesn't change that answer. It changes the **order**:
three things that weren't on the list in October now point at the backend
(a tamper-proof Shop Floor claim, writes from the MCP server, and a growing
set of reminders that need a timer), and all three need the same Function
App the mail and signing work would create. See §11.

Do **not** use Static Web Apps' built-in "managed functions" for this. They
are the obvious first choice and they can't do the one thing this backend
is for:

| Managed functions (built into SWA) | Bring-your-own Function App |
| --- | --- |
| No managed identity | Managed identity |
| No Key Vault references | Key Vault references |
| HTTP triggers only, so no scheduled jobs | Every trigger, timers included |
| Consumption plan only | Any plan (Flex Consumption is enough) |
| Community reports that SWA replaces the caller's `Authorization` header with its own token | The caller's bearer token reaches the code unchanged |

Source: Microsoft Learn, "API support in Azure Static Web Apps with Azure
Functions" (table quoted above, updated 2026-06-02). The header behaviour is
from community threads, not Microsoft docs, so treat it as **unverified**;
it doesn't matter for the recommended shape, which doesn't route through the
SWA proxy.

---

## 2. What would move out of the browser

Everything below is in the public bundle or depends on a per-user grant today.

| Item | Today | Where in the code | Problem | After |
| --- | --- | --- | --- | --- |
| QZ Tray signing key | PKCS8 private key compiled into the bundle from the `VITE_QZ_PRIVATE_KEY` repo secret | `src/api/config.ts:49`, `src/api/qzPrint.ts:96-145`, `deploy.yml:259` | Anyone who downloads the bundle can sign QZ requests. Accepted risk (SEC-02) because the cert is trusted only on kiosk machines | Key in Key Vault; a `POST /api/qz/sign` endpoint signs. **The existing key must be rotated** — it has been public, so moving it without a new keypair changes nothing |
| Notification mail | Each user's own token calls `/users/{shared mailbox}/sendMail` (`postMail`); every commenter needs Send-As **and** FullAccess granted by hand | `src/api/email.ts:470-490`, `errorReport.ts`, `editFailureReport.ts` | Anyone holding the grant can send anything as the shared mailbox; new starters fail silently until added; guests can't send at all (hence the Power Automate guest flow); closing the tab mid-send cancels it (the "Leave site?" guard in `email.ts`) | Function sends as the mailbox with its **own** identity, scoped to that one mailbox by Exchange RBAC for Applications. Recipient policy enforced server-side. Per-user grants removed. Once the server has accepted a send, closing the tab no longer loses it |
| Scheduled work | Power Automate flows owned outside the repo (DueStatus, guest notifications); none for the reminders people have asked for (§5, "Scheduled functions") | `docs/POWER-AUTOMATE-GUEST-NOTIFICATIONS.md` | Not version-controlled; ownership unclear; every new reminder is a new flow | Timer-triggered functions in this repo |
| Shop Floor claims (in progress) | Each operator's kiosk writes the SFB Claims list as the signed-in kiosk account, so that account needs Contribute | `shopfloor-management` branch, `api/shopFloorClaims.ts` | Anyone with Contribute can edit a claim in SharePoint. **Accepted for the pilot** (Tim, 2026-11-13) because claims only drive the boards | When claims feed labor time, SAP confirmations or pay: a `POST /api/shop-floor/claim` that alone holds Edit on the list (§5a) |
| GitHub issue creation | Each manager pastes a personal access token into the browser | `src/hooks/useGitHubToken.ts` | A PAT in `localStorage`; XSS exfiltrates it (SEC-05) | Optional: a GitHub App whose private key is in Key Vault, issuing short-lived installation tokens |
| Recipient lists, staff addresses | Hardcoded defaults in `config.ts` | `src/api/config.ts` (SEC-03) | Public | Unchanged by the backend. Closed by the private repo and SWA sign-in in front of every file |

What does **not** move: SharePoint reads and writes (Shop Floor claims aside,
later), Fabric lookups, attachments. They already run on the signed-in user's
delegated token, and SharePoint's per-list permissions — and, for SAP data,
Fabric's per-item permissions — are the right boundary for them. Moving them
behind a server would add latency and a second copy of the permission model
for no gain.

---

## 2a. What changed between 2026-10-20 and 2026-11-13

Sixty commits (v0.193.0 → v0.221.0) plus four branches in progress. What
matters for this design:

### Mail: more of it, sent differently, still on per-user grants

- **One email per reason, Bcc'd** (v0.204.4). A send is now one `sendMail`
  per reason with several people in `bccRecipients`, not one per person. The
  `/api/mail/send` body therefore carries `to` **or** `bcc` (§5), and the
  recipient policy must check both. Fewer, larger sends also make a
  per-caller rate limit simpler to set.
- **More features email from the browser**: the MCN workflow (v0.204.0), EIR
  ⇄ task shared comments (v0.205.0), the ECN distribution list (v0.215.0),
  panel order tasks (v0.216.0), and clearer subjects on task / EIR / build
  request mail (v0.218.0). Every one of them inherits the Send-As dependency.
- **Report issue was silently broken from late August to v0.201.1**
  (2026-10-22): it had no address to send to, and every report was refused.
  That is the same class of failure as a new starter's mentions going
  nowhere — mail that fails without anyone seeing it. A server-side send with
  its own logs and an alert on failures is the structural fix; the in-app
  toast only reaches the person who pressed the button.
- **SEC-04's IT stopgap hasn't happened.** The BACKLOG item (Send-As +
  FullAccess through a security group) is still open. It is still worth doing
  first: it costs IT ten minutes and helps until the backend exists.

### Fabric became a core dependency — and stays in the browser

October had one Fabric read (the Calculator's cost). Now: Pricing's SAP part,
customer and list-price lookups (v0.196.0–v0.197.0), supplier performance
(v0.198.0, `tbl_arc_supplier_performance`), the Panel SAP BOM Builder's costs
(v0.217.0, `tbl_cogs_material_apis`), and on the Shop Floor branch the whole
production schedule and the employee table.

Every one reads with the signed-in user's own token, and **who may read is
Fabric's call** (a purchasing role, a pricing role, a BOM group). That is the
right boundary and the backend doesn't change it. Two Fabric points do touch
the backend:

- **The Shop Floor contract assumed an "ARC server" fanning one schedule read
  out to every kiosk.** ARC has none, so each kiosk reads Fabric itself and
  needs a signed-in account with Fabric read access. That is fine for a
  pilot. If many kiosks poll a 2.8-second whole-table read, a cached
  `GET /api/shop-floor/schedule` (one Fabric read, served to every kiosk)
  becomes worth building; measure first.
- **A scheduled job that reads SAP** (a late-order digest, say) would need the
  managed identity granted read on the Fabric GraphQL item, as a service
  principal. Fabric supports that; it is one more IT ask (§10).

### New: a tamper-proof claim needs a server

The Shop Floor branch records who is working which job (SFB Claims, Start /
Finish from a kiosk badge scan). ARC writes as each signed-in person, so the
kiosk account needs Contribute on the list, and anyone with Contribute can
edit a claim in SharePoint. The branch records this as accepted for the
pilot, with a clear trigger: **revisit if claim data ever feeds labor time,
SAP confirmations or pay.** At that point the only fix is a writer the users
aren't — §5a.

### New: the MCP server's Phase 2 needs the same move

`docs/MCP-SERVER-PLAN.md` (branch `feat/10-arc-mcp-server`, BusinessIT#10)
plans a local, read-only MCP server first. Its Phase 2 adds writes, and the
plan's rule is that those writes **must send the regular ARC emails**. Today
every "after a write" side effect (comment append, mentions, watcher
notifications, status alerts) lives in React Query hooks, so a write from
anywhere else skips them. Moving notification logic server-side
("intent-based mail", §5 Phase 2) is exactly what the MCP plan needs, so the
two pieces of work should be one.

### More reminders that need a timer

Each of these is a "nothing happens unless somebody opens ARC" gap:

| Reminder | Where it came from |
| --- | --- |
| Due-date digest for tasks and EIRs, linking to `/agenda` | BusinessIT#13 |
| A crimp height or conformal coating check missed on a shift | v0.206.0 / v0.213.0 notes: "needs Power Automate, since ARC has no scheduler" |
| Shop Floor: close a claim left running past its work center's limit | Today the **kiosk** runs this sweep, so it only happens while a kiosk is open |
| CMMS `DueStatus` | An existing Power Automate flow, outside the repo |

Four is the point where "one more flow" stops being the cheap answer.

### Nothing new for the backend

- **Plant Map** (branch) publishes an SVG + CSV to a SharePoint library for
  Power BI's Folder connector. No server needed.
- **Pull tests** (branch) talk to the Mark-10 tester over Web Serial from the
  browser. No helper program, no server.
- **Panel capacity, BOM Builder drafts** keep unsaved work in `localStorage`
  under the `useDraft` rules. That is a per-viewer convenience, not shared
  state, so it stays.
- **No new printing paths.** QZ signing is still the one secret in the
  bundle.

### The SWA / private-repo move hasn't happened

The base path is still `/altronic-arc/` (`vite.config.ts:15`,
`src/main.tsx:110`). §6 is unchanged.

---

## 3. Constraints the design keeps

- **SharePoint stays the system of record.** The backend stores nothing but
  logs.
- **No secret in the repo or the bundle.** Key Vault for keys, managed
  identity for Graph, OIDC federation for GitHub Actions → Azure deploys.
  The managed identity means the mail and scheduled-job paths need **no
  client secret at all**: nothing to rotate, nothing to leak.
- **`USE_MOCK` still works with zero configuration.** A new `api/backend.ts`
  transport has a mock branch like every other module.
- **Lockout-safe roll-out.** `VITE_BACKEND_URL` unset = today's behaviour
  (in-browser signing, per-user Send-As). Same shape as
  `EIR_ROLES_ENFORCED`. The URL is not a secret.
- **The client still never enforces anything.** The backend is where rules
  that must hold against a modified client finally have a home. A rule moved
  there should be described as enforced; one left in the SPA still isn't.
- **Small.** Two people maintain this. One Function App, a handful of
  functions, no database.

---

## 4. Options considered

| Option | Verdict |
| --- | --- |
| **A. SWA managed functions** | Rejected. No managed identity, no Key Vault, no timers (§1) |
| **B. Function App, called directly by the SPA with a bearer token** | **Recommended.** Works from GitHub Pages today and from SWA later. No dependency on SWA proxy behaviour |
| **C. Function App linked to SWA as its `/api` backend** | Viable later. Needs SWA **Standard**. SWA then fronts `/api` and passes `x-ms-client-principal`, which identifies the user but carries no token. Adds a second sign-in session (SWA cookie beside MSAL). Revisit only if same-origin `/api` becomes worth it |
| **D. App Service or Container Apps hosting SPA + API together** | Rejected. Always-on compute, patching and scaling for a workload that runs a few thousand times a day |
| **E. Keep Power Automate for everything** | Doesn't solve signing; mail would still need a per-flow connection owner; no code review or tests; can't be the sole writer of a list without its own service account; four reminders means four flows |

---

## 5. Recommended shape

```
 Browser (GitHub Pages today; SWA later)
   MSAL ── token for Graph / Fabric ─────► Graph, SharePoint, Fabric   (unchanged)
   MSAL ── token for api://<arc>/access_as_user ─┐
                                                  ▼
             Azure Function App (Flex Consumption, Node 22, TypeScript)
               ├─ Entra auth: audience api://<arc>, tenant = ours
               ├─ POST /api/qz/sign          ── Key Vault (QZ private key)
               ├─ POST /api/mail/send        ── Graph app-only Mail.Send,
               │                                scoped to the shared mailbox
               ├─ POST /api/shop-floor/claim ── Graph app-only Sites.Selected
               │    (later, §5a)                (PMO, write) — the only writer
               ├─ timers: reminders, sweeps  ── Graph app-only Sites.Selected
               │                                (read), Fabric (read) if needed
               └─ logs: actor, action, ids ─► Application Insights (no bodies)
             Managed identity → Key Vault (get secret), Graph (app roles)
```

### Auth between the SPA and the backend

1. On ARC's existing Entra app registration, **Expose an API** with one
   delegated scope, `access_as_user`. Grant it to the SPA (same app) and
   admin-consent once.
2. The SPA acquires that token **silently**, as its own scope list. Like
   `fabricScopes`, it must never join `graphScopes`: Entra issues one token
   per resource, and mixing them fails sign-in.
3. The Function App validates the token: App Service Authentication with the
   allowed audience and our tenant, plus an in-code check of `tid` and `scp`
   so a local run behaves the same. **Verify in the spike that Easy Auth is
   available on Flex Consumption**; if not, validate in code against Entra's
   JWKS.
4. CORS on the Function App allows exactly the ARC origin(s).

The caller's identity (`oid`, UPN) comes from the validated token and is
what the backend logs. Nothing the request body says about "who I am" is
trusted. MSAL 5 is still an open upgrade (DEP-01); do the scope work on
whichever version is current and don't bundle the two.

### `POST /api/qz/sign`

- Body: QZ's `toSign` string. Response: base64 RSA-SHA512 signature.
- `qzPrint.ts` points `setSignaturePromise` at the endpoint when
  `VITE_BACKEND_URL` is set. The certificate is public and stays in the
  bundle.
- Fits the existing failure design: `printHtmlSilently` already never throws
  and is bounded by a 4 s timeout, so a backend outage falls back to the
  browser print dialog, exactly as a missing QZ Tray does now.
- What it buys honestly: any signed-in user can still get a signature, but
  the key can't be copied off the internet, can be rotated without a deploy,
  and every signature is logged against a person. The endpoint can also
  refuse requests that don't name an allowed printer, which the bundle never
  could.
- **Rotation is part of the work**: new keypair, new self-signed cert, the
  cert re-trusted on each kiosk machine, and `VITE_QZ_PRIVATE_KEY` deleted
  from the repo secrets and `deploy.yml`.

### `POST /api/mail/send`

Phase 1 keeps the SPA's builders (`lib/*Alerts.ts`, `renderEmailShell`,
threading, the one-email-per-reason grouping) and moves only the **send**:

- Body: `{ to[] | bcc[], subject, html, threading, attachments? }`, matching
  what `postMail` builds today (a single person in To, several in Bcc). The
  server sets From to the shared mailbox and ignores any From the caller
  sends.
- **Recipient policy, server-side, over To and Bcc alike:** every recipient
  must be a user in our tenant directory, members **and** guests. Not a
  domain check: guests are legitimate recipients (they're mentioned and watch
  items), and a domain check would either drop them or let any address
  through.
- Per-caller rate limit and size cap, so a modified client can't turn the
  mailbox into a relay.
- **The server accepts, then sends.** Answer 202 once the request is valid
  and queued (a storage queue on the same account is enough), so the
  browser's "Leave site?" guard only covers the one POST and a closed tab
  can't cancel a send.
- **Failures alert someone.** Report issue was dead for two months and nobody
  could see it. A failed send logs and raises an App Insights alert to the
  maintainers, not only a toast to whoever pressed the button.
- Logged: caller, recipient count, subject, item key. Not the body (CLAUDE.md
  rule 12).
- The identity: the Function App's managed identity, granted Mail.Send
  through **Exchange RBAC for Applications** with a management scope holding
  only the shared mailbox. That replaces Application Access Policies.
  **Do not also grant Graph `Mail.Send` in Entra** — that grant is unscoped
  and would apply to every mailbox.

What it removes: the per-user Send-As + FullAccess grants (the new-starter
failure), the ability of any grant-holder to send arbitrary mail as the
mailbox, and the reason guests can't notify anyone. The guest Power Automate
flow could be retired once this is live.

**Phase 2, the intent-based version** — the server builds the wording from an
intent (`{ kind, id, event }`), so a client can no longer choose recipients
at all. That is the version where the recipient rules become fully enforced,
and it is a much bigger move: the builders would need to read SharePoint
themselves. **It is also what the MCP server's write phase needs** (§2a), so
do it once, for both, when MCP writes are actually wanted. The `lib/*Alerts.ts`
builders are already pure, which is most of the work; the missing half is
reading the item and its watchers server-side.

### 5a. Server-only writers (later, on a trigger)

A list whose rows must hold against a modified client gets **one** writer:
the Function App's managed identity with Sites.Selected **write** on that
site, and users with Read on the list. The SPA calls an endpoint, and the
endpoint applies the rule before writing.

First and only candidate today: **Shop Floor claims**, when the trigger in
§2a fires (claims feed labor time, SAP confirmations or pay). The endpoint
would take `{ workCenter, orderOpKey, badge, action }`, validate the badge
against the Fabric employee table, keep the unique-key lock the branch
already relies on, and stamp the time on the **server's** clock rather than
the kiosk's.

The same pattern answers two other "Revisit when" rows in `CLAUDE.md` if they
ever fire: a **Counters list** with `If-Match` for sequence numbers, if the
business stops accepting duplicates, and any list that needs a server-side
rule SharePoint permissions can't express. Don't build it for any of them
until its trigger fires.

### Scheduled functions

- Needs the managed identity granted **Sites.Selected** per site collection,
  the same `POST /sites/{id}/permissions` an admin already runs for the SPA.
  Read-only grants where a job only reads.
- In order: the **Shop Floor stale-claim sweep** (so it runs without a kiosk
  open — and it needs write on PMO, so it pairs with §5a), the **due-date
  digest** (BusinessIT#13, linking to `/agenda`), **missed shift checks** for
  crimp height and coating, then move the **DueStatus** flow in so CMMS logic
  lives in one repo.
- Every timer sends through the same mail path as `/api/mail/send`, so its
  messages thread with ARC's own (`lib/emailThread.ts`).

### GitHub (optional, last)

A GitHub App installed on `Altronic-LLC/BusinessIT`, private key in Key
Vault, endpoint issues the issue on the caller's behalf. Removes PATs from
browsers. Only worth doing if a third person needs the feature.

---

## 6. Hosting the SPA on Static Web Apps (separate step)

Independent of the Function App; this is the SEC-03 move already planned
in `CLAUDE.md`, and still not done as of 2026-11-13.

- **Plan:** Standard, for custom Entra auth (sign-in required before any
  file is served, so the bundle stops being public) and an SLA. Free hosts
  the SPA fine but can't require company sign-in.
- **`staticwebapp.config.json`:** `navigationFallback` to `index.html` for
  client routing; a route rule requiring `authenticated` on `/*` with a 401
  redirect to `/.auth/login/aad`; **`globalHeaders` with a real
  Content-Security-Policy header** (better than the `<meta>` CSP SEC-06
  proposes, since headers can also set `frame-ancestors`). The CSP must
  allow QZ's `wss://localhost`, the Fabric GraphQL endpoint, Graph,
  SharePoint and (later) the Function App — and Web Serial needs no CSP entry.
- **Code changes:** drop the `/altronic-arc/` base path in
  `vite.config.ts:15` and the `basename` in `src/main.tsx:110`;
  `msalConfig.ts` already derives the redirect from the origin and
  `BASE_URL`, so it needs nothing. Register the new redirect URI in Entra.
  Update `deploy.yml`'s live-version URL used by the forward-only guard.
- **Kiosks:** the Reports kiosk and (on the branch) the Shop Floor kiosk sit
  on unattended machines. SWA's sign-in in front of every file adds one more
  session that has to stay alive there; test a kiosk overnight in the spike.
- **Two sessions:** SWA's sign-in cookie sits beside MSAL's cache. Both are
  silent SSO against the same Entra session, so people should see at most one
  extra redirect on first visit. Confirm in the spike.

---

## 7. Cost (approximate — check the Azure pricing calculator)

| Resource | Expected |
| --- | --- |
| Function App, Flex Consumption | Within or near the monthly free grant at ARC's volume (a few thousand calls a day) |
| Storage account (required by Functions; also holds the mail queue) | Cents a month |
| Key Vault, Standard | Cents a month (charged per 10,000 operations) |
| Application Insights | Low single-digit dollars a month if logs stay to ids and counts |
| Static Web Apps, Standard | About $9 per app per month; Free if company sign-in in front isn't wanted |

Effort: about 1–2 weeks spread over a quarter for the foundation plus QZ and
mail, 1–2 days for the SWA move, then roughly a day per timer and 2–3 days
for the claims endpoint when its trigger fires. Intent-based mail (shared
with MCP writes) is the large item: 2–3 weeks, and only when wanted.

---

## 8. Risks and unknowns

| Risk | Mitigation |
| --- | --- |
| The backend becomes a dependency every comment waits on | Mail stays best-effort and asynchronous exactly as now (`MailSendResult` + toast). Signing already degrades to the print dialog |
| The backend becomes a dependency the **kiosks** wait on (claims) | Only once §5a is built. Until then kiosks write SharePoint directly as now. When built, a backend outage must show on the kiosk ("can't record — tell your supervisor"), never silently drop a Start |
| Cold starts make the first print or comment of the day slow | Flex Consumption supports always-ready instances; measure before paying for one |
| Easy Auth on Flex Consumption | Verify in spike; fall back to in-code JWT validation |
| Exchange RBAC for Applications needs Exchange admin work | One-time IT task; documented PowerShell in Microsoft Learn ("Role Based Access Control for Applications in Exchange Online") |
| A managed identity reading Fabric | Fabric supports service principals on GraphQL items; needs the tenant setting "Service principals can use Fabric APIs". Verify before promising a SAP-reading timer |
| A second deployable with its own CI | One workflow, OIDC to Azure, same required `verify` check; forward-only like `deploy.yml` |
| Function code is public while the repo is public | Fine: no secrets in code. Endpoints still require a tenant token |
| A future corporate policy names hosting, logging or identity rules | Load it into CLAUDE.md's policy section first; this design should be checked against it |

---

## 9. Spike plan for this branch

Each step has a yes/no exit. Stop and write down the answer if one fails.

1. **Provision** (needs an Azure subscription and resource group — §10):
   Function App (Flex, Node 22) with system-assigned managed identity, Key
   Vault (RBAC mode) granting that identity *Key Vault Secrets User*, App
   Insights. *Exit:* a hello endpoint answers from the Function App URL.
2. **Auth:** expose `access_as_user`, get the token silently from the SPA on
   the dev server, call the endpoint. *Exit:* 200 with our token, 401 with
   none, 401 with a token from another tenant or audience.
3. **QZ signing:** new keypair, private key in Key Vault, `/api/qz/sign`
   behind `VITE_BACKEND_URL`, a test label through `/dev/qz-print-test`.
   *Exit:* QZ Tray accepts the signature on a test machine trusting the new
   cert; dialog fallback still works with the backend stopped.
4. **Mail:** Exchange RBAC scope on the shared mailbox for the managed
   identity; `/api/mail/send` with the directory check over To and Bcc.
   *Exit:* a mention email arrives from a test account that holds **no**
   Send-As; a Bcc'd send to several people arrives once each; a send to an
   address outside the directory is refused; the threading headers still
   group in Outlook (`/dev/email-grouping-test`).
5. **A timer:** the due-date digest for one person, read-only Sites.Selected
   on Engineering. *Exit:* it arrives on schedule with no browser open, and
   threads like ARC's own mail.
6. **SWA (can run in parallel):** a throwaway SWA from this branch with the
   config in §6. *Exit:* an unauthenticated request gets the sign-in
   redirect, deep links work, MSAL sign-in still silent, CSP header present
   and nothing on the Dashboard, a print view, QZ, a Fabric lookup or the
   Reports kiosk (left overnight) breaks.
7. **Write up:** fill in the measured answers here and decide whether to
   record a new row in CLAUDE.md's "Decisions on record".

Code layout when building starts: a `backend/` folder with its own
`package.json`, `tsconfig.json` and Vitest config, so it never enters the
SPA's bundle or test run. It may import pure modules from `src/lib/`
(`guestIdentity.ts`, `emailThread.ts`, later the `*Alerts.ts` builders) —
those import nothing from upper layers, which is exactly why they can be
shared. The MCP plan's `mcp/` folder follows the same rule, so the two can
share those modules too.

---

## 10. What we need from IT

1. An Azure subscription and resource group for ARC, and who owns the bill.
2. Permission to add an exposed API scope to ARC's app registration, and an
   admin consent.
3. Exchange admin: an RBAC-for-Applications management scope containing only
   the shared mailbox, assigned Mail.Send for the Function App's identity.
   **Before that, and regardless:** Send-As + FullAccess on the shared mailbox
   through a security group (the BACKLOG item), so new starters stop failing
   silently now.
4. SharePoint admin: Sites.Selected grants for the managed identity, per
   site, only when a job or endpoint needs one (PMO write for claims; read
   elsewhere).
5. For the Shop Floor pilot, independent of the backend: a kiosk account with
   Fabric read on the schedule and employee tables, and Contribute on the SFB
   lists.
6. Fabric admin, only if a timer reads SAP: the tenant setting allowing
   service principals on Fabric APIs, and read on the GraphQL item for the
   managed identity.
7. Whether a corporate standard already exists for Azure Functions hosting,
   Key Vault, or logging retention — if so, it goes into CLAUDE.md's policy
   section before anything is built.

---

## 11. Roadmap

Each stage stands on its own and leaves ARC working if the next never
happens. Triggers are what moves a "later" stage into "now".

| Stage | What | Closes / unblocks | Needs | When |
| --- | --- | --- | --- | --- |
| **0. No-Azure fixes** | Send-As + FullAccess by security group; kiosk account for the Shop Floor pilot; `<meta>` CSP trial on Pages | SEC-04 (stopgap), Shop Floor pilot, SEC-06 (partial) | IT tickets; a CSP test against QZ and Fabric | Now |
| **1. Private repo on SWA** | §6 | SEC-03, SEC-06 (real header) | Azure subscription; SWA Standard; Entra redirect URI | Next — already the top BACKLOG item |
| **2. Function App foundation + mail + signing** | §5 auth, `/api/mail/send` (Phase 1), `/api/qz/sign` with a rotated key | SEC-04, SEC-02; guest mail; failed-send alerts | Exposed API scope; Exchange RBAC scope; Key Vault | After 1, or alongside it |
| **3. Timers** | Due-date digest, missed shift checks, then DueStatus into the repo | BusinessIT#13; crimp / coating reminders; Power Automate flows into version control | Read Sites.Selected for the identity | After 2, one timer at a time |
| **4. Server-only writers** | `/api/shop-floor/claim` + the stale-claim sweep on a timer (§5a) | Tamper-proof claims; the sweep without a kiosk open | Write Sites.Selected on PMO; lists set to Read for users | **Trigger:** claims feed labor time, SAP confirmations or pay |
| **5. Intent-based mail** | Server builds and addresses every notification from `{ kind, id, event }` | Recipient rules fully enforced; MCP Phase 2 writes that email like ARC | Server-side reads of items and watchers | **Trigger:** MCP writes are wanted, or a recipient rule must hold against a modified client |
| **Optional** | GitHub App; cached Shop Floor schedule for kiosks; Counters allocator | SEC-05; kiosk load on Fabric; duplicate numbers | — | **Triggers:** a third GitHub user; measured kiosk load; the business rejects duplicates |

Not on the roadmap, on purpose: moving SharePoint or Fabric reads behind the
server, a database of ARC's own, or replacing MSAL sign-in. None of the
features added since October needs any of them.

---

## Sources

- [API support in Azure Static Web Apps with Azure Functions](https://learn.microsoft.com/azure/static-web-apps/apis-functions)
- [Bring your own functions to Azure Static Web Apps](https://learn.microsoft.com/azure/static-web-apps/functions-bring-your-own)
- [Azure Static Web Apps hosting plans](https://learn.microsoft.com/azure/static-web-apps/plans)
- [Role Based Access Control for Applications in Exchange Online](https://learn.microsoft.com/graph/auth-limit-mailbox-access)
- Community reports of SWA replacing the bearer token in managed functions:
  [Auth0 community](https://community.auth0.com/t/azure-static-website-api-overrides-the-bearer-attribute-in-the-header/48942),
  [Microsoft Q&A](https://learn.microsoft.com/en-us/answers/questions/5658836/static-web-app-with-managed-function-cant-turn-off)
