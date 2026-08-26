<#
.SYNOPSIS
    Adds the Communication and Watchers columns to the Supplier Contact List.

.DESCRIPTION
    ARC's comment thread and watcher list need two columns this list doesn't
    have (Suppliers List and Supplier Issue Tracker already carry both). This
    adds them and nothing else — it does not touch data, existing columns, or
    any other list.

    Idempotent: a column that already exists is reported and skipped, so
    re-running after a partial failure is safe.

    Requires Sites.Manage.All, which is a bigger scope than the read-only
    discovery script uses, so it re-authenticates even if you are already
    connected for discovery.

    RUN THIS IN YOUR OWN TERMINAL. The sign-in is interactive, and a browser
    popup (or the device code) can't be surfaced from a background shell -
    it just times out after two minutes with the prompt trapped in a buffer.
    Pass -DeviceCode if the browser popup can't open.

.NOTES
    Adding a column is reversible (delete it in list settings) and leaves
    existing rows untouched — they simply have no value for it.
#>

param(
    [switch]$WhatIf,
    # Use the code-and-URL flow instead of a browser popup.
    [switch]$DeviceCode
)

$ErrorActionPreference = "Stop"
Import-Module Microsoft.Graph.Authentication

$siteId = "coopermachineryservices.sharepoint.com,915a6183-2b71-4dfd-a8b9-181126dfbe78,3eb6cb9c-6535-4c69-a8d7-e90b2f90a9eb"
$listId = "efdb064b-be61-442e-9bae-f052569c3701"   # Supplier Contact List, Altronic_PMO

# The two columns, exactly as ARC expects to read and write them — same
# shapes as the FAIT columns (scripts/add-fait-columns.ps1).
$wanted = @(
    @{
        name        = "Communication"
        displayName = "Communication"
        description = "Comment thread. Managed by ARC - pipe-delimited records, do not edit by hand."
        text        = @{
            allowMultipleLines          = $true
            appendChangesToExistingText = $false
            linesForEditing             = 6
            textType                    = "plain"
        }
    },
    @{
        name          = "Watchers"
        displayName   = "Watchers"
        description   = "People notified about changes and comments on this contact."
        personOrGroup = @{
            allowMultipleSelection = $true
            chooseFromType         = "peopleOnly"
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

Write-Host "Reading existing columns..." -ForegroundColor Cyan
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

Write-Host ""
Write-Host "=== Verification ===" -ForegroundColor Cyan
$after = (Invoke-MgGraphRequest -Method GET `
    -Uri "https://graph.microsoft.com/v1.0/sites/$siteId/lists/$listId/columns").value
foreach ($col in $wanted) {
    $found = $after | Where-Object { $_["name"] -eq $col.name }
    if ($found) {
        $detail = if ($found.ContainsKey("text")) {
            "multiline=$($found['text']['allowMultipleLines']) append=$($found['text']['appendChangesToExistingText']) type=$($found['text']['textType'])"
        } elseif ($found.ContainsKey("personOrGroup")) {
            "multi=$($found['personOrGroup']['allowMultipleSelection']) from=$($found['personOrGroup']['chooseFromType'])"
        } else { "" }
        Write-Host ("  OK      {0,-16} {1}" -f $found["name"], $detail) -ForegroundColor Green
    } else {
        Write-Host ("  MISSING {0}" -f $col.name) -ForegroundColor Red
    }
}
