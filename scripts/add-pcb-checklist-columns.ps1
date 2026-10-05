<#
.SYNOPSIS
    Adds the two new PCB checklist columns to the Engineering Project Task List.

.DESCRIPTION
    Sarah Shaffer's request (ARC Feature Requests, 2026-10-02; tracked as
    Altronic-LLC/BusinessIT#1): two more Yes/No items on the PCB Engineering
    checklist, directly after "Schematic Part Number Pulled If new", for
    production requirements and design-improvement updates:

      - Fiducials on top and bottom of actual PCB
      - Design Rule Checks Completed and Resolved

    THE DISPLAY NAME IS THE CONTRACT. ARC finds each checklist column by its
    DISPLAY name (src/lib/pcbChecklist.ts, matched case-insensitively), not its
    internal name — so the displayName below must match that file exactly. A
    mismatch doesn't error anywhere: the item renders as a red "column missing
    on the SharePoint Task list" box on every PCB task.

    The internal names are short and readable on purpose. ARC never uses them
    directly, and SharePoint's own encoding of a 40-character display name
    (spaces to _x0020_, cut at 32 characters) is unreadable in Graph and
    Power Automate.

    RUN THIS BEFORE DEPLOYING THE CODE CHANGE. ARC reads a task with
    $expand=fields and no $select, so extra columns can't break any read —
    they sit unused until the code ships. The other order shows two red
    boxes on every PCB task until the columns exist.

    Idempotent: a column that already exists (by internal OR display name) is
    reported and skipped, so re-running after a partial failure is safe.

    Requires Sites.Manage.All, a bigger scope than read-only discovery uses,
    so it re-authenticates even if you are already connected.

    RUN THIS IN YOUR OWN TERMINAL. The sign-in is interactive and a browser
    popup can't be surfaced from a background shell. Pass -DeviceCode if the
    popup can't open.

.EXAMPLE
    ./scripts/add-pcb-checklist-columns.ps1 -WhatIf
    ./scripts/add-pcb-checklist-columns.ps1

.NOTES
    Adding a column is reversible (delete it in list settings) and leaves
    existing rows untouched. Every existing task starts unticked (No) on both,
    which is what the checklist shows for any item not yet done.
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

# displayName MUST match PCB_CHECKLIST_ITEMS in src/lib/pcbChecklist.ts.
$wanted = @(
    @{
        name         = "PcbFiducials"
        displayName  = "Fiducials on top and bottom of actual PCB"
        description  = "PCB checklist item (ARC). Do not rename: ARC finds this column by its display name."
        boolean      = @{}
        defaultValue = @{ value = "0" }
    },
    @{
        name         = "PcbDrcComplete"
        displayName  = "Design Rule Checks Completed and Resolved"
        description  = "PCB checklist item (ARC). Do not rename: ARC finds this column by its display name."
        boolean      = @{}
        defaultValue = @{ value = "0" }
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

function Get-TaskListColumns {
    (Invoke-MgGraphRequest -Method GET `
        -Uri "https://graph.microsoft.com/v1.0/sites/$siteId/lists/$listId/columns").value
}

Write-Host "Reading existing columns on Project Task List..." -ForegroundColor Cyan
$existing = Get-TaskListColumns
Write-Host "  $($existing.Count) columns on the list"

foreach ($col in $wanted) {
    # Skip on EITHER name: a column created by hand in list settings has the
    # right display name under SharePoint's own encoded internal name, and a
    # second column with the same display name would make ARC's match
    # ambiguous.
    $clash = $existing | Where-Object {
        $_["name"] -eq $col.name -or $_["displayName"] -ieq $col.displayName
    }
    if ($clash) {
        Write-Host "SKIP   $($col.displayName) - already exists as '$($clash[0]['name'])'" -ForegroundColor Yellow
        continue
    }
    if ($WhatIf) {
        Write-Host "WOULD CREATE  $($col.name)  ('$($col.displayName)')" -ForegroundColor Cyan
        continue
    }
    Write-Host "CREATE $($col.name)  ('$($col.displayName)')..." -ForegroundColor Green
    $body = $col | ConvertTo-Json -Depth 6
    $created = Invoke-MgGraphRequest -Method POST `
        -Uri "https://graph.microsoft.com/v1.0/sites/$siteId/lists/$listId/columns" `
        -Body $body -ContentType "application/json"
    Write-Host "       created as internal name '$($created['name'])'" -ForegroundColor Green
}

# Read back, so the result is what the list says rather than what we hoped.
Write-Host ""
Write-Host "=== Verification ===" -ForegroundColor Cyan
$after = Get-TaskListColumns
$ok = $true

foreach ($col in $wanted) {
    $found = @($after | Where-Object { $_["displayName"] -ieq $col.displayName })
    if ($found.Count -eq 0) {
        Write-Host "  MISSING  $($col.displayName)" -ForegroundColor Red
        $ok = $false
        continue
    }
    if ($found.Count -gt 1) {
        Write-Host "  DUPLICATE display name ($($found.Count) columns): $($col.displayName)" -ForegroundColor Red
        Write-Host "           ARC matches by display name - delete the extra in list settings." -ForegroundColor Red
        $ok = $false
        continue
    }
    $isBool = $found[0].ContainsKey("boolean")
    $colour = if ($isBool) { "Green" } else { "Red" }
    Write-Host ("  {0,-8} {1,-16} '{2}'  yes/no={3}" -f `
        $(if ($isBool) { "OK" } else { "WRONG" }), $found[0]["name"], $found[0]["displayName"], $isBool) `
        -ForegroundColor $colour
    if (-not $isBool) { $ok = $false }
}

Write-Host ""
if ($WhatIf) {
    Write-Host "Dry run - nothing was created. Re-run without -WhatIf to create the columns." -ForegroundColor Cyan
} elseif ($ok) {
    Write-Host "Both columns are in place. Safe to deploy the ARC change." -ForegroundColor Green
} else {
    Write-Host "Fix the problems above before deploying the ARC change." -ForegroundColor Red
    exit 1
}
