<#
.SYNOPSIS
    Adds the Communication, Watchers and Contact Category columns to the
    Supplier Contact List.

.DESCRIPTION
    ARC's comment thread and watcher list need two columns this list doesn't
    have (Suppliers List and Supplier Issue Tracker already carry both). This
    adds them and nothing else — it does not touch data, existing columns, or
    any other list.

    Contact Category (BusinessIT#80, Katie Fleming, 2026-11-24) is a single
    choice: Quality / Accounting / Customer Service, strict (no fill-in). If
    the column already exists, any of those it is missing are ADDED - nothing
    is removed. More can be added in List settings; ARC reads the live
    choices. After the columns, a throwaway contact is written with a
    category, read back and deleted (a 2xx is not proof).

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
    },
    @{
        name        = "ContactCategory"
        displayName = "Contact Category"
        description = "What the contact is for at the supplier (BusinessIT#80)."
        choice      = @{
            allowTextEntry = $false
            displayAs      = "dropDownMenu"
            choices        = @("Quality", "Accounting", "Customer Service")
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
        $found = $existing | Where-Object { $_["name"] -eq $col.name }
        $missing = @()
        if ($col.choice) { $missing = @($col.choice.choices | Where-Object { @($found["choice"]["choices"]) -notcontains $_ }) }
        if (-not $missing.Count) { Write-Host "SKIP   $($col.name) - already exists" -ForegroundColor Yellow; continue }
        if ($WhatIf) { Write-Host "WOULD ADD CHOICES  $($col.name): $($missing -join ', ')" -ForegroundColor Cyan; continue }
        $merged = @($found["choice"]["choices"]) + $missing
        $patch = @{ choice = @{ allowTextEntry = [bool]$found["choice"]["allowTextEntry"]; displayAs = $found["choice"]["displayAs"]; choices = $merged } } |
            ConvertTo-Json -Depth 6
        Invoke-MgGraphRequest -Method PATCH `
            -Uri "https://graph.microsoft.com/v1.0/sites/$siteId/lists/$listId/columns/$($found["id"])" `
            -Body $patch -ContentType "application/json" | Out-Null
        Write-Host "CHOICES $($col.name) + $($missing -join ', ')" -ForegroundColor Green
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
        } elseif ($found.ContainsKey("choice")) {
            "$($found['choice']['displayAs']) fill-in=$($found['choice']['allowTextEntry']) choices=$(@($found['choice']['choices']) -join ' | ')"
        } else { "" }
        Write-Host ("  OK      {0,-16} {1}" -f $found["name"], $detail) -ForegroundColor Green
    } else {
        Write-Host ("  MISSING {0}" -f $col.name) -ForegroundColor Red
    }
}

# A write through Graph, read back, on a throwaway contact (no supplier, so
# it shows on no ARC screen), then deleted. A 2xx alone is not proof - Graph
# silently drops some fields (see CLAUDE.md, "DisplayName").
if (-not $WhatIf) {
    Write-Host ""
    Write-Host "=== Write check: Contact Category ===" -ForegroundColor Cyan
    $items = "https://graph.microsoft.com/v1.0/sites/$siteId/lists/$listId/items"
    $tmp = Invoke-MgGraphRequest -Method POST -Uri $items -ContentType "application/json" `
        -Body (@{ fields = @{ Title = "ARC column check - delete me"; ContactCategory = "Quality" } } | ConvertTo-Json -Depth 4)
    try {
        $back = Invoke-MgGraphRequest -Method GET -Uri "$items/$($tmp.id)?`$expand=fields(`$select=ContactCategory)"
        if ($back.fields.ContactCategory -eq "Quality") {
            Write-Host "  OK      ContactCategory wrote and read back 'Quality'" -ForegroundColor Green
        } else {
            Write-Host "  FAILED  ContactCategory read back as '$($back.fields.ContactCategory)'" -ForegroundColor Red
        }
    } finally {
        Invoke-MgGraphRequest -Method DELETE -Uri "$items/$($tmp.id)" | Out-Null
        Write-Host "  throwaway contact $($tmp.id) deleted"
    }
}
