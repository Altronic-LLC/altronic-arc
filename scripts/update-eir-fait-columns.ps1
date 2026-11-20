<#
.SYNOPSIS
    SharePoint changes for BusinessIT #73 (FAIT status) and #23 (EIR stock
    and cost), both on Altronic_Engineering.

.DESCRIPTION
    FAIT list:
      - Adds "Pending EIR Review & Response" to the Status choices. The
        column only accepts the values it lists, so ARC can't save the new
        status until this has run. Existing choices are kept as they are.

    EIRs list:
      - Renames the display names of the two existing columns, which now
        hold the stock and cost at the time the EIR was raised:
            CurrentStock         "Current Stock" -> "Initial Stock"
            Current_x0020_Price  "Current Price" -> "Initial Cost"
        The INTERNAL names don't change, so nothing reading them breaks.
      - Adds two text columns for the stock and cost now, updated at any
        time by Supply Chain:
            LatestStock  shown "Current Stock"
            LatestCost   shown "Current Cost"
        Text, like the two existing ones, which hold values such as "$1.84".

    Run it BEFORE the deploy that ships v0.225.0. ARC reads the two new
    columns, and if they're missing it falls back to reading without them,
    but the Current Stock / Current Cost boxes then can't be saved.

    Idempotent: anything already done is reported and skipped. -WhatIf
    reports what it would change and writes nothing.

    RUN THIS IN YOUR OWN TERMINAL - the sign-in is interactive. Pass
    -DeviceCode if the browser popup can't open.
#>

param(
    [switch]$WhatIf,
    [switch]$DeviceCode
)

$ErrorActionPreference = "Stop"
Import-Module Microsoft.Graph.Authentication

$siteId = "coopermachineryservices.sharepoint.com,ddb5fc80-ea51-4d56-b008-ce6a82af49b0,aa6b9467-3f57-4213-bbd4-60b94403421a"
$faitListId = "d655b5d6-ee28-45c4-85ab-128198569508"
$eirListId  = "8d00a762-288c-4678-afc4-cba2f24ac965"

$newFaitStatus = "Pending EIR Review & Response"

$renames = @(
    @{ name = "CurrentStock";        displayName = "Initial Stock" },
    @{ name = "Current_x0020_Price"; displayName = "Initial Cost" }
)
$newEirColumns = @(
    @{
        name        = "LatestStock"
        displayName = "Current Stock"
        description = "Stock now. Updated by Supply Chain at any time; Initial Stock keeps the figure from when the EIR was raised."
        text        = @{ allowMultipleLines = $false; maxLength = 255 }
    },
    @{
        name        = "LatestCost"
        displayName = "Current Cost"
        description = "Cost now. Updated by Supply Chain at any time; Initial Cost keeps the figure from when the EIR was raised."
        text        = @{ allowMultipleLines = $false; maxLength = 255 }
    }
)

$ctx = Get-MgContext
if (-not $ctx -or $ctx.Scopes -notcontains "Sites.Manage.All") {
    Write-Host "Signing in for write access (Sites.Manage.All)..." -ForegroundColor Cyan
    if ($DeviceCode) {
        Connect-MgGraph -Scopes "Sites.Manage.All" -UseDeviceCode -NoWelcome
    } else {
        Connect-MgGraph -Scopes "Sites.Manage.All" -NoWelcome
    }
}

function Get-Columns([string]$listId) {
    (Invoke-MgGraphRequest -Method GET `
        -Uri "https://graph.microsoft.com/v1.0/sites/$siteId/lists/$listId/columns").value
}

function Update-Column([string]$listId, [string]$columnId, [hashtable]$body) {
    Invoke-MgGraphRequest -Method PATCH `
        -Uri "https://graph.microsoft.com/v1.0/sites/$siteId/lists/$listId/columns/$columnId" `
        -Body ($body | ConvertTo-Json -Depth 6) -ContentType "application/json" | Out-Null
}

# ---------------------------------------------------------------------------
# FAIT Status choice
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "=== FAIT: Status choices ===" -ForegroundColor Cyan
$status = Get-Columns $faitListId | Where-Object { $_["name"] -eq "Status" }
if (-not $status -or -not $status.ContainsKey("choice")) {
    throw "The FAIT list has no Status choice column - nothing changed."
}
$choices = @($status["choice"]["choices"])
Write-Host "  now: $($choices -join ' | ')"
if ($choices -contains $newFaitStatus) {
    Write-Host "SKIP   '$newFaitStatus' is already a choice" -ForegroundColor Yellow
} elseif ($WhatIf) {
    Write-Host "WOULD ADD '$newFaitStatus'" -ForegroundColor Cyan
} else {
    $choice = @{
        choices        = @($choices + $newFaitStatus)
        allowTextEntry = [bool]$status["choice"]["allowTextEntry"]
        displayAs      = $status["choice"]["displayAs"]
    }
    Update-Column $faitListId $status["id"] @{ choice = $choice }
    Write-Host "ADDED  '$newFaitStatus'" -ForegroundColor Green
}

# ---------------------------------------------------------------------------
# EIR columns. Rename first, so the new columns' display names don't clash.
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "=== EIRs: stock and cost columns ===" -ForegroundColor Cyan
$eirCols = Get-Columns $eirListId
foreach ($r in $renames) {
    $col = $eirCols | Where-Object { $_["name"] -eq $r.name }
    if (-not $col) { throw "EIRs list has no column '$($r.name)' - nothing renamed." }
    if ($col["displayName"] -eq $r.displayName) {
        Write-Host "SKIP   $($r.name) already shown as '$($r.displayName)'" -ForegroundColor Yellow
    } elseif ($WhatIf) {
        Write-Host "WOULD RENAME $($r.name): '$($col["displayName"])' -> '$($r.displayName)'" -ForegroundColor Cyan
    } else {
        Update-Column $eirListId $col["id"] @{ displayName = $r.displayName }
        Write-Host "RENAMED $($r.name): '$($col["displayName"])' -> '$($r.displayName)'" -ForegroundColor Green
    }
}

$have = $eirCols | ForEach-Object { $_["name"] }
foreach ($c in $newEirColumns) {
    if ($have -contains $c.name) {
        Write-Host "SKIP   $($c.name) - already exists" -ForegroundColor Yellow
        continue
    }
    if ($WhatIf) {
        Write-Host "WOULD CREATE $($c.name) ('$($c.displayName)')" -ForegroundColor Cyan
        continue
    }
    $created = Invoke-MgGraphRequest -Method POST `
        -Uri "https://graph.microsoft.com/v1.0/sites/$siteId/lists/$eirListId/columns" `
        -Body ($c | ConvertTo-Json -Depth 6) -ContentType "application/json"
    if ($created["name"] -ne $c.name) {
        throw "Created '$($c.displayName)' but SharePoint named it '$($created["name"])', not '$($c.name)'. ARC reads '$($c.name)' - fix this before deploying."
    }
    Write-Host "CREATE $($c.name) ('$($c.displayName)')" -ForegroundColor Green
}

if ($WhatIf) { Write-Host ""; Write-Host "WhatIf - nothing written."; return }

# ---------------------------------------------------------------------------
# Read back what the lists say now.
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "=== Verification ===" -ForegroundColor Cyan
$ok = $true
$status = Get-Columns $faitListId | Where-Object { $_["name"] -eq "Status" }
if (@($status["choice"]["choices"]) -contains $newFaitStatus) {
    Write-Host "  OK      FAIT Status offers '$newFaitStatus'" -ForegroundColor Green
} else { Write-Host "  MISSING FAIT Status '$newFaitStatus'" -ForegroundColor Red; $ok = $false }

$eirCols = Get-Columns $eirListId
foreach ($want in @($renames + ($newEirColumns | ForEach-Object { @{ name = $_.name; displayName = $_.displayName } }))) {
    $col = $eirCols | Where-Object { $_["name"] -eq $want.name }
    if ($col -and $col["displayName"] -eq $want.displayName) {
        Write-Host ("  OK      {0,-20} '{1}'" -f $want.name, $want.displayName) -ForegroundColor Green
    } else { Write-Host ("  WRONG   {0}" -f $want.name) -ForegroundColor Red; $ok = $false }
}

# The read ARC makes asks for these by internal name; prove a read that
# selects them succeeds (a missing column would 400 here).
$probe = Invoke-MgGraphRequest -Method GET `
    -Uri "https://graph.microsoft.com/v1.0/sites/$siteId/lists/$eirListId/items?`$top=1&`$expand=fields(`$select=CurrentStock,Current_x0020_Price,LatestStock,LatestCost)"
Write-Host "  OK      EIR read selecting all four columns ($(@($probe.value).Count) row)" -ForegroundColor Green

if (-not $ok) { throw "Verification failed - see above." }
Write-Host ""
Write-Host "Done. Deploy v0.225.0 when ready." -ForegroundColor Green
