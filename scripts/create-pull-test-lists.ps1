<#
.SYNOPSIS
    Creates the Pull Test lists on Altronic_PMO (BusinessIT#64, Harness):
    "Pull Test Specs" and "Pull Tests", and adds the "Pull test failed" alert
    to the existing "Harness Alert Recipients" list. Idempotent; -WhatIf
    reports only.

.DESCRIPTION
    Pull tests on the Mark-10 WT-205 wire crimp pull tester - for the machined
    pins (DriveCOM) that crimp height can't judge, and stamped terminals too.

      Pull Test Specs   Title (shown "Terminal", may be blank for an
                        industry-standard row that covers any terminal),
                        ManufacturerPartNumber, WireGauge, MinimumForce,
                        ForceUnit (lbF/N/kgF/ozF/kN), SpecSource
                        (Manufacturer / Industry standard), SpecReference,
                        Notes, Active
      Pull Tests        Title (app-derived), TestedAt, CheckPoint, ClockNumber,
                        SpecRef (LOOKUP -> Pull Test Specs), SpecTerminal,
                        Terminal, WireGauge, Applicator, MinimumForce,
                        SpecUnit, SpecReference (copied from the spec),
                        ForceUnit (the readings' unit), Pull1-Pull5,
                        LowestPull, Failed, ReadingSource (Tester / Typed /
                        Mixed), HowFailed, HarnessOrAssembly, WorkOrder, Notes

    The internal names are the contract with src/lib/pullTestMapper.ts.
    ForceUnit, CheckPoint, SpecSource and ReadingSource choices are
    src/types/pullTest.ts's constants, and the Alert choices are
    src/types/harness.ts HARNESS_ALERTS - change both together.

    Five things are load-bearing:

    - TestedAt is INDEXED. ARC reads the log one year at a time, and past
      5,000 rows SharePoint refuses a $filter on an unindexed column.
    - SpecRef is a SINGLE lookup: Graph returns a bare SpecRefLookupId and ARC
      writes a bare integer.
    - Five pull columns, though a test needs three today: how many pulls per
      setup is still being decided, and raising it is then a constant in ARC,
      not a list change.
    - The Harness Alert Recipients Alert column is a strict choice, so "Pull
      test failed" must be ADDED to it before anyone can be picked for it.
    - Every column is then WRITTEN AND READ BACK with a throwaway row (and the
      row deleted). A 2xx from a write is not evidence the value landed.

    RUN IN YOUR OWN TERMINAL - the sign-in is interactive.

.EXAMPLE
    .\create-pull-test-lists.ps1 -WhatIf
    .\create-pull-test-lists.ps1
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
$SPECS_NAME = "Pull Test Specs"
$TESTS_NAME = "Pull Tests"
$RECIPIENTS_NAME = "Harness Alert Recipients"

$FORCE_UNITS = @("lbF", "N", "kgF", "ozF", "kN")
$HARNESS_ALERTS = @("Crimp out of spec", "Pull test failed", "Part number request")

$plainNote = @{ allowMultipleLines = $true; appendChangesToExistingText = $false; linesForEditing = 3; textType = "plain" }
$force = @{ decimalPlaces = "automatic" }
$strict = { param($choices) @{ allowTextEntry = $false; displayAs = "dropDownMenu"; choices = $choices } }

$specColumns = @(
    @{ name = "ManufacturerPartNumber"; displayName = "Manufacturer Part #"; text = @{} },
    @{ name = "WireGauge"; displayName = "Wire Gauge (AWG)"; text = @{}
       description = "Text, not a number - some terminals take '0.5 mm2 or 20'." },
    @{ name = "MinimumForce"; displayName = "Minimum Pull Force"; number = $force
       description = "The least force a good crimp holds, in Force Unit. Blank until known; tests against it can't be judged." },
    @{ name = "ForceUnit"; displayName = "Force Unit"; choice = (& $strict $FORCE_UNITS) },
    @{ name = "SpecSource"; displayName = "Source"; choice = (& $strict @("Manufacturer", "Industry standard")) },
    @{ name = "SpecReference"; displayName = "Reference"; text = @{}
       description = "Where the minimum comes from - e.g. IPC/WHMA-A-620 Table 19-1, or a datasheet number." },
    @{ name = "Notes"; displayName = "Notes"; text = $plainNote },
    @{ name = "Active"; displayName = "Active"; boolean = @{}
       description = "Untick to retire a spec. It stops being offered for new tests; tests already using it keep it." }
)

function Get-TestColumns($specsListId) {
    $cols = @(
        @{ name = "TestedAt"; displayName = "Tested At"; indexed = $true
           dateTime = @{ format = "dateTime"; displayAs = "standard" } },
        @{ name = "CheckPoint"; displayName = "Test"; choice = (& $strict @("Start", "In process", "End")) },
        @{ name = "ClockNumber"; displayName = "Clock #"; text = @{} },
        @{ name = "SpecRef"; displayName = "Spec"; lookup = @{ listId = $specsListId; columnName = "Title" } },
        @{ name = "SpecTerminal"; displayName = "Spec Terminal"; text = @{}
           description = "Copied from the spec when the test is saved, like the spec columns after it. Blank = any terminal." },
        @{ name = "Terminal"; displayName = "Terminal Pulled"; text = @{} },
        @{ name = "WireGauge"; displayName = "Wire Gauge"; text = @{} },
        @{ name = "Applicator"; displayName = "Applicator or Crimp Tool"; text = @{} },
        @{ name = "MinimumForce"; displayName = "Spec Minimum"; number = $force },
        @{ name = "SpecUnit"; displayName = "Spec Unit"; choice = (& $strict $FORCE_UNITS) },
        @{ name = "SpecReference"; displayName = "Spec Reference"; text = @{} },
        @{ name = "ForceUnit"; displayName = "Pull Unit"; choice = (& $strict $FORCE_UNITS)
           description = "The unit the pulls are in - what the tester sent, or was picked when typing." }
    )
    foreach ($i in 1..5) { $cols += @{ name = "Pull$i"; displayName = "Pull $i"; number = $force } }
    $cols += @(
        @{ name = "LowestPull"; displayName = "Lowest Pull"; number = $force },
        @{ name = "Failed"; displayName = "Failed"; boolean = @{}
           description = "Any pull below the minimum. Set by ARC on every save." },
        @{ name = "ReadingSource"; displayName = "Read By"; choice = (& $strict @("Tester", "Typed", "Mixed")) },
        @{ name = "HowFailed"; displayName = "How It Failed"; text = @{} },
        @{ name = "HarnessOrAssembly"; displayName = "Harness or Assembly"; text = @{} },
        @{ name = "WorkOrder"; displayName = "Work Order"; text = @{} },
        @{ name = "Notes"; displayName = "Notes"; text = $plainNote }
    )
    return $cols
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
    # NOT required: an industry-standard spec covers any terminal on a gauge.
    Set-TitleColumn $specsId "Terminal" $true $false
}

Write-Host "`n=== $TESTS_NAME ===" -ForegroundColor Cyan
$testsId = $null
if (-not $specsId) {
    Write-Host "  WOULD CREATE  $TESTS_NAME once the specs list exists (its SpecRef lookup needs the id)" -ForegroundColor Cyan
} else {
    $testColumns = Get-TestColumns $specsId
    $testsId = Ensure-List $TESTS_NAME $testColumns
    if ($testsId) {
        Ensure-Columns $testsId $TESTS_NAME $testColumns
        # App-derived ("504041 / 18 AWG / Start"), so nobody has to type it.
        Set-TitleColumn $testsId "Test" $false $false
    }
}

# --- the "Pull test failed" alert on Harness Alert Recipients ---------------
Write-Host "`n=== $RECIPIENTS_NAME ===" -ForegroundColor Cyan
$recipientsId = $found[$RECIPIENTS_NAME]
if (-not $recipientsId) {
    Write-Host "  MISSING  $RECIPIENTS_NAME - run scripts/create-crimp-lists.ps1 first; nobody can be emailed about a failed pull until it exists." -ForegroundColor Red
} else {
    $alert = (Invoke-MgGraphRequest -Method GET -Uri "$graph/lists/$recipientsId/columns").value |
        Where-Object { $_["name"] -eq "Alert" }
    $have = @($alert["choice"]["choices"])
    $missing = $HARNESS_ALERTS | Where-Object { $have -notcontains $_ }
    if (-not $missing) {
        Write-Host "  Alert already offers: $($have -join ', ')" -ForegroundColor Yellow
    } elseif ($WhatIf) {
        Write-Host "  WOULD ADD Alert choice(s): $($missing -join ', ')" -ForegroundColor Cyan
    } else {
        # Keep any choice someone added by hand, then ARC's in ARC's order.
        $choices = @($HARNESS_ALERTS) + @($have | Where-Object { $HARNESS_ALERTS -notcontains $_ })
        $body = @{ choice = @{ allowTextEntry = $false; displayAs = "dropDownMenu"; choices = $choices } } | ConvertTo-Json -Depth 4
        Invoke-MgGraphRequest -Method PATCH -Uri "$graph/lists/$recipientsId/columns/$($alert["id"])" `
            -Body $body -ContentType "application/json" | Out-Null
        $back = (Invoke-MgGraphRequest -Method GET -Uri "$graph/lists/$recipientsId/columns/$($alert["id"])")["choice"]["choices"]
        if ($back -contains "Pull test failed") {
            Write-Host "  Alert now offers: $($back -join ', ')" -ForegroundColor Green
        } else {
            Write-Host "  The Alert column did NOT take the new choice - add 'Pull test failed' in List settings." -ForegroundColor Red
        }
    }
}

# --- write and read back every column ---------------------------------------
if (-not $WhatIf -and $specsId -and $testsId) {
    Write-Host "`n=== Write/read-back check ===" -ForegroundColor Cyan
    $specFields = @{
        Title = "ARC-VERIFY"; ManufacturerPartNumber = "verify"; WireGauge = "0.5 mm2 or 20"; MinimumForce = 12.5
        ForceUnit = "N"; SpecSource = "Industry standard"; SpecReference = "verify ref"; Notes = "verify"; Active = $false
    }
    $spec = Invoke-MgGraphRequest -Method POST -Uri "$graph/lists/$specsId/items" -ContentType "application/json" `
        -Body (@{ fields = $specFields } | ConvertTo-Json -Depth 4)
    $testFields = @{
        Title = "ARC-VERIFY"; TestedAt = "2026-01-15T14:30:00Z"; CheckPoint = "In process"; ClockNumber = "999"
        SpecRefLookupId = [int]$spec.id; SpecTerminal = ""; Terminal = "ARC-VERIFY"; WireGauge = "18"
        Applicator = "VERIFY"; MinimumForce = 12.5; SpecUnit = "N"; SpecReference = "verify ref"; ForceUnit = "lbF"
        Pull1 = 24.8; Pull2 = 2.4; Pull3 = 30.15; Pull4 = 22; Pull5 = 19.9; LowestPull = 2.4; Failed = $true
        ReadingSource = "Mixed"; HowFailed = "verify"; HarnessOrAssembly = "verify"; WorkOrder = "1000209528"; Notes = "verify"
    }
    $row = Invoke-MgGraphRequest -Method POST -Uri "$graph/lists/$testsId/items" -ContentType "application/json" `
        -Body (@{ fields = $testFields } | ConvertTo-Json -Depth 4)
    $back = Invoke-MgGraphRequest -Method GET -Uri "$graph/lists/$testsId/items/$($row.id)?`$expand=fields"
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
    foreach ($k in $testFields.Keys) {
        $got = $back.fields[$k]
        if ($k -eq "CheckedAt" -or $k -eq "TestedAt") {
            $iso = if ($got -is [datetime]) { $got.ToUniversalTime().ToString("yyyy-MM-ddTHH:mm") } else { "$got".Substring(0, 16) }
            if ($iso -ne "2026-01-15T14:30") { $bad += "TestedAt = '$got'" }
            continue
        }
        # An empty text column comes back absent, not "".
        if ($testFields[$k] -eq "" -and $null -eq $got) { continue }
        $problem = Compare-Field $k $testFields[$k] $got
        if ($problem) { $bad += $problem }
    }
    foreach ($k in $specFields.Keys) {
        $problem = Compare-Field "specs $k" $specFields[$k] $specBack.fields[$k]
        if ($problem) { $bad += $problem }
    }
    Invoke-MgGraphRequest -Method DELETE -Uri "$graph/lists/$testsId/items/$($row.id)" | Out-Null
    Invoke-MgGraphRequest -Method DELETE -Uri "$graph/lists/$specsId/items/$($spec.id)" | Out-Null
    if ($bad) {
        Write-Host "  These did NOT read back as written - fix before using ARC:" -ForegroundColor Red
        $bad | ForEach-Object { Write-Host "    $_" -ForegroundColor Red }
    } else {
        Write-Host "  Every column wrote and read back correctly (test rows deleted)." -ForegroundColor Green
    }
}

Write-Host "`n=== Next ===" -ForegroundColor Cyan
if ($specsId) { Write-Host "  VITE_SP_PULL_TEST_SPECS_LIST_ID = $specsId" -ForegroundColor Green }
if ($testsId) { Write-Host "  VITE_SP_PULL_TESTS_LIST_ID = $testsId" -ForegroundColor Green }
Write-Host "  Set both as repo variables and redeploy, add the specs in ARC" -ForegroundColor Gray
Write-Host "  (Harness > Pull Tests > Specs), and pick who is emailed about a failed" -ForegroundColor Gray
Write-Host "  pull in Harness > Pull Tests > Who's notified." -ForegroundColor Gray
