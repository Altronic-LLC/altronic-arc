# Security Audit — ARC (Altronic Resource Center)

**Date:** 2026-09-22
**Reviewer:** Claude Code (multi-agent review, 5 parallel deep-dive audits + 1 re-verification pass)
**Repo:** `Altronic-LLC/altronic-arc` (public GitHub Pages SPA)
**Branch:** `security-audit`, based on `main` @ `89cd829` (v0.164.0) — the real
current upstream, confirmed via `gh api repos/Altronic-LLC/altronic-arc`.

## Important context for whoever reads this next

A first pass at this audit (also written to a file called `security-audit.md`,
now deleted) was done against a badly stale local clone — `v0.24.0`, ~400
commits and a full rebrand behind real upstream. That version's findings are
**void** and should not be trusted; this document supersedes it entirely,
re-verified against the actual current code. See the project's `MEMORY.md`
equivalent (Claude's memory of this repo) for the full story if it happens
again — the short version: **always confirm `git fetch upstream && git
merge-base --is-ancestor upstream/main main` before trusting any audit
against this repo.**

This file is gitignored (see `.gitignore`'s "Local-only" section) — it
documents exploit scenarios for currently-unpatched issues in a public repo
and must never be committed.

---

## Fixed in this pass (commit on `security-audit` branch)

These three were verified as genuine, zero-risk fixes — same proven pattern
used successfully in an earlier (unrelated) fix round — and applied directly:

### Fixed — `src/api/admins.ts`
Removed a one-time debug block (`console.group("[ADMINS DEBUG]...")`) that
printed an admin's email, display name, and note to the browser console in
real mode, gated only by a one-shot flag rather than `USE_MOCK`. Any signed-
in user opening the Admins view leaked this PII to their own DevTools
console (and to anyone screen-sharing/screenshotting it).

### Fixed — `src/api/eirs.ts`
Removed the same pattern, reintroduced independently: a debug block
(`console.group("[EIR DEBUG] Reporter shape")`) printed the first loaded
EIR's reporter name+email in real mode.

### Fixed — `src/api/attachments.ts`
`uploadAttachment()` and `deleteAttachment()` embedded the file's name
directly into a SharePoint REST OData string literal
(`AttachmentFiles/add(FileName='...')`) using only `encodeURIComponent`,
which does not escape the `'` character that delimits the literal. Added
`safeName`/`safeFileName` sanitization (`.replace(/[/\\:\0]/g, "_").slice(0,
256)`) before encoding, same as the already-proven pattern.

Typecheck and full test suite verified green after these changes.

---

## Open — needs a real fix, not zero-risk

### 1. HIGH — Comment/identity forgery
**File:** `src/lib/communicationParser.ts:25-26` (`TIMESTAMP_SPLIT_RE`),
compounded by `src/lib/mentions.ts` (`buildCommentHtml`, `escapeHtml`) and
`src/components/CommentThread.tsx:90-99` (`isOwn` check → Edit button).

The comment-thread parser splits the whole stored string on any occurrence
of a `MM/DD/YYYY HH:MM:SS AM/PM|||Name|||email|||body` pattern, with no
regard for whether it's a real record boundary or text a user typed inside
their own comment. A negative lookbehind exists (`(?<![\d/])`) but only
guards a narrow date-ambiguity edge case — a legitimate word boundary (a
space, a new paragraph) right before an attacker-typed fake timestamp isn't
stopped. `buildCommentHtml` only escapes `& < > " '`; digits, `/`, `:`, `|`
pass through untouched.

**Exploit:** any signed-in user posts a comment containing an embedded fake
record, e.g. using a real coworker's email as the forged author — the next
render splits it into a second, fabricated comment attributed to that
person, and `CommentThread.tsx`'s email-based `isOwn` check even renders an
Edit button on it as if the victim wrote it. Real risk to the integrity of
approvals/sign-offs recorded in comment threads across every department
(EIR, ECN, FAIT, Gray Market, Customer Notes, Cost Impact Notices, Build
Requests, MRB, Panels, Maintenance — 47 files depend on this shared parser,
confirmed none of them reimplement their own, so **one fix here covers
everything**).

**Recommendation:** escape or reject the delimiter sequence at write time —
either encode `|||`/timestamp-pattern sequences within comment bodies
before persisting, or move the stored format away from something forgeable
from within a text field (e.g. a JSON array). This is the top-priority real
fix from this audit.

### 2. NEEDS VERIFICATION (not a pure code bug) — Admin/role list write access
**Files:** `src/auth/msalConfig.ts:79-86` (scope config), `src/components/
RequireAdmin.tsx:19`, `src/hooks/useAdmins.ts`, `useEirRoles.ts`,
`useOpenOrdersCustomers.ts` (`useAdminGuard`), and similar per-department
role hooks.

The app requests `Sites.Selected` and enforces admin/role gating entirely
client-side (a `useMutation` guard that throws before calling the API if
`useIsAdmin()`/equivalent is false). Earlier analysis assumed this meant any
signed-in user could bypass the UI and self-escalate by POSTing to the
Admins/role lists with their own token. **That assumption needs a
correction:** `Sites.Selected` governs what the *application* may request,
not what an individual user's *delegated* token can do — SharePoint still
enforces that user's own object-level list permissions on top of it. The
code is explicit that it's relying on this: `RequireAdmin.tsx:19` states
outright "the real security boundary is SharePoint per-list permissions,"
echoed in `useAdmins.ts`, `useEirRoles.ts`, and referenced in `usePanelRoles.ts`
/ `useCsaListings.ts` / `useQuickLinks.ts`.

**This can't be resolved by reading source code.** It depends on whether the
Admins, EIR Roles, Panel Roles, Maintenance Roles, and Open Orders Roles
SharePoint lists actually have broken/restricted permission inheritance
limiting writes to real admins.

**Recommendation:** whoever manages the SharePoint site needs to confirm
list-level permissions directly. If they're properly restricted, this was
never a live issue and the code's own defense-in-depth comments are
accurate. If they aren't, this is a real, tenant-wide gap hitting every one
of those lists identically (not worse than before — it scaled uniformly
with the app's growth, not disproportionately) and severity should be
treated as HIGH given how many lists are now affected.

### 3. LOW-MEDIUM — Hardcoded bootstrap admin
**File:** `src/lib/adminAccess.ts:16-19` (`BOOTSTRAP_ADMINS`)

`demo.user@altronic-llc.com` is a permanent, hardcoded admin, active in real
mode too (not gated behind `USE_MOCK`), and can't be revoked from the Admins
UI since it isn't stored in the Admins list.

**Recommendation:** gate behind `USE_MOCK`, or document explicitly as
permanent-by-design if that's intended.

### 4. LOW — Unresolved, needs live-endpoint verification
**Files:** `src/api/projectFiles.ts:101,300`, `src/api/openOrdersFiles.ts:47`

Graph drive path-addressing URLs (`{basePath}:/{name}:`) built from
filenames via `encodeURIComponent` per segment. Whether a crafted filename
containing an encoded `/` could be reinterpreted by Graph's colon-path
parser as a path separator (path traversal) wasn't verified against a live
endpoint in either audit pass. Not asserted as a confirmed bug — flagged as
an open question.

**Recommendation:** either verify against a live Graph endpoint, or
preemptively apply the same `safeName` sanitization used in
`attachments.ts` for defense-in-depth regardless of the live-endpoint
answer.

### 5. INFO — Minor logging, not PII
**File:** `src/api/projectFiles.ts:490-496`

An unconditional `console.log` (fires in mock AND real mode, unlike the two
fixed findings above) prints the uploaded file's name, resolved folder name,
final stored filename, and folder kind/prefix. No person's name/email
involved — filename/folder-structure disclosure only. Low priority; noted
for completeness, not fixed in this pass.

---

## Clean — verified, no action needed

- **All 10 real `dangerouslySetInnerHTML` call sites** across every entity
  type (EIR, ECN, Gray Market, Customer Notes, Cost Impact Notices, Build
  Requests, tasks, comments) route through `sanitiseHtml()`. Its DOMPurify
  config (`FORBID_TAGS`/`FORBID_ATTR`/`ADD_TAGS`/`ADD_ATTR`) is still safe —
  no path to `javascript:` URIs or event handlers. `linkifyHtml()` runs
  before sanitization, so anything it introduces is still filtered.
- **`src/components/useCommentOriginLink.ts`** — a "jump to source" link
  handler for cross-entity mirrored comments. Deliberately guards against
  becoming an open-redirect (checks modifier keys, reads the raw `href`
  attribute rather than the resolved URL, requires a leading `/`). The
  content it handles (`buildMirroredBody` in `commentMirror.ts`) properly
  escapes the origin sentence, link text, and href before embedding.
- **`src/api/currentUser.ts:66`** — same OData-literal-escaping gap in
  principle as the attachments fix, but only ever called with the signed-in
  user's own UPN; not reachable with attacker-controlled input today.
- **`src/api/teradyneLog.ts`'s `encodeFilter`** — a deliberate, correctly-
  scoped helper (not raw `encodeURIComponent`), fed only internal/trusted
  filter values. Not a bug.
- **`SHARED_MAILBOX` encoding** (`errorReport.ts`, `email.ts`,
  `editFailureReport.ts`, `pottingSampleLog.ts`) — `encodeURIComponent` used
  correctly for a URL path segment on a trusted config value.

---

## Priority order

1. **Finding 1 (High)** — comment/identity forgery. Directly exploitable by
   any user today; single shared fix point.
2. **Finding 2** — get a real answer on SharePoint list permissions from
   whoever manages the site. Severity depends entirely on that answer.
3. **Finding 3** — gate or document the hardcoded bootstrap admin.
4. **Finding 4** — verify or preemptively sanitize the two Graph
   path-addressing call sites.
5. **Finding 5** — low-priority cleanup, no urgency.
