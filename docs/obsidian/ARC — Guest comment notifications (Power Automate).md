---
title: ARC — Guest comment notifications (Power Automate)
tags:
  - arc
  - power-automate
  - sharepoint
  - notifications
  - how-to
created: 2026-09-23
status: ready-to-build
scope: Engineering Project Task List — guests only
---

# ARC — Guest comment notifications

> [!abstract] What this sets up
> Email notifications to task watchers when an **external (guest)** user
> comments on an Engineering task in ARC. Employees are already covered by ARC
> itself — this fills the one gap guests leave.

> [!info] Scope
> **Engineering Project Task List only. Guests only.** The employee path is not
> touched. One flow per list is the cost of this approach, so prove it on one
> list before building any others.

**Two ways to do this:**

| | Time | Best when |
| --- | --- | --- |
| [[#A — Generate and import a package]] | ~10 min | Normal route. No clicking, nothing to mis-type |
| [[#B — Build it by hand]] | ~45 min | The import is rejected, or you want to understand every piece |

---

## Step 0 — Check whether you need this at all

> [!warning] Do this first
> If the guest has a real mailbox in your tenant, he needs a **permissions
> grant and no flow at all**. Two minutes here can save the whole build.

1. Go to [admin.exchange.microsoft.com](https://admin.exchange.microsoft.com)
2. Left menu → **Recipients**
3. Search `motortech` (or the guest's surname) under **Mailboxes**, then under **Contacts**

| Where he appears | Means | Do |
| --- | --- | --- |
| **Mailboxes** | Real mailbox in this tenant | **Stop here.** Grant Send-As + FullAccess on `automation@altronic-llc.com` — he then works exactly like an employee |
| **Contacts** | Mail contact / mail user; mailbox is at motortech.de | Carry on |
| Nowhere | No Exchange object at all | Carry on |

> [!note]- PowerShell alternative (click to expand)
> `Get-Recipient RVoelz@motortech.de` answers the same question, but
> `Connect-ExchangeOnline` crashes inside the module's Windows broker on at
> least one machine here — a `NullReferenceException` in `RuntimeBroker`.
> `Connect-ExchangeOnline -Device` avoids it. The portal is quicker.

---

## Step 1 — Add the `LastNotifiedComment` column

Required either way. It is what stops the flow re-emailing the same comment
every time anything on the task changes — see
[[#Why the LastNotifiedComment column]].

```powershell
cd C:\REPOS\altronic-arc

# Preview. Changes nothing.
./scripts/add-task-last-notified-column.ps1 -WhatIf

# Create it. Add -DeviceCode if the sign-in popup can't open.
./scripts/add-task-last-notified-column.ps1
```

Idempotent — safe to re-run. It prints the column's **exact internal name**.

> [!note]- Doing it by hand instead
> List → **Settings → List settings → Create column**
> Name `LastNotifiedComment` · Type **Single line of text** · Max length `64`
> · Default **empty**.

> [!danger] Do not make it a Date column
> It stores the comment's raw timestamp *string* as ARC wrote it —
> `09/23/2026 02:30:00 PM`. A Date column would reformat or timezone-shift it
> and the comparison would never match.

---

## A — Generate and import a package

### A1. Generate it

```powershell
cd C:\REPOS\altronic-arc
./scripts/new-guest-notification-flow.ps1
```

Writes two files to the repo root:

- `ARC-GuestNotify-ProjectTaskList.zip` — the importable package
- `ARC-GuestNotify-ProjectTaskList.definition.json` — a readable copy

No sign-in, no network. It only writes files.

> [!tip] Same flow for another list
> ```powershell
> ./scripts/new-guest-notification-flow.ps1 `
>     -ListName "EIRs" `
>     -ListId "8d00a762-288c-4678-afc4-cba2f24ac965" `
>     -TitleColumn "EIRNo"
> ```

### A2. Read the definition first

Open the `.definition.json`. You are about to import something that emails
people — worth thirty seconds. Check the list GUID and the domain in the guest
condition are what you expect.

### A3. Import

1. [make.powerautomate.com](https://make.powerautomate.com)
2. Confirm the **environment** picker (top right) is production
3. **My flows** → **Import** → **Import Package (Legacy)**
4. Upload the `.zip`
5. Under **Related resources**, set both connections:
   - **SharePoint** → your SharePoint connection
   - **Office 365 Outlook** → the service account's connection
6. **Import**

> [!important] Who owns the flow matters
> A flow sends email **as its owner**. Use a **service account**, not your
> personal one — otherwise notifications come from you personally and break
> when your account changes.

> [!warning] If the import is rejected
> The package format is not a documented Microsoft contract. Fall back to
> [[#B — Build it by hand]] — same flow, same expressions.

### A4. Turn it on

The flow imports **off**, which is correct. Open it, read it, then **Turn on**.

Now go to [[#Step 9 — Test it]].

---

## B — Build it by hand

### B1. Create the flow

1. [make.powerautomate.com](https://make.powerautomate.com) → **Create**
2. **Automated cloud flow**
3. Name: `ARC - Guest comment notifications (Engineering Tasks)`
4. Trigger: search `When an item is created or modified` → **SharePoint**
5. **Create**

### B2. The trigger

| Field | Value |
| --- | --- |
| **Site Address** | `https://coopermachineryservices.sharepoint.com/sites/Altronic_Engineering` |
| **List Name** | **Project Task List** |

If the site isn't listed, choose **Enter custom value** and paste the URL.

### B3. Read the newest comment — six Compose actions

ARC stores the **whole comment thread in one column**, `Communication`.
Records are newline-separated; each looks like:

```text
MM/DD/YYYY HH:MM:SS AM/PM|||Author Name|||author@email|||<html body>
```

So a two-comment thread is literally:

```text
09/20/2026 10:15:00 AM|||Sarah Shaffer|||sarah.shaffer@altronic-llc.com|||<p>first</p>
09/23/2026 02:30:00 PM|||Ralf Voelz|||RVoelz@motortech.de|||<p>second</p>
```

Power Automate has no regex, so: split on the newline for the last record,
then split that on `|||` for its fields.

For **each** of the six: **+ New step** → search `Compose` → **Data Operation —
Compose** → **rename it** (its **…** → **Rename**) → paste into **Inputs**.

> [!danger] Renaming is not optional
> Every later action references these by name. Leave them as `Compose`,
> `Compose 2`… and all the expressions below are wrong.

**1 · `LastRecord`**

```text
@{last(split(triggerOutputs()?['body/Communication'], decodeUriComponent('%0A')))}
```

**2 · `Fields`**

```text
@{split(outputs('LastRecord'), '|||')}
```

**3 · `CommentTimestamp`**

```text
@{trim(outputs('Fields')[0])}
```

**4 · `AuthorName`**

```text
@{trim(outputs('Fields')[1])}
```

**5 · `AuthorEmail`**

```text
@{trim(outputs('Fields')[2])}
```

**6 · `CommentBody`**

```text
@{join(skip(outputs('Fields'), 3), '|||')}
```

> [!danger] Take fields from the FRONT — never count back from the end
> A comment body can itself contain `|||`. Index backwards (e.g.
> `Fields[length-2]` for the email) and a single such comment shifts **every**
> field, so the author's email silently reads as a chunk of body text.
>
> Tested 2026-09-23 with the body `<p>pipes ||| inside</p>`: backwards
> indexing returned `<p>pipes ` as the email address. Fields 0/1/2 from the
> front plus a re-join (action 6) handles it. ARC's own parser re-joins the
> body for exactly this reason.

### B4. Guests only

1. **+ New step** → `Condition` → rename to `Is the author external?`
2. Left box → **Expression** tab:

```text
not(endsWith(toLower(outputs('AuthorEmail')), '@altronic-llc.com'))
```

3. Middle: **is equal to** · Right box → **Expression**: `true`

Everything below goes in **`If yes`**. Leave `If no` empty.

> [!danger] This is what stops double-notifying
> ARC already emails watchers for **employee** comments. Without this check
> every employee comment sends twice. Test [[#9.1 Employee comment → exactly ONE email|9.1]] catches an inverted condition.

> [!note] Why the domain, not the `#EXT#` tag
> ARC stores a person's **mailbox** everywhere — person columns, mention
> chips, recipient lists — never their UPN, so `#EXT#` isn't available here.
> Keep this identical to `INTERNAL_EMAIL_DOMAINS` in
> `src/lib/guestIdentity.ts`. If another Cooper domain is ever added, **both
> change together**.

### B5. Don't re-send

Inside `If yes`:

1. **Add an action** → `Condition` → rename to `Is this a new comment?`
2. Left box → **Expression**:

```text
not(equals(outputs('CommentTimestamp'), coalesce(triggerOutputs()?['body/LastNotifiedComment'], '')))
```

3. Middle: **is equal to** · Right → **Expression**: `true`

Everything remaining goes inside **this** condition's `If yes`.

### B6. Email each watcher

**Loop:** **Add an action** → `Apply to each` → rename `Each watcher` →
**Expression**:

```text
triggerOutputs()?['body/Watchers']
```

**Skip the author:** inside the loop, `Condition` → rename `Not the author` →
left box **Expression**:

```text
not(equals(toLower(items('Each_watcher')?['Email']), toLower(outputs('AuthorEmail'))))
```

Middle **is equal to** · right `true`.

> [!tip] Underscores inside `items()`
> `items('Each_watcher')` — spaces become underscores in expressions.

**Send:** inside `Not the author` → `If yes` → **Office 365 Outlook — Send an
email (V2)**

**To** (Expression):

```text
items('Each_watcher')?['Email']
```

**Subject** (Expression):

```text
concat(outputs('AuthorName'), ' commented on ', triggerOutputs()?['body/NumberedTitle'])
```

**Body** — click **`</>`** (code view) on the body box **first**, then paste:

```html
<p><strong>@{outputs('AuthorName')}</strong> (external) commented on
<strong>@{triggerOutputs()?['body/NumberedTitle']}</strong>:</p>

<blockquote>@{outputs('CommentBody')}</blockquote>

<p><a href="https://altronic-llc.github.io/altronic-arc/task/@{triggerOutputs()?['body/ID']}">Open this task in ARC</a></p>

<p style="color:#888;font-size:12px">Sent by ARC on behalf of an external
collaborator, who cannot send from the notifications mailbox.</p>
```

**Show advanced options → Reply To**:

```text
@{outputs('AuthorEmail')}
```

> [!important] Keep `/altronic-arc/` in the link
> ARC is served from a GitHub Pages sub-path. Dropping it 404s.

### B7. Record what was sent

**Outside** the `Each watcher` loop, still inside B5's `If yes`:

**Add an action** → **SharePoint — Update item**

| Field | Value |
| --- | --- |
| **Site Address** | same as the trigger |
| **List Name** | **Project Task List** |
| **Id** | `triggerOutputs()?['body/ID']` (Expression) |
| **Last Notified Comment** | `outputs('CommentTimestamp')` (Expression) |

**Save.**

> [!warning] Outside the loop, not inside
> Inside, it writes once per watcher — harmless but it makes run history much
> harder to read.

---

## Step 9 — Test it

> [!important] Watch the run history, not just your inbox
> Flow → **Run history**. A flow that fails silently looks *identical* to one
> that correctly decided not to send.

Set up: a throwaway task, with **yourself** as a watcher.

### 9.1 Employee comment → exactly ONE email

Comment yourself, in ARC.

- ✅ ARC's normal notification arrives
- ✅ Run history shows the flow ran and **stopped at the guest check**
- ❌ **Two emails → the guest condition is inverted**

### 9.2 Guest comment → the flow sends

- ✅ Subject names the author and the task
- ✅ Body shows the comment
- ✅ Link opens the right task
- ✅ Reply-To is the guest
- ✅ `LastNotifiedComment` now holds that timestamp

### 9.3 Status change, no comment → NO email

- ✅ Flow runs, stops at the dedupe guard
- ❌ An email means the guard isn't working — check the column's internal name

### 9.4 Two guest comments in a row → two correct emails

- ✅ Each shows **its own** comment, not the same one twice

### 9.5 A comment containing `|||`

Have the guest post `test ||| pipes`.

- ✅ Body shows the pipes, author still correct
- ❌ A mangled sender means backwards field indexing

### 9.6 Guest comment, no watchers → no email, no failure

- ✅ Run succeeds, loop ran zero times

---

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| Employees get two emails | Guest condition inverted — check `not(...)` and `is equal to true` |
| Nobody gets anything | A condition is stopping everything. Open the run, read each condition's inputs/outputs |
| Same comment emailed repeatedly | Update item missing, or the column's internal name doesn't match |
| `The expression is invalid` | An action wasn't renamed — check all six names |
| Author shows as HTML fragments | Backwards field indexing. Rebuild per B3 |
| Body shows raw `<p>` tags | Body box wasn't switched to code view (`</>`) |
| Link 404s | `/altronic-arc/` missing |
| `items('Each watcher')` invalid | Use underscores: `items('Each_watcher')` |
| Mail comes from a person | Flow owner is a personal account |
| Import rejected | Package format isn't a documented contract — build by hand |

---

## Background

### Why guests can't just send like everyone else

ARC sends notifications with Graph `sendMail` **from
`automation@altronic-llc.com`, on behalf of the signed-in user**. That needs
the signed-in user to hold Exchange **Send-As _and_ FullAccess** on that
mailbox, granted per person.

A guest (B2B) user can hold **neither** — Exchange permissions need a
mail-enabled recipient object in _this_ tenant, and a guest's mailbox lives in
their own organisation. So today, when a guest comments:

- the comment **saves normally** — nothing is lost
- `sendMail` returns **403**
- the guest sees _"Your comment saved, but you don't have access to send
  notification email — X was NOT notified."_
- **the watchers are never emailed**

### Why SharePoint triggers the flow, instead of ARC calling it

> [!danger] Never give ARC an HTTP-triggered flow URL
> An HTTP trigger authenticates by a **shared secret embedded in its URL**.
> ARC is a static bundle served to anyone on the internet, so that URL would
> be extractable from the JavaScript — and anyone who found it could send mail
> as `automation@`.
>
> Same reasoning as the QZ Tray private key, except the consequence is a
> public spoofing endpoint rather than a stray print job.

Watching the list has a bonus: it also catches comments written in
SharePoint's own UI or the legacy Power Apps form, which ARC never sees.

### Why the `LastNotifiedComment` column

The created-or-modified trigger fires on **every** column change, not just
`Communication`. The column is the only reliable record of which comment has
already been emailed.

Comparing against the trigger's own "previous run time" is tempting and
**wrong**: two comments inside one polling interval would collapse into a
single notification.

### What this deliberately does not do

| Limitation | Why |
| --- | --- |
| **One flow per list** | Engineering Tasks only. EIRs, ECNs, Build Requests each need their own — the main cost, and why it starts with one |
| **Attachments aren't carried** | They appear as links needing ARC sign-in. The recipient must open ARC to reply anyway |
| **@-mentions don't notify** | Watchers only. Mentions are stored as `<span class="mention" data-email="…">` and could be parsed later |
| **Sender is the flow owner** | Not `automation@` unless the owner has Send-As on it. Worth granting so guest and employee mail look alike |
| **The guest still sees ARC's error toast** | ARC doesn't yet suppress it for guests — `isGuestEmail()` exists in `src/lib/guestIdentity.ts` but isn't wired up. Tell him to ignore it |

### Reference

| Thing | Value |
| --- | --- |
| Site | `https://coopermachineryservices.sharepoint.com/sites/Altronic_Engineering` |
| List | **Project Task List** — `42fb8c19-5f33-4fdd-9ef7-df6f21433588` |
| Comment column | `Communication` (plain multi-line text) |
| Watchers column | `Watchers` (multi-person) |
| Title column | `NumberedTitle` — e.g. `T3-0017-HUB V4 refresh` |
| Internal domain | `altronic-llc.com` — everything else is a guest |
| ARC base URL | `https://altronic-llc.github.io/altronic-arc/` |
| Generator | `scripts/new-guest-notification-flow.ps1` |
| Column script | `scripts/add-task-last-notified-column.ps1` |
