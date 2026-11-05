<#
.SYNOPSIS
    Sets the "Panel Tasks" list's Status choices to the panel team's Wrike
    "Panel Workflow" (BusinessIT#42). Idempotent; -WhatIf reports only.

.DESCRIPTION
    ARC's Panel Tasks used four statuses (Pending, In Process, On Hold,
    Complete). The panel team works to Wrike's Panel Workflow, so the column
    becomes those eleven, in Wrike's order, with New as the default:

      Active     New, Pending Scheduling, Ready, In Progress, Revision Needed,
                 Awaiting Pre-Req, Possible Support
      Completed  Completed
      Deferred   On Hold - Approval, On Hold - Internal
      Canceled   Canceled

    The list must match PANEL_TASK_STATUSES in src/types/task.ts: Status is a
    strict Choice column, so a value ARC writes that it doesn't declare is
    refused. ARC reads the old four as their match (Pending -> New, In Process
    -> In Progress, On Hold -> On Hold - Internal, Complete -> Completed), so
    nothing breaks before rows are moved; -MigrateRows moves them so
    SharePoint's own views agree.

    The choices are read back after the change. A 2xx is not evidence.

    RUN IN YOUR OWN TERMINAL - the sign-in is interactive. If the Windows
    account window never appears (it can open behind VS Code), use -DeviceCode.

.EXAMPLE
    .\set-panel-task-statuses.ps1 -WhatIf
    .\set-panel-task-statuses.ps1
    .\set-panel-task-statuses.ps1 -MigrateRows
#>

[CmdletBinding()]
param(
    [switch]$WhatIf,
    [switch]$MigrateRows,
    [switch]$DeviceCode
)

$ErrorActionPreference = "Stop"
Import-Module Microsoft.Graph.Authentication

$siteId = "coopermachineryservices.sharepoint.com,fdf31131-2076-4618-923b-a1856e6b0f2a,3eb6cb9c-6535-4c69-a8d7-e90b2f90a9eb"
$listId = "17a33ee1-c4aa-439b-9dc0-6269a8e04767"   # Panel Tasks
$graph = "https://graph.microsoft.com/v1.0/sites/$siteId"

$statuses = @(
    "New", "Pending Scheduling", "Ready", "In Progress", "Revision Needed", "Awaiting Pre-Req",
    "Possible Support", "Completed", "On Hold - Approval", "On Hold - Internal", "Canceled"
)
$legacy = @{ "Pending" = "New"; "In Process" = "In Progress"; "On Hold" = "On Hold - Internal"; "Complete" = "Completed" }

$ctx = Get-MgContext
if (-not $ctx -or $ctx.Scopes -notcontains "Sites.Manage.All") {
    Write-Host "Signing in for write access (Sites.Manage.All)..." -ForegroundColor Cyan
    if ($DeviceCode) { Connect-MgGraph -Scopes "Sites.Manage.All" -UseDeviceCode -NoWelcome }
    else             { Connect-MgGraph -Scopes "Sites.Manage.All" -NoWelcome }
}
if ($WhatIf) { Write-Host "`n*** -WhatIf: nothing will be changed ***" -ForegroundColor Magenta }

Write-Host "`n=== Panel Tasks ($listId): Status column ===" -ForegroundColor Cyan
$col = (Invoke-MgGraphRequest -Method GET -Uri "$graph/lists/$listId/columns").value | Where-Object { $_.name -eq "Status" }
if (-not $col) { throw "The Panel Tasks list has no column named Status." }
if (-not $col.choice) { throw "Status isn't a Choice column - stopping rather than guessing." }
$now = @($col.choice.choices)
Write-Host "  now:  $($now -join ' | ')"
Write-Host "  want: $($statuses -join ' | ')"

if ((($now -join "`n") -eq ($statuses -join "`n")) -and "$($col.defaultValue.value)" -eq "New") {
    Write-Host "  already set" -ForegroundColor Green
} elseif ($WhatIf) {
    Write-Host "  would set the eleven choices, default New" -ForegroundColor Yellow
} else {
    $body = @{
        choice = @{ choices = $statuses; allowTextEntry = $false; displayAs = "dropDownMenu" }
        defaultValue = @{ value = "New" }
    } | ConvertTo-Json -Depth 5
    Invoke-MgGraphRequest -Method PATCH -Uri "$graph/lists/$listId/columns/$($col.id)" -ContentType "application/json" -Body $body | Out-Null
    $back = Invoke-MgGraphRequest -Method GET -Uri "$graph/lists/$listId/columns/$($col.id)"
    if ((@($back.choice.choices) -join "`n") -ne ($statuses -join "`n")) {
        throw "The choices didn't read back as set: $(@($back.choice.choices) -join ' | ')"
    }
    Write-Host "  set and read back: $(@($back.choice.choices).Count) choices, default '$($back.defaultValue.value)'" -ForegroundColor Green
}

if ($MigrateRows) {
    Write-Host "`n=== Rows still on an old status ===" -ForegroundColor Cyan
    $items = @()
    $uri = "$graph/lists/$listId/items?`$expand=fields(`$select=Title,Status)&`$top=999"
    while ($uri) {
        $page = Invoke-MgGraphRequest -Method GET -Uri $uri
        $items += $page.value
        $uri = $page.'@odata.nextLink'
    }
    $old = @($items | Where-Object { $legacy.ContainsKey("$($_.fields.Status)") })
    Write-Host "  $($old.Count) of $($items.Count) row(s)"
    foreach ($it in $old) {
        $to = $legacy["$($it.fields.Status)"]
        if ($WhatIf) { Write-Host "  would move #$($it.id) '$($it.fields.Title)': $($it.fields.Status) -> $to"; continue }
        Invoke-MgGraphRequest -Method PATCH -Uri "$graph/lists/$listId/items/$($it.id)/fields" -ContentType "application/json" `
            -Body (@{ Status = $to } | ConvertTo-Json) | Out-Null
        $check = Invoke-MgGraphRequest -Method GET -Uri "$graph/lists/$listId/items/$($it.id)?`$expand=fields(`$select=Status)"
        if ("$($check.fields.Status)" -ne $to) { throw "Row #$($it.id) read back as '$($check.fields.Status)'" }
        Write-Host "  #$($it.id) $($it.fields.Status) -> $to" -ForegroundColor Green
    }
}

Write-Host "`nDone." -ForegroundColor Cyan
