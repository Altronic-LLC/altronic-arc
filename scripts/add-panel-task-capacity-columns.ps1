<#
.SYNOPSIS
    Adds the capacity columns (StartDate, DueDate, EstimatedHours) and the
    Wrike-import bookkeeping columns (LegacySource, ImportHash) to the
    "Panel Tasks" list on ALTRONICPANELTEAM (BusinessIT#42).
    Idempotent; -WhatIf reports only.

.DESCRIPTION
    The Panel Engineering Capacity view spreads each task's estimated hours
    across its start-to-due working days, per assignee. These are the columns
    it reads; the internal names are the contract with
    src/lib/panelTaskMapper.ts:

      StartDate        Date only                     "Start Date"
      DueDate          Date only                     "Due Date"
      EstimatedHours   Number, >= 0, two decimals    "Estimated Hours"
      LegacySource     Text, INDEXED                 "wrike:<task id>" - import only
      ImportHash       Text                          "src=...;arc=..." - import only

    ARC's app never reads or writes LegacySource or ImportHash; they belong to
    scripts/import-wrike-panel-tasks.ps1 (see docs/WRIKE-IMPORT.md).

    None is required: existing tasks have no dates, and a task missing any of
    them shows in ARC's "Needs scheduling" backlog instead of the grid.

    Every column is then WRITTEN AND READ BACK with a throwaway task (deleted
    afterwards). A 2xx from a write is not evidence the value landed. Dates are
    written at midday UTC, ARC's date-only rule (src/lib/spDates.ts), and read
    back through the same midday pivot.

    RUN IN YOUR OWN TERMINAL - the sign-in is interactive. If the Windows
    account window never appears (it can open behind VS Code), use -DeviceCode.

.EXAMPLE
    .\add-panel-task-capacity-columns.ps1 -WhatIf
    .\add-panel-task-capacity-columns.ps1
#>

[CmdletBinding()]
param(
    [switch]$WhatIf,
    [switch]$DeviceCode
)

$ErrorActionPreference = "Stop"
Import-Module Microsoft.Graph.Authentication

$siteId = "coopermachineryservices.sharepoint.com,fdf31131-2076-4618-923b-a1856e6b0f2a,3eb6cb9c-6535-4c69-a8d7-e90b2f90a9eb"
$listId = "17a33ee1-c4aa-439b-9dc0-6269a8e04767"   # Panel Tasks
$graph = "https://graph.microsoft.com/v1.0/sites/$siteId"

$dateOnly = @{ format = "dateOnly"; displayAs = "standard" }
$columns = @(
    @{ name = "StartDate"; displayName = "Start Date"; dateTime = $dateOnly
       description = "First working day of the task. ARC spreads the estimated hours from here to the due date." },
    @{ name = "DueDate"; displayName = "Due Date"; dateTime = $dateOnly },
    @{ name = "EstimatedHours"; displayName = "Estimated Hours"
       number = @{ decimalPlaces = "two"; minimum = 0 }
       description = "Total hours the task should take. Drives the Panel Engineering Capacity view." },
    # Import bookkeeping for scripts/import-wrike-panel-tasks.ps1. ARC never
    # reads or writes either. LegacySource is indexed so a re-run can find a
    # task by it past 5,000 rows.
    @{ name = "LegacySource"; displayName = "Legacy Source"; text = @{}; indexed = $true
       description = "wrike:<task id> on a task imported from Wrike. Written by the import script only." },
    @{ name = "ImportHash"; displayName = "Import Hash"; text = @{}
       description = "What the Wrike import last wrote (src=...;arc=...). Lets a re-run spot edits made in ARC." }
)

# --- auth -------------------------------------------------------------------
$ctx = Get-MgContext
if (-not $ctx -or $ctx.Scopes -notcontains "Sites.Manage.All") {
    Write-Host "Signing in for write access (Sites.Manage.All)..." -ForegroundColor Cyan
    if ($DeviceCode) { Connect-MgGraph -Scopes "Sites.Manage.All" -UseDeviceCode -NoWelcome }
    else             { Connect-MgGraph -Scopes "Sites.Manage.All" -NoWelcome }
}
if ($WhatIf) { Write-Host "`n*** -WhatIf: nothing will be changed ***" -ForegroundColor Magenta }

# --- add what's missing -----------------------------------------------------
Write-Host "`n=== Panel Tasks ($listId) ===" -ForegroundColor Cyan
$have = (Invoke-MgGraphRequest -Method GET -Uri "$graph/lists/$listId/columns").value
foreach ($c in $columns) {
    $existing = $have | Where-Object { $_["name"] -eq $c.name }
    if ($existing) {
        # Report a same-name column of the wrong type rather than "fixing" it -
        # changing a column's type in place can lose data.
        $kind = if ($c.dateTime) { "dateTime" } elseif ($c.number) { "number" } else { "text" }
        if (-not $existing[$kind]) {
            Write-Host "  WRONG TYPE  $($c.name) exists but is not a $kind column - fix it in List settings" -ForegroundColor Red
        } elseif ($c.indexed -and -not $existing["indexed"]) {
            if ($WhatIf) { Write-Host "  WOULD INDEX $($c.name)" -ForegroundColor Cyan; continue }
            Invoke-MgGraphRequest -Method PATCH -Uri "$graph/lists/$listId/columns/$($existing["id"])" `
                -Body (@{ indexed = $true } | ConvertTo-Json) -ContentType "application/json" | Out-Null
            Write-Host "  indexed     $($c.name)" -ForegroundColor Green
        } else {
            Write-Host "  EXISTS      $($c.name)" -ForegroundColor Yellow
        }
        continue
    }
    if ($WhatIf) { Write-Host "  WOULD ADD   $($c.name)" -ForegroundColor Cyan; continue }
    Invoke-MgGraphRequest -Method POST -Uri "$graph/lists/$listId/columns" `
        -Body ($c | ConvertTo-Json -Depth 6) -ContentType "application/json" | Out-Null
    Write-Host "  added       $($c.name)" -ForegroundColor Green
}

if ($WhatIf) { Write-Host "`n-WhatIf - nothing was changed.`n" -ForegroundColor Yellow; exit 0 }

# --- write and read back ----------------------------------------------------
# ARC's date-only rule: written at 12:00 UTC; a stored time after 12:00 UTC
# belongs to the NEXT day (SharePoint may store local midnight instead).
function Get-DateKey($value) {
    if ($null -eq $value -or "$value" -eq "") { return "" }
    $d = if ($value -is [datetime]) { $value.ToUniversalTime() } else { ([datetime]::Parse("$value")).ToUniversalTime() }
    if ($d.Hour -gt 12) { $d = $d.AddDays(1) }
    return $d.ToString("yyyy-MM-dd")
}

Write-Host "`n=== Write/read-back check ===" -ForegroundColor Cyan
$fields = @{
    Title = "ARC-VERIFY capacity columns (safe to delete)"
    Status = "Pending"
    StartDate = "2026-01-13T12:00:00Z"
    DueDate = "2026-01-16T12:00:00Z"
    EstimatedHours = 12.5
    LegacySource = "wrike:ARC-VERIFY"
    ImportHash = "src=verify;arc=verify"
}
$row = Invoke-MgGraphRequest -Method POST -Uri "$graph/lists/$listId/items" -ContentType "application/json" `
    -Body (@{ fields = $fields } | ConvertTo-Json -Depth 4)
$bad = @()
try {
    $back = Invoke-MgGraphRequest -Method GET `
        -Uri "$graph/lists/$listId/items/$($row.id)?`$expand=fields(`$select=StartDate,DueDate,EstimatedHours,LegacySource,ImportHash)"
    if ("$($back.fields.LegacySource)" -ne $fields.LegacySource) { $bad += "LegacySource = '$($back.fields.LegacySource)'" }
    if ("$($back.fields.ImportHash)" -ne $fields.ImportHash) { $bad += "ImportHash = '$($back.fields.ImportHash)'" }
    if ((Get-DateKey $back.fields.StartDate) -ne "2026-01-13") { $bad += "StartDate = '$($back.fields.StartDate)' (wrote 2026-01-13)" }
    if ((Get-DateKey $back.fields.DueDate) -ne "2026-01-16") { $bad += "DueDate = '$($back.fields.DueDate)' (wrote 2026-01-16)" }
    $hours = $back.fields.EstimatedHours
    if ($null -eq $hours -or [Math]::Abs([double]$hours - 12.5) -gt 1e-9) { $bad += "EstimatedHours = '$hours' (wrote 12.5)" }

    # Clearing must work too: the edit form blanks a date or the hours.
    Invoke-MgGraphRequest -Method PATCH -Uri "$graph/lists/$listId/items/$($row.id)/fields" -ContentType "application/json" `
        -Body (@{ StartDate = $null; EstimatedHours = $null } | ConvertTo-Json) | Out-Null
    $cleared = Invoke-MgGraphRequest -Method GET `
        -Uri "$graph/lists/$listId/items/$($row.id)?`$expand=fields(`$select=StartDate,EstimatedHours)"
    if ($cleared.fields.StartDate) { $bad += "StartDate did not clear (still '$($cleared.fields.StartDate)')" }
    if ($null -ne $cleared.fields.EstimatedHours) { $bad += "EstimatedHours did not clear (still '$($cleared.fields.EstimatedHours)')" }
} finally {
    Invoke-MgGraphRequest -Method DELETE -Uri "$graph/lists/$listId/items/$($row.id)" | Out-Null
}

if ($bad) {
    Write-Host "  These did NOT read back as written - fix before relying on the Capacity view:" -ForegroundColor Red
    $bad | ForEach-Object { Write-Host "    $_" -ForegroundColor Red }
    exit 1
}
Write-Host "  All five columns wrote and read back, and the dates/hours cleared (test task deleted)." -ForegroundColor Green
Write-Host "`nNo env var needed - ARC already knows the Panel Tasks list id." -ForegroundColor Gray
