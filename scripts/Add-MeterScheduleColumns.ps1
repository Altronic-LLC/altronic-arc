<#
.SYNOPSIS
    Adds the columns an Hourmeter-basis PM schedule actually needs, and offers
    to remove the two redundant AssetTag lookups.

.DESCRIPTION
    `ScheduleBasis` on Scheduled Maintenance now offers Fixed | Floating |
    Hourmeter, and the Equipment List has `CurrentMachineHours`. But a
    Hourmeter schedule still has **no way to say how many hours between
    services, and nowhere to record the reading it was last done at** — so it
    cannot be computed. Discovery on 2026-08-28 confirmed:

      - `FrequencyUnit` offers only Days | Weeks | Months | Years
      - there is no meter column of any kind on Scheduled Maintenance

    This adds the three that close that gap:

      Hours added to FrequencyUnit   so `FrequencyInterval` = 500 + unit Hours
                                     means "every 500 hours", reusing the
                                     interval column rather than inventing a
                                     second one.
      LastCompletedHours (number)    the meter reading when the PM was last
                                     done. Without it there is no baseline and
                                     a meter PM can never come due.
      NextDueHours (number)          app-owned, = LastCompletedHours + interval.
                                     Stored for the same reason NextDueDate is:
                                     it is the only thing that makes a meter
                                     schedule visible to Power Automate.

    It also OPTIONALLY removes the `AssetTag` lookup from both maintenance
    lists — see -RemoveAssetTagLookups.

    Idempotent. Start with -WhatIf. RUN IN YOUR OWN TERMINAL: the sign-in is
    interactive.

.PARAMETER RemoveAssetTagLookups
    DESTRUCTIVE, and off by default.

    `AssetTag` on both maintenance lists is a SECOND WRITABLE lookup into the
    Equipment List, sitting alongside `EquipmentRef`. Nothing stops a work
    order pointing EquipmentRef at one asset and AssetTag at another, and
    whichever a screen happens to read wins — the kind of split that is
    invisible until two reports disagree.

    ARC does not need the column: it already loads the whole Equipment
    register, so it can show `equipment.assetTag` off the EquipmentRef the row
    already has. One source, no drift, no extra column.

    Safe while both lists have 0 rows. Check that before using it.

.EXAMPLE
    .\Add-MeterScheduleColumns.ps1 -WhatIf

.EXAMPLE
    .\Add-MeterScheduleColumns.ps1 -RemoveAssetTagLookups

.NOTES
    NOT DONE HERE: index `NextDueHours` if meter PMs ever grow past a few
    hundred rows, same reasoning as NextDueDate.
#>

[CmdletBinding()]
param(
    [switch]$WhatIf,
    [switch]$DeviceCode,
    [switch]$RemoveAssetTagLookups
)

$ErrorActionPreference = "Stop"
Import-Module Microsoft.Graph.Authentication

$siteId = "coopermachineryservices.sharepoint.com,915a6183-2b71-4dfd-a8b9-181126dfbe78,3eb6cb9c-6535-4c69-a8d7-e90b2f90a9eb"
$LIST_SCHEDULED  = "9179e16d-5cc8-41bd-b085-eccd39293f98"
$LIST_MAINTTASKS = "ff9d837f-227f-4a9b-b534-5fc722ff8c3b"

$FREQUENCY_UNITS = @("Days", "Weeks", "Months", "Years", "Hours")

$newCols = @(
    @{
        name        = "LastCompletedHours"
        displayName = "Last Completed Hours"
        description = "The machine-hour reading when this PM was last carried out. The baseline a Hourmeter schedule counts from - without it the next due reading cannot be worked out."
        number      = @{ decimalPlaces = "automatic"; displayAs = "number" }
    },
    @{
        name        = "NextDueHours"
        displayName = "Next Due Hours"
        description = "The machine-hour reading this PM is next due at. Owned by ARC - do not edit by hand. Stored (not just computed) so SharePoint views and Power Automate can see it, same as Next Due Date."
        number      = @{ decimalPlaces = "automatic"; displayAs = "number" }
    }
)

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

$base = "https://graph.microsoft.com/v1.0/sites/$siteId/lists/$LIST_SCHEDULED/columns"
$existing = (Invoke-MgGraphRequest -Method GET -Uri $base).value
$have = $existing | ForEach-Object { $_["name"] }

Write-Host ""
Write-Host "=== Scheduled Maintenance: meter columns ===" -ForegroundColor Cyan
foreach ($col in $newCols) {
    if ($have -contains $col.name) {
        Write-Host ("  SKIP    {0} - already exists" -f $col.name) -ForegroundColor Yellow
        continue
    }
    if ($WhatIf) {
        Write-Host ("  WOULD CREATE  {0}" -f $col.name) -ForegroundColor Cyan
        continue
    }
    Write-Host ("  CREATE  {0}..." -f $col.name) -ForegroundColor Green
    $created = Invoke-MgGraphRequest -Method POST -Uri $base `
        -Body ($col | ConvertTo-Json -Depth 8) -ContentType "application/json"
    Write-Host ("          internal name '{0}'" -f $created["name"]) -ForegroundColor Green
}

Write-Host ""
Write-Host "=== Scheduled Maintenance: FrequencyUnit gains 'Hours' ===" -ForegroundColor Cyan
$fu = $existing | Where-Object { $_["name"] -eq "FrequencyUnit" }
if (-not $fu) {
    Write-Host "  MISSING FrequencyUnit - expected it to exist. Nothing changed." -ForegroundColor Red
} else {
    $current = @($fu["choice"]["choices"])
    if ($current -contains "Hours") {
        Write-Host "  SKIP    already offers Hours" -ForegroundColor Yellow
    } else {
        Write-Host ("  from: {0}" -f ($current -join ", ")) -ForegroundColor Gray
        Write-Host ("  to  : {0}" -f ($FREQUENCY_UNITS -join ", ")) -ForegroundColor Gray
        if (-not $WhatIf) {
            Invoke-MgGraphRequest -Method PATCH -Uri "$base/$($fu['id'])" `
                -Body (@{ choice = @{ choices = @($FREQUENCY_UNITS) } } | ConvertTo-Json -Depth 5) `
                -ContentType "application/json" | Out-Null
            Write-Host "  UPDATED" -ForegroundColor Green
        } else {
            Write-Host "  WOULD UPDATE" -ForegroundColor Cyan
        }
    }
}

# --- The redundant AssetTag lookups ----------------------------------------
Write-Host ""
Write-Host "=== AssetTag lookups on the two maintenance lists ===" -ForegroundColor Cyan
foreach ($pair in @(
    @{ Label = "Altronic Maintenance Tasks"; Id = $LIST_MAINTTASKS },
    @{ Label = "Scheduled Maintenance";      Id = $LIST_SCHEDULED }
)) {
    $u = "https://graph.microsoft.com/v1.0/sites/$siteId/lists/$($pair.Id)/columns"
    $cols = (Invoke-MgGraphRequest -Method GET -Uri $u).value
    $tag = $cols | Where-Object { $_["name"] -eq "AssetTag" }
    if (-not $tag) { Write-Host ("  {0}: no AssetTag column" -f $pair.Label) -ForegroundColor Gray; continue }

    $ro = $tag["readOnly"]
    if ($ro) {
        Write-Host ("  {0}: AssetTag is READ-ONLY (a projection) - leave it alone." -f $pair.Label) -ForegroundColor Green
        continue
    }

    Write-Host ("  {0}: AssetTag is a SECOND WRITABLE lookup into the Equipment List." -f $pair.Label) -ForegroundColor Red
    if (-not $RemoveAssetTagLookups) {
        Write-Host "     Not removing it (pass -RemoveAssetTagLookups to delete)." -ForegroundColor Yellow
        Write-Host "     ARC will read the tag off EquipmentRef regardless, so the column is unused." -ForegroundColor Yellow
        continue
    }
    if ($WhatIf) {
        Write-Host "     WOULD DELETE AssetTag" -ForegroundColor Magenta
        continue
    }
    Write-Host "     DELETING AssetTag..." -ForegroundColor Magenta
    Invoke-MgGraphRequest -Method DELETE -Uri "$u/$($tag['id'])" | Out-Null
    Write-Host "     deleted" -ForegroundColor Green
}

# --- Verification -----------------------------------------------------------
Write-Host ""
Write-Host "=== Verification ===" -ForegroundColor Cyan
$after = (Invoke-MgGraphRequest -Method GET -Uri $base).value
foreach ($col in $newCols) {
    $found = $after | Where-Object { $_["name"] -eq $col.name }
    if ($found) { Write-Host ("  OK      {0}" -f $col.name) -ForegroundColor Green }
    elseif ($WhatIf) { Write-Host ("  PENDING {0}" -f $col.name) -ForegroundColor Gray }
    else { Write-Host ("  MISSING {0}" -f $col.name) -ForegroundColor Red }
}
$fuAfter = $after | Where-Object { $_["name"] -eq "FrequencyUnit" }
if ($fuAfter) {
    Write-Host ("  FrequencyUnit: {0}" -f (@($fuAfter["choice"]["choices"]) -join ", ")) -ForegroundColor Green
}

Write-Host ""
Write-Host "Then re-run .\scripts\discover-cmms-changes.ps1 to refresh the snapshots." -ForegroundColor Yellow
