# Architecture, Security & Engineering Standards Review — altronic-arc

**Recommended model:** Claude Fable 5.1 for the primary review agent (Opus 5.5 as a cost-controlled alternative). Sonnet 5.5 is fine for parallel subagents doing dependency scans and file inventories. Run inside Claude Code with the repo at `C:\repos\altronic-arc` and shell access; do not paste code into chat.

**Before running:** confirm the repo does not contain government/export-controlled program data or customer NDA material you are not cleared to run through an AI review. (As of 2026-10-16 it does not; it does contain staff names and e-mail addresses and partly real customer names in fixtures — see SEC-03 in the first report.)

**Where the previous report is:** private artifact on claude.ai, linked from the BACKLOG review item. Have it open: the findings table's IDs are stable and the new report should say for each one whether it is fixed, still open, or regressed.

**Do not commit the report** — public repository. See `docs/reviews/README.md`.

---

## Prompt

```
You are performing a full architecture, security, and engineering-standards review of the repository at https://github.com/Altronic-LLC/altronic-arc (local clone C:\repos\altronic-arc). Treat this as a senior staff engineer / AppSec audit. Be specific, cite file paths and line numbers, and distinguish fact from inference.

CONTEXT
- Purpose of the system: ARC (Altronic Resource Center) — one web app, behind one Microsoft sign-in, that replaces per-department Power Apps / Power Automate / SharePoint views for every Altronic department (Engineering, Panels, Operations, Coils, QC, Supply Chain, Sales). ~120 screens over ~93 SharePoint lists on 7 sites.
- Stack: React 18 + Vite + TypeScript SPA on GitHub Pages; MSAL.js (Entra ID, PKCE); Microsoft Graph v1.0 with Sites.Selected for all data, SharePoint REST (AllSites.Manage) for attachments, Fabric API for GraphQL (read-only SAP cost); TanStack Query; Vitest + RTL. NO backend of ARC's own; Power Automate flows (owned outside the repo) handle guest notifications and a few column updates.
- Deployment context: internal tool for ~200 staff. Public repository. Handles employee PII, customer/supplier names, part numbers and pricing (business-sensitive; the Pricing lists have unique SharePoint permissions). Not regulated, no payments.
- Team size and maturity: two contributors, Ray White (maintainer) and Tim Webster; no dedicated security review; CLAUDE.md is the working manual and must stay current, including its "Corporate IT architecture and security policies" section — check the code against every policy loaded there.
- Accepted by the business, do not report as findings: occasional duplicate sequence numbers (client-side numbering), 2026-10-17.
- Anything I already know is a problem: [fill in — open items from the previous report's section H and the BACKLOG review item]

RULES
- Read the codebase before forming opinions. Start with README.md, CLAUDE.md (grep it — it is ~700 KB), package.json, vite.config.ts, .github/, scripts/, and the entry points (src/main.tsx, src/auth/, src/api/graph.ts, src/api/config.ts), then trace the main request/data paths.
- Run tooling where available (npm audit, npm outdated, npm run typecheck, npm test, a production build into a scratch directory). Report what you ran and the raw results. Run the test suite on an otherwise idle machine; it is memory-heavy.
- Do not modify, commit, or push anything. Read-only review.
- If you find credentials, API keys, tokens, or connection strings in the repo or git history, do NOT print the values. Report the file path, the type of secret, and that it must be rotated.
- Say clearly when you are unsure or could not verify something. Do not invent findings to fill a section.
- Use subagents in parallel for independent scans (dependency audit, secrets/PII scan, test coverage inventory) and consolidate their results yourself.
- Use the previous report's finding IDs. For each previous finding say: FIXED (cite the commit or code), OPEN, ACCEPTED (cite the decision in CLAUDE.md), or REGRESSED. New findings get new IDs in the same series.

REVIEW SCOPE

1. Architecture
- Map the system: major modules, boundaries, data flow, external integrations. Produce a short text diagram.
- Evaluate separation of concerns, layering (views → hooks → api → graph; lib stays pure), coupling, cohesion, and whether the structure matches the stated purpose.
- Identify god classes/modules, circular dependencies, duplicated logic, leaky abstractions, and inconsistent patterns.
- Assess scalability and failure modes: state handling, concurrency (client-side number allocation!), retries, timeouts, idempotency, background jobs (Power Automate).
- Note what is overbuilt and what is underbuilt relative to the project's actual needs.
- Re-assess the SharePoint-as-backend decision against the triggers listed in CLAUDE.md "Engineering standards" — has any trigger fired?

2. Security
- Authentication and authorization: how identity is established (src/auth/activeAccount.ts is the rule), where access checks live, missing or inconsistent checks, privilege escalation paths. Remember: UI role gating is navigation; SharePoint per-list permission is the boundary. Check that nothing in the client is being treated as the boundary.
- Input handling: OData injection (every $filter must use lib/odata.ts), XSS (every dangerouslySetInnerHTML must go through lib/sanitiseHtml.ts), SSRF, path traversal in drive paths, file upload handling.
- Secrets management: hardcoded secrets, .env handling, secrets in logs or error messages, git history exposure, what VITE_* bakes into the public bundle.
- Data protection: PII in the public repo and in the bundle, logging of sensitive data (Graph error logs), data retention.
- Session/token handling (localStorage cache), CSRF, CORS, security headers / meta CSP, cookie flags.
- Dependency and supply-chain risk: known CVEs, unpinned versions, abandoned packages, lockfile integrity, install scripts, Actions pinned to SHAs.
- Infrastructure and CI/CD: workflow permissions, secrets exposure, branch protection and required checks (query them with gh api).
- Rate limiting, abuse resistance (shared-mailbox sendMail), denial-of-service surface.
- Map findings to OWASP Top 10 and CWE IDs where applicable.

3. Dependencies
- Full inventory: direct vs transitive, versions, license types (qz-tray is LGPL-2.1 — confirm it is still isolated in its own chunk), last-release dates.
- Flag: known vulnerabilities (with severity, prod vs dev), deprecated/unmaintained packages, major-version drift, license conflicts with proprietary internal use, packages that could be replaced by stdlib.
- Assess lockfile presence and consistency, and whether Dependabot is actually merging.

4. Code quality and engineering standards
- Consistency with React/TypeScript idioms. Presence and enforcement of linting and formatting (is ESLint configured yet?).
- Error handling patterns: swallowed exceptions, inconsistent error types, missing context.
- Logging and observability: console usage, the errorBuffer → e-mail path, health signals.
- Configuration management: VITE_* variables, deploy.yml's named list, defaults in config.ts (hardcoded people).
- Type safety: any / ts-ignore counts and where they cluster.
- Dead code, TODO/FIXME debt, commented-out blocks.

5. Testing
- Test pyramid: unit/integration/e2e presence and ratio. Measure coverage if tooling allows (vitest --coverage) and compare with the previous number.
- Test quality: behaviour vs implementation assertions; flaky patterns (wall-clock dates, raised timeouts); mocking of things that shouldn't be mocked — especially a test that mocks the exact thing it guards (the AuthGate lesson).
- Critical paths with no test coverage (roles hooks, msalConfig, config.ts).
- CI: does pr.yml actually block merges? Is `Checks / verify` a required status check? Is enforce_admins on?

6. Documentation and developer experience
- README accuracy, setup reproducibility (try npm install && npm run dev in demo mode), CLAUDE.md currency (file-by-file overview vs actual tree), ADRs, inline comments where logic is non-obvious.
- Onboarding friction: how long would a new engineer need to run this locally?

7. Maintainability and operations
- Build and release process, versioning (package.json = changelog top = version.json), tags, rollback story (workflow_dispatch ref).
- SharePoint schema changes (scripts/*.ps1): reversibility, dry-run flags, data safety.
- Backup, disaster recovery, runbook presence.
- Bus factor.

OUTPUT FORMAT
Produce a single report with these sections, in this order:

A. Executive summary (10 lines max): overall health rating (Critical / Poor / Fair / Good / Strong) for Architecture, Security, Dependencies, Code Quality, Testing, and Ops — each with the previous rating beside it — plus the three things that most need attention.

B. System map: the text diagram and a short narrative of how the system works.

C. Findings table: one row per finding with columns: ID, Status (NEW / OPEN / FIXED / ACCEPTED / REGRESSED), Severity (Critical/High/Medium/Low/Info), Category, Location (file:line), Description, Evidence, Recommendation, Effort (S/M/L). Severity must reflect real exploitability or impact in this system's actual context, not generic worst-case.

D. Detailed findings: for every Critical and High, a full write-up with reproduction or proof where possible, affected scope, and a concrete fix (code snippet or exact change).

E. Dependency report: inventory summary, vulnerability list, licensing issues, upgrade plan ordered by risk.

F. What's done well: be specific. This calibrates the rest of the report.

G. Prioritized remediation roadmap: three tiers. Tier 1 = fix before next deploy. Tier 2 = next sprint. Tier 3 = backlog. Each item references finding IDs and estimates effort.

H. Open questions and unverifiable items: anything you could not confirm, assumptions you made, and what information or access would resolve them.

I. Tooling log: every command you ran and a one-line summary of its output.

Write for an engineering lead who will act on this. No filler, no restating the task, no generic advice that isn't tied to something you actually observed in this repo. Publish the report as a private artifact; do not write it into the repository.
```

---

## Running tips
- Give the agent the full repo and the ability to execute commands.
- Name `dist/`, `node_modules/`, `sample-open-orders*/` and `scripts/data/` as out of scope so it doesn't spend its budget on generated or vendored content.
- Fill in the **Anything I already know is a problem** line before running; the severity ratings and the FIXED/OPEN bookkeeping depend on it.
- Expect 2–3 hours of wall time on a laptop, most of it the test suite and dependency lookups.
