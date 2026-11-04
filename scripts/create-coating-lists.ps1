<#
.SYNOPSIS
    Creates the Conformal Coating Thickness Checks lists on Altronic_PMO
    (BusinessIT#60, Operations): "Coating Specs", "Coating Checks" and
    "Operations Alert Recipients". Idempotent; -WhatIf reports only.

.DESCRIPTION
    At the start of each shift an operator measures an uncoated board three
    times and a coated board three times, in mm (the default) or inches. ARC
    works the coating thickness out and judges it against the spec's min / max
    in the SPEC'S unit (a spec is entered in mm or inches); inches and mils are
    stored beside the mm figure.

    RE-RUN after the 2026-11-04 spec-unit change: it adds SpecUnit (both lists)
    and ThicknessIn (checks). ARC selects them, and selecting a column a list
    hasn't got fails the whole read.

      Coating Specs     Title (shown "Spec"), MinMm, MaxMm (always stored in mm),
                        SpecUnit (choice: mm / in - the unit they were entered
                        in, and so the unit a check is judged in),
                        CoatedSides (1 or 2), Notes, Active
      Coating Checks    Title (app-derived), MeasuredAt, Machine, Operator,
                        Unit (choice: mm / in), SpecRef (LOOKUP -> Coating Specs),
                        SpecName, MinMm, MaxMm, SpecUnit, CoatedSides (copied
                        from the spec), Uncoated1-3, Coated1-3, UncoatedAverage,
                        CoatedAverage, ThicknessMm, ThicknessIn, ThicknessMils,
                        OutOfSpec, Notes
      Operations Alert Recipients
                        Title (shown "Name"), Email, Alert (choice:
                        "Coating out of spec") - one row per person per alert,
                        managed in ARC at /operations/alert-recipients

    The internal names are the contract with src/lib/coatingMapper.ts.

    Four things are load-bearing:

    - MeasuredAt is INDEXED. ARC reads the log one year at a time, and past
      5,000 rows SharePoint refuses a $filter on an unindexed column.
    - SpecRef is a SINGLE lookup: Graph returns a bare SpecRefLookupId and ARC
      writes a bare integer.
    - Unit's, SpecUnit's and Alert's choices are src/types/coating.ts COATING_UNITS and
      src/types/operationsAlerts.ts OPERATIONS_ALERTS. allowTextEntry is off,
      so change both together.
    - Every column is then WRITTEN AND READ BACK with a throwaway row (and the
      row deleted). A 2xx from a write is not evidence the value landed.

    RUN IN YOUR OWN TERMINAL - the sign-in is interactive.

.EXAMPLE
    .\create-coating-lists.ps1 -WhatIf
    .\create-coating-lists.ps1
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
$SPECS_NAME = "Coating Specs"
$CHECKS_NAME = "Coating Checks"
$RECIPIENTS_NAME = "Operations Alert Recipients"

$plainNote = @{ allowMultipleLines = $true; appendChangesToExistingText = $false; linesForEditing = 3; textType = "plain" }
$decimal = @{ decimalPlaces = "automatic" }

$specColumns = @(
    @{ name = "MinMm"; displayName = "Minimum (mm)"; number = $decimal
       description = "Lowest acceptable coating thickness, in millimetres." },
    @{ name = "MaxMm"; displayName = "Maximum (mm)"; number = $decimal
       description = "Highest acceptable coating thickness, in millimetres." },
    @{ name = "SpecUnit"; displayName = "Limits Entered In"; defaultValue = @{ value = "mm" }
       choice = @{ allowTextEntry = $false; displayAs = "dropDownMenu"; choices = @("mm", "in") }
       description = "The unit the limits were typed in. Checks are judged in this unit; MinMm / MaxMm are always mm." },
    @{ name = "CoatedSides"; displayName = "Coated Sides"; number = @{ decimalPlaces = "none"; minimum = 1; maximum = 2 }
       description = "1 or 2. The coated-minus-uncoated difference is divided by this." },
    @{ name = "Notes"; displayName = "Notes"; text = $plainNote },
    @{ name = "Active"; displayName = "Active"; boolean = @{}
       description = "Untick to retire a spec. It stops being offered for new checks; checks already using it keep it." }
)

$recipientColumns = @(
    @{ name = "Email"; displayName = "Email"; text = @{} },
    @{ name = "Alert"; displayName = "Alert"
       choice = @{ allowTextEntry = $false; displayAs = "dropDownMenu"; choices = @("Coating out of spec") } }
)

function Get-CheckColumns($specsListId) {
    @(
        @{ name = "MeasuredAt"; displayName = "Measured At"; indexed = $true
           dateTime = @{ format = "dateTime"; displayAs = "standard" } },
        @{ name = "Machine"; displayName = "Machine"; text = @{} },
        @{ name = "Operator"; displayName = "Operator"; text = @{} },
        @{ name = "Unit"; displayName = "Measured In"; defaultValue = @{ value = "mm" }
           choice = @{ allowTextEntry = $false; displayAs = "dropDownMenu"; choices = @("mm", "in") } },
        @{ name = "SpecRef"; displayName = "Spec"
           lookup = @{ listId = $specsListId; columnName = "Title" } },
        @{ name = "SpecName"; displayName = "Spec Name"; text = @{}
           description = "Copied from the spec when the check is saved, like the three columns after it." },
        @{ name = "MinMm"; displayName = "Spec Minimum (mm)"; number = $decimal },
        @{ name = "MaxMm"; displayName = "Spec Maximum (mm)"; number = $decimal },
        @{ name = "SpecUnit"; displayName = "Spec Entered In"
           choice = @{ allowTextEntry = $false; displayAs = "dropDownMenu"; choices = @("mm", "in") } },
        @{ name = "CoatedSides"; displayName = "Coated Sides"; number = @{ decimalPlaces = "none" } },
        @{ name = "Uncoated1"; displayName = "Uncoated 1"; number = $decimal },
        @{ name = "Uncoated2"; displayName = "Uncoated 2"; number = $decimal },
        @{ name = "Uncoated3"; displayName = "Uncoated 3"; number = $decimal },
        @{ name = "Coated1"; displayName = "Coated 1"; number = $decimal },
        @{ name = "Coated2"; displayName = "Coated 2"; number = $decimal },
        @{ name = "Coated3"; displayName = "Coated 3"; number = $decimal },
        @{ name = "UncoatedAverage"; displayName = "Uncoated Average"; number = $decimal },
        @{ name = "CoatedAverage"; displayName = "Coated Average"; number = $decimal },
        @{ name = "ThicknessMm"; displayName = "Coating Thickness (mm)"; number = $decimal
           description = "Set by ARC on every save. Judged in the spec's unit." },
        @{ name = "ThicknessIn"; displayName = "Coating Thickness (in)"; number = $decimal
           description = "The same thickness in inches. Set by ARC on every save." },
        @{ name = "ThicknessMils"; displayName = "Coating Thickness (mils, ref)"; number = $decimal
           description = "The same thickness in mils, for reference. Never judged." },
        @{ name = "OutOfSpec"; displayName = "Out of Spec"; boolean = @{}
           description = "Thickness outside the spec's min / max. Set by ARC on every save." },
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
    Set-TitleColumn $specsId "Spec" $false $true
}

Write-Host "`n=== $CHECKS_NAME ===" -ForegroundColor Cyan
$checksId = $null
if (-not $specsId) {
    Write-Host "  WOULD CREATE  $CHECKS_NAME once the specs list exists (its SpecRef lookup needs the id)" -ForegroundColor Cyan
} else {
    $checkColumns = Get-CheckColumns $specsId
    $checksId = Ensure-List $CHECKS_NAME $checkColumns
    if ($checksId) {
        Ensure-Columns $checksId $CHECKS_NAME $checkColumns
        # App-derived ("SPRAY-1 / Acrylic / 2026-11-04"), so nobody has to type it.
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
    $specFields = @{ Title = "ARC-VERIFY"; MinMm = 0.0254; MaxMm = 0.0762; SpecUnit = "in"; CoatedSides = 2; Notes = "verify"; Active = $false }
    $spec = Invoke-MgGraphRequest -Method POST -Uri "$graph/lists/$specsId/items" -ContentType "application/json" `
        -Body (@{ fields = $specFields } | ConvertTo-Json -Depth 4)
    $checkFields = @{
        Title = "ARC-VERIFY"; MeasuredAt = "2026-01-15T14:30:00Z"; Machine = "VERIFY"; Operator = "verify"; Unit = "in"
        SpecRefLookupId = [int]$spec.id; SpecName = "ARC-VERIFY"; MinMm = 0.0254; MaxMm = 0.0762; SpecUnit = "in"; CoatedSides = 2
        Uncoated1 = 0.062; Uncoated2 = 0.0622; Uncoated3 = 0.0621; Coated1 = 0.0661; Coated2 = 0.0662; Coated3 = 0.066
        UncoatedAverage = 0.0621; CoatedAverage = 0.0661; ThicknessMm = 0.0508; ThicknessIn = 0.002; ThicknessMils = 2; OutOfSpec = $false
        Notes = "verify"
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
        if ($k -eq "MeasuredAt") {
            # Invoke-MgGraphRequest hands a date back as a [datetime].
            $iso = if ($got -is [datetime]) { $got.ToUniversalTime().ToString("yyyy-MM-ddTHH:mm") } else { "$got".Substring(0, 16) }
            if ($iso -ne "2026-01-15T14:30") { $bad += "MeasuredAt = '$got'" }
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
        $recipientFields = @{ Title = "ARC-VERIFY"; Email = "verify@example.com"; Alert = "Coating out of spec" }
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
if ($specsId)  { Write-Host "  VITE_SP_COATING_SPECS_LIST_ID = $specsId" -ForegroundColor Green }
if ($checksId) { Write-Host "  VITE_SP_COATING_CHECKS_LIST_ID = $checksId" -ForegroundColor Green }
if ($recipientsId) { Write-Host "  VITE_SP_OPERATIONS_ALERT_RECIPIENTS_LIST_ID = $recipientsId" -ForegroundColor Green }
Write-Host "  Set all three as repo variables and redeploy, then in ARC add a spec" -ForegroundColor Gray
Write-Host "  (Operations > Conformal Coating Checks > Specs) and pick who is emailed" -ForegroundColor Gray
Write-Host "  (Who's notified)." -ForegroundColor Gray
