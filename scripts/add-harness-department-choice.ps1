<#
.SYNOPSIS
    Adds "Harness" to the Department choice column on the Quick Links and ARC
    Feature Requests lists (Altronic_Engineering). Idempotent; -WhatIf reports.

.DESCRIPTION
    Harness became its own department in ARC on 2026-10-27, moved out of
    Operations. Both lists' Department columns are strict choices
    (allowTextEntry = false), so until "Harness" is one of their choices,
    SharePoint REFUSES a Quick Link or a feature request tagged Harness.

    RUN THIS BEFORE deploying the version that adds the Harness department.

    The choice is inserted after "Operations", keeping the existing order;
    every existing choice is kept. Each column is read back afterwards, since a
    2xx from a column PATCH is not evidence it changed.

    RUN IN YOUR OWN TERMINAL - the sign-in is interactive.

.EXAMPLE
    .\add-harness-department-choice.ps1 -WhatIf
    .\add-harness-department-choice.ps1
#>

[CmdletBinding()]
param(
    [switch]$WhatIf,
    [switch]$DeviceCode
)

$ErrorActionPreference = "Stop"
Import-Module Microsoft.Graph.Authentication

$site = "coopermachineryservices.sharepoint.com,ddb5fc80-ea51-4d56-b008-ce6a82af49b0,aa6b9467-3f57-4213-bbd4-60b94403421a"
$graph = "https://graph.microsoft.com/v1.0/sites/$site"
$lists = [ordered]@{
    "Quick Links"          = "39871b55-ea75-4773-8405-e938161c9b30"
    "ARC Feature Requests" = "c7b00c39-4370-4063-a852-05d2c1b9fbfb"
}

$ctx = Get-MgContext
if (-not $ctx -or $ctx.Scopes -notcontains "Sites.Manage.All") {
    if ($DeviceCode) { Connect-MgGraph -Scopes "Sites.Manage.All" -UseDeviceCode -NoWelcome }
    else             { Connect-MgGraph -Scopes "Sites.Manage.All" -NoWelcome }
}
if ($WhatIf) { Write-Host "*** -WhatIf: nothing will be changed ***" -ForegroundColor Magenta }

foreach ($name in $lists.Keys) {
    $listId = $lists[$name]
    $column = (Invoke-MgGraphRequest -Method GET -Uri "$graph/lists/$listId/columns").value |
        Where-Object { $_["name"] -eq "Department" }
    if (-not $column) { Write-Host "  $name - no Department column found" -ForegroundColor Red; continue }
    $choices = @($column["choice"]["choices"])
    if ($choices -contains "Harness") { Write-Host "  $name - already has Harness" -ForegroundColor Yellow; continue }

    # A loop, not a range: PowerShell's ($a..$b) counts DOWN when $a > $b.
    $next = @()
    foreach ($c in $choices) { $next += $c; if ($c -eq "Operations") { $next += "Harness" } }
    if ($next -notcontains "Harness") { $next += "Harness" }
    if ($WhatIf) { Write-Host "  $name - WOULD SET: $($next -join ', ')" -ForegroundColor Cyan; continue }

    $body = @{ choice = @{ choices = $next; allowTextEntry = $column["choice"]["allowTextEntry"]; displayAs = $column["choice"]["displayAs"] } }
    Invoke-MgGraphRequest -Method PATCH -Uri "$graph/lists/$listId/columns/$($column["id"])" `
        -Body ($body | ConvertTo-Json -Depth 5) -ContentType "application/json" | Out-Null

    $back = (Invoke-MgGraphRequest -Method GET -Uri "$graph/lists/$listId/columns/$($column["id"])")["choice"]["choices"]
    if ($back -contains "Harness") { Write-Host "  $name - added Harness: $($back -join ', ')" -ForegroundColor Green }
    else { Write-Host "  $name - the PATCH was accepted but Harness did NOT appear. Add it in List settings." -ForegroundColor Red }
}
