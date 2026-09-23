# Guest notifications via Power Automate — Engineering Tasks

**Status: ready to build and test.** Step-by-step for the Engineering Project
Task List only. Decided with Ray, 2026-09-23.

> **There is a generator — you probably don't need to build this by hand.**
> `./scripts/new-guest-notification-flow.ps1` writes an importable package
> with the site, list, domain and every expression already baked in. Import it
> at make.powerautomate.com → My flows → Import. This document remains the
> reference for what the flow does, and the fallback if the import is refused.
>
> **When you import, check the Review Package Content table lists the flow
> plus two connections.** If it says **No items**, the package is wrong and
> the import will report success while creating nothing — that happened on
> 2026-09-23 and is now guarded against, but the green tick alone is not
> evidence the flow exists. Check **My flows** afterwards either way.
>
> **For Obsidian:** `docs/obsidian/ARC — Guest comment notifications (Power
> Automate).md` is the same guide with frontmatter, callouts and wikilinks,
> written to drop straight into a vault.

Scope deliberately narrow: **one list, guests only.** Prove it on the task list
before adding a flow per list, and leave the employee path completely alone.

---

## Why this exists

ARC sends notifications with Graph `sendMail` **from
`automation@altronic-llc.com`, on behalf of the signed-in user**. That needs
the signed-in user to hold Exchange **Send-As _and_ FullAccess** on that
mailbox, granted per person.

A **guest (B2B) user cannot hold either** — Exchange permissions need a
mail-enabled recipient object in _this_ tenant, and a guest's mailbox lives in
their own organisation. So today, when a guest comments:

- the comment **saves normally** (nothing is lost)
- `sendMail` returns **403**
- the guest sees _"Your comment saved, but you don't have access to send
  notification email — X was NOT notified."_
- **the watchers are never emailed**

This flow closes that last gap.

### CHECK THIS FIRST — it may make the flow unnecessary

If the guest turns out to have a real mailbox in the tenant, he needs a
permissions grant and no flow at all.

**Exchange admin centre** → <https://admin.exchange.microsoft.com> →
**Recipients**, search `motortech`:

| Found under | Means | Do |
| --- | --- | --- |
| **Mailboxes** | Real mailbox in this tenant | **No flow.** Grant Send-As + FullAccess on `automation@` — he then works exactly like an employee |
| **Contacts** | Mail contact / mail user | Build the flow |
| Nowhere | No Exchange object | Build the flow |

(The PowerShell equivalent is `Get-Recipient RVoelz@motortech.de`, but
`Connect-ExchangeOnline` crashes on this machine inside the module's Windows
broker — `-Device` avoids it. The portal is quicker.)

---

## Design: SharePoint triggers the flow — ARC never calls it

**Do not create an HTTP-triggered flow for ARC to call.**

An HTTP trigger authenticates by a **shared secret embedded in its URL**. ARC
is a static bundle served to anyone on the internet, so that URL would be
extractable from the JavaScript and anyone who found it could send mail as
`automation@`. Same reasoning as the QZ Tray private key (CLAUDE.md), except
the consequence is a public spoofing endpoint.

The guest's comment already writes to SharePoint, so watch the list instead:

```
Guest posts a comment in ARC
  → ARC writes Communication to the list     (already works today)
  → Flow triggers on the modified item
  → Flow reads the NEWEST comment record
  → Flow stops unless the author is external
  → Flow emails the watchers, as the flow owner
```

Bonus: this also covers comments written in SharePoint's own UI or the legacy
Power Apps form, which ARC never sees.

---

## What you need

| Thing | Value |
| --- | --- |
| Site | `https://coopermachineryservices.sharepoint.com/sites/Altronic_Engineering` |
| List | **Project Task List** (id `42fb8c19-5f33-4fdd-9ef7-df6f21433588`) |
| Comment column | `Communication` (plain multi-line text) |
| Watchers column | `Watchers` (multi-person) |
| Title column | `NumberedTitle` (e.g. `T3-0017-HUB V4 refresh`) |
| Internal domain | `altronic-llc.com` — everything else is a guest |

**Flow owner:** use a **service account**, not a personal one. A flow sends as
its owner, so a personal account makes notifications come from a person and
breaks when they leave.

---

## Build it

### 1. Trigger

**When an item is created or modified** (SharePoint)

- Site Address: the Altronic_Engineering site above
- List Name: **Project Task List**

### 2. Get the newest comment — `Compose` actions

`Communication` holds the **entire thread in one column**, records separated by
a newline, each record being:

```
MM/DD/YYYY HH:MM:SS AM/PM|||Author Name|||author@email|||<html body>
```

Power Automate has no regex, so split on the newline to isolate the last
record, then take fields **from the front**.

> **Take fields from the FRONT, never the back.** A comment body can itself
> contain `|||`, which shifts every field if you index backwards — the author
> email then reads as a fragment of the body. Verified, 2026-09-23. ARC's own
> parser re-joins the body for exactly this reason
> (`src/lib/communicationParser.ts`).

**Compose — `LastRecord`**

```
@{last(split(triggerOutputs()?['body/Communication'], decodeUriComponent('%0A')))}
```

**Compose — `Fields`**

```
@{split(outputs('LastRecord'), '|||')}
```

**Compose — `AuthorEmail`**

```
@{trim(outputs('Fields')[2])}
```

**Compose — `AuthorName`**

```
@{trim(outputs('Fields')[1])}
```

**Compose — `CommentTimestamp`**

```
@{trim(outputs('Fields')[0])}
```

**Compose — `CommentBody`** (re-joins, so `|||` in the body survives)

```
@{join(skip(outputs('Fields'), 3), '|||')}
```

### 3. Stop unless the author is a guest — `Condition`

Employees are **already emailed by ARC**. Without this check every employee
comment notifies twice.

**Condition:** `AuthorEmail` _does not end with_ `@altronic-llc.com`

```
@{not(endsWith(toLower(outputs('AuthorEmail')), '@altronic-llc.com'))}
```

Put everything below in the **If yes** branch. The **If no** branch does
nothing — ARC already handled it.

> Matching the domain, not `#EXT#`: ARC stores a person's **mailbox**
> everywhere, not their UPN. Keep this rule identical to
> `INTERNAL_EMAIL_DOMAINS` in `src/lib/guestIdentity.ts` — if another Cooper
> domain is ever added, both change together.

### 4. Don't re-send the same comment — `Condition`

A modified-trigger fires on **every** column change, not just `Communication`.
Without a guard, changing a task's status re-emails its last comment.

Add the **`LastNotifiedComment`** column to the list first — there is a script
for it, so you don't have to do it by hand:

```powershell
# preview, changes nothing
./scripts/add-task-last-notified-column.ps1 -WhatIf

# create it (-DeviceCode if the sign-in popup can't open)
./scripts/add-task-last-notified-column.ps1
```

Then:

**Condition:** `CommentTimestamp` **is not equal to** `LastNotifiedComment`

```
@{not(equals(outputs('CommentTimestamp'), coalesce(triggerOutputs()?['body/LastNotifiedComment'], '')))}
```

At the **end** of the flow, **Update item** → set `LastNotifiedComment` to
`CommentTimestamp`.

> The column is the reliable option. Comparing against the trigger's previous
> run time is tempting and wrong — two comments inside one polling interval
> would collapse to one notification.

### 5. Who to email

`Watchers` is multi-person, so use **Apply to each** over
`triggerOutputs()?['body/Watchers']`.

Inside the loop, **skip the author** (they don't need their own comment):

```
@{not(equals(toLower(items('Apply_to_each')?['Email']), toLower(outputs('AuthorEmail'))))}
```

> ARC's full rule is `commentNotifyRecipients` in `src/lib/mentions.ts` —
> watchers **plus anyone @-mentioned**, deduped, minus the author. Watchers
> alone is the right starting point; mentions are stored as
> `<span class="mention" data-email="...">` in the body and can be added later
> if people miss them.

### 6. Send the email

**Send an email (V2)** — Outlook

- **To:** `items('Apply_to_each')?['Email']`
- **Subject:** `@{outputs('AuthorName')} commented on @{triggerOutputs()?['body/NumberedTitle']}`
- **Body:**

```html
<p><strong>@{outputs('AuthorName')}</strong> (external) commented on
<strong>@{triggerOutputs()?['body/NumberedTitle']}</strong>:</p>

<blockquote>@{outputs('CommentBody')}</blockquote>

<p><a href="https://altronic-llc.github.io/altronic-arc/task/@{triggerOutputs()?['body/ID']}">Open this task in ARC</a></p>

<p style="color:#888;font-size:12px">Sent by ARC on behalf of an external
collaborator, who cannot send from the notifications mailbox.</p>
```

- **Reply-To:** `@{outputs('AuthorEmail')}` — so replies reach the guest
  rather than the flow owner

The deep link must keep the `/altronic-arc/` sub-path or it 404s on GitHub
Pages.

---

## Test it

1. **Add yourself as a watcher** on a throwaway task, and make sure the guest
   is **not** the author yet.
2. **Comment as an employee** (yourself, in ARC). → You get ARC's normal
   email. The flow runs and stops at step 3. **You must NOT get two emails** —
   if you do, the guest condition is inverted.
3. **Comment as the guest.** → The flow sends. Check: correct task title, the
   comment body intact, the link opens the right task, Reply-To is the guest.
4. **Change the task's status** (no new comment). → **No email.** If one
   arrives, step 4's guard isn't working.
5. **Comment as the guest twice in a row.** → Two emails, each with the right
   body — not the same one twice.
6. **Comment with `|||` in the text.** → The email body shows the pipes and
   the author is still right. This is the case that breaks a back-indexed
   parse.

**Check the flow's run history** for every test, not just your inbox — a flow
that fails silently looks identical to one that correctly decided not to send.

---

## Known limits

- **One flow per list.** This covers Engineering Tasks only. EIRs, ECNs, Build
  Requests and the rest each need their own — the main cost of this approach,
  and why it starts with one.
- **Attachments aren't carried.** ARC inlines comment attachments as links; the
  flow sends the body as stored, so a screenshot appears as a link needing ARC
  sign-in. Acceptable — the recipient has to open ARC to reply anyway.
- **@-mentions don't notify** unless step 5 is extended to parse
  `data-email` out of the body. Watchers do.
- **Sender is the flow owner**, not `automation@`, unless the owner has Send-As
  on it. Worth granting so guest and employee notifications look alike.
- **The guest still sees the failure toast in ARC** until ARC is taught to
  suppress it (`isGuestEmail` exists for this; not wired up yet). Tell him to
  ignore it, or ask for that change.
