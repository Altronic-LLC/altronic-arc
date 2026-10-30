# Importing Panel Engineering's Wrike tasks into ARC

BusinessIT#42. Panel Engineering plans its work in Wrike today (the "Altronic
Panels" space and its **Panel Engineering Capacity** workload chart). ARC's
Panel Tasks and the Capacity view replace it. The decision (Tim, 2026-10-28):
**start fresh in ARC, but pull from Wrike while testing, and pull again right
before go-live** so nothing is keyed in twice.

The tool is `scripts/import-wrike-panel-tasks.ps1`. **It has not been run live
yet.** The Wrike field names below come from the v4 API docs and the Graph side
can't be signed in from Claude's shell, so the first run is Tim's, in his own
terminal. Anything marked *unverified* needs checking on that run.

## Prerequisites

1. `scripts/add-panel-task-capacity-columns.ps1` has been run. It adds
   `StartDate`, `DueDate` and `EstimatedHours` (which the app reads) and
   `LegacySource` (indexed) and `ImportHash` (which only the import uses).
   ARC's app never reads or writes those last two.
2. A **Wrike permanent token** from a user who can see the whole Altronic
   Panels space: Wrike → Apps & Integrations → API → Create token. It
   inherits that user's permissions and never expires, so treat it like a
   password. It goes in `$env:WRIKE_TOKEN` for the session only. It is never
   a script parameter, never written to disk, and never anywhere near the ARC
   bundle or repo:

   ```powershell
   $env:WRIKE_TOKEN = [Net.NetworkCredential]::new('', (Read-Host -AsSecureString 'Wrike token')).Password
   ```

   Revoke it in Wrike once go-live is done.
3. A working folder **outside the repo**, such as `C:\WrikeImport\`. The export
   is company data and this repo is public; the script refuses an `-OutDir`
   inside it.
4. Everybody being imported has visited the ALTRONICPANELTEAM site once (or
   been picked in a Panel list in ARC). A person column needs the person's id
   on that site, and Graph can't create one. Anyone missing is listed, never
   guessed at.

## The three steps

Nothing is written to SharePoint until step 3, and step 3 does only what step
2 wrote down.

```powershell
.\import-wrike-panel-tasks.ps1 -Export -OutDir C:\WrikeImport\2026-11-03
.\import-wrike-panel-tasks.ps1 -Plan   -OutDir C:\WrikeImport\2026-11-03 -MapFile C:\WrikeImport\map.json
.\import-wrike-panel-tasks.ps1 -Apply  -OutDir C:\WrikeImport\2026-11-03
```

### 1. Export (reads Wrike only)

Base URL `https://www.wrike.com/api/v4` (`-WrikeHost` for an EU account),
header `Authorization: bearer <token>`. Raw JSON pages are saved verbatim:

| Call | Saved as |
|---|---|
| `GET /spaces`, then the one titled "Altronic Panels" | `spaces-*.json` |
| `GET /spaces/{id}/folders`: the folder and project tree (00. Execution, 01. New Requests, 02. Backlog, 99. Archived, and the projects in them) | `folders-*.json` |
| `GET /spaces/{id}/tasks?descendants=true&subTasks=true&pageSize=1000&fields=[responsibleIds, effortAllocation, description, parentIds, superParentIds]`, paged by `nextPageToken` | `tasks-*.json` |
| `GET /contacts`: Wrike user id → name and email | `contacts-*.json` |
| `GET /workflows`: custom statuses (id, name, group) | `workflows-*.json` |
| `GET /tasks/{id}/comments`, one call per task | `comments/<taskId>.json` |
| run summary | `manifest.json` |

On a 429 or 5xx it backs off and retries. *Unverified:* whether
`/spaces/{id}/tasks` honours `descendants` exactly like the folder endpoint,
and the rate at which per-task comment calls get throttled.

### 2. Plan (reads Wrike export + SharePoint, writes files only)

Run it once with no `-MapFile` and it writes `map-template.json`: every Wrike
status, pre-filled from its status group (Active → In Process, Deferred → On
Hold, Completed and Cancelled → Complete), plus every Wrike project title.
Check it, save it as your map file (outside the repo), and re-run.

| Map key | Meaning |
|---|---|
| `statusMap` | Wrike status **name** → `Pending` / `In Process` / `On Hold` / `Complete`. Any status left out stops the plan, naming it. |
| `projectMap` | Wrike project title → Panel Project Reference title. Blank means match on the same title. |
| `peopleMap` | Wrike email → panel-site email, for people whose two addresses differ. |
| `excludeFolders` | Folder or project titles whose tasks are skipped (template: `99. Archived`). |
| `skipStatusGroups` | Wrike status groups never imported (template: `Cancelled`). |

The plan reads Panel Tasks (by `LegacySource`), Panel Project Reference and
the panel site's User Information List live, then writes:

| File | Holds |
|---|---|
| `plan.json` | Every planned write, exactly as step 3 will perform it |
| `report.md` | The counts. Read this first. |
| `create.csv` | Wrike tasks with no ARC row yet |
| `update.csv` | Wrike changed and the ARC row is untouched since the last import: the fields that will change |
| `conflicts.csv` | **Edited in ARC since the last import.** Never overwritten. |
| `comments.csv` | Comments to append |
| `unmatched-people.csv` | Responsibles the panel site can't resolve. Left off. |
| `new-projects.csv` | A Panel Project Reference to **create** for each Wrike project that matches none |
| `arc-projects.csv` | Every Panel Project Reference that exists now, to point `projectMap` at |
| `unmatched-projects.csv` | Wrike projects left with no Panel Project Reference (set to Create = No). Project left blank. |
| `flexible-effort.csv` | Tasks whose Flexible effort was flattened to a total |

#### New Panel Project References

On 2026-10-28 the live list held four references and Wrike had 41 projects,
none matching, so the import CREATES them (Tim). `new-projects.csv` proposes
one per unmatched Wrike project:

- **Title** `<TYPE>-<Wrike title>`, the shape of the existing
  `PRD-1234-ABC12-V1-001` (a leading `DWG# ` is dropped).
- **ProjectType** guessed: a title starting with a drawing number is
  `PRD-Production Order`; otherwise support/commissioning → FS, scripting or
  programming → PRG, standards/configuration → IS, anything else `MSC-Misc`.
  **A guess — check every row.**
- **DwgNo** the leading drawing number (`1234-ABC12-V1-002`, `1000-111`); an
  SAP number later in the title isn't one. **Description** is the rest.

To change any of it, copy `new-projects.csv` (outside the repo), edit it in
Excel (Create = No leaves a project off, and its tasks import with no
project), and re-plan with `-ProjectsFile <that copy>`. Two rows with the
same Title stop the plan. Apply creates the references FIRST, add-only: a
Title that exists by then is reused, never renamed. If one is refused, its
tasks are refused too, so re-plan after fixing it.

### 3. Apply (writes SharePoint)

Performs `plan.json`: creates (with `LegacySource = "wrike:<taskId>"` and
`ImportHash`), updates only the planned fields, and appends comments. It
**refuses** a row whose live values changed since the plan (re-plan), and a
create whose `LegacySource` row has appeared since. It never deletes. Every
write is read back, and a field SharePoint stored differently from what was
sent is reported in `applied-<time>.csv`. Then run `-Plan` again: it should
plan zero writes.

## Blueprints, the request form and automation (deciding what ARC needs)

```powershell
.\import-wrike-panel-tasks.ps1 -Blueprints -OutDir C:\WrikeImport\blueprints
```

Read-only. Pulls every folder (project) blueprint, task blueprint and custom
field, and writes `blueprints.md`: each blueprint's task tree with durations
(Wrike minutes ÷ 480 = days), effort and assignees. Not yet run live — the
blueprint endpoints come from the v4 docs and Wrike's community, and a
missing field is left blank.

**Request forms and automation rules have no public API**, so they are
compared from screenshots. The one form seen (2026-10-28):

| Form | Questions | On submit |
|---|---|---|
| New Production Order | What is the Job #? · Who is the customer? · What is the SAP#? | Create project from **Panel Blueprint - Production Job**, status New, in 01. New Requests, prefixed with the Job #; no assignee, no approval, dates not rescheduled; visible to everyone in the account |

**The space's own "Panel Workflow"** is what 251 of 252 tasks use, and the
account `/workflows` endpoint doesn't return it — `-Export` and `-Blueprints`
also read `/spaces/{id}/workflows` (works, checked 2026-10-28). Its 11
statuses became Panel Tasks' own statuses in ARC (Tim's decision), so the
status map is one-to-one; the Default Workflow's names and the bare group
names map by group (Active → New, Deferred → On Hold - Internal, Cancelled →
Canceled). Run `scripts/set-panel-task-statuses.ps1` before `-Apply`, or the
column refuses the new names.

**The blueprint** (read 2026-10-28): "Panel Blueprint - Production Job" holds
four task blueprints — Drawing Creation, BOM Creation, SOO Creation,
Programming. The blueprint tree returns no hours, so the typical figures come
from the ~30 real tasks of each kind in the export: Drawing 24h (median, 3–56,
~3 days), BOM 2h (1 day), SOO 6h (1 day), Programming 16h (3–56, ~3 days).

**The space's own custom fields**: Work Type (Production Order /
Non-Production / Improvement / Internal), Priority (High / Medium / Low), SAP#
(text), Project/Job (text). The first export didn't request `customFields`,
so their values weren't seen; `-Export` now asks for them, and `-Plan` maps
Work Type, Priority and SAP# (Project/Job not yet). The account also carries ~40 Wrike template fields
(risk, budget, RACI…) that the panel space doesn't use.

## What maps to what

| Wrike | ARC Panel Tasks | Notes |
|---|---|---|
| `title` | `Title` | cut at 255 characters, noted |
| `customStatusId` → status name | `Status` | through `statusMap` |
| nearest project above the task (`parentIds` → folder tree) | `ProjectReferenceLookupId` | single lookup, bare integer; `projectMap` or same title, else blank and listed |
| every **resolved** `responsibleIds` entry | `AssignedLookupId` | multi-person, the two-key `Collection(Edm.Int32)` shape (Assigned allows several since 2026-10-29; `setup-panel-planning.ps1` switches it). The Capacity view splits the hours between them, as Wrike does. |
| every resolved responsible | `Watchers` | two-key `Collection(Edm.Int32)` shape. An assignee also watches (ARC's rule). |
| `dates.start` / `dates.due` | `StartDate` / `DueDate` | date part only, written at 12:00 UTC (ARC's date-only rule). Backlog-type dates are left blank. |
| `effortAllocation.totalEffort` (minutes) | `EstimatedHours` | ÷ 60, two decimals. Blank when mode is `None` or absent. |
| the "Work Type" and "Priority" custom fields (found by title) | `WorkType`, `Priority` | strict choices; a value ARC doesn't know is left blank and noted |
| the "SAP#" custom field (found by title) | `SAPNumber` | text, trimmed; the panel team says it is NOT the Sales Order |
| `description` (HTML) | `Description` | converted to plain text (lists become `- ` lines), plus "Imported from Wrike: `<permalink>`" |
| comments | `Communication` | one record each, original author and time (US Eastern, like every ARC record), oldest first, tagged "— imported from Wrike" |
| — | `TaskType` | not written: Wrike has no equivalent |

**Effort.** ARC models Wrike's **Basic** effort only: one total spread evenly
over the task's working days. A Daily or Flexible task's per-person, per-day
split is flattened to its total and listed in `flexible-effort.csv`. A
person-day that Wrike had at 8.05 h may land differently in ARC. *Unverified:*
the `effortAllocation.mode` strings and that `totalEffort` is in minutes on
every mode.

**People.** A responsible the panel site can't resolve is left off and listed,
never written as an empty person column. Fix it (they open the site, or add a
`peopleMap` line) and re-plan; the next apply adds them, because the change
counts as a Wrike-side difference against an ARC row nobody has touched.

## Why a re-run is safe: the two hashes

`ImportHash` holds `src=<sha256>;arc=<sha256>` over Title, Status, project,
assignee, watchers, description, dates and hours:

- **src**: the values mapped from Wrike at the last import.
- **arc**: the same fields as SharePoint **stored** them, read back after the
  write. Taken from the read-back, not from what was sent, so a value
  SharePoint stores slightly differently (a rich-text Description, say) can't
  read as an ARC edit on every later run.

On re-plan, per task:

| Live ARC row vs `arc` | Wrike now vs `src` | Plan |
|---|---|---|
| no row | — | create |
| different | — | **conflict**: listed, never touched |
| same | same | nothing |
| same | different | update the fields that differ |
| `ImportHash` missing or unreadable | — | conflict |

`Communication` is not hashed. Comments are append-only and deduped by the
backfill's `commentKey` rule: same author, same words, ignoring time and the
import tag. So a comment typed in ARC never blocks an update, and a comment
is never imported twice. Comments are appended on conflict rows too, because
appending can't overwrite anybody's edit.

## Testing → go-live

**During testing**, run Export → Plan → Apply as often as is useful. Wrike
stays the system of record. Edits made in ARC to imported tasks should be few:
anything edited in ARC becomes a conflict and stops following Wrike. If a
tester needs to change one, change it in Wrike instead.

**At go-live:**

1. Tell Panel Engineering: no more Wrike edits from now on.
2. Final `-Export` into a fresh folder, then `-Plan`.
3. Review `report.md`, `conflicts.csv` and the two unmatched lists with Mark.
   For each conflict, decide whether ARC's version stands (do nothing) or
   Wrike's (fix it by hand in ARC).
4. `-Apply`, then `-Plan` once more, which should show zero writes.
5. Make the Wrike space read-only (or archive it), and revoke the token.

## Not covered

- **Attachments** (`/tasks/{id}/attachments`): not imported. The Wrike
  permalink in each description leads back to them while Wrike is readable.
  Add them if Tim wants them; they would go through the same list-item
  attachment upload ARC uses, one at a time per item.
- **Time logs** (actual hours): not imported. ARC has no actuals column yet
  (one of Ray's open questions on #42).
- **Subtasks** are imported as ordinary tasks. Panel Tasks has no parent
  column.
- **Custom fields**: Work Type and Priority map to Panel Tasks' `WorkType` and
  `Priority`, found by the field's title in the exported `customfields-*.json`
  (`-Export` saves them); a value ARC doesn't know is left blank and noted.
  SAP# maps to `SAPNumber` as text. Project/Job is not mapped.
- **The chain and the order hold don't apply to imported tasks**: they have
  no `ChainStep` and no Panel Order, so nothing opens or holds them
  automatically. The chain starts with orders raised in ARC.

## Open questions for Tim

1. The status map. The template guesses from Wrike's status groups.
2. Folders: is `99. Archived` skipped? Are `02. Backlog` and `01. New Requests` in?
3. Wrike project titles vs Panel Project Reference titles: the same, or a `projectMap`?
4. Attachments and time logs: wanted?

## Sources

- [Workload Charts in Wrike](https://help.wrike.com/hc/en-us/articles/360010835433-Workload-Charts-in-Wrike)
- [Wrike API v4 — Tasks](https://developers.wrike.com/api/v4/tasks/)
- [Wrike API — OAuth 2.0 and permanent tokens](https://developers.wrike.com/oauth-20-authorization/)
