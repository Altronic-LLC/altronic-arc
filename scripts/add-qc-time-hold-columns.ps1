<#
.SYNOPSIS
    Adds the On Hold columns to the QC Time Tracking list (ALTRONICPANELTEAM).

.DESCRIPTION
    A panel goes on hold for reasons outside QC's control — a bad Altronic
    component, missing parts, a customer-caused delay. The Excel sheet this
    list replaced used to highlight those rows; ARC had no way to record it at
    all (Ray, 2026-09-16).

        QC Time Tracking (existing list)
            OnHold        boolean — is this panel on hold right now
            HoldReason    SINGLE CHOICE — why, from a fixed list

    HoldReason is a single choice rather than free text (Ray's call) so the
    values stay countable: "management spot correlations when panel times
    increase" needs the reasons to group, which free text never does.
    `allowTextEntry` is OFF for the same reason — a typed-in variant would
    make its own bucket of one.

    Changing the choices later means editing BOTH this script's list and
    `QC_TIME_HOLD_REASONS` in src/types/task.ts. ARC does NOT clamp what it
    reads (an unrecognised value renders as itself rather than vanishing), so
    a value added in SharePoint first shows up fine — but the picker won't
    offer it until the const catches up.

    Idempotent: a column that already exists is left alone.

.PARAMETER WhatIf
    Print what would be created without creating anything.

.EXAMPLE
    ./scripts/add-qc-time-hold-columns.ps1 -WhatIf

.EXAMPLE
    ./scripts/add-qc-time-hold-columns.ps1

.NOTES
    Needs Sites.Manage.All — adding a column is a schema write.
#>
param(
    [switch]$WhatIf
)

$ErrorActionPreference = "Stop"

# Mirrored from src/api/config.ts (SITES.panelTeam).
$PanelTeamSite = "coopermachineryservices.sharepoint.com,fdf31131-2076-4618-923b-a1856e6b0f2a,3eb6cb9c-6535-4c69-a8d7-e90b2f90a9eb"

# Mirrored from SP_QC_TIME_TRACKING_LIST_ID in src/api/config.ts.
$ListId = "d3d97708-1d55-4307-8e3f-9411cd98a2fa"

# MUST match QC_TIME_HOLD_REASONS in src/types/task.ts.
$HoldReasons = @(
    "Bad Altronic component",
    "Missing parts",
    "Customer-caused delay",
    "Waiting on engineering",
    "Recurring issue",
    "Other"
)

$Columns = @(
    @{
        name        = "OnHold"
        displayName = "On Hold"
        boolean     = @{}
    },
    @{
        name        = "HoldReason"
        displayName = "Hold Reason"
        choice      = @{
            choices        = $HoldReasons
            displayAs      = "dropDownMenu"
            # OFF on purpose: a typed-in variant makes its own bucket of one,
            # which defeats the point of recording the reason at all.
            allowTextEntry = $false
        }
    }
)

$ctx = Get-MgContext
if (-not $ctx -or $ctx.Scopes -notcontains "Sites.Manage.All") {
    Write-Host "Signing in (Sites.Manage.All — adding a column is a schema write)..." -ForegroundColor Cyan
    try {
        Connect-MgGraph -Scopes "Sites.Manage.All" -NoWelcome
    } catch {
        Connect-MgGraph -Scopes "Sites.Manage.All" -UseDeviceCode -NoWelcome
    }
}

Write-Host "`nQC Time Tracking — On Hold columns" -ForegroundColor Cyan

# Refuse rather than write to a list that isn't there.
try {
    $list = Invoke-MgGraphRequest -Method GET `
        -Uri "https://graph.microsoft.com/v1.0/sites/$PanelTeamSite/lists/$ListId`?`$select=id,displayName"
    Write-Host "  list: $($list.displayName)" -ForegroundColor Green
} catch {
    Write-Host "  NOT FOUND: $ListId" -ForegroundColor Red
    Write-Host "  Check VITE_SP_QC_TIME_TRACKING_LIST_ID in src/api/config.ts." -ForegroundColor Red
    exit 1
}

$existing = (Invoke-MgGraphRequest -Method GET `
    -Uri "https://graph.microsoft.com/v1.0/sites/$PanelTeamSite/lists/$ListId/columns").value
$have = @($existing | ForEach-Object { $_.name })

foreach ($col in $Columns) {
    if ($have -contains $col.name) {
        Write-Host "    $($col.name) — already there"
        continue
    }
    if ($WhatIf) {
        Write-Host "    $($col.name) — WOULD ADD" -ForegroundColor Yellow
        continue
    }
    Invoke-MgGraphRequest -Method POST `
        -Uri "https://graph.microsoft.com/v1.0/sites/$PanelTeamSite/lists/$ListId/columns" `
        -Body ($col | ConvertTo-Json -Depth 10) -ContentType "application/json" | Out-Null
    Write-Host "    $($col.name) — ADDED" -ForegroundColor Green
}

if ($WhatIf) {
    Write-Host "`n-WhatIf — nothing was created.`n" -ForegroundColor Yellow
    exit 0
}

Write-Host ""
Write-Host "Done. No env var to set — the list id was already configured, so" -ForegroundColor Cyan
Write-Host "ARC picks the new columns up on the next deploy." -ForegroundColor Cyan
Write-Host ""
Write-Host "Hold reasons configured:" -ForegroundColor Cyan
foreach ($r in $HoldReasons) { Write-Host "  - $r" }
Write-Host ""
Write-Host "These MUST stay in step with QC_TIME_HOLD_REASONS in" -ForegroundColor Yellow
Write-Host "src/types/task.ts — change both together, or the picker offers a" -ForegroundColor Yellow
Write-Host "value SharePoint refuses (or hides one it would accept)." -ForegroundColor Yellow
Write-Host ""
