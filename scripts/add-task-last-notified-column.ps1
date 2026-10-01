<#
.SYNOPSIS
    Adds the LastNotifiedComment column to the Engineering Project Task List.

.DESCRIPTION
    Support column for the Power Automate flow that emails GUEST comments —
    see docs/POWER-AUTOMATE-GUEST-NOTIFICATIONS.md. Nothing in ARC reads or
    writes it; the flow owns it entirely.

    WHY IT IS NEEDED. The flow triggers on "when an item is created or
    modified", which fires on EVERY column change, not just Communication.
    Without somewhere to record which comment was last emailed, changing a
    task's status re-sends its most recent comment — repeatedly. The flow
    stamps the newest comment's timestamp here and compares against it on the
    next run.

    Comparing against the trigger's own "previous run" time instead is
    tempting and wrong: two comments inside one polling interval would
    collapse into a single notification.

    It holds the comment's raw timestamp string as stored in Communication
    ("09/23/2026 02:30:00 PM"), NOT a real date — a text column, so no
    timezone or format conversion can alter what it compares against.

    Idempotent: a column that already exists is reported and skipped, so
    re-running after a partial failure is safe.

    Requires Sites.Manage.All, a bigger scope than read-only discovery uses,
    so it re-authenticates even if you are already connected.

    RUN THIS IN YOUR OWN TERMINAL. The sign-in is interactive and a browser
    popup can't be surfaced from a background shell. Pass -DeviceCode if the
    popup can't open — worth knowing that ExchangeOnlineManagement's broker
    crashes on at least one machine here, and -DeviceCode is the workaround
    for that family of problem too.

    ARC WORKS BEFORE AND AFTER THIS RUNS. ARC never selects this column, so
    its absence cannot 400 a read the way a missing Watchers column would.
    Only the flow cares, and the flow is built after this.

.NOTES
    Adding a column is reversible (delete it in list settings) and leaves
    existing rows untouched — they simply have no value for it, which the
    flow's coalesce() treats as "nothing notified yet".
#>

param(
    [switch]$WhatIf,
    # Use the code-and-URL flow instead of a browser popup.
    [switch]$DeviceCode
)

$ErrorActionPreference = "Stop"
Import-Module Microsoft.Graph.Authentication

# Altronic_Engineering / Project Task List — CLAUDE.md "SharePoint identifiers"
$siteId = "coopermachineryservices.sharepoint.com,ddb5fc80-ea51-4d56-b008-ce6a82af49b0,aa6b9467-3f57-4213-bbd4-60b94403421a"
$listId = "42fb8c19-5f33-4fdd-9ef7-df6f21433588"

$wanted = @(
    @{
        name        = "LastNotifiedComment"
        displayName = "Last Notified Comment"
        description = "Timestamp of the most recent comment already emailed by the guest-notification flow. Written by Power Automate; ARC ignores it. Do not edit by hand."
        text        = @{
            allowMultipleLines = $false
            maxLength          = 64
        }
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

Write-Host "Reading existing columns on Project Task List..." -ForegroundColor Cyan
$existing = (Invoke-MgGraphRequest -Method GET `
    -Uri "https://graph.microsoft.com/v1.0/sites/$siteId/lists/$listId/columns").value
$have = $existing | ForEach-Object { $_["name"] }
Write-Host "  $($have.Count) columns on the list"

foreach ($col in $wanted) {
    if ($have -contains $col.name) {
        Write-Host "SKIP   $($col.name) - already exists" -ForegroundColor Yellow
        continue
    }
    if ($WhatIf) {
        Write-Host "WOULD CREATE  $($col.name)" -ForegroundColor Cyan
        continue
    }
    Write-Host "CREATE $($col.name)..." -ForegroundColor Green
    $body = $col | ConvertTo-Json -Depth 6
    $created = Invoke-MgGraphRequest -Method POST `
        -Uri "https://graph.microsoft.com/v1.0/sites/$siteId/lists/$listId/columns" `
        -Body $body -ContentType "application/json"
    Write-Host "       created as internal name '$($created['name'])'" -ForegroundColor Green
}

# Read back, so the result is what the list says rather than what we hoped.
Write-Host ""
Write-Host "=== Verification ===" -ForegroundColor Cyan
$after = (Invoke-MgGraphRequest -Method GET `
    -Uri "https://graph.microsoft.com/v1.0/sites/$siteId/lists/$listId/columns").value

foreach ($col in $wanted) {
    $found = $after | Where-Object { $_["name"] -eq $col.name }
    if ($found) {
        Write-Host ("  OK      {0,-22} readOnly={1}" -f `
            $found["name"], $found["readOnly"]) -ForegroundColor Green
        Write-Host "       Use this EXACT internal name in the flow's Update item step." -ForegroundColor Gray
    } else {
        Write-Host ("  MISSING {0}" -f $col.name) -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "Next: build the flow — docs/POWER-AUTOMATE-GUEST-NOTIFICATIONS.md" -ForegroundColor Cyan
