<#
.SYNOPSIS
    Creates the two Harness Production lists on Altronic_PMO: "Harness Part
    Numbers" and "Harness Production Log". Idempotent; -WhatIf reports only.

.DESCRIPTION
    The Harness Production Log replaces an Access database on a production PC.
    Its part numbers were free text there (1,310 spellings for ~1,000 parts), so
    the new log points at a separate, admin-managed part list instead:

      Harness Part Numbers   Title (shown "Part Number"), Description, Active, Note
      Harness Production Log Title (app-derived), ProductionDate, WorkOrder,
                             PartNumber (LOOKUP -> Harness Part Numbers),
                             Quantity, ReworkQuantity, Comments, BuiltBy,
                             VisualCheck, DataQualityNotes, LegacySource

    Three things are load-bearing:

    - ProductionDate and LegacySource are INDEXED. The log loads with ~22,000
      rows, past SharePoint's 5,000-item threshold, and above that it refuses a
      $filter on an unindexed column however few rows match. ARC reads the log
      one year at a time by ProductionDate; the load script matches on
      LegacySource. Title on the part list is indexed for the same reason.
    - PartNumber is a SINGLE lookup. Graph returns it as a bare
      PartNumberLookupId and ARC writes it as a bare integer.
    - Every column is then WRITTEN AND READ BACK with a throwaway row (and the
      row deleted). A 2xx from a write is not evidence the value landed - see
      "A field called DisplayName is silently dropped" in CLAUDE.md.

    RUN IN YOUR OWN TERMINAL - the sign-in is interactive.

.EXAMPLE
    .\create-harness-production-lists.ps1 -WhatIf
    .\create-harness-production-lists.ps1
#>

[CmdletBinding()]
param(
    [switch]$WhatIf,
    [switch]$DeviceCode
)

$ErrorActionPreference = "Stop"
Import-Module Microsoft.Graph.Authentication

$siteId = "coopermachineryservices.sharepoint.com,915a6183-2b71-4dfd-a8b9-181126dfbe78,3eb6cb9c-6535-4c69-a8d7-e90b2f90a9eb"
$graph = "https://graph.microsoft.com/v1.0/sites/$siteId"
$PARTS_NAME = "Harness Part Numbers"
$LOG_NAME = "Harness Production Log"

$plainNote = @{ allowMultipleLines = $true; appendChangesToExistingText = $false; linesForEditing = 4; textType = "plain" }

$partColumns = @(
    @{ name = "Description"; displayName = "Description"; text = @{} },
    @{ name = "Active"; displayName = "Active"; boolean = @{}
       description = "Untick to retire a part number. It stops being offered for new entries; every entry already using it keeps it." },
    @{ name = "Note"; displayName = "Note"; text = $plainNote }
)

function Get-LogColumns($partsListId) {
    @(
        @{ name = "ProductionDate"; displayName = "Production Date"; indexed = $true
           dateTime = @{ format = "dateOnly"; displayAs = "standard" } },
        @{ name = "WorkOrder"; displayName = "Work Order"; text = @{} },
        @{ name = "PartNumber"; displayName = "Part Number"
           lookup = @{ listId = $partsListId; columnName = "Title" } },
        @{ name = "Quantity"; displayName = "Qty"; number = @{ decimalPlaces = "none" } },
        @{ name = "ReworkQuantity"; displayName = "Rework Qty"; number = @{ decimalPlaces = "none" } },
        @{ name = "Comments"; displayName = "Comments"; text = $plainNote },
        @{ name = "BuiltBy"; displayName = "Built By"; text = @{}
           description = "Clock number(s) or initials of whoever built it - the old database's Clock Number." },
        @{ name = "VisualCheck"; displayName = "Visual Check"; text = @{}
           description = "Clock number(s) or initials of whoever did the visual check." },
        @{ name = "DataQualityNotes"; displayName = "Data Quality Notes"; text = $plainNote
           description = "What the Access import changed on this row, with the original value. Blank on rows entered in ARC." },
        @{ name = "LegacySource"; displayName = "Legacy Source"; text = @{}; indexed = $true
           description = "The Access row this came from. Used to make the import re-runnable. Blank on rows entered in ARC." }
    )
}

# --- auth -------------------------------------------------------------------
$ctx = Get-MgContext
if (-not $ctx -or $ctx.Scopes -notcontains "Sites.Manage.All") {
    Write-Host "Signing in for write access (Sites.Manage.All)..." -ForegroundColor Cyan
    if ($DeviceCode) { Connect-MgGraph -Scopes "Sites.Manage.All" -UseDeviceCode -NoWelcome }
    else             { Connect-MgGraph -Scopes "Sites.Manage.All" -NoWelcome }
}
if ($WhatIf) { Write-Host "`n*** -WhatIf: nothing will be changed ***" -ForegroundColor Magenta }

# --- find existing lists (paged: an unpaged call silently returns a subset) --
$found = @{}
$uri = "$graph/lists?`$select=id,displayName&`$top=200"
while ($uri) {
    $page = Invoke-MgGraphRequest -Method GET -Uri $uri
    foreach ($l in $page.value) { $found[$l.displayName] = $l.id }
    $uri = $page["@odata.nextLink"]
}

function Ensure-List($name, $columns) {
    $id = $found[$name]
    if ($id) { Write-Host "  EXISTS  $name ($id)" -ForegroundColor Yellow; return $id }
    if ($WhatIf) { Write-Host "  WOULD CREATE  $name with $($columns.Count) columns" -ForegroundColor Cyan; return $null }
    Write-Host "  CREATE  $name..." -ForegroundColor Green
    $body = @{ displayName = $name; list = @{ template = "genericList" }; columns = $columns } | ConvertTo-Json -Depth 8
    $created = Invoke-MgGraphRequest -Method POST -Uri "$graph/lists" -Body $body -ContentType "application/json"
    return $created["id"]
}

function Ensure-Columns($listId, $label, $columns) {
    $have = (Invoke-MgGraphRequest -Method GET -Uri "$graph/lists/$listId/columns").value
    foreach ($c in $columns) {
        $existing = $have | Where-Object { $_["name"] -eq $c.name }
        if (-not $existing) {
            if ($WhatIf) { Write-Host "    WOULD ADD  $label / $($c.name)" -ForegroundColor Cyan; continue }
            Invoke-MgGraphRequest -Method POST -Uri "$graph/lists/$listId/columns" `
                -Body ($c | ConvertTo-Json -Depth 6) -ContentType "application/json" | Out-Null
            Write-Host "    added      $label / $($c.name)" -ForegroundColor Green
        } elseif ($c.indexed -and -not $existing["indexed"]) {
            if ($WhatIf) { Write-Host "    WOULD INDEX  $label / $($c.name)" -ForegroundColor Cyan; continue }
            Invoke-MgGraphRequest -Method PATCH -Uri "$graph/lists/$listId/columns/$($existing["id"])" `
                -Body (@{ indexed = $true } | ConvertTo-Json) -ContentType "application/json" | Out-Null
            Write-Host "    indexed    $label / $($c.name)" -ForegroundColor Green
        }
    }
}

function Set-TitleColumn($listId, $displayName, [bool]$index, [bool]$required) {
    $title = (Invoke-MgGraphRequest -Method GET -Uri "$graph/lists/$listId/columns").value |
        Where-Object { $_["name"] -eq "Title" }
    $patch = @{ displayName = $displayName; required = $required }
    if ($index) { $patch.indexed = $true }
    if ($WhatIf) { Write-Host "    WOULD SET  Title -> '$displayName'" -ForegroundColor Cyan; return }
    Invoke-MgGraphRequest -Method PATCH -Uri "$graph/lists/$listId/columns/$($title["id"])" `
        -Body ($patch | ConvertTo-Json) -ContentType "application/json" | Out-Null
    Write-Host "    Title shown as '$displayName'" -ForegroundColor Green
}

Write-Host "`n=== $PARTS_NAME ===" -ForegroundColor Cyan
$partsId = Ensure-List $PARTS_NAME $partColumns
if ($partsId) {
    Ensure-Columns $partsId $PARTS_NAME $partColumns
    Set-TitleColumn $partsId "Part Number" $true $true
}

Write-Host "`n=== $LOG_NAME ===" -ForegroundColor Cyan
if (-not $partsId) {
    Write-Host "  WOULD CREATE  $LOG_NAME once the part list exists (its PartNumber lookup needs the id)" -ForegroundColor Cyan
} else {
    $logColumns = Get-LogColumns $partsId
    $logId = Ensure-List $LOG_NAME $logColumns
    if ($logId) {
        Ensure-Columns $logId $LOG_NAME $logColumns
        # App-derived ("593027-15 / WO 1000209528"), so nobody has to type it.
        Set-TitleColumn $logId "Entry" $false $false
    }
}

# --- write and read back every column ---------------------------------------
if (-not $WhatIf -and $partsId -and $logId) {
    Write-Host "`n=== Write/read-back check ===" -ForegroundColor Cyan
    $part = Invoke-MgGraphRequest -Method POST -Uri "$graph/lists/$partsId/items" -ContentType "application/json" `
        -Body (@{ fields = @{ Title = "ARC-VERIFY"; Description = "verify"; Active = $false; Note = "verify" } } | ConvertTo-Json -Depth 4)
    $logFields = @{
        Title = "ARC-VERIFY"; ProductionDate = "2026-01-15T12:00:00Z"; WorkOrder = "1000000000"
        PartNumberLookupId = [int]$part.id; Quantity = 7; ReworkQuantity = 1; Comments = "verify"
        BuiltBy = "999"; VisualCheck = "998"; DataQualityNotes = "verify"; LegacySource = "ARC-VERIFY"
    }
    $row = Invoke-MgGraphRequest -Method POST -Uri "$graph/lists/$logId/items" -ContentType "application/json" `
        -Body (@{ fields = $logFields } | ConvertTo-Json -Depth 4)
    $back = Invoke-MgGraphRequest -Method GET -Uri "$graph/lists/$logId/items/$($row.id)?`$expand=fields"
    $partBack = Invoke-MgGraphRequest -Method GET -Uri "$graph/lists/$partsId/items/$($part.id)?`$expand=fields"
    $bad = @()
    foreach ($k in $logFields.Keys) {
        $got = $back.fields[$k]
        if ($k -eq "ProductionDate") {
            # Invoke-MgGraphRequest hands a date back as a [datetime], not the
            # ISO string Graph sent, so "$got" reads "01/15/2026 12:00:00".
            # Compare the calendar day in UTC, whichever shape arrives.
            $day = if ($got -is [datetime]) { $got.ToUniversalTime().ToString("yyyy-MM-dd") } else { "$got".Substring(0, [Math]::Min(10, "$got".Length)) }
            if ($day -ne "2026-01-15") { $bad += "$k = '$got'" }
        }
        elseif ("$got" -ne "$($logFields[$k])") { $bad += "$k = '$got' (wrote '$($logFields[$k])')" }
    }
    foreach ($k in "Description", "Note") { if ($partBack.fields[$k] -ne "verify") { $bad += "parts $k = '$($partBack.fields[$k])'" } }
    if ($partBack.fields["Active"] -ne $false) { $bad += "parts Active = '$($partBack.fields["Active"])'" }
    Invoke-MgGraphRequest -Method DELETE -Uri "$graph/lists/$logId/items/$($row.id)" | Out-Null
    Invoke-MgGraphRequest -Method DELETE -Uri "$graph/lists/$partsId/items/$($part.id)" | Out-Null
    if ($bad) {
        Write-Host "  These did NOT read back as written - fix before loading:" -ForegroundColor Red
        $bad | ForEach-Object { Write-Host "    $_" -ForegroundColor Red }
    } else {
        Write-Host "  Every column wrote and read back correctly (test rows deleted)." -ForegroundColor Green
    }
}

Write-Host "`n=== Next ===" -ForegroundColor Cyan
if ($partsId) { Write-Host "  VITE_SP_HARNESS_PART_NUMBERS_LIST_ID = $partsId" -ForegroundColor Green }
if ($logId)   { Write-Host "  VITE_SP_HARNESS_PRODUCTION_LOG_LIST_ID = $logId" -ForegroundColor Green }
Write-Host "  Set both as repo variables and redeploy, then load the data with" -ForegroundColor Gray
Write-Host "  scripts/load-harness-production-log.ps1 (report first, then -Apply)." -ForegroundColor Gray
