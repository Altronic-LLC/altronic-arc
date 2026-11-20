# Insourcing Quoting — design

Source: BusinessIT issue #37 ("Insourcing Quoting"). Status: **design agreed in discussion, not yet built.**
Branch: `feature/insourcing-quoting` (local only). Written 2026-10-09.

Reference tool for the pricing maths: <https://github.com/Alt-Rwhite/AltronicQuoteTool> (a single `index.html`, Supabase-backed, html2canvas + jsPDF).

## 1. What it is

A tool, inside ARC, for producing insourcing quotes. It centralises what is today scattered across email: the customer's data package, labour and material cost, per-part pricing, and the conversation between engineering, sales and operations. It outputs a formatted PDF quote for the customer.

- **Customers never use the tool.** They only receive the PDF.
- **Every new-product quote is budgetary** (non-binding), unless the box is unticked.
- **Departments:** shared across Sales, Engineering, Supply Chain and Operations. Access is by role (section 3), not by department.
- **Phase 2** (not in the first release): raise an Engineering or Operations task from a quote.

## 2. Structure: Quote → Line (final assembly or part) → Component

A quote holds one or more **lines**. A line is either:

- a **final assembly**, built from **components**. Each component carries its **cost** (cost, optional material overhead, quantity per assembly) — and **no margin**. The components' cost rolls up to one assembly cost, and the assembly's **one target gross margin** turns that cost into its price; or
- a standalone **part**, quoted on its own: its cost and optional overhead are entered on the line itself, it has no components, and its target GM prices it exactly the same way.

(Revised 2026-10-09 — see section 11. The first design gave every component its own target GM and had no Part line; a part quoted alone was an assembly with one component.)

The customer sees, per assembly: its part numbers, description and a quantity-break table. They never see components, component prices, cost, margin, discount or markup.

## 3. Roles

A new **Quote Roles** list (Title = email, plus `PersonName`, `Roles`, `Note`), modelled on Parts Roles. **No role = no access**: the Dashboard card and menu entry stay hidden. ARC admins are not auto-granted a role.

| | `viewer` | `quoter` | `manager` |
|---|---|---|---|
| See quotes, assemblies, items, sell and break prices | yes | yes | yes |
| Comment, attach, collaborate | yes | yes | yes |
| Edit any field | no | yes | yes |
| See and edit cost, margin, target GM, discount, overhead, price | **hidden** | yes | yes |
| Create a quote, assemblies, items, or a new rev | no | yes | yes |
| Generate the PDF | no | yes | yes |
| Set Won / Lost / Expired | no | no | yes |
| Create and edit customers | no | no | yes |
| Manage roles and reference lists | no | no | yes |

`costing` was considered and dropped.

**Hiding from viewers is UI-only.** The bundle is static and the cost/margin columns are still returned by Graph, so a viewer with dev tools can read them. There is deliberately **no separate restricted cost list** (decided). The real boundary is SharePoint list permissions. The Manual and CLAUDE.md must say this plainly.

Every gate is asked by the UI **and** inside each `mutationFn`, with the roles list awaited (`ensureQueryData`), never read from a render-time flag (the Parts Roles / CMMS pattern). Pure rules live in one file, `lib/quoteRoles.ts`.

## 4. Lists (all on the PMO site, off the navigation, reachable via Site contents)

Five lists. Hiding them from navigation is cosmetic; permissions are set per list in SharePoint. Create with `scripts/create-quote-lists.ps1` (readable internal names, idempotent, `-WhatIf`), in the style of `create-altronic-parts-lists.ps1`. Never name a column `DisplayName` (Graph drops it).

### 4.1 Quotes (header)

| Column | Notes |
|---|---|
| `Title` | The quote number, e.g. `IQ-COO-0042-R1`. Indexed, **Enforce Unique Values**. |
| `QuoteBase` | `IQ-COO-0042` — shared by every rev. |
| `Rev` | Number. A rev is a **new record**. |
| `CustomerRef` | **Single** lookup to Quote Customers (bare integer on write; select both halves). |
| `Status` | Draft, Sent, Won, Lost, Expired. |
| `ValidityDays` | Default 30; expiry is derived. |
| `ContactName`, `ContactEmail` | Customer contact (AQT's company/name/email). |
| `Budgetary` | Boolean (blank = No). |
| `BudgetaryText` | Multi-line. Seeded from the default wording (below) when `Budgetary` is ticked and the field is empty; editable per quote; never overwritten once edited. |
| `QuoteNotes` | Multi-line. General notes, **printed at the bottom** of the quote. |
| `Communication`, `Watchers` | Internal thread. This is where assembly-level discussion happens. Append Changes must be off (verify behaviourally). |

Default budgetary wording (from AQT): *"Budgetary Quotation — Non-Binding. This quotation is presented as a budgetary estimate only. Pricing is based on current component costing and product design as they stand at the time of issue. The product described herein is still under development. Final pricing, specifications, and availability are subject to change without notice. This document does not constitute a firm offer or binding commitment of any kind."*

### 4.2 Quote Assemblies (quote lines)

One row per quote LINE the customer would buy — a final assembly or a standalone part. (The list keeps its original name.)

| Column | Notes |
|---|---|
| `Title` | The line's Altronic part number. |
| `QuoteRef` | **Single** lookup to Quotes. |
| `LineNo` | Order on the worksheet and the PDF. |
| `QuotedQty` | How many the customer is quoted for — a whole number ≥ 1, default 1, never blank (missing reads as 1). Prices the line's **Subtotal** at the break it falls in. |
| `LineType` | `Assembly` (costed from its components) or `Part` (costed on the line). Missing reads as `Assembly`. |
| `Cost`, `MaterialOverheadPct` | **Part lines only** — the part's unit cost and optional overhead. Ignored (and cleared) on an assembly. |
| `SapPartNumber`, `AltronicPartNumber`, `CustomerPartNumber`, `Description` | Printed. The SAP part # is `####-####-##` (10 digits), formatted as typed; blank is allowed. |
| `PriceBreaks` | JSON, up to three `{ qty, discountPct, note }`. Breaks are on the **line**. |
| `TargetGM` | **The one target gross margin for the line**, percent, 0 < GM < 100. Required unless a manual price is set. |
| `ManualPrice` | Optional override. A visible "manual price" marker so it is never mistaken for the computed price. |
| `CustomerPrice` | Stored result so SharePoint views and exports can show it. `quotePricing.ts` is the single source of truth and recomputes it on every write. |

**Deferred (decided 2026-10-09): the AQT "user price" layer** — the channel discount, the round-up to a whole dollar and the per-quote choice of which price the customer sees. None of it is in the first release: no `DiscountPct`, `UserPrice` or `PriceBasis` columns. The customer price is the straight computed price (or the manual override). It can be added later without disturbing anything here, because the discount and rounding apply once, on the assembly.

No notes field and no comment thread on assemblies (decided).

### 4.3 Quote Items (components)

| Column | Notes |
|---|---|
| `Title` | The component's Altronic part number. |
| `AssemblyRef` | **Single** lookup to Quote Assemblies. |
| `QuoteRef` | **Single** lookup to Quotes (so a list can be read per quote). |
| `LineNo` | Order within the assembly. |
| `Quantity` | Units of this component in **one** assembly. |
| `SapPartNumber`, `AltronicPartNumber`, `Description` | **No `CustomerPartNumber`** on a component (Ray, 2026-10-09) — the customer's part number belongs to the LINE they buy. |
| `Cost` | Single total (not split into labour/material/other). |
| `MaterialOverheadPct` | Optional; blank = 0. |
| `Communication`, `Watchers` | Per-component thread, internal, never mirrored. |
| Attachments | On (kind `quoteItem` in `api/attachments.ts`). |

**No margin column on items** (2026-10-09): a component carries cost only; the target GM is the assembly's. No notes column on items. No customer lookup on the item: the customer is derived through the quote, so the same part quoted to two customers is two rows on two quotes and can never disagree with the quote's customer.

### 4.4 Quote Customers

| Column | Notes |
|---|---|
| `Title` | Customer name. |
| `CustomerCode` | Generated, 2–5 characters, indexed, **Enforce Unique Values**. Frozen at creation. |
| `CustomerNumber` | The SAP sold-to, stored as **text** (keeps leading zeros), matched with the Open Orders `sameAccount` padding rule. |
| `Active` | Retire instead of delete, since quotes point here. |
| `Note` | |

Only a `manager` creates or edits customers. A quoter picks from existing ones; the picker says who can add one rather than dead-ending.

**Code generation:** propose the first three letters of the first significant word (ignore punctuation, "The", "Inc"). On a clash, show it and offer the next candidates (`COP`, `COO2`), and let the manager choose or type one — never silently append a digit, since a clash often means a duplicate customer. Also check the **name**, case- and punctuation-insensitive. SharePoint's unique index is the real guard; the in-app check gives the friendly message first, and a refused save re-proposes.

Renaming a customer never changes its code or any existing quote number.

### 4.5 Quote Roles

See section 3.

## 5. Numbering

`IQ-<CUSTOMERCODE>-<global sequence, 4 digits>-R<rev>`, e.g. `IQ-COO-0042-R1`.

- The sequence is **global** (one counter, not per customer or date), so two customers can never produce the same number.
- **Next number = highest base + 1, never count + 1** (the Operations task numbering lesson: a count slips when something is deleted).
- `Title` has Enforce Unique Values. If two people create at once, the second save is refused; ARC refetches, recomputes and retries **once**, surfacing any other error unchanged.
- A rev keeps its base, so `R1` and `R2` sort together. Base and rev are separate columns; `Title` is the display string.
- The PDF prints the rev.
- Pure and tested in `lib/quoteNumber.ts`.

## 6. Pricing — `lib/quotePricing.ts` (pure, no `Date.now()`)

Ported from AQT, with the changes below. GM is `(sell − cost) / sell`; markup is `(sell − cost) / cost`.

1. **Loaded cost** of a component: `cost × (1 + overhead%)` (overhead blank = 0). Overhead is a real cost, so GM is computed on loaded cost. **Extended cost** = `quantity × loadedCost`. A component has **no** sell price and **no** GM.
2. **Line cost** (`unitCost`): an assembly's is `Σ component extendedCost`; a Part line's is its own `cost × (1 + overhead%)`. Unknown (null) if any component is incomplete (no or non-positive cost, negative overhead, quantity ≤ 0), or there are no components, or a Part has no cost.
3. **Computed price** = `roundCents(unitCost ÷ (1 − targetGM))` — the margin applied **once**, to the line's total cost, and rounded **once**, there. Null when the cost is unknown or the target GM is missing or outside `0 < GM < 100` (each named as a problem: "No target GM set for this assembly.").
4. **Manual override** replaces the computed price (and may be used with no target GM); GM and markup are recomputed from the price actually quoted.
5. **GM, markup, profit** of a line: `(price − unitCost) ÷ price`, `(price − unitCost) ÷ unitCost`, `price − unitCost`.
6. **No user-price layer in the first release** (section 4.2). Any future discount or round-up applies once, on the line.
7. **Quantity breaks** (up to three) apply to the line price: each tier's price is `roundCents(price × (1 − breakDisc))` with cost held fixed, so GM falls at higher volume. The base tier is `1 – (firstBreak − 1)`.
8. **The quote's GM is weighted, never averaged:** `(Σ line price − Σ line cost) ÷ Σ line price`.

Tests: the GM applied to an assembly's total (components $38.40 + $18.795 at a 40% assembly GM → `roundCents(57.195 ÷ 0.6)` = **$95.33**), overhead before the margin, rounding once on the line, the manual override with and without a GM, the missing-GM problem, a component with no cost blocking the price, a Part line (with overhead, with a manual price, ignoring stray components), tier GM falling, and the quote GM weighted across lines.

Display: every derived money value shows exactly 2 decimals; a typed unit cost may show up to 4 when sub-cent precision was entered (`lib/quoteMoney.ts`).

## 7. Worksheet and PDF

**Worksheet (internal):** a "Line items" section. Each final assembly shows its components with **cost only** — quantity, unit cost, overhead %, loaded cost, extended cost — then the line's roll-up: total cost, target GM, price (marked when manual), achieved GM and markup. A Part line shows its own cost, overhead and loaded cost and has no components. "Add line" offers Final assembly or Part. Each component's thread opens inline beneath it (the `BuildRequestItemCard` pattern). Cost columns are visible only to `quoter` and `manager`.

**Customer PDF:**
- Real, selectable text drawn with jsPDF (and the AutoTable plugin), **not** AQT's html2canvas screenshot. Built-in Helvetica; the Altronic mark as the transparent PNG used by the Open Orders workbooks. Lazy-loaded.
- Prints: the quote number **with its rev**, date and expiry, customer, per assembly its part numbers, description and quantity-break table (range and unit price only), the budgetary text if ticked, and `QuoteNotes` at the bottom.
- **Never prints:** cost, margin, markup, profit, target GM, discount, component lines, component prices, comments, attachments.
- **Structural guarantee:** the PDF is built from a separate customer-facing `QuotePdfModel` that has no cost, margin or component fields. One mapper function builds it from the record, and the printer accepts only the model. A future edit cannot print cost because the field does not exist where the printer can reach it.
- **Leak test:** generate a PDF from a quote with distinctive cost and margin values, extract its text, and fail if any of those values, or the words "cost", "margin" or "markup", appear. This works only because the text is real.
- `BudgetaryText` and `QuoteNotes` are free text typed on purpose, so the test cannot judge them. The form says beside each that the text prints on the customer's quote.
- Quantity breaks print without AQT's "−x% off base" badge (redundant with the base price, and invites negotiating the percentage). Reinstate on request.

## 8. Revisions

- Two actions on a quote: **New rev** (copies the quote forward as the next `R#`; the old rev is untouched) and **Update in place** (edits the current rev, no new number).
- A new rev copies **assemblies and components** forward as new rows, so each rev keeps exactly what was sent. Comments carry across with their original authors and timestamps, tagged "carried over from R1" (the EIR promotion rule); attachments are copied with `copyAttachments`. This is a best-effort sequence over three lists that names whatever failed.
- **The latest rev is derived, never stored** (highest `Rev` for a `QuoteBase`), so there is no "Superseded" status to keep in step. The quote list shows the current rev by default with the earlier ones expandable.

## 9. Mock/real boundary and conventions

- `api/quotes.ts`, `api/quoteAssemblies.ts`, `api/quoteItems.ts`, `api/quoteCustomers.ts`, `api/quoteRoles.ts`, each with `USE_MOCK` branches side by side; React Query hooks per list; sample data in `data/quoteMockData.ts`.
- All five lists need `SITES.pmo` list ids in `config.ts` and each `VITE_*` var in `.github/workflows/deploy.yml`'s named list. No default for the Quote Roles id (unset = no access, so a default is not a lockout risk, but the list must exist before anyone is admitted).
- Single lookups (`QuoteRef`, `AssemblyRef`, `CustomerRef`) are written as **bare integers** and need both halves in the `$select`. Mock mode cannot see this, so each needs a `USE_MOCK: false` request-shape test.
- A real-mode test per write, forced `USE_MOCK: false`.
- Every table (quote list, customer list, roles admin) ships with sorting and column filters (`useSortableTable` / `SortableHeader`).
- No delete on quotes (a quote records what was offered; a withdrawn one is Lost or Expired). Assemblies and items can be deleted — see section 13, which wins wherever it differs from the sections above. Customers are retired, not deleted. A test asserts each module exports nothing matching /delete|remove/ where that applies.
- Dates through `DateField`. Comments follow the house rules (mentions, auto-watch, `commentNotifyRecipients`, `autoWatchFromMentions` against the PMO resolver). Pasted attachments via `useCommentFileUpload`.
- Lazy route bundle with a `Suspense` boundary; add the app to `appAccess.ts` and the roles-gated menu/dashboard entry.
- Update the About diagrams, the Manual, the CLAUDE.md file overview, and the changelog + `public/version.json` (a minor bump).

## 10. Phase 2 (after the first release)

Raise an Engineering or Operations task from a quote. Reuse the Build Request pattern: store the link once (on the child), derive the reverse on the quote; nothing stored twice.

## 11. Open decisions

Decided 2026-10-09:

- **In-place edits of a Sent quote** show a confirmation: "This rev was sent to the customer. Update R1 anyway, or create R2?" Both buttons are available; it only makes the choice deliberate.
- **Saving the PDF is explicit.** Generating downloads or prints locally and saves nothing. A **Save to folder** button writes to the dedicated folder, with a prompt when the status becomes Sent. A saved file is never silently overwritten (a clash renames, as the datasheets and Open Orders raw extracts do).
- **The user-price layer is deferred** (section 4.2).
- **Gross margin is set ONCE, on the final assembly — not per component** (Ray, 2026-10-09: "If it's an assembly, I don't want to adjust the individual gross margins on the individual components. I only want to adjust the gross margin on the final assembly."). Components carry cost, material overhead and quantity only; `TargetGM` moved from Quote Items to Quote Assemblies. Why: the price of what the customer buys is a single commercial decision, and per-component margins meant landing one price by adjusting a dozen numbers, while trivial parts could quietly move the assembly's margin.
- **A quote line can be a standalone PART**, not only a final assembly (Ray, 2026-10-09: "a part … which I can load cost in, pick the gross margin I want, add the overhead if I want … a new line item. But it's not a full assembly"). `LineType` on Quote Assemblies; a Part carries its own `Cost` / `MaterialOverheadPct` and has no components. Assembly → Part is refused while the line has components; Part → Assembly clears the line's own cost.
- **Every line has a quoted quantity** (Ray, 2026-10-09: "defaults to ONE piece and is never blank"). `QuotedQty` on Quote Assemblies; the line's **Subtotal** = the tier unit price for that quantity × qty (rounded to the cent); the quote's **Total** = Σ Subtotals. The PDF prints "Quantity | Unit price | Subtotal" per line, "Volume pricing" only when the line has breaks, and a right-aligned "Total".
- **A component has no customer part number** (Ray, 2026-10-09): `CustomerPartNumber` is on lines only. The script stops creating it on Quote Items and reports an existing one as unused (never deleted).
- **SAP part numbers are `####-####-##`** (10 digits, 4-4-2, e.g. 1003-0114-40) on lines and components (Ray, 2026-10-09). Formatted as typed and validated in the forms (`lib/sapPartNumber.ts`); blank allowed; stored dashed; read as stored. The customer's SAP sold-to stays free text.
- **The PDF folder** is `General/IC Quotes` in the default Documents library of `SITES.pmo` (Altronic_PMO), as given by Ray on 2026-10-09 (name confirmed by Ray: "IC Quotes"). He also supplied a sharing link; a share token can be regenerated, so the link is **not** used. Before building on the path, still verify it read-only against live Graph with a script in the style of `scripts/verify-open-orders-folder.ps1`.

Still open:

1. **Roles detail:** `manager` sets outcome statuses only. Does a manager also need to approve a quote before it is Sent? Starting without it.
2. **Component sub-assemblies** are out of scope; the roll-up is flat. Nesting would need cycle checks and recursive totals.

## 12. Proposed build order (all local until told otherwise)

1. Pure layer: `quotePricing.ts`, `quoteNumber.ts`, `quoteRoles.ts`, the PDF model mapper — with tests.
2. Mock-mode API modules, hooks and sample data for the five lists.
3. Worksheet screen, then the PDF, then roles admin and customers.
4. The SharePoint create script, then the real-mode API branches with request-shape tests.
5. Manual, About diagrams, CLAUDE.md, changelog and `version.json`.

## 13. Implementation contract (build reference)

Decisions made when the build started (2026-10-09), on top of the sections above:

- **Phase 2 columns are created now** on Quotes, but wired only as read/display in the first release: `EngineeringTaskLink` (Hyperlink — the Project Task List is on another site collection, so a lookup is impossible), `OperationsTaskLink` (Hyperlink, for symmetry), and `EngineeringProjectRef` (text holding an Engineering Projects TITLE — the SCN Project Reference pattern, since that list is on Altronic_Engineering). Hyperlink columns are **never written in a create POST**, only in their own follow-up PATCH (see CLAUDE.md, "Hyperlink columns").
- **Title replaces the separate Altronic part number column** on Assemblies and Items (no duplicate `AltronicPartNumber` column).
- **Attachments are on for Quotes (the customer's data package) and Quote Items.** Not on Assemblies.
- **Assemblies and items CAN be deleted** (by quoter / manager) — they are the composition of a draft, and a rev preserves what was sent. **Quotes cannot be deleted**; customers are retired (`Active`), never deleted. Roles rows can be deleted.
- **The roles list is managed by a quote `manager` OR an ARC admin.** Admins are not granted quote access, but they can manage the list, so it can never be locked from the inside.
- Department: **Customer Service / Sales**. Routes under `/sales/quotes`.

### 13.1 SharePoint columns (internal names are the contract between the script and the code)

**Quotes** — attachments ON. `Title` indexed + Enforce Unique Values.

| Internal name | Type |
|---|---|
| `Title` | text (quote number, `IQ-COO-0042-R1`) |
| `QuoteBase` | text, indexed |
| `Rev` | number (0 decimals) |
| `CustomerRef` | lookup → Quote Customers (`Title`), single |
| `Status` | choice: Draft, Sent, Won, Lost, Expired (default Draft, no fill-in) |
| `ValidityDays` | number (0 decimals), default 30 |
| `ContactName` | text |
| `ContactEmail` | text |
| `Budgetary` | boolean, default No |
| `BudgetaryText` | note, plain text |
| `QuoteNotes` | note, plain text |
| `Communication` | note, plain text, **append changes OFF** |
| `Watchers` | person, multi |
| `EngineeringTaskLink` | hyperlink |
| `OperationsTaskLink` | hyperlink |
| `EngineeringProjectRef` | text |

**Quote Assemblies** (quote lines) — attachments OFF.

| Internal name | Type |
|---|---|
| `Title` | text (the line's Altronic part number) |
| `QuoteRef` | lookup → Quotes (`Title`), single, indexed |
| `LineNo` | number (0 decimals) |
| `QuotedQty` | number (0 decimals), default 1 |
| `LineType` | choice: Assembly, Part (default Assembly, no fill-in) |
| `Cost` | currency (Part lines only) |
| `MaterialOverheadPct` | number (Part lines only) |
| `SapPartNumber` | text (`####-####-##`) |
| `CustomerPartNumber` | text |
| `Description` | note, plain text |
| `PriceBreaks` | note, plain text (JSON `QuotePriceBreak[]`) |
| `TargetGM` | number — the one target GM for the line |
| `ManualPrice` | currency |
| `CustomerPrice` | currency |

**Quote Items** — attachments ON.

| Internal name | Type |
|---|---|
| `Title` | text (component Altronic part number) |
| `QuoteRef` | lookup → Quotes (`Title`), single, indexed |
| `AssemblyRef` | lookup → Quote Assemblies (`Title`), single, indexed |
| `LineNo` | number (0 decimals) |
| `SapPartNumber` | text |
| `Description` | note, plain text |
| `Quantity` | number |
| `Cost` | currency |
| `MaterialOverheadPct` | number |
| `Communication` | note, plain text, **append changes OFF** |
| `Watchers` | person, multi |

**Quote Customers** — attachments OFF.

| Internal name | Type |
|---|---|
| `Title` | text (customer name) |
| `CustomerCode` | text, indexed + Enforce Unique Values |
| `CustomerNumber` | text (SAP sold-to) |
| `Active` | boolean, default Yes |
| `Note` | note, plain text |

**Quote Roles** — attachments OFF.

| Internal name | Type |
|---|---|
| `Title` | text (email) |
| `PersonName` | text (**never** `DisplayName`) |
| `Roles` | text (lowercase CSV of viewer / quoter / manager) |
| `Note` | note, plain text |

### 13.2 Files

| Area | Files |
|---|---|
| Types (done) | `src/types/quote.ts` |
| Config (done) | `SP_QUOTES_LIST_ID`, `SP_QUOTE_ASSEMBLIES_LIST_ID`, `SP_QUOTE_ITEMS_LIST_ID`, `SP_QUOTE_CUSTOMERS_LIST_ID`, `SP_QUOTE_ROLES_LIST_ID`, `QUOTES_CONFIGURED` in `src/api/config.ts`; all five in `deploy.yml` and `vite-env.d.ts` |
| Script | `scripts/create-quote-lists.ps1` |
| Pure rules | `src/lib/quotePricing.ts`, `src/lib/quoteNumber.ts`, `src/lib/quoteRoles.ts`, `src/lib/quoteCustomerCode.ts`, `src/lib/quotePdfModel.ts` |
| Mappers | `src/lib/quoteMapper.ts` (all five lists, Graph item ⇄ domain, field builders) |
| API | `src/api/quotes.ts`, `quoteAssemblies.ts`, `quoteItems.ts`, `quoteCustomers.ts`, `quoteRoles.ts`, `quoteRevisions.ts`, `quotePdfFiles.ts` |
| Mock data | `src/data/quoteMockData.ts` |
| PDF renderer | `src/lib/quotePdf.ts` (jsPDF + jspdf-autotable, dynamically imported) |
| Hooks | `src/hooks/useQuotes.ts`, `useQuoteAssemblies.ts`, `useQuoteItems.ts`, `useQuoteCustomers.ts`, `useQuoteRoles.ts`, `useQuotePdf.ts` |
| Views | `src/views/QuotesView.tsx`, `QuoteDetailView.tsx`, `QuoteCustomersView.tsx`, `QuoteRolesView.tsx` + form modals in `src/components/` |
