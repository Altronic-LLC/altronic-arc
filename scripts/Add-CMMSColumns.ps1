<#
.SYNOPSIS
    Creates and fixes the SharePoint columns for the ARC CMMS Maintenance module.

.DESCRIPTION
    Works against four lists on the Altronic_PMO site:
      - Altronic Equipment List      (378 rows) -> asset register fields
      - Altronic Maintenance Tasks   (0 rows)   -> work-order fields
      - Scheduled Maintenance        (0 rows)   -> PM schedule fields
      - Operations Task List         (live)     -> one promotion back-pointer

    Both maintenance lists are EMPTY today, which is why this is worth running
    now: creating, retyping or removing a column costs nothing while there are
    no rows, and costs a migration afterwards.

    Idempotent. A column that already exists is reported and skipped, so a
    re-run after a partial failure is safe. Adding a column leaves existing
    rows untouched - they simply have no value for it.

    THREE OPEN DECISIONS ARE PARAMETERS, NOT ASSUMPTIONS. See -FrequencyMode,
    -SkipManufacturerModel and -IncludeLastAlerted below. Defaults follow the
    recommendations in the plan note; change them if the team decides otherwise.

    RUN THIS IN YOUR OWN TERMINAL. The sign-in is interactive and a browser
    popup cannot be surfaced from a background shell. Pass -DeviceCode if the
    popup can't open.

    START WITH -WhatIf. It prints every create and every change without
    touching anything.

.PARAMETER FrequencyMode
    How a PM's recurrence is stored on Scheduled Maintenance.
      Interval (default) - adds FrequencyInterval (number) + FrequencyUnit
                           (Days/Weeks/Months/Years). Expresses "every 6 weeks".
      Choice             - configures the existing placeholder `Frequency`
                           choice column with a fixed cadence vocabulary.
    See section 3.3 of the plan note.

.PARAMETER RemovePlaceholderFrequency
    DESTRUCTIVE. Only meaningful with -FrequencyMode Interval. Deletes the
    unconfigured `Frequency` choice column instead of leaving it orphaned.
    Safe today because the list has 0 rows - confirm that before using it.

.PARAMETER SkipManufacturerModel
    Don't add Manufacturer / ModelNumber to the Equipment List. Those values
    currently live inside `Description` as prose; splitting them out means
    somebody backfills 378 rows.

.PARAMETER IncludeLastAlerted
    Adds LastAlertedDate to Scheduled Maintenance, for per-item Power Automate
    reminders. Leave it off if the flows send a digest instead (recommended) -
    a digest needs no de-duplication state.

.PARAMETER OnlyList
    Restrict the run to one list: Equipment, Maintenance, Scheduled, Operations.

.EXAMPLE
    .\Add-CMMSColumns.ps1 -WhatIf

.EXAMPLE
    .\Add-CMMSColumns.ps1 -OnlyList Scheduled -FrequencyMode Interval

.NOTES
    Requires Sites.Manage.All - a wider scope than the read-only discovery
    script, so it re-authenticates even if you are already connected.

    NOT DONE BY THIS SCRIPT, and both matter:
      1. Indexing. `NextDueDate`, `DueDate` and `Active` should be indexed
         columns so Power Automate can filter on them. Graph does not expose
         indexing reliably - set it in List settings > Indexed columns.
      2. Required flags and column ordering in the SharePoint form. ARC
         enforces its own required fields; SharePoint's are separate.

    Verify the internal names it reports at the end before coding against
    them. SharePoint decides the final internal name, not this script.
#>

[CmdletBinding()]
param(
    [switch]$WhatIf,
    [switch]$DeviceCode,
    [ValidateSet("Interval", "Choice")]
    [string]$FrequencyMode = "Interval",
    [switch]$RemovePlaceholderFrequency,
    [switch]$SkipManufacturerModel,
    [switch]$IncludeLastAlerted,
    [ValidateSet("Equipment", "Maintenance", "Scheduled", "Operations")]
    [string]$OnlyList
)

$ErrorActionPreference = "Stop"
Import-Module Microsoft.Graph.Authentication

# --- Identifiers -------------------------------------------------------------
# PMO site, mirrored from src/api/config.ts (SITES.pmo). List ids confirmed by
# discovery on 2026-08-27.
$siteId = "coopermachineryservices.sharepoint.com,915a6183-2b71-4dfd-a8b9-181126dfbe78,3eb6cb9c-6535-4c69-a8d7-e90b2f90a9eb"

$LIST_EQUIPMENT  = "6f2fb6e1-3b41-40de-b78b-2c43c3c3d068"
$LIST_MAINTTASKS = "ff9d837f-227f-4a9b-b534-5fc722ff8c3b"
$LIST_SCHEDULED  = "9179e16d-5cc8-41bd-b085-eccd39293f98"
$LIST_OPSTASKS   = "298ac5c5-6c53-4262-95e7-e1cfca06978b"

# --- Shared vocabularies -----------------------------------------------------
# Category is deliberately the SAME set on both maintenance lists, so a PM's
# category copies straight onto the work order it generates.
$WORK_CATEGORIES = @(
    "Corrective / Repair", "Preventive", "Inspection",
    "Calibration", "Cleaning", "Oil Change", "Safety", "Improvement"
)
$WORK_STATUSES = @(
    "Backlog", "Up Next", "Started", "Awaiting Parts", "On Hold", "Complete", "Canceled"
)
$PRIORITIES = @("Low", "Med", "High", "Emergency")

# --- Column factories --------------------------------------------------------
function New-TextCol($name, $display, $desc, [switch]$Multi) {
    @{ name = $name; displayName = $display; description = $desc
       text = @{ allowMultipleLines = [bool]$Multi
                 appendChangesToExistingText = $false
                 linesForEditing = $(if ($Multi) { 6 } else { 0 })
                 textType = "plain" } }
}
function New-ChoiceCol($name, $display, $desc, $choices, [switch]$AllowText) {
    @{ name = $name; displayName = $display; description = $desc
       choice = @{ allowTextEntry = [bool]$AllowText
                   choices = @($choices)
                   displayAs = "dropDownMenu" } }
}
function New-NumberCol($name, $display, $desc) {
    @{ name = $name; displayName = $display; description = $desc
       number = @{ decimalPlaces = "automatic"; displayAs = "number" } }
}
function New-DateCol($name, $display, $desc) {
    @{ name = $name; displayName = $display; description = $desc
       dateTime = @{ displayAs = "standard"; format = "dateOnly" } }
}
function New-BoolCol($name, $display, $desc) {
    @{ name = $name; displayName = $display; description = $desc; boolean = @{} }
}
function New-PersonCol($name, $display, $desc, [switch]$Multi) {
    @{ name = $name; displayName = $display; description = $desc
       personOrGroup = @{ allowMultipleSelection = [bool]$Multi
                          chooseFromType = "peopleOnly" } }
}
function New-LookupCol($name, $display, $desc, $targetListId) {
    @{ name = $name; displayName = $display; description = $desc
       lookup = @{ listId = $targetListId; columnName = "Title" } }
}

# --- The plan ----------------------------------------------------------------
$plan = @()

# 1. Altronic Equipment List -> asset register -------------------------------
$equipCols = @(
    (New-ChoiceCol "Criticality" "Criticality" `
        "How badly the plant is affected when this asset is down. Drives dashboard ranking." `
        @("Critical", "Important", "Standard")),
    (New-ChoiceCol "AssetStatus" "Asset Status" `
        "Current state of the asset. Retire an asset here rather than deleting the row." `
        @("In Service", "Down", "Standby", "Retired")),
    (New-LookupCol "ParentAsset" "Parent Asset" `
        "The line or machine this asset belongs to, so history rolls up." $LIST_EQUIPMENT),
    (New-DateCol "InstallDate" "Install Date" "When the asset was put into service."),
    (New-DateCol "WarrantyExpiry" "Warranty Expiry" "End of the manufacturer warranty."),
    (New-PersonCol "ResponsibleTech" "Responsible Tech" `
        "Default assignee for scheduled maintenance on this asset.")
)
if (-not $SkipManufacturerModel) {
    $equipCols += (New-TextCol "Manufacturer" "Manufacturer" `
        "Currently embedded in Description as prose - backfill opportunistically, never required.")
    $equipCols += (New-TextCol "ModelNumber" "Model Number" `
        "Currently embedded in Description as prose - backfill opportunistically, never required.")
}
$plan += @{ key = "Equipment"; listId = $LIST_EQUIPMENT
            label = "Altronic Equipment List"; create = $equipCols; patch = @() }

# 2. Altronic Maintenance Tasks -> work orders -------------------------------
$plan += @{
    key = "Maintenance"; listId = $LIST_MAINTTASKS; label = "Altronic Maintenance Tasks"
    create = @(
        (New-ChoiceCol "Priority" "Priority" `
            "Triage order. Emergency means the line is down." $PRIORITIES),
        (New-LookupCol "ScheduledMaintenanceRef" "Scheduled Maintenance Ref" `
            "The PM schedule this work order came from. EMPTY means a one-off - that is what the Scheduled/One-off filter and PM compliance both read." `
            $LIST_SCHEDULED),
        (New-TextCol "WONumber" "WO Number" `
            "WO-YYYY-####. Owned by ARC - never typed by a user."),
        (New-PersonCol "ReportedBy" "Reported By" `
            "Who reported the problem. On a promoted Operations task this is that task's author, not whoever promoted it."),
        (New-DateCol "CompletedDate" "Completed Date" "When the work was finished."),
        (New-PersonCol "CompletedBy" "Completed By" "Who finished the work."),
        (New-NumberCol "LaborHours" "Labor Hours" "Hours worked. Feeds MTTR."),
        (New-NumberCol "DowntimeHours" "Downtime Hours" `
            "Hours the asset was unavailable. Feeds the bad-actor list."),
        (New-TextCol "FailureCause" "Failure Cause" `
            "Why it failed. This is the asset history - TechNotes is working notes." -Multi),
        (New-TextCol "Resolution" "Resolution" `
            "What was done to fix it. Also carries the reason when a PM is skipped." -Multi),
        (New-TextCol "PartsUsed" "Parts Used" `
            "Free text for now. A real parts list would be a separate list." -Multi)
    )
    patch = @(
        @{ name = "Status";   choices = $WORK_STATUSES
           why = "adds Awaiting Parts and On Hold" },
        @{ name = "Category"; choices = $WORK_CATEGORIES
           why = "expands beyond Calibration/Cleaning/Oil Change - used instead of a second WorkType column" }
    )
}

# 3. Scheduled Maintenance -> PM rules ---------------------------------------
$schedCols = @(
    (New-DateCol "FirstDueDate" "First Due Date" `
        "The anchor the projection starts from. Without it there is nothing to compute the first occurrence from."),
    (New-ChoiceCol "ScheduleBasis" "Schedule Basis" `
        "Fixed = next due comes from the DUE date (an annual calibration stays on its date even if done late). Floating = next due comes from the COMPLETION date (a 90-day filter change resets from when it was actually done)." `
        @("Fixed", "Floating")),
    (New-BoolCol "Active" "Active" `
        "Unticked pauses the PM without deleting it. Every Power Automate flow must honour this or a retired asset nags forever."),
    (New-NumberCol "GraceDays" "Grace Days" `
        "How many days late still counts as on time for PM compliance."),
    (New-NumberCol "LeadTimeDays" "Lead Time Days" `
        "How far ahead of the due date this appears as actionable, and when the reminder flow picks it up."),
    (New-PersonCol "AssignedTo" "Assigned To" `
        "Default assignee copied onto each work order, and who the reminder flow emails."),
    (New-PersonCol "LastCompletedBy" "Last Completed By" "Who last carried this PM out."),
    (New-ChoiceCol "Priority" "Priority" "Copied onto each work order." $PRIORITIES),
    (New-PersonCol "Watchers" "Watchers" `
        "People notified about changes to this schedule. No comment thread here - comments belong on the work order." -Multi),
    (New-BoolCol "RequiresShutdown" "Requires Shutdown" "The asset must be stopped for this work."),
    (New-BoolCol "LOTORequired" "LOTO Required" `
        "Lockout/tagout applies. Recorded here for planning - the procedure itself is owned and signed off outside ARC.")
)
if ($FrequencyMode -eq "Interval") {
    $schedCols += (New-NumberCol "FrequencyInterval" "Frequency Interval" `
        "How many units between occurrences, e.g. 6 with unit Weeks.")
    $schedCols += (New-ChoiceCol "FrequencyUnit" "Frequency Unit" `
        "Unit for Frequency Interval." @("Days", "Weeks", "Months", "Years"))
}
if ($IncludeLastAlerted) {
    $schedCols += (New-DateCol "LastAlertedDate" "Last Alerted Date" `
        "Stamped by Power Automate so a per-item reminder is not resent daily. ARC must never write this.")
}

$schedPatch = @(
    @{ name = "Category"; choices = $WORK_CATEGORIES
       why = "replaces the 'Choice 1/2/3' placeholder; same vocabulary as Maintenance Tasks so it copies across" }
)
if ($FrequencyMode -eq "Choice") {
    $schedPatch += @{ name = "Frequency"
        choices = @("Weekly", "Bi-Weekly", "Monthly", "Quarterly", "Semi-Annual", "Annual")
        why = "replaces the 'Choice 1/2/3' placeholder. Cannot express 'every 6 weeks' - use -FrequencyMode Interval if that is needed" }
}

$plan += @{ key = "Scheduled"; listId = $LIST_SCHEDULED
            label = "Scheduled Maintenance"; create = $schedCols; patch = $schedPatch }

# 4. Operations Task List -> promotion back-pointer ---------------------------
$plan += @{
    key = "Operations"; listId = $LIST_OPSTASKS; label = "Operations Task List"
    create = @(
        (New-LookupCol "MaintenanceTaskReference" "Maintenance Task Reference" `
            "Set when this task is promoted to a maintenance work order. Non-empty means already promoted - ARC blocks a second promotion on that." `
            $LIST_MAINTTASKS)
    )
    patch = @()
}

if ($OnlyList) { $plan = $plan | Where-Object { $_.key -eq $OnlyList } }

# --- Connect -----------------------------------------------------------------
$ctx = Get-MgContext
if (-not $ctx -or $ctx.Scopes -notcontains "Sites.Manage.All") {
    Write-Host "Signing in for write access (Sites.Manage.All)..." -ForegroundColor Cyan
    if ($DeviceCode) { Connect-MgGraph -Scopes "Sites.Manage.All" -UseDeviceCode -NoWelcome }
    else             { Connect-MgGraph -Scopes "Sites.Manage.All" -NoWelcome }
}

if ($WhatIf) {
    Write-Host ""
    Write-Host "*** -WhatIf: nothing will be changed ***" -ForegroundColor Magenta
}
Write-Host ""
Write-Host ("Frequency mode : {0}" -f $FrequencyMode) -ForegroundColor Gray
Write-Host ("Manufacturer/Model : {0}" -f $(if ($SkipManufacturerModel) { "skipped" } else { "added" })) -ForegroundColor Gray
Write-Host ("LastAlertedDate : {0}" -f $(if ($IncludeLastAlerted) { "added (per-item alerts)" } else { "not added (digest alerts)" })) -ForegroundColor Gray

$summary = @()

foreach ($list in $plan) {
    Write-Host ""
    Write-Host ("=== {0} ===" -f $list.label) -ForegroundColor Cyan
    $base = "https://graph.microsoft.com/v1.0/sites/$siteId/lists/$($list.listId)/columns"

    $existing = (Invoke-MgGraphRequest -Method GET -Uri $base).value
    $have = $existing | ForEach-Object { $_["name"] }
    Write-Host ("  {0} columns on the list" -f $have.Count) -ForegroundColor Gray

    # -- creates
    foreach ($col in $list.create) {
        if ($have -contains $col.name) {
            Write-Host ("  SKIP    {0} - already exists" -f $col.name) -ForegroundColor Yellow
            $summary += [pscustomobject]@{ List = $list.label; Column = $col.name; Action = "skip (exists)" }
            continue
        }
        if ($WhatIf) {
            Write-Host ("  WOULD CREATE  {0}" -f $col.name) -ForegroundColor Cyan
            $summary += [pscustomobject]@{ List = $list.label; Column = $col.name; Action = "would create" }
            continue
        }
        Write-Host ("  CREATE  {0}..." -f $col.name) -ForegroundColor Green
        $created = Invoke-MgGraphRequest -Method POST -Uri $base `
            -Body ($col | ConvertTo-Json -Depth 8) -ContentType "application/json"
        Write-Host ("          internal name '{0}'" -f $created["name"]) -ForegroundColor Green
        $summary += [pscustomobject]@{ List = $list.label; Column = $created["name"]; Action = "created" }
    }

    # -- choice patches
    foreach ($fix in $list.patch) {
        $target = $existing | Where-Object { $_["name"] -eq $fix.name }
        if (-not $target) {
            Write-Host ("  MISSING {0} - expected an existing column to update" -f $fix.name) -ForegroundColor Red
            $summary += [pscustomobject]@{ List = $list.label; Column = $fix.name; Action = "MISSING - not updated" }
            continue
        }
        $current = @()
        if ($target.ContainsKey("choice")) { $current = @($target["choice"]["choices"]) }
        $missing = $fix.choices | Where-Object { $current -notcontains $_ }
        if (-not $missing) {
            Write-Host ("  SKIP    {0} - choices already correct" -f $fix.name) -ForegroundColor Yellow
            $summary += [pscustomobject]@{ List = $list.label; Column = $fix.name; Action = "skip (choices ok)" }
            continue
        }
        Write-Host ("  UPDATE  {0} - {1}" -f $fix.name, $fix.why) -ForegroundColor Green
        Write-Host ("          from: {0}" -f ($current -join ", ")) -ForegroundColor Gray
        Write-Host ("          to  : {0}" -f ($fix.choices -join ", ")) -ForegroundColor Gray
        if ($WhatIf) {
            $summary += [pscustomobject]@{ List = $list.label; Column = $fix.name; Action = "would update choices" }
            continue
        }
        $body = @{ choice = @{ choices = @($fix.choices) } } | ConvertTo-Json -Depth 5
        Invoke-MgGraphRequest -Method PATCH -Uri "$base/$($target['id'])" `
            -Body $body -ContentType "application/json" | Out-Null
        $summary += [pscustomobject]@{ List = $list.label; Column = $fix.name; Action = "choices updated" }
    }

    # -- optional destructive removal
    if ($RemovePlaceholderFrequency -and $list.key -eq "Scheduled" -and $FrequencyMode -eq "Interval") {
        $freq = $existing | Where-Object { $_["name"] -eq "Frequency" }
        if ($freq) {
            if ($WhatIf) {
                Write-Host "  WOULD DELETE  Frequency (unconfigured placeholder)" -ForegroundColor Magenta
                $summary += [pscustomobject]@{ List = $list.label; Column = "Frequency"; Action = "would DELETE" }
            } else {
                Write-Host "  DELETE  Frequency (unconfigured placeholder)" -ForegroundColor Magenta
                Invoke-MgGraphRequest -Method DELETE -Uri "$base/$($freq['id'])" | Out-Null
                $summary += [pscustomobject]@{ List = $list.label; Column = "Frequency"; Action = "DELETED" }
            }
        }
    }
}

# --- Verification ------------------------------------------------------------
Write-Host ""
Write-Host "=== Verification (read back from the lists) ===" -ForegroundColor Cyan
foreach ($list in $plan) {
    $after = (Invoke-MgGraphRequest -Method GET `
        -Uri "https://graph.microsoft.com/v1.0/sites/$siteId/lists/$($list.listId)/columns").value
    $names = $after | ForEach-Object { $_["name"] }
    Write-Host ("  {0}" -f $list.label) -ForegroundColor Cyan
    foreach ($col in $list.create) {
        if ($names -contains $col.name) {
            Write-Host ("    OK      {0}" -f $col.name) -ForegroundColor Green
        } elseif ($WhatIf) {
            Write-Host ("    PENDING {0}" -f $col.name) -ForegroundColor Gray
        } else {
            Write-Host ("    MISSING {0}" -f $col.name) -ForegroundColor Red
        }
    }
    foreach ($fix in $list.patch) {
        $t = $after | Where-Object { $_["name"] -eq $fix.name }
        if ($t -and $t.ContainsKey("choice")) {
            Write-Host ("    CHOICES {0}: {1}" -f $fix.name, (@($t["choice"]["choices"]) -join ", ")) -ForegroundColor Green
        }
    }
}

Write-Host ""
Write-Host "=== Summary ===" -ForegroundColor Cyan
$summary | Format-Table -AutoSize

Write-Host ""
Write-Host "STILL TO DO BY HAND:" -ForegroundColor Yellow
Write-Host "  1. Index NextDueDate, DueDate and Active (List settings > Indexed columns)" -ForegroundColor Yellow
Write-Host "     so Power Automate can filter on them." -ForegroundColor Yellow
Write-Host "  2. Confirm the internal names above before coding ARC against them -" -ForegroundColor Yellow
Write-Host "     SharePoint, not this script, decides the final internal name." -ForegroundColor Yellow
Write-Host "  3. Re-run scripts/discover-list.ps1 to refresh the schema snapshots." -ForegroundColor Yellow
