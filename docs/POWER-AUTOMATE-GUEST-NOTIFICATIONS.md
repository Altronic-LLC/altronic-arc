# Guest notifications via Power Automate

**Status: not built.** This is the build brief for whoever creates the flow.
Decided with Ray on 2026-09-23.

## The problem

ARC sends every notification with Graph `sendMail` **from the shared mailbox
`automation@altronic-llc.com`, on behalf of the signed-in user**. That needs
the signed-in user to hold Exchange **Send-As _and_ FullAccess** on that
mailbox, granted per person (see `BACKLOG.md` — moving this to a group is its
own queued item).

A **guest (B2B) user cannot be granted either.** Exchange permissions need a
mail-enabled recipient object in *this* tenant, and a guest's mailbox lives in
their own organisation. So for a guest:

- `sendMail` returns **403**, which ARC classifies as a permission failure
- the comment **saves normally** — nothing is lost
- the guest sees a toast: *"Your comment saved, but you don't have access to
  send notification email — X was NOT notified."*

Nothing is silent, but the watchers genuinely are not emailed.

## Why Power Automate and not a server

Ray's call, 2026-09-23: **Power Automate, handling guests and scheduled alerts
only.** The employee path stays exactly as it is.

- It runs on the existing M365 licence — no hosting, no Azure subscription, no
  secret to rotate.
- A flow sends as **its owner**, not as the signed-in user, so the guest's lack
  of a mailbox stops mattering.
- It is already the documented plan for the Medius → Suppliers sync, so this is
  not ARC's first flow by intent.

An Azure Function was the alternative and was **not** chosen for this step.

## The trigger: SharePoint, NOT an HTTP call from ARC

**Do not give ARC a flow URL to call.**

An HTTP-triggered flow authenticates by a **shared secret embedded in its
URL**. ARC is a static bundle served to anyone on the internet — that URL
would be extractable from the JavaScript, and anyone who found it could send
mail as `automation@`. This is the same reasoning as the QZ Tray private key
(see CLAUDE.md, "Signed when VITE_QZ_CERTIFICATE…"), except the consequence is
a public spoofing endpoint rather than a print job.

Use **"When an item is created or modified"** on the list instead. The guest's
comment already writes to the `Communication` column, so the flow sees it with
nothing to call and no secret anywhere.

```
Guest posts a comment in ARC
  → ARC writes Communication to SharePoint        (already works today)
  → Flow triggers on the modified item
  → Flow parses the NEWEST comment record
  → Flow checks the author is external
  → Flow emails the watchers, as the flow owner
```

A side benefit: this also covers comments written in SharePoint's own UI or the
legacy Power Apps form, which ARC never sees.

## Two rules the flow MUST get right

### 1. Only send for EXTERNAL authors

Employees are already emailed by ARC directly. A flow that sends
unconditionally means **every employee comment notifies twice.**

The rule Ray chose (2026-09-23): **an address is internal if and only if its
domain is `altronic-llc.com`; anything else is a guest.**

> This was only safe to adopt because `@hoerbiger.com` is retired. Until
> 2026-09-23, 25 of the 28 people in ARC's own data were `@hoerbiger.com` and
> that rule would have labelled most of the company external. If another Cooper
> domain comes into use, this rule and `isGuestEmail()` in
> `src/lib/guestIdentity.ts` must be updated **together**.

### 2. Only the NEWEST comment

`Communication` is **one text column holding the entire thread**. A flow that
reads the whole value on every modification will re-email every historical
comment, every time anything on the item changes.

Record format (one per comment, concatenated, oldest first):

```
MM/DD/YYYY HH:MM:SS AM/PM|||Author Name|||author@email|||<html body>
```

So: split the value on the timestamp pattern, take the **last** record, and
read field 3 for the author address. Parsing is documented in
`src/lib/communicationParser.ts` — match its behaviour rather than inventing a
second parser.

**Also guard against re-firing.** A SharePoint modified-trigger fires for every
column change, not just `Communication`. Without a check, editing a status
re-sends the last comment. Options, cheapest first:

- Compare the newest comment's timestamp against the trigger's previous run
- Keep a "last notified comment timestamp" column on the list
- Accept a duplicate and let the flow's own 5-minute dedupe window absorb it
  (weakest — do not rely on it)

## Who to email

The item's **`Watchers`** column, minus the comment author. ARC's own rule is
`commentNotifyRecipients` in `src/lib/mentions.ts` — watchers plus anyone
@-mentioned, deduped, minus the author unless they mentioned themselves.

An @-mention is stored as:

```html
<span class="mention" data-email="sarah.shaffer@altronic-llc.com">@Sarah Shaffer</span>
```

so the mentioned addresses are recoverable from the body if the flow wants to
match ARC exactly.

## Which lists

Start with **one** list and prove the mechanism before fanning out. The
Engineering Project Task List is the obvious first (`VITE_SP_TASK_LIST_ID`, on
`SITES.engineering`).

Every list with a `Communication` column would eventually need its own flow —
that is the main cost of this approach, and the reason not to build all of them
up front.

## What ARC does on its side

`src/lib/guestIdentity.ts` holds the single definition of "is this address
external", so ARC and the flow can agree. In ARC it is used to:

- keep the guest **visible in people pickers**, labelled `external`, so they
  can be @-mentioned and assigned (they were excluded before — `#EXT#` UPNs
  are filtered out of the directory)
- **suppress the alarming toast** for a guest, whose mail the flow handles —
  telling them they "don't have access to send notification email" is wrong
  once the flow is live

## Still to decide / verify

- [ ] Does the federated guest actually have a mail-enabled identity in
      Exchange? If `Get-Recipient` returns `UserMailbox`, he may just need a
      Send-As grant and **no flow at all**. Run this first:
      ```powershell
      Get-Recipient -Identity "<his address>" |
        Select-Object Name, RecipientType, RecipientTypeDetails, PrimarySmtpAddress
      ```
- [ ] Who owns the flow? It sends as its owner, so a personal account makes the
      mail come from a person and breaks when they leave. A service account is
      the right answer.
- [ ] Confirm the flow's sender address is acceptable — it will not be
      `automation@` unless the owner has rights to it.
- [ ] Scheduled alerts (overdue PMs, LTB dates, stale FAITs) were the other
      half of Ray's ask. Separate flows; not covered by this brief.
