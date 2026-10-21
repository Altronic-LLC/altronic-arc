<#
.SYNOPSIS
    Creates the QCFRM-012 CPU-95 test sheet list on Altronic_PMO, replacing the
    "CPU-95" list on Altronic_Engineering. Idempotent; -WhatIf reports only.

.DESCRIPTION
    Every column comes from scripts/data/qc-cpu95-columns.json - the one copy
    of the layout, which the migration script reads too. Add a column there,
    never here. A re-run adds whatever columns the list is missing and changes
    nothing that already exists.

    What the layout changes from the old list (Tim, 2026-10-21):
    - Readable internal names throughout.
    - The standard and 791952/62-18 peak-volt readings are ONE column each:
      they fill the same blank on paper, and the part number decides the spec.
    - The three firing-angle grids (16/18/20 cylinder, 108 columns) are 20 row
      slots of spec and actual, labelled by the unit's cylinder grid.
    - Checks are a choice of Yes / No / N/A, not a yes/no tick, so "doesn't
      apply" is recorded. Defect flags stay yes/no.
    - Columns the paper uses and the old list lacked: SAP Number, Memory No.,
      the oven ON/OFF times, the CPU-95C (791955-16) and EVS checks, and the
      twelve Post Test Inspection points.
    - Project Reference is TEXT: the Projects list is on another site, and a
      lookup can't reach across sites.

    Two things are load-bearing:
    - Title (shown "Serial Number"), Altronic Part Number, Date Tested and
      LegacySource are INDEXED, so the list can be filtered past 5,000 rows.
      The migration script matches on LegacySource.
    - Every column is then WRITTEN AND READ BACK with a throwaway row (and the
      row deleted). A 2xx from a write is not evidence the value landed - see
      "A field called DisplayName is silently dropped" in CLAUDE.md.

    RUN IN YOUR OWN TERMINAL - the sign-in is interactive.

.EXAMPLE
    .\create-qc-cpu95-pmo-list.ps1 -WhatIf
    .\create-qc-cpu95-pmo-list.ps1
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

$spec = Get-Content (Join-Path $PSScriptRoot "data/qc-cpu95-columns.json") -Raw -Encoding utf8 | ConvertFrom-Json
$LIST_NAME = $spec.listName
$plainNote = @{ allowMultipleLines = $true; appendChangesToExistingText = $false; linesForEditing = 6; textType = "plain" }

function ConvertTo-ColumnDefinition($c) {
    $def = @{ name = $c.name; displayName = $c.displayName }
    if ($c.description) { $def.description = $c.description }
    if ($c.indexed) { $def.indexed = $true }
    switch ($c.type) {
        "text"     { $def.text = @{} }
        "note"     { $def.text = $plainNote }
        "number"   { $def.number = @{} }
        "date"     { $def.dateTime = @{ format = "dateOnly"; displayAs = "standard" } }
        "dateTime" { $def.dateTime = @{ format = "dateTime"; displayAs = "standard" } }
        # A single choice (dropDownMenu) - ARC writes a bare string. checkBoxes
        # would make it a MultiChoice, which needs a different write shape.
        "check"    { $def.choice = @{ choices = @($spec.checkChoices); displayAs = "dropDownMenu"; allowTextEntry = $false } }
        "flag"     { $def.boolean = @{} }
        default    { throw "Unknown column type '$($c.type)' on $($c.name)" }
    }
    $def
}

$columns = @($spec.columns | Where-Object { $_.type -ne "title" } | ForEach-Object { ConvertTo-ColumnDefinition $_ })
$titleSpec = $spec.columns | Where-Object { $_.type -eq "title" }
Write-Host "$LIST_NAME - $($columns.Count) columns plus Title ('$($titleSpec.displayName)')" -ForegroundColor Cyan

# --- auth -------------------------------------------------------------------
$ctx = Get-MgContext
if (-not $ctx -or $ctx.Scopes -notcontains "Sites.Manage.All") {
    Write-Host "Signing in for write access (Sites.Manage.All)..." -ForegroundColor Cyan
    if ($DeviceCode) { Connect-MgGraph -Scopes "Sites.Manage.All" -UseDeviceCode -NoWelcome }
    else             { Connect-MgGraph -Scopes "Sites.Manage.All" -NoWelcome }
}
if ($WhatIf) { Write-Host "`n*** -WhatIf: nothing will be changed ***" -ForegroundColor Magenta }

# --- find the list (paged: an unpaged call silently returns a subset) --------
$listId = $null
$uri = "$graph/lists?`$select=id,displayName&`$top=200"
while ($uri) {
    $page = Invoke-MgGraphRequest -Method GET -Uri $uri
    foreach ($l in $page.value) { if ($l.displayName -eq $LIST_NAME) { $listId = $l.id } }
    $uri = $page["@odata.nextLink"]
}

if ($listId) {
    Write-Host "  EXISTS  $LIST_NAME ($listId)" -ForegroundColor Yellow
} elseif ($WhatIf) {
    Write-Host "  WOULD CREATE  $LIST_NAME on Altronic_PMO with $($columns.Count) columns" -ForegroundColor Cyan
} else {
    # Created bare, then the columns one at a time below: a create carrying
    # 150 column definitions is one request that fails as a whole.
    Write-Host "  CREATE  $LIST_NAME..." -ForegroundColor Green
    $body = @{ displayName = $LIST_NAME; list = @{ template = "genericList" } } | ConvertTo-Json -Depth 4
    $listId = (Invoke-MgGraphRequest -Method POST -Uri "$graph/lists" -Body $body -ContentType "application/json")["id"]
}

# --- columns ------------------------------------------------------------------
if ($listId) {
    $have = (Invoke-MgGraphRequest -Method GET -Uri "$graph/lists/$listId/columns").value
    $added = 0
    foreach ($c in $columns) {
        $existing = $have | Where-Object { $_["name"] -eq $c.name }
        if (-not $existing) {
            if ($WhatIf) { Write-Host "    WOULD ADD  $($c.name)" -ForegroundColor Cyan; continue }
            Invoke-MgGraphRequest -Method POST -Uri "$graph/lists/$listId/columns" `
                -Body ($c | ConvertTo-Json -Depth 6) -ContentType "application/json" | Out-Null
            $added++
            Write-Host "    added      $($c.name)" -ForegroundColor Green
        } elseif ($c.indexed -and -not $existing["indexed"]) {
            if ($WhatIf) { Write-Host "    WOULD INDEX  $($c.name)" -ForegroundColor Cyan; continue }
            Invoke-MgGraphRequest -Method PATCH -Uri "$graph/lists/$listId/columns/$($existing["id"])" `
                -Body (@{ indexed = $true } | ConvertTo-Json) -ContentType "application/json" | Out-Null
            Write-Host "    indexed    $($c.name)" -ForegroundColor Green
        }
    }
    Write-Host "  $added column(s) added" -ForegroundColor Gray

    $title = (Invoke-MgGraphRequest -Method GET -Uri "$graph/lists/$listId/columns").value | Where-Object { $_["name"] -eq "Title" }
    if ($WhatIf) { Write-Host "    WOULD SET  Title -> '$($titleSpec.displayName)', indexed, required" -ForegroundColor Cyan }
    else {
        Invoke-MgGraphRequest -Method PATCH -Uri "$graph/lists/$listId/columns/$($title["id"])" -ContentType "application/json" `
            -Body (@{ displayName = $titleSpec.displayName; indexed = $true; required = $true } | ConvertTo-Json) | Out-Null
        Write-Host "    Title shown as '$($titleSpec.displayName)'" -ForegroundColor Green
    }
}

# --- write and read back every column ---------------------------------------
if (-not $WhatIf -and $listId) {
    Write-Host "`n=== Write/read-back check ===" -ForegroundColor Cyan
    $fields = @{ Title = "ARC-VERIFY" }
    $i = 0
    foreach ($c in $spec.columns) {
        $i++
        switch ($c.type) {
            "text"     { $fields[$c.name] = "v$i" }
            "note"     { $fields[$c.name] = "line 1`nline 2 ($i)" }
            "number"   { $fields[$c.name] = $i + 0.5 }
            "date"     { $fields[$c.name] = "2026-01-15T12:00:00Z" }
            "dateTime" { $fields[$c.name] = "2026-01-15T14:35:00Z" }
            "check"    { $fields[$c.name] = $spec.checkChoices[$i % $spec.checkChoices.Count] }
            "flag"     { $fields[$c.name] = $true }
        }
    }
    $row = Invoke-MgGraphRequest -Method POST -Uri "$graph/lists/$listId/items" -ContentType "application/json" `
        -Body (@{ fields = $fields } | ConvertTo-Json -Depth 4)
    $back = Invoke-MgGraphRequest -Method GET -Uri "$graph/lists/$listId/items/$($row.id)?`$expand=fields"
    $bad = @()
    foreach ($k in $fields.Keys) {
        $want = $fields[$k]; $got = $back.fields[$k]
        $type = ($spec.columns | Where-Object { $_.name -eq $k }).type
        if ($type -in "date", "dateTime") {
            # Invoke-MgGraphRequest hands a date back as a [datetime], not the
            # ISO string Graph sent. Compare the instant in UTC.
            $gotIso = if ($got -is [datetime]) { $got.ToUniversalTime().ToString("yyyy-MM-ddTHH:mm") } else { "$got".Substring(0, [Math]::Min(16, "$got".Length)) }
            if ($gotIso -ne $want.Substring(0, 16)) { $bad += "$k = '$got' (wrote '$want')" }
        }
        elseif ($type -eq "number") { if ([double]$got -ne [double]$want) { $bad += "$k = '$got' (wrote '$want')" } }
        elseif ($type -eq "note") { if (("$got" -replace "`r", "") -ne $want) { $bad += "$k = '$got'" } }
        elseif ("$got" -ne "$want") { $bad += "$k = '$got' (wrote '$want')" }
    }
    Invoke-MgGraphRequest -Method DELETE -Uri "$graph/lists/$listId/items/$($row.id)" | Out-Null
    if ($bad) {
        Write-Host "  These did NOT read back as written - fix before migrating:" -ForegroundColor Red
        $bad | ForEach-Object { Write-Host "    $_" -ForegroundColor Red }
    } else {
        Write-Host "  All $($fields.Count) columns wrote and read back correctly (test row deleted)." -ForegroundColor Green
    }
}

Write-Host "`n=== Next ===" -ForegroundColor Cyan
if ($listId) { Write-Host "  New list id: $listId" -ForegroundColor Green }
Write-Host "  Copy the ARC-era rows across with scripts/migrate-qc-cpu95-to-pmo.ps1" -ForegroundColor Gray
Write-Host "  (report first, then -Since <date> -Apply). ARC keeps reading the old list" -ForegroundColor Gray
Write-Host "  until VITE_SP_QC_CPU95_LIST_ID is pointed at the new one." -ForegroundColor Gray
