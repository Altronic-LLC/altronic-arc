# scripts/

One-off and occasional tools that sit beside ARC: creating and changing
SharePoint lists, loading legacy data, discovering schemas, and generating
local artefacts. None of them run in CI or in the app.

**SharePoint is ARC's database, so a script that writes to it is a change to
production data.** Every writing script below is dry-run by default or takes
`-WhatIf`; run it that way first and read the output. The PowerShell scripts
sign in interactively with PnP.PowerShell or Microsoft Graph PowerShell — no
credentials live in this folder.

Two rules that apply to everything here:

- **Real SharePoint content never gets committed.** Schema snapshots
  (`*-schema.json`), before/after records (`reassign-*.csv`) and equipment
  audits (`equipment-*.csv`) are gitignored. A new script that writes real
  rows to disk adds its output pattern to `.gitignore` in the same PR. This
  repository is public.
- **A new script is listed here** in the same PR, with what it touches and
  how to dry-run it.

## Scripts that write to SharePoint

| Script | What it does | Dry run | Also writes locally |
|---|---|---|---|
| `Add-CMMSColumns.ps1` | Creates and fixes the columns for the CMMS Maintenance module | `-WhatIf` | |
| `Add-MeterScheduleColumns.ps1` | Adds the columns an hourmeter-basis PM schedule needs | `-WhatIf` | |
| `add-fait-columns.ps1` | Adds Communication and Watchers to the FAIT list | `-WhatIf` | |
| `add-mrb-watchers-column.ps1` | Adds Watchers to MRB Data | `-WhatIf` | |
| `add-pcb-checklist-columns.ps1` | Adds the two PCB checklist columns to the Engineering Project Task List | `-WhatIf` | |
| `add-qc-time-hold-columns.ps1` | Adds the On Hold columns to QC Time Tracking (ALTRONICPANELTEAM) | `-WhatIf` | |
| `add-supplier-contact-columns.ps1` | Adds Communication and Watchers to the Supplier Contact List | `-WhatIf` | |
| `add-task-last-notified-column.ps1` | Adds LastNotifiedComment to the Engineering Project Task List | `-WhatIf` | |
| `create-altronic-parts-lists.ps1` | Creates the Altronic Part List and Component List (Engineering) | `-WhatIf` | |
| `create-ecn-checklist-list.ps1` | Creates ECN Checklists (Engineering) | `-WhatIf` | |
| `create-feature-requests-list.ps1` | Creates ARC Feature Requests (Engineering) | `-WhatIf` | |
| `create-harness-production-lists.ps1` | Creates Harness Part Numbers and Harness Production Log (PMO) | `-WhatIf` | |
| `create-maintenance-reference-lists.ps1` | Creates Maintenance Departments and Maintenance Locations | `-WhatIf` | |
| `create-maintenance-roles-list.ps1` | Creates Maintenance Roles (PMO) | `-WhatIf` | |
| `create-open-orders-lists.ps1` | Creates the Open Orders customer list (ALTRONICSALESTEAM) | `-WhatIf` | |
| `create-pricing-lists.ps1` | Creates the six Sales Pricing lists, with unique permissions | `-WhatIf` | |
| `create-quick-links-list.ps1` | Creates Quick Links (Engineering) | `-WhatIf` | |
| `create-quote-lists.ps1` | Creates the five Insourcing Quotes lists (PMO) | `-WhatIf` | |
| `restore-fait-89-communication.ps1` | Restores one FAIT's Communication field by merging every comment from version history | `-WhatIf` | |
| `Scrub-EquipmentList.ps1` | Audits, and optionally cleans, the Altronic Equipment List | report only unless `-Apply` | `equipment-*.csv` (gitignored) |
| `load-altronic-parts-lists.ps1` | Loads the legacy parts lists into the Part and Component lists | report only unless `-Apply` | fix / change / skip CSVs |
| `load-harness-production-log.ps1` | Loads the cleaned Access export into the Harness lists | report only unless `-Apply` | load report |
| `reassign-site-user.ps1` | Re-points every person field from one site user to another | report only unless `-Apply` | `reassign-*.csv` (gitignored; the only rollback record — keep it) |
| `swap-resistor-rating-bc.ps1` | Swaps Rating B and C on resistors entered voltage-first; `-Undo` reverses | report only unless `-Apply` | report |

## Read-only scripts

| Script | What it does | Writes locally |
|---|---|---|
| `Verify-CmmsSchema.ps1` | Checks every column the CMMS module reads exists | |
| `check-site-permissions.ps1` | Checks the Graph `Sites.Selected` grants for every ARC site | |
| `diagnose-fait-communication.ps1` | Explains "not all FAIT comments appear" by inspecting the Communication field | |
| `recover-fait-communication.ps1` | Reads a FAIT's Communication history from version history, to plan a restore | |
| `person-identities.ps1` | Reports every distinct person identity in a list's person fields | |
| `verify-open-orders-folder.ps1` | Confirms the Open Orders folder tree ARC writes to exists | |
| `verify-quote-pdf-folder.ps1` | Confirms the customer-quote PDF folder exists | |
| `discover-list.ps1` | Dumps a list's id, columns and sample rows | `<slug>-schema.json` (gitignored) |
| `discover-teradyne-lists.ps1` | Same, for the four Teradyne lists | schema snapshots (gitignored) |
| `discover-cmms-changes.ps1` | Refreshes the three CMMS snapshots and answers the open schema questions | schema snapshots (gitignored) |

## Local generators (no SharePoint)

| Script | What it does |
|---|---|
| `generate-pwa-icons.mjs` | Builds the PWA and home-screen icons from the Altronic mark (uses `sharp`, a dev dependency) |
| `generate-sample-open-orders.mjs` | Builds sample Open Orders workbooks from the mock fixtures into `sample-open-orders/` (gitignored) |
| `generate-open-orders-from-file.mjs` | Builds the Open Orders workbooks from a real SAP extract, through the app's own code, into `sample-open-orders-real/` (gitignored) |
| `open-orders-sample-entry.ts` | Bundle entry for the two generators above; not run directly |
| `clean-harness-production-log.mjs` | Cleans the legacy Harness Production Access export into CSVs for `load-harness-production-log.ps1` (output gitignored) |
| `new-guest-notification-flow.ps1` | Generates an importable Power Automate package for guest notifications (output gitignored) |
| `screenshot-page.mjs` | Screenshots one element of the running dev server as the demo user — see README "Checks" |

## Other files

- `*-schema.json` — list schema snapshots from the discovery scripts. Gitignored; regenerate rather than commit.
- `data/through-hole-mfg-decisions.csv` — manufacturer decisions used when loading the Component List. Tracked; it holds internal part numbers, so review before adding anything like it (see review finding SEC-03).
