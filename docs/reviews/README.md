# Reviews — keeping ARC audited

ARC had a full architecture, security and engineering-standards audit on
2026-10-16 (Claude Fable 5.1, read-only, with dependency / secrets / test
sub-scans). This folder is how that stays true instead of being a one-off.

## What lives here

- `REVIEW-PROMPT.md` — the prompt that produced the audit, with ARC's context
  filled in. Re-run it as-is; change only the **Anything I already know is a
  problem** line and the date.
- **Reports are NOT committed.** This is a public repository, and a review
  report is a list of weaknesses with file and line numbers. Reports live as
  private artifacts (claude.ai) and in the maintainer's Downloads; the
  changelog records *fixes*, never findings. Link the artifact from the
  BACKLOG item that tracks the follow-ups.

## Cadence

| When | What |
|---|---|
| Every PR | `.github/workflows/pr.yml` — typecheck, full tests, changelog/version agreement. Must be a required status check on `main`. |
| Every feature | The **Engineering standards — compliance checklist** in CLAUDE.md, before opening the PR. |
| Weekly | Dependabot PRs (`.github/dependabot.yml`): merge the grouped minor/patch PR when `Checks` is green. |
| Quarterly, and after any auth / permissions / numbering change | Re-run `REVIEW-PROMPT.md` against `main`. Diff the findings table against the previous report: anything that reappears is a process gap, not a bug. |
| On each framework major (vite, tailwind, react-router, msal, react) | Re-run the **Dependencies** and **Testing** scopes only. |

## Reading a report

Severity is calibrated to ARC's real context (internal, authenticated,
SharePoint-bounded), not to generic worst case. A finding's ID (`SEC-01`,
`ARCH-06`, …) is stable across reports so fixes can cite it in commit
messages, as the v0.191.2 release did.

## History

| Date | Scope | Outcome |
|---|---|---|
| 2026-10-16 | Full audit (A–I) | 1 High (shared-browser identity), 11 Medium, rest Low/Info. Tier 1 and the small Tier 2/3 items fixed in v0.191.2 (PR #86). |
| 2026-10-16 | Post-fix re-audit + SharePoint-as-backend architecture assessment | See the private artifact linked from BACKLOG. |
