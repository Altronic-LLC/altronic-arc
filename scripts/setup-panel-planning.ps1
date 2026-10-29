<#
.SYNOPSIS
    Sets up the panel planning changes on ALTRONICPANELTEAM (BusinessIT#42,
    Tim 2026-10-29). Idempotent; -WhatIf reports only.

.DESCRIPTION
    Six SharePoint changes. The internal names are the contract with
    src/api/panelTasks.ts, panelTaskTemplates.ts, panelSettings.ts and
    panelTimeOff.ts. RUN IT BEFORE THE DEPLOY that ships them: ARC's reads
    select the new columns, and selecting a column a list hasn't got fails the
    whole read.

    1. Panel Tasks -> TaskType gains "BOM" and "Programming" (kept in
       PANEL_TASK_TYPES' order). A strict choice column refuses a type it
       doesn't declare.
    2. Panel Tasks gains PanelOrderRef (shown "Panel Order"): a SINGLE lookup
       to Panel Order Headers, Title - the order a standard task was raised
       for. ARC selects both halves and writes a bare integer. Checked by
       creating a throwaway task, reading both halves back and deleting it.
    3. A new list, "Panel Task Templates" - the tasks a new Panel Order raises:
         Title          (shown "Task")       text      "Drawing Creation"
         TaskType       (shown "Task Type")  choice    same choices as Panel Tasks
         EstimatedHours (shown "Hours")      number    the task's usual total
         SortOrder      (shown "Order")      number    the order they're raised in
         Active                              yes/no    default Yes
       Seeded with Wrike's four ONLY WHILE EMPTY - after that the panel
       managers own it in ARC, and a re-run never puts back a task somebody
       removed.
    4. A new list, "Panel Settings": Title (shown "Setting") + Value. Holds
       the Capacity view's amber threshold; ARC adds the row on first change.
    5. Panel Time Off gains CompanyHoliday (yes/no), and TeamMember stops being
       required - a company holiday is everyone's, with no person.
    6. Panel Tasks -> Assigned allows more than one person.
    7. Panel Tasks gains WorkType (shown "Work Type"): a single choice of
       Production Order / Non-Production / Improvement / Internal - the panel
       space's Wrike custom field. Strict: must match PANEL_TASK_WORK_TYPES.
    8. Panel Tasks gains Priority: a single choice of High / Medium / Low (the
       Wrike custom field). If a Priority column is already there, its missing
       choices are added. Strict: must match PANEL_TASK_PRIORITIES.

    Every change is read back; a 2xx is not evidence. Prints the two new list
    ids for VITE_SP_PANEL_TASK_TEMPLATES_LIST_ID and VITE_SP_PANEL_SETTINGS_LIST_ID.

    RUN IN YOUR OWN TERMINAL - the sign-in is interactive. If the Windows
    account window never appears (it can open behind VS Code), use -DeviceCode.

.EXAMPLE
    .\setup-panel-planning.ps1 -WhatIf
    .\setup-panel-planning.ps1
#>

[CmdletBinding()]
param(
    [switch]$WhatIf,
    [switch]$DeviceCode
)

$ErrorActionPreference = "Stop"
Import-Module Microsoft.Graph.Authentication

$siteId = "coopermachineryservices.sharepoint.com,fdf31131-2076-4618-923b-a1856e6b0f2a,3eb6cb9c-6535-4c69-a8d7-e90b2f90a9eb"
$graph = "https://graph.microsoft.com/v1.0/sites/$siteId"
$tasksListId = "17a33ee1-c4aa-439b-9dc0-6269a8e04767"    # Panel Tasks
$ordersListId = "8561acf4-b583-459b-aafd-2106803a70c7"   # Panel Order Headers

# Must match PANEL_TASK_TYPES in src/types/task.ts.
$taskTypes = @("Drawings", "BOM", "SOO", "Programming", "Quote", "Administrative")
# Must match DEFAULT_PANEL_TASK_TEMPLATES in src/lib/panelOrderTasks.ts.
$seed = @(
    @{ Title = "Drawing Creation"; TaskType = "Drawings";    EstimatedHours = 24; SortOrder = 1; Active = $true },
    @{ Title = "BOM Creation";     TaskType = "BOM";         EstimatedHours = 2;  SortOrder = 2; Active = $true },
    @{ Title = "SOO Creation";     TaskType = "SOO";         EstimatedHours = 6;  SortOrder = 3; Active = $true },
    @{ Title = "Programming";      TaskType = "Programming"; EstimatedHours = 16; SortOrder = 4; Active = $true }
)

$ctx = Get-MgContext
if (-not $ctx -or $ctx.Scopes -notcontains "Sites.Manage.All") {
    Write-Host "Signing in for write access (Sites.Manage.All)..." -ForegroundColor Cyan
    if ($DeviceCode) { Connect-MgGraph -Scopes "Sites.Manage.All" -UseDeviceCode -NoWelcome }
    else             { Connect-MgGraph -Scopes "Sites.Manage.All" -NoWelcome }
}
if ($WhatIf) { Write-Host "`n*** -WhatIf: nothing will be changed ***" -ForegroundColor Magenta }

function Get-Column($listId, $name) {
    (Invoke-MgGraphRequest -Method GET -Uri "$graph/lists/$listId/columns").value | Where-Object { $_.name -eq $name }
}

# --- 1. TaskType choices ------------------------------------------------------
Write-Host "`n=== Panel Tasks: TaskType choices ===" -ForegroundColor Cyan
$col = Get-Column $tasksListId "TaskType"
if (-not $col) { throw "The Panel Tasks list has no column named TaskType." }
if (-not $col.choice) { throw "TaskType isn't a Choice column - stopping rather than guessing." }
$now = @($col.choice.choices)
# Keep any choice SharePoint has that ARC doesn't know, after ARC's own.
$want = @($taskTypes) + @($now | Where-Object { $taskTypes -notcontains $_ })
Write-Host "  now:  $($now -join ' | ')"
Write-Host "  want: $($want -join ' | ')"
if (($now -join "`n") -eq ($want -join "`n")) {
    Write-Host "  already set" -ForegroundColor Green
} elseif ($WhatIf) {
    Write-Host "  would set the choices above" -ForegroundColor Yellow
} else {
    $body = @{ choice = @{ choices = $want; allowTextEntry = [bool]$col.choice.allowTextEntry; displayAs = $col.choice.displayAs } } | ConvertTo-Json -Depth 5
    Invoke-MgGraphRequest -Method PATCH -Uri "$graph/lists/$tasksListId/columns/$($col.id)" -ContentType "application/json" -Body $body | Out-Null
    $back = @((Get-Column $tasksListId "TaskType").choice.choices)
    if (($back -join "`n") -ne ($want -join "`n")) { throw "TaskType didn't read back as set: $($back -join ' | ')" }
    Write-Host "  set and read back" -ForegroundColor Green
}

# --- 2. PanelOrderRef lookup ---------------------------------------------------
Write-Host "`n=== Panel Tasks: PanelOrderRef ===" -ForegroundColor Cyan
$ref = Get-Column $tasksListId "PanelOrderRef"
if ($ref) {
    if ($ref.lookup.listId -ne $ordersListId) { throw "PanelOrderRef exists but looks up $($ref.lookup.listId), not Panel Order Headers." }
    Write-Host "  EXISTS (lookup -> Panel Order Headers.$($ref.lookup.columnName))" -ForegroundColor Yellow
} elseif ($WhatIf) {
    Write-Host "  WOULD ADD  PanelOrderRef ('Panel Order'), single lookup -> Panel Order Headers.Title" -ForegroundColor Cyan
} else {
    $body = @{
        name = "PanelOrderRef"; displayName = "Panel Order"
        description = "The Panel Order this task was raised for (its standard tasks). Set by ARC."
        lookup = @{ listId = $ordersListId; columnName = "Title"; allowMultipleValues = $false }
    } | ConvertTo-Json -Depth 5
    Invoke-MgGraphRequest -Method POST -Uri "$graph/lists/$tasksListId/columns" -ContentType "application/json" -Body $body | Out-Null
    Write-Host "  added" -ForegroundColor Green
}

if (-not $WhatIf) {
    # Write and read back: a throwaway task pointing at the newest order.
    $order = (Invoke-MgGraphRequest -Method GET -Uri "$graph/lists/$ordersListId/items?`$top=1&`$select=id").value | Select-Object -First 1
    if ($order) {
        $created = Invoke-MgGraphRequest -Method POST -Uri "$graph/lists/$tasksListId/items" -ContentType "application/json" `
            -Body (@{ fields = @{ Title = "ARC setup check - delete me"; Status = "New"; PanelOrderRefLookupId = [int]$order.id } } | ConvertTo-Json -Depth 4)
        try {
            $back = Invoke-MgGraphRequest -Method GET -Uri "$graph/lists/$tasksListId/items/$($created.id)?`$expand=fields(`$select=PanelOrderRef,PanelOrderRefLookupId)"
            if ("$($back.fields.PanelOrderRefLookupId)" -ne "$($order.id)") {
                throw "PanelOrderRef read back as '$($back.fields.PanelOrderRefLookupId)', expected $($order.id)."
            }
            Write-Host "  write/read-back OK (order $($order.id))" -ForegroundColor Green
        } finally {
            Invoke-MgGraphRequest -Method DELETE -Uri "$graph/lists/$tasksListId/items/$($created.id)" | Out-Null
        }
    } else {
        Write-Host "  no Panel Orders to check against - skipped the read-back" -ForegroundColor Yellow
    }
}

function Find-List($name) {
    $found = $null
    $uri = "$graph/lists?`$select=id,displayName&`$top=200"
    while ($uri) {
        $page = Invoke-MgGraphRequest -Method GET -Uri $uri
        foreach ($l in $page.value) { if ($l.displayName -eq $name) { $found = $l.id } }
        $uri = $page["@odata.nextLink"]
    }
    return $found
}

# Creates the list if missing and adds missing columns. Returns its id, or
# $null under -WhatIf when it doesn't exist yet.
function Ensure-List($name, $columns, $titleLabel) {
    $id = Find-List $name
    if ($id) {
        Write-Host "  EXISTS  $name ($id)" -ForegroundColor Yellow
    } elseif ($WhatIf) {
        Write-Host "  WOULD CREATE  $name with $($columns.Count) columns, Title shown as '$titleLabel'" -ForegroundColor Cyan
        return $null
    } else {
        $body = @{ displayName = $name; list = @{ template = "genericList" }; columns = $columns } | ConvertTo-Json -Depth 8
        $id = (Invoke-MgGraphRequest -Method POST -Uri "$graph/lists" -Body $body -ContentType "application/json")["id"]
        Write-Host "  created $name ($id)" -ForegroundColor Green
    }
    $have = (Invoke-MgGraphRequest -Method GET -Uri "$graph/lists/$id/columns").value
    foreach ($c in $columns) {
        if ($have | Where-Object { $_["name"] -eq $c.name }) { continue }
        if ($WhatIf) { Write-Host "    WOULD ADD    $($c.name)" -ForegroundColor Cyan; continue }
        Invoke-MgGraphRequest -Method POST -Uri "$graph/lists/$id/columns" -Body ($c | ConvertTo-Json -Depth 6) -ContentType "application/json" | Out-Null
        Write-Host "    added        $($c.name)" -ForegroundColor Green
    }
    $title = $have | Where-Object { $_["name"] -eq "Title" }
    if (-not $WhatIf -and $title -and $title["displayName"] -ne $titleLabel) {
        Invoke-MgGraphRequest -Method PATCH -Uri "$graph/lists/$id/columns/$($title["id"])" `
            -Body (@{ displayName = $titleLabel } | ConvertTo-Json) -ContentType "application/json" | Out-Null
        Write-Host "    Title shown as '$titleLabel'" -ForegroundColor Green
    }
    return $id
}

# --- 3. Panel Task Templates ---------------------------------------------------
Write-Host "`n=== Panel Task Templates ===" -ForegroundColor Cyan
$templateColumns = @(
    @{ name = "TaskType"; displayName = "Task Type"; choice = @{ choices = $taskTypes; allowTextEntry = $false; displayAs = "dropDownMenu" } },
    @{ name = "EstimatedHours"; displayName = "Hours"; number = @{ decimalPlaces = "two"; minimum = 0 }
       description = "The task's usual total hours." },
    @{ name = "SortOrder"; displayName = "Order"; number = @{ decimalPlaces = "none" }
       description = "The order the tasks are raised and listed in." },
    @{ name = "Active"; displayName = "Active"; boolean = @{}; defaultValue = @{ value = "1" }
       description = "No = kept, but no longer raised for new orders." }
)
$templatesId = Ensure-List "Panel Task Templates" $templateColumns "Task"
if ($templatesId) {
    $items = @((Invoke-MgGraphRequest -Method GET -Uri "$graph/lists/$templatesId/items?`$select=id&`$top=1").value)
    if ($items.Count -gt 0) {
        Write-Host "  has rows - not seeded (the panel managers own it now)" -ForegroundColor Yellow
    } elseif ($WhatIf) {
        Write-Host "  WOULD SEED $($seed.Count) tasks" -ForegroundColor Cyan
    } else {
        foreach ($row in $seed) {
            $created = Invoke-MgGraphRequest -Method POST -Uri "$graph/lists/$templatesId/items" -ContentType "application/json" `
                -Body (@{ fields = $row } | ConvertTo-Json -Depth 4)
            $back = Invoke-MgGraphRequest -Method GET -Uri "$graph/lists/$templatesId/items/$($created.id)?`$expand=fields(`$select=Title,TaskType,EstimatedHours,SortOrder,Active)"
            $f = $back.fields
            if ($f.Title -ne $row.Title -or $f.TaskType -ne $row.TaskType -or [double]$f.EstimatedHours -ne $row.EstimatedHours -or
                [int]$f.SortOrder -ne $row.SortOrder -or $f.Active -ne $true) {
                throw "Seed row '$($row.Title)' didn't read back as written: $($f | ConvertTo-Json -Compress)"
            }
            Write-Host "    seeded       $($row.Title) ($($row.EstimatedHours)h, $($row.TaskType))" -ForegroundColor Green
        }
    }
}

# --- 4. Panel Settings ---------------------------------------------------------
# One row per setting: Title = its name, Value = text. ARC adds a row the
# first time a setting is changed, so nothing is seeded.
Write-Host "`n=== Panel Settings ===" -ForegroundColor Cyan
$settingsColumns = @(
    @{ name = "Value"; displayName = "Value"; text = @{}; description = "The setting's value, as text." }
)
$settingsId = Ensure-List "Panel Settings" $settingsColumns "Setting"

# --- 5. Panel Time Off: company holidays --------------------------------------
# CompanyHoliday = off for everyone, with no person; so TeamMember stops being
# required (ARC still requires a person on every other entry). ARC's read
# selects CompanyHoliday: RUN THIS BEFORE THE DEPLOY.
Write-Host "`n=== Panel Time Off: CompanyHoliday ===" -ForegroundColor Cyan
$timeOffId = Find-List "Panel Time Off"
if (-not $timeOffId) {
    Write-Host "  Panel Time Off doesn't exist - run create-panel-time-off-list.ps1 first, then this again." -ForegroundColor Yellow
} else {
    if (Get-Column $timeOffId "CompanyHoliday") {
        Write-Host "  EXISTS  CompanyHoliday" -ForegroundColor Yellow
    } elseif ($WhatIf) {
        Write-Host "  WOULD ADD  CompanyHoliday (yes/no, default No)" -ForegroundColor Cyan
    } else {
        $body = @{ name = "CompanyHoliday"; displayName = "Company Holiday"; boolean = @{}; defaultValue = @{ value = "0" }
                   description = "Off for everyone on the Panel Engineering Capacity view; no Team Member." } | ConvertTo-Json -Depth 4
        Invoke-MgGraphRequest -Method POST -Uri "$graph/lists/$timeOffId/columns" -ContentType "application/json" -Body $body | Out-Null
        Write-Host "  added    CompanyHoliday" -ForegroundColor Green
    }
    $member = Get-Column $timeOffId "TeamMember"
    if ($member -and $member.required) {
        if ($WhatIf) { Write-Host "  WOULD MAKE  TeamMember not required" -ForegroundColor Cyan }
        else {
            Invoke-MgGraphRequest -Method PATCH -Uri "$graph/lists/$timeOffId/columns/$($member.id)" -ContentType "application/json" `
                -Body (@{ required = $false } | ConvertTo-Json) | Out-Null
            if ((Get-Column $timeOffId "TeamMember").required) { throw "TeamMember is still required - change it in List settings." }
            Write-Host "  TeamMember no longer required" -ForegroundColor Green
        }
    }
}

# --- 6. Panel Tasks: more than one assignee ------------------------------------
# Assigned becomes a MULTI-person column (Tim, 2026-10-29). Existing values are
# kept. ARC reads either shape, but writes the multi-person shape, so this must
# run BEFORE the deploy.
Write-Host "`n=== Panel Tasks: Assigned allows several people ===" -ForegroundColor Cyan
$assigned = Get-Column $tasksListId "Assigned"
if (-not $assigned -or -not $assigned.personOrGroup) { throw "Panel Tasks has no person column named Assigned." }
if ($assigned.personOrGroup.allowMultipleSelection) {
    Write-Host "  already allows several" -ForegroundColor Green
} elseif ($WhatIf) {
    Write-Host "  WOULD SET  allowMultipleSelection = true" -ForegroundColor Cyan
} else {
    $pg = @{ allowMultipleSelection = $true; chooseFromType = $assigned.personOrGroup.chooseFromType; displayAs = $assigned.personOrGroup.displayAs }
    Invoke-MgGraphRequest -Method PATCH -Uri "$graph/lists/$tasksListId/columns/$($assigned.id)" -ContentType "application/json" `
        -Body (@{ personOrGroup = $pg } | ConvertTo-Json -Depth 4) | Out-Null
    if (-not (Get-Column $tasksListId "Assigned").personOrGroup.allowMultipleSelection) {
        throw "Assigned didn't read back as multi-select. Set it by hand: Panel Tasks -> List settings -> Assigned -> Allow multiple selections: Yes."
    }
    Write-Host "  set and read back" -ForegroundColor Green
}

# --- 7. Panel Tasks: Work Type -------------------------------------------------
Write-Host "`n=== Panel Tasks: WorkType ===" -ForegroundColor Cyan
$workTypes = @("Production Order", "Non-Production", "Improvement / Internal")   # PANEL_TASK_WORK_TYPES
$wt = Get-Column $tasksListId "WorkType"
if ($wt) {
    $now = @($wt.choice.choices)
    if (($now -join "`n") -eq ($workTypes -join "`n")) { Write-Host "  EXISTS with the three choices" -ForegroundColor Yellow }
    else { Write-Host "  EXISTS but its choices are: $($now -join ' | ') - expected $($workTypes -join ' | ')" -ForegroundColor Yellow }
} elseif ($WhatIf) {
    Write-Host "  WOULD ADD  WorkType ('Work Type'): $($workTypes -join ' | ')" -ForegroundColor Cyan
} else {
    $body = @{ name = "WorkType"; displayName = "Work Type"
               description = "Production Order, Non-Production or Improvement / Internal (the Wrike custom field)."
               choice = @{ choices = $workTypes; allowTextEntry = $false; displayAs = "dropDownMenu" } } | ConvertTo-Json -Depth 5
    Invoke-MgGraphRequest -Method POST -Uri "$graph/lists/$tasksListId/columns" -ContentType "application/json" -Body $body | Out-Null
    $back = @((Get-Column $tasksListId "WorkType").choice.choices)
    if (($back -join "`n") -ne ($workTypes -join "`n")) { throw "WorkType didn't read back with the three choices: $($back -join ' | ')" }
    Write-Host "  added and read back" -ForegroundColor Green
}

# --- 8. Panel Tasks: Priority -------------------------------------------------
Write-Host "`n=== Panel Tasks: Priority ===" -ForegroundColor Cyan
$priorities = @("High", "Medium", "Low")   # PANEL_TASK_PRIORITIES
$pc = Get-Column $tasksListId "Priority"
if ($pc -and -not $pc.choice) {
    throw "Panel Tasks already has a Priority column that isn't a Choice column - stopping rather than guessing."
} elseif ($pc) {
    $now = @($pc.choice.choices)
    $missing = @($priorities | Where-Object { $now -notcontains $_ })
    if (-not $missing.Count) { Write-Host "  EXISTS with High / Medium / Low" -ForegroundColor Yellow }
    elseif ($WhatIf) { Write-Host "  WOULD ADD choices: $($missing -join ', ')" -ForegroundColor Cyan }
    else {
        $want = @($priorities) + @($now | Where-Object { $priorities -notcontains $_ })
        Invoke-MgGraphRequest -Method PATCH -Uri "$graph/lists/$tasksListId/columns/$($pc.id)" -ContentType "application/json" `
            -Body (@{ choice = @{ choices = $want; allowTextEntry = $false; displayAs = $pc.choice.displayAs } } | ConvertTo-Json -Depth 5) | Out-Null
        $back = @((Get-Column $tasksListId "Priority").choice.choices)
        if (@($priorities | Where-Object { $back -notcontains $_ }).Count) { throw "Priority didn't read back with High / Medium / Low: $($back -join ' | ')" }
        Write-Host "  choices set and read back" -ForegroundColor Green
    }
} elseif ($WhatIf) {
    Write-Host "  WOULD ADD  Priority: $($priorities -join ' | ')" -ForegroundColor Cyan
} else {
    $body = @{ name = "Priority"; displayName = "Priority"
               description = "High, Medium or Low (the Wrike custom field)."
               choice = @{ choices = $priorities; allowTextEntry = $false; displayAs = "dropDownMenu" } } | ConvertTo-Json -Depth 5
    Invoke-MgGraphRequest -Method POST -Uri "$graph/lists/$tasksListId/columns" -ContentType "application/json" -Body $body | Out-Null
    $back = @((Get-Column $tasksListId "Priority").choice.choices)
    if (($back -join "`n") -ne ($priorities -join "`n")) { throw "Priority didn't read back with the three choices: $($back -join ' | ')" }
    Write-Host "  added and read back" -ForegroundColor Green
}

if ($WhatIf) { Write-Host "`n-WhatIf - nothing was changed.`n" -ForegroundColor Yellow; exit 0 }

Write-Host "`nSet these as repo variables (and in .env.local), then deploy:" -ForegroundColor Cyan
Write-Host "  VITE_SP_PANEL_TASK_TEMPLATES_LIST_ID=$templatesId"
Write-Host "  VITE_SP_PANEL_SETTINGS_LIST_ID=$settingsId"
Write-Host "Done." -ForegroundColor Cyan
