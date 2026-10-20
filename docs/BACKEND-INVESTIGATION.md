# A small backend for ARC: investigation

**Status:** investigation only. Nothing is built or provisioned.
**Branch:** `investigate/small-backend`
**Date:** 2026-10-20
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
| QZ Tray signing key | PKCS8 private key compiled into the bundle from the `VITE_QZ_PRIVATE_KEY` repo secret | `src/api/config.ts:49`, `src/api/qzPrint.ts:125-145`, `deploy.yml:232` | Anyone who downloads the bundle can sign QZ requests. Accepted risk (SEC-02) because the cert is trusted only on kiosk machines | Key in Key Vault; a `POST /api/qz/sign` endpoint signs. **The existing key must be rotated** — it has been public, so moving it without a new keypair changes nothing |
| Notification mail | Each user's own token calls `/users/{shared mailbox}/sendMail`; every commenter needs Send-As **and** FullAccess granted by hand | `src/api/email.ts:540-561`, `errorReport.ts`, `editFailureReport.ts`, `pottingSampleLog.ts` | Anyone holding the grant can send anything as the shared mailbox; new starters fail silently until added; guests can't send at all (hence the Power Automate guest flow) | Function sends as the mailbox with its **own** identity, scoped to that one mailbox by Exchange RBAC for Applications. Recipient policy enforced server-side. Per-user grants removed |
| Scheduled work | Power Automate flows owned outside the repo (DueStatus, guest notifications); none for due-date reminders (BusinessIT#13) | `docs/POWER-AUTOMATE-GUEST-NOTIFICATIONS.md` | Not version-controlled; ownership unclear | Timer-triggered functions in this repo |
| GitHub issue creation | Each manager pastes a personal access token into the browser | `src/hooks/useGitHubToken.ts` | A PAT in `localStorage`; XSS exfiltrates it (SEC-05) | Optional: a GitHub App whose private key is in Key Vault, issuing short-lived installation tokens |
| Recipient lists, staff addresses | Hardcoded defaults in `config.ts` | `src/api/config.ts` (SEC-03) | Public | Unchanged by the backend. Closed by the private repo and SWA sign-in in front of every file |

What does **not** move: SharePoint reads and writes, Fabric lookups,
attachments. They already run on the signed-in user's delegated token, and
SharePoint's per-list permissions are the right boundary for them. Moving
them behind a server would add latency and a second copy of the permission
model for no gain.

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
- **Small.** Two people maintain this. One Function App, three or four
  functions, no database.

---

## 4. Options considered

| Option | Verdict |
| --- | --- |
| **A. SWA managed functions** | Rejected. No managed identity, no Key Vault, no timers (§1) |
| **B. Function App, called directly by the SPA with a bearer token** | **Recommended.** Works from GitHub Pages today and from SWA later. No dependency on SWA proxy behaviour |
| **C. Function App linked to SWA as its `/api` backend** | Viable later. Needs SWA **Standard**. SWA then fronts `/api` and passes `x-ms-client-principal`, which identifies the user but carries no token. Adds a second sign-in session (SWA cookie beside MSAL). Revisit only if same-origin `/api` becomes worth it |
| **D. App Service or Container Apps hosting SPA + API together** | Rejected. Always-on compute, patching and scaling for a workload that runs a few thousand times a day |
| **E. Keep Power Automate for everything** | Doesn't solve signing; mail would still need a per-flow connection owner; no code review or tests |

---

## 5. Recommended shape

```
 Browser (GitHub Pages today; SWA later)
   MSAL ── token for Graph ──────────────► Graph / SharePoint     (unchanged)
   MSAL ── token for api://<arc>/access_as_user ─┐
                                                  ▼
             Azure Function App (Flex Consumption, Node 22, TypeScript)
               ├─ Entra auth: audience api://<arc>, tenant = ours
               ├─ POST /api/qz/sign      ── Key Vault (QZ private key)
               ├─ POST /api/mail/send    ── Graph app-only Mail.Send,
               │                            scoped to the shared mailbox
               ├─ timer: due-date digests ─ Graph app-only Sites.Selected
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
trusted.

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
threading) and moves only the **send**:

- Body: `{ to[], subject, html, threading, attachments? }`. The server sets
  From to the shared mailbox and ignores any From the caller sends.
- **Recipient policy, server-side:** every recipient must be a user in our
  tenant directory, members **and** guests. Not a domain check: guests are
  legitimate recipients (they're mentioned and watch items), and a domain
  check would either drop them or let any address through.
- Per-caller rate limit and size cap, so a modified client can't turn the
  mailbox into a relay.
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

Phase 2, later and optional: the server builds the wording from an intent
(`{ kind, id, event }`), so a client can no longer choose recipients at all.
That is the version where the recipient rules become fully enforced, and it
is a much bigger move — the builders would need to read SharePoint
themselves.

### Scheduled functions

- First candidate: due-date reminders (BusinessIT#13), linking to
  `/agenda`.
- Needs the managed identity granted **Sites.Selected** per site collection,
  the same `POST /sites/{id}/permissions` an admin already runs for the SPA.
  Read-only grants where a job only reads.
- Later: move the DueStatus flow in, so CMMS logic lives in one repo.

### GitHub (optional, last)

A GitHub App installed on `Altronic-LLC/BusinessIT`, private key in Key
Vault, endpoint issues the issue on the caller's behalf. Removes PATs from
browsers. Only worth doing if a third person needs the feature.

---

## 6. Hosting the SPA on Static Web Apps (separate step)

Independent of the Function App; this is the SEC-03 move already planned
in `CLAUDE.md`.

- **Plan:** Standard, for custom Entra auth (sign-in required before any
  file is served, so the bundle stops being public) and an SLA. Free hosts
  the SPA fine but can't require company sign-in.
- **`staticwebapp.config.json`:** `navigationFallback` to `index.html` for
  client routing; a route rule requiring `authenticated` on `/*` with a 401
  redirect to `/.auth/login/aad`; **`globalHeaders` with a real
  Content-Security-Policy header** (better than the `<meta>` CSP SEC-06
  proposes, since headers can also set `frame-ancestors`).
- **Code changes:** drop the `/altronic-arc/` base path in
  `vite.config.ts:15` and the `basename` in `src/main.tsx:104`;
  `msalConfig.ts` already derives the redirect from the origin and
  `BASE_URL`, so it needs nothing. Register the new redirect URI in Entra.
  Update `deploy.yml`'s live-version URL used by the forward-only guard.
- **Two sessions:** SWA's sign-in cookie sits beside MSAL's cache. Both are
  silent SSO against the same Entra session, so people should see at most one
  extra redirect on first visit. Confirm in the spike.

---

## 7. Cost (approximate — check the Azure pricing calculator)

| Resource | Expected |
| --- | --- |
| Function App, Flex Consumption | Within or near the monthly free grant at ARC's volume (a few thousand calls a day) |
| Key Vault, Standard | Cents a month (charged per 10,000 operations) |
| Application Insights | Low single-digit dollars a month if logs stay to ids and counts |
| Static Web Apps, Standard | About $9 per app per month; Free if company sign-in in front isn't wanted |

Effort: about 1–2 weeks spread over a quarter for the Function App (QZ,
mail, one timer), plus 1–2 days for the SWA move, matching the review's
estimate.

---

## 8. Risks and unknowns

| Risk | Mitigation |
| --- | --- |
| The backend becomes a dependency every comment waits on | Mail stays best-effort and asynchronous exactly as now (`MailSendResult` + toast). Signing already degrades to the print dialog |
| Cold starts make the first print or comment of the day slow | Flex Consumption supports always-ready instances; measure before paying for one |
| Easy Auth on Flex Consumption | Verify in spike; fall back to in-code JWT validation |
| Exchange RBAC for Applications needs Exchange admin work | One-time IT task; documented PowerShell in Microsoft Learn ("Role Based Access Control for Applications in Exchange Online") |
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
   identity; `/api/mail/send` with the directory check. *Exit:* a mention
   email arrives from a test account that holds **no** Send-As; a send to an
   address outside the directory is refused; the threading headers still
   group in Outlook (`/dev/email-grouping-test`).
5. **SWA (can run in parallel):** a throwaway SWA from this branch with the
   config above. *Exit:* an unauthenticated request gets the sign-in
   redirect, deep links work, MSAL sign-in still silent, CSP header present
   and nothing on the Dashboard, a print view or QZ breaks.
6. **Write up:** fill in the measured answers here and decide whether to
   record a new row in CLAUDE.md's "Decisions on record".

Code layout when building starts: a `backend/` folder with its own
`package.json`, `tsconfig.json` and Vitest config, so it never enters the
SPA's bundle or test run. It may import pure modules from `src/lib/`
(`guestIdentity.ts`, `emailThread.ts`) — those import nothing from upper
layers, which is exactly why they can be shared.

---

## 10. What we need from IT

1. An Azure subscription and resource group for ARC, and who owns the bill.
2. Permission to add an exposed API scope to ARC's app registration, and an
   admin consent.
3. Exchange admin: an RBAC-for-Applications management scope containing only
   the shared mailbox, assigned Mail.Send for the Function App's identity.
4. SharePoint admin: Sites.Selected grants for the managed identity, per
   site, only when a scheduled job needs one.
5. Whether a corporate standard already exists for Azure Functions hosting,
   Key Vault, or logging retention — if so, it goes into CLAUDE.md's policy
   section before anything is built.

---

## Sources

- [API support in Azure Static Web Apps with Azure Functions](https://learn.microsoft.com/azure/static-web-apps/apis-functions)
- [Bring your own functions to Azure Static Web Apps](https://learn.microsoft.com/azure/static-web-apps/functions-bring-your-own)
- [Azure Static Web Apps hosting plans](https://learn.microsoft.com/azure/static-web-apps/plans)
- [Role Based Access Control for Applications in Exchange Online](https://learn.microsoft.com/graph/auth-limit-mailbox-access)
- Community reports of SWA replacing the bearer token in managed functions:
  [Auth0 community](https://community.auth0.com/t/azure-static-website-api-overrides-the-bearer-attribute-in-the-header/48942),
  [Microsoft Q&A](https://learn.microsoft.com/en-us/answers/questions/5658836/static-web-app-with-managed-function-cant-turn-off)
