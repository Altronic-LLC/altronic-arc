<#
.SYNOPSIS
    Adds the Panel Department Yes/No column to the MRB Data list (BusinessIT#71).

.DESCRIPTION
    ARC marks an MRB entry as coming from the panel department, so entries can
    be sorted and filtered in reporting. That needs one boolean column the MRB
    Data list doesn't have: internal name `PanelDepartment`, shown as
    "Panel Department". This adds it and nothing else - it does not touch any
    existing column or row.

    RUN THIS BEFORE THE DEPLOY THAT SHIPS THE FEATURE. ARC's read selects
    `PanelDepartment`, and selecting a column a list hasn't got 400s the WHOLE
    read, so the MRB register would fail to load until this has run.

    Idempotent: an existing column is reported and skipped, so re-running is
    safe. After creating (or finding) the column it WRITES AND READS BACK a
    value on a throwaway row, then deletes the row - a 2xx from a write is not
    evidence the value landed (see "A field called DisplayName is silently
    dropped" in CLAUDE.md). The throwaway row is stamped Data Format = Legacy,
    so if the delete ever fails it sits in the Archive tab, not the live queue.

    Requires Sites.Manage.All, which is a bigger scope than the read-only
    discovery script uses, so it re-authenticates even if you are already
    connected.

    RUN THIS IN YOUR OWN TERMINAL. The sign-in is interactive and can't be
    surfaced from a background shell. Pass -DeviceCode if the browser popup
    can't open.

.NOTES
    Adding a column is reversible (delete it in list settings) and leaves
    existing rows untouched - they read as No.
#>

param(
    [switch]$WhatIf,
    # Use the code-and-URL flow instead of a browser popup.
    [switch]$DeviceCode
)

$ErrorActionPreference = "Stop"
Import-Module Microsoft.Graph.Authentication

$siteId = "coopermachineryservices.sharepoint.com,915a6183-2b71-4dfd-a8b9-181126dfbe78,3eb6cb9c-6535-4c69-a8d7-e90b2f90a9eb"
$listId = "1ca33f70-c98f-4481-b518-4b15fc8fbfff"   # MRB Data, Altronic_PMO
$graph  = "https://graph.microsoft.com/v1.0/sites/$siteId/lists/$listId"

$column = @{
    name        = "PanelDepartment"
    displayName = "Panel Department"
    description = "Yes if this MRB entry came from the panel department. Set by ARC."
    boolean     = @{}
}

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
$existing = (Invoke-MgGraphRequest -Method GET -Uri "$graph/columns").value
$found = $existing | Where-Object { $_["name"] -eq $column.name }

if ($found) {
    Write-Host "SKIP   $($column.name) - already exists" -ForegroundColor Yellow
} elseif ($WhatIf) {
    Write-Host "WOULD CREATE  $($column.name) (Yes/No, '$($column.displayName)')" -ForegroundColor Cyan
    return
} else {
    Write-Host "CREATE $($column.name)..." -ForegroundColor Green
    $created = Invoke-MgGraphRequest -Method POST -Uri "$graph/columns" `
        -Body ($column | ConvertTo-Json -Depth 4) -ContentType "application/json"
    Write-Host "       created as internal name '$($created['name'])'" -ForegroundColor Green
    if ($created["name"] -ne $column.name) {
        Write-Host "  The internal name is NOT '$($column.name)' - ARC reads and writes that exact name. Stop and fix." -ForegroundColor Red
        return
    }
}

if ($WhatIf) { return }

# --- write and read back ----------------------------------------------------
Write-Host "`n=== Write/read-back check ===" -ForegroundColor Cyan
$bad = @()
$row = Invoke-MgGraphRequest -Method POST -Uri "$graph/items" -ContentType "application/json" `
    -Body (@{ fields = @{ Title = "ARC-VERIFY - delete me"; field_12 = "Legacy"; PanelDepartment = $true } } | ConvertTo-Json -Depth 4)
try {
    $select = "`$expand=fields(`$select=Title,PanelDepartment)"
    $back = Invoke-MgGraphRequest -Method GET -Uri "$graph/items/$($row.id)?$select"
    if ($back.fields["PanelDepartment"] -ne $true) { $bad += "wrote Yes, read back '$($back.fields["PanelDepartment"])'" }

    Invoke-MgGraphRequest -Method PATCH -Uri "$graph/items/$($row.id)/fields" -ContentType "application/json" `
        -Body (@{ PanelDepartment = $false } | ConvertTo-Json) | Out-Null
    $back = Invoke-MgGraphRequest -Method GET -Uri "$graph/items/$($row.id)?$select"
    if ($back.fields["PanelDepartment"] -ne $false) { $bad += "wrote No, read back '$($back.fields["PanelDepartment"])'" }
} finally {
    Invoke-MgGraphRequest -Method DELETE -Uri "$graph/items/$($row.id)" | Out-Null
}

if ($bad) {
    Write-Host "  PanelDepartment did NOT read back as written - fix before deploying:" -ForegroundColor Red
    $bad | ForEach-Object { Write-Host "    $_" -ForegroundColor Red }
} else {
    Write-Host "  PanelDepartment wrote and read back Yes and No (test row deleted)." -ForegroundColor Green
    Write-Host "`nThe MRB list is ready for the deploy that ships the Panel department flag." -ForegroundColor Cyan
}
