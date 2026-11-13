<#
.SYNOPSIS
    Creates (or tops up) one QC form's SharePoint list from its column JSON -
    the one list script for every digitized QC form. Idempotent; -WhatIf
    reports only.

.DESCRIPTION
    Every column comes from the form's column JSON in scripts/data/ (e.g.
    qc-cpu95-columns.json) - the one copy of the list's layout. Add a column
    there, never here, and add its descriptor in the form's src/lib/*Fields.ts;
    the form's test fails until the two agree. A re-run adds whatever columns
    the list is missing and changes nothing that already exists.

    The JSON holds:
    - listName, and checkChoices (Yes / No / N/A).
    - columns: name, displayName, type, and optionally description and indexed.
      Types: title, text, note, number, date (date only), dateTime, check
      (single choice of checkChoices), flag (yes/no).

    One list per form on Altronic_PMO (QC Forms roadmap, decision 2), so each
    form keeps real columns for filtering and reporting.

    Two things are load-bearing:
    - Columns marked indexed (and Title, shown as the title column's
      displayName) are INDEXED, so the list can be filtered past 5,000 rows.
    - Every column is then WRITTEN AND READ BACK with a throwaway row (and the
      row deleted). A 2xx from a write is not evidence the value landed - see
      "A field called DisplayName is silently dropped" in CLAUDE.md.

    The CPU-95 list (QCFRM-012) was the first, built 2026-10-21; its layout
    notes are in qc-cpu95-columns.json and CLAUDE.md.

    RUN IN YOUR OWN TERMINAL - the sign-in is interactive.

.PARAMETER Columns
    The form's column JSON - a path, or a file name in scripts/data/.

.PARAMETER SiteId
    The Graph site id; Altronic_PMO by default.

.EXAMPLE
    .\create-qc-form-list.ps1 -Columns qc-cpu95-columns.json -WhatIf
    .\create-qc-form-list.ps1 -Columns qc-cpu95-columns.json
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Columns,
    [string]$SiteId = "coopermachineryservices.sharepoint.com,915a6183-2b71-4dfd-a8b9-181126dfbe78,3eb6cb9c-6535-4c69-a8d7-e90b2f90a9eb",
    [switch]$WhatIf,
    [switch]$DeviceCode
)

$ErrorActionPreference = "Stop"
Import-Module Microsoft.Graph.Authentication

$graph = "https://graph.microsoft.com/v1.0/sites/$SiteId"

$columnsPath = if (Test-Path $Columns) { $Columns } else { Join-Path $PSScriptRoot "data/$Columns" }
if (-not (Test-Path $columnsPath)) { throw "Column JSON not found: $Columns" }
$spec = Get-Content $columnsPath -Raw -Encoding utf8 | ConvertFrom-Json
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

# Not $columns: PowerShell names ignore case, so that IS the [string]$Columns
# parameter, and assigning the list to it turned it into one string (found
# 2026-10-26, the first run of this generic script: "1 columns plus Title").
$columnDefs = @($spec.columns | Where-Object { $_.type -ne "title" } | ForEach-Object { ConvertTo-ColumnDefinition $_ })
$titleSpec = $spec.columns | Where-Object { $_.type -eq "title" }
Write-Host "$LIST_NAME - $($columnDefs.Count) columns plus Title ('$($titleSpec.displayName)')" -ForegroundColor Cyan

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
    Write-Host "  WOULD CREATE  $LIST_NAME with $($columnDefs.Count) columns" -ForegroundColor Cyan
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
    foreach ($c in $columnDefs) {
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
        Write-Host "  These did NOT read back as written - fix before using the list:" -ForegroundColor Red
        $bad | ForEach-Object { Write-Host "    $_" -ForegroundColor Red }
    } else {
        Write-Host "  All $($fields.Count) columns wrote and read back correctly (test row deleted)." -ForegroundColor Green
    }
}

Write-Host "`n=== Next ===" -ForegroundColor Cyan
if ($listId) { Write-Host "  List id: $listId" -ForegroundColor Green }
Write-Host "  Give the form its list in src/api/qcFormLists.ts (a VITE_SP_*_LIST_ID in" -ForegroundColor Gray
Write-Host "  config.ts, deploy.yml and .env.example), then set the repo variable and redeploy." -ForegroundColor Gray
