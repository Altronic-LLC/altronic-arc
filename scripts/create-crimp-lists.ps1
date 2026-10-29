<#
.SYNOPSIS
    Creates the Harness department's lists on Altronic_PMO: "Crimp Specs",
    "Crimp Height Checks" (BusinessIT#55) and "Harness Alert Recipients".
    Idempotent; -WhatIf reports only.

.DESCRIPTION
    Replaces the paper Terminal Crimp Verification Chart (MFGFRM 002 REV 0):

      Crimp Specs           Title (shown "Terminal"), ManufacturerPartNumber,
                            Applicator, WireGauge, TableHeight, WireSetting,
                            InsulationSetting, CrimpHeight, Tolerance, Notes, Active
      Crimp Height Checks   Title (app-derived), CheckedAt, CheckPoint,
                            ClockNumber, SpecRef (LOOKUP -> Crimp Specs),
                            Terminal, WireGauge, Applicator, CrimpHeight,
                            Tolerance (copied from the spec), Reading1-3,
                            Average, OutOfSpec, ApplicatorChange,
                            VerifierClock, HarnessOrAssembly, WorkOrder, Notes
      Harness Alert Recipients
                            Title (shown "Name"), Email, Alert (choice:
                            "Crimp out of spec" / "Part number request") -
                            one row per person per alert, managed in ARC at
                            /harness/alert-recipients, so changing who is
                            emailed needs no redeploy

    The internal names are the contract with src/lib/crimpMapper.ts.

    Four things are load-bearing:

    - CheckedAt is INDEXED. ARC reads the log one year at a time, and past
      5,000 rows SharePoint refuses a $filter on an unindexed column.
    - SpecRef is a SINGLE lookup: Graph returns a bare SpecRefLookupId and ARC
      writes a bare integer.
    - WireGauge and the three settings are TEXT. The spec sheet has
      "0.5 mm2 or 20" and "E-1".
    - Every column is then WRITTEN AND READ BACK with a throwaway row (and the
      row deleted). A 2xx from a write is not evidence the value landed.

    RUN IN YOUR OWN TERMINAL - the sign-in is interactive.

.EXAMPLE
    .\create-crimp-lists.ps1 -WhatIf
    .\create-crimp-lists.ps1
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
$SPECS_NAME = "Crimp Specs"
$CHECKS_NAME = "Crimp Height Checks"
$RECIPIENTS_NAME = "Harness Alert Recipients"

$plainNote = @{ allowMultipleLines = $true; appendChangesToExistingText = $false; linesForEditing = 3; textType = "plain" }
$inches = @{ decimalPlaces = "automatic" }

$specColumns = @(
    @{ name = "ManufacturerPartNumber"; displayName = "Manufacturer Part #"; text = @{} },
    @{ name = "Applicator"; displayName = "Applicator S/N or Colour"; text = @{} },
    @{ name = "WireGauge"; displayName = "Wire Gauge (AWG)"; text = @{}
       description = "Text, not a number - some terminals take '0.5 mm2 or 20'." },
    @{ name = "TableHeight"; displayName = "Table Height"; text = @{} },
    @{ name = "WireSetting"; displayName = "Wire Setting"; text = @{} },
    @{ name = "InsulationSetting"; displayName = "Insulation Setting"; text = @{} },
    @{ name = "CrimpHeight"; displayName = "Crimp Height (in)"; number = $inches
       description = "Nominal crimp height in inches. Blank until measured; checks against it can't be judged." },
    @{ name = "Tolerance"; displayName = "Tolerance (+/- in)"; number = $inches },
    @{ name = "Notes"; displayName = "Notes"; text = $plainNote },
    @{ name = "Active"; displayName = "Active"; boolean = @{}
       description = "Untick to retire a spec. It stops being offered for new checks; checks already using it keep it." }
)

# The Alert choices are src/types/harness.ts HARNESS_ALERTS - change both together.
$recipientColumns = @(
    @{ name = "Email"; displayName = "Email"; text = @{} },
    @{ name = "Alert"; displayName = "Alert"
       choice = @{ allowTextEntry = $false; displayAs = "dropDownMenu"; choices = @("Crimp out of spec", "Part number request") } }
)

function Get-CheckColumns($specsListId) {
    @(
        @{ name = "CheckedAt"; displayName = "Checked At"; indexed = $true
           dateTime = @{ format = "dateTime"; displayAs = "standard" } },
        @{ name = "CheckPoint"; displayName = "Check"
           choice = @{ allowTextEntry = $false; displayAs = "dropDownMenu"; choices = @("Start", "In process", "End") } },
        @{ name = "ClockNumber"; displayName = "Clock #"; text = @{} },
        @{ name = "SpecRef"; displayName = "Spec"
           lookup = @{ listId = $specsListId; columnName = "Title" } },
        @{ name = "Terminal"; displayName = "Terminal"; text = @{}
           description = "Copied from the spec when the check is saved, like the four columns after it." },
        @{ name = "WireGauge"; displayName = "Wire Gauge"; text = @{} },
        @{ name = "Applicator"; displayName = "Applicator"; text = @{} },
        @{ name = "CrimpHeight"; displayName = "Spec Crimp Height (in)"; number = $inches },
        @{ name = "Tolerance"; displayName = "Spec Tolerance (+/- in)"; number = $inches },
        @{ name = "Reading1"; displayName = "Reading 1"; number = $inches },
        @{ name = "Reading2"; displayName = "Reading 2"; number = $inches },
        @{ name = "Reading3"; displayName = "Reading 3"; number = $inches },
        @{ name = "Average"; displayName = "Average"; number = $inches },
        @{ name = "OutOfSpec"; displayName = "Out of Spec"; boolean = @{}
           description = "Any reading outside the spec. Set by ARC on every save." },
        @{ name = "ApplicatorChange"; displayName = "Any Change to Applicator"; text = @{} },
        @{ name = "VerifierClock"; displayName = "Verifier's Clock #"; text = @{} },
        @{ name = "HarnessOrAssembly"; displayName = "Harness or Assembly"; text = @{} },
        @{ name = "WorkOrder"; displayName = "Work Order"; text = @{} },
        @{ name = "Notes"; displayName = "Notes"; text = $plainNote }
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

Write-Host "`n=== $SPECS_NAME ===" -ForegroundColor Cyan
$specsId = Ensure-List $SPECS_NAME $specColumns
if ($specsId) {
    Ensure-Columns $specsId $SPECS_NAME $specColumns
    Set-TitleColumn $specsId "Terminal" $true $true
}

Write-Host "`n=== $CHECKS_NAME ===" -ForegroundColor Cyan
if (-not $specsId) {
    Write-Host "  WOULD CREATE  $CHECKS_NAME once the specs list exists (its SpecRef lookup needs the id)" -ForegroundColor Cyan
} else {
    $checkColumns = Get-CheckColumns $specsId
    $checksId = Ensure-List $CHECKS_NAME $checkColumns
    if ($checksId) {
        Ensure-Columns $checksId $CHECKS_NAME $checkColumns
        # App-derived ("504041 / 14 AWG / Start"), so nobody has to type it.
        Set-TitleColumn $checksId "Check" $false $false
    }
}

Write-Host "`n=== $RECIPIENTS_NAME ===" -ForegroundColor Cyan
$recipientsId = Ensure-List $RECIPIENTS_NAME $recipientColumns
if ($recipientsId) {
    Ensure-Columns $recipientsId $RECIPIENTS_NAME $recipientColumns
    Set-TitleColumn $recipientsId "Name" $false $true
}

# --- write and read back every column ---------------------------------------
if (-not $WhatIf -and $specsId -and $checksId) {
    Write-Host "`n=== Write/read-back check ===" -ForegroundColor Cyan
    $specFields = @{
        Title = "ARC-VERIFY"; ManufacturerPartNumber = "verify"; Applicator = "VERIFY"; WireGauge = "0.5 mm2 or 20"
        TableHeight = "0.15"; WireSetting = "E-1"; InsulationSetting = "1.2"; CrimpHeight = 0.0405; Tolerance = 0.002
        Notes = "verify"; Active = $false
    }
    $spec = Invoke-MgGraphRequest -Method POST -Uri "$graph/lists/$specsId/items" -ContentType "application/json" `
        -Body (@{ fields = $specFields } | ConvertTo-Json -Depth 4)
    $checkFields = @{
        Title = "ARC-VERIFY"; CheckedAt = "2026-01-15T14:30:00Z"; CheckPoint = "In process"; ClockNumber = "999"
        SpecRefLookupId = [int]$spec.id; Terminal = "ARC-VERIFY"; WireGauge = "18"; Applicator = "VERIFY"
        CrimpHeight = 0.0405; Tolerance = 0.002; Reading1 = 0.0386; Reading2 = 0.039; Reading3 = 0.0425
        Average = 0.03987; OutOfSpec = $true; ApplicatorChange = "verify"; VerifierClock = "998"
        HarnessOrAssembly = "verify"; WorkOrder = "1000209528"; Notes = "verify"
    }
    $row = Invoke-MgGraphRequest -Method POST -Uri "$graph/lists/$checksId/items" -ContentType "application/json" `
        -Body (@{ fields = $checkFields } | ConvertTo-Json -Depth 4)
    $back = Invoke-MgGraphRequest -Method GET -Uri "$graph/lists/$checksId/items/$($row.id)?`$expand=fields"
    $specBack = Invoke-MgGraphRequest -Method GET -Uri "$graph/lists/$specsId/items/$($spec.id)?`$expand=fields"
    $bad = @()
    function Compare-Field($label, $wrote, $got) {
        if ($wrote -is [double] -or $wrote -is [int]) {
            if ([Math]::Abs([double]$got - [double]$wrote) -gt 1e-9) { return "$label = '$got' (wrote '$wrote')" }
        } elseif ($wrote -is [bool]) {
            if ([bool]$got -ne $wrote) { return "$label = '$got' (wrote '$wrote')" }
        } elseif ("$got" -ne "$wrote") { return "$label = '$got' (wrote '$wrote')" }
        return $null
    }
    foreach ($k in $checkFields.Keys) {
        $got = $back.fields[$k]
        if ($k -eq "CheckedAt") {
            # Invoke-MgGraphRequest hands a date back as a [datetime].
            $iso = if ($got -is [datetime]) { $got.ToUniversalTime().ToString("yyyy-MM-ddTHH:mm") } else { "$got".Substring(0, 16) }
            if ($iso -ne "2026-01-15T14:30") { $bad += "CheckedAt = '$got'" }
            continue
        }
        $problem = Compare-Field $k $checkFields[$k] $got
        if ($problem) { $bad += $problem }
    }
    foreach ($k in $specFields.Keys) {
        $problem = Compare-Field "specs $k" $specFields[$k] $specBack.fields[$k]
        if ($problem) { $bad += $problem }
    }
    if ($recipientsId) {
        $recipientFields = @{ Title = "ARC-VERIFY"; Email = "verify@example.com"; Alert = "Part number request" }
        $rec = Invoke-MgGraphRequest -Method POST -Uri "$graph/lists/$recipientsId/items" -ContentType "application/json" `
            -Body (@{ fields = $recipientFields } | ConvertTo-Json -Depth 4)
        $recBack = Invoke-MgGraphRequest -Method GET -Uri "$graph/lists/$recipientsId/items/$($rec.id)?`$expand=fields"
        foreach ($k in $recipientFields.Keys) {
            if ("$($recBack.fields[$k])" -ne $recipientFields[$k]) { $bad += "recipients $k = '$($recBack.fields[$k])'" }
        }
        Invoke-MgGraphRequest -Method DELETE -Uri "$graph/lists/$recipientsId/items/$($rec.id)" | Out-Null
    }
    Invoke-MgGraphRequest -Method DELETE -Uri "$graph/lists/$checksId/items/$($row.id)" | Out-Null
    Invoke-MgGraphRequest -Method DELETE -Uri "$graph/lists/$specsId/items/$($spec.id)" | Out-Null
    if ($bad) {
        Write-Host "  These did NOT read back as written - fix before using ARC:" -ForegroundColor Red
        $bad | ForEach-Object { Write-Host "    $_" -ForegroundColor Red }
    } else {
        Write-Host "  Every column wrote and read back correctly (test rows deleted)." -ForegroundColor Green
    }
}

Write-Host "`n=== Next ===" -ForegroundColor Cyan
if ($specsId)  { Write-Host "  VITE_SP_CRIMP_SPECS_LIST_ID = $specsId" -ForegroundColor Green }
if ($checksId) { Write-Host "  VITE_SP_CRIMP_CHECKS_LIST_ID = $checksId" -ForegroundColor Green }
if ($recipientsId) { Write-Host "  VITE_SP_HARNESS_ALERT_RECIPIENTS_LIST_ID = $recipientsId" -ForegroundColor Green }
Write-Host "  Set all three as repo variables and redeploy, then load the spec sheet with" -ForegroundColor Gray
Write-Host "  scripts/load-crimp-specs.ps1 (report first, then -Apply), and pick who is emailed" -ForegroundColor Gray
Write-Host "  in ARC: Harness > Crimp Height Checks > Who's notified." -ForegroundColor Gray
