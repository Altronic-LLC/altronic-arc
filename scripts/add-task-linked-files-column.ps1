<#
.SYNOPSIS
    Adds the LinkedFiles column to the Project Task List (BusinessIT#62).

.DESCRIPTION
    ARC links files that are already in the Engineering project-folder library
    to a task, instead of uploading a second copy. The links are kept on the
    task in one column: internal name `LinkedFiles`, shown as "Linked Files",
    multi-line PLAIN text holding a JSON array (Graph can't write a Hyperlink
    column). This adds that column and nothing else.

    ARC reads the column ON ITS OWN, never in the task list's read, so the
    deploy does not break if this hasn't run yet - the task page's Linked files
    just says linking isn't set up. Run it before people need the button.

    Idempotent: an existing column is checked (multi-line, plain text, Append
    Changes off) and not recreated. A NEW column is read back and checked the
    same way - Graph created the live one with Append Changes ON although this
    request asks for it off (2026-11-25), and turning it off took List settings.

    -WriteCheckTaskId <id> also WRITES AND READS BACK a test value on that task,
    then puts the task's own value back. Use a test task: the write changes the
    task's Modified date. A 2xx from a write is not evidence the value landed
    (see "A field called DisplayName is silently dropped" in CLAUDE.md), and a
    second write that doubles the first means Append Changes is on.

    Requires Sites.Manage.All. RUN THIS IN YOUR OWN TERMINAL: the sign-in is
    interactive. Pass -DeviceCode if the browser popup can't open.

.NOTES
    Adding a column is reversible (delete it in list settings) and leaves every
    existing task untouched - they read as no linked files.
#>

param(
    [switch]$WhatIf,
    [int]$WriteCheckTaskId = 0,
    [switch]$DeviceCode
)

$ErrorActionPreference = "Stop"
Import-Module Microsoft.Graph.Authentication

$siteId = "coopermachineryservices.sharepoint.com,ddb5fc80-ea51-4d56-b008-ce6a82af49b0,aa6b9467-3f57-4213-bbd4-60b94403421a"
$listId = "42fb8c19-5f33-4fdd-9ef7-df6f21433588"   # Project Task List, Altronic_Engineering
$graph  = "https://graph.microsoft.com/v1.0/sites/$siteId/lists/$listId"

$column = @{
    name        = "LinkedFiles"
    displayName = "Linked Files"
    description = "Files in the project folder library linked to this task. Written by ARC - don't edit by hand."
    text        = @{
        allowMultipleLines          = $true
        textType                    = "plain"
        appendChangesToExistingText = $false
        linesForEditing             = 6
    }
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

# Checked on an existing column AND straight after creating one: Graph can
# create the column with Append Changes ON even though the request asks for it
# off (it did on 2026-11-25), and says nothing about it.
function Test-LinkedFilesColumn($col) {
    $t = $col["text"]
    if (-not $t -or -not $t["allowMultipleLines"] -or $t["textType"] -ne "plain") {
        Write-Host "  It is NOT multi-line plain text - ARC needs that. Fix it in list settings." -ForegroundColor Red
    }
    if ($t -and $t["appendChangesToExistingText"]) {
        Write-Host "  Graph says Append Changes to Existing Text is ON. Turn it off in List settings > Linked Files," -ForegroundColor Red
        Write-Host "  then run again with -WriteCheckTaskId <a test task's id>. Don't let anyone link files until then." -ForegroundColor Red
    } elseif ($t) {
        Write-Host "  Multi-line plain text, Append Changes off." -ForegroundColor Green
    }
}

if ($found) {
    Write-Host "SKIP   $($column.name) - already exists" -ForegroundColor Yellow
    Test-LinkedFilesColumn $found
} elseif ($WhatIf) {
    Write-Host "WOULD CREATE  $($column.name) (multi-line plain text, '$($column.displayName)')" -ForegroundColor Cyan
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
    # Read it back rather than trusting the POST's answer.
    $reread = (Invoke-MgGraphRequest -Method GET -Uri "$graph/columns").value |
        Where-Object { $_["name"] -eq $column.name }
    Test-LinkedFilesColumn $reread
}

if ($WhatIf -or $WriteCheckTaskId -le 0) {
    if (-not $WhatIf) {
        Write-Host "`nNo write check run. Pass -WriteCheckTaskId <a test task's id> to prove the column." -ForegroundColor Cyan
    }
    return
}

# --- write and read back, on a test task, then restore -------------------
Write-Host "`n=== Write/read-back check on task $WriteCheckTaskId ===" -ForegroundColor Cyan
$select = "`$expand=fields(`$select=Title,LinkedFiles)"
$before = Invoke-MgGraphRequest -Method GET -Uri "$graph/items/$($WriteCheckTaskId)?$select"
$original = $before.fields["LinkedFiles"]
Write-Host "  Task: $($before.fields['Title'])"

$one = '[{"id":"ARC-VERIFY-1","name":"verify-1.pdf","webUrl":"#","folderPath":"","linkedBy":"ARC check","linkedByEmail":"","linkedAt":"2026-01-01T00:00:00.000Z"}]'
$two = '[{"id":"ARC-VERIFY-2","name":"verify-2.pdf","webUrl":"#","folderPath":"","linkedBy":"ARC check","linkedByEmail":"","linkedAt":"2026-01-01T00:00:00.000Z"}]'
$bad = @()
try {
    foreach ($value in @($one, $two)) {
        Invoke-MgGraphRequest -Method PATCH -Uri "$graph/items/$WriteCheckTaskId/fields" -ContentType "application/json" `
            -Body (@{ LinkedFiles = $value } | ConvertTo-Json) | Out-Null
        $back = Invoke-MgGraphRequest -Method GET -Uri "$graph/items/$($WriteCheckTaskId)?$select"
        if ($back.fields["LinkedFiles"] -ne $value) {
            $bad += "wrote $value`n      read back $($back.fields['LinkedFiles'])"
        }
    }
} finally {
    Invoke-MgGraphRequest -Method PATCH -Uri "$graph/items/$WriteCheckTaskId/fields" -ContentType "application/json" `
        -Body (@{ LinkedFiles = $original } | ConvertTo-Json) | Out-Null
    Write-Host "  Put the task's own value back." -ForegroundColor Gray
}

if ($bad) {
    Write-Host "  LinkedFiles did NOT read back as written - fix before using it (a doubled value means Append Changes is on):" -ForegroundColor Red
    $bad | ForEach-Object { Write-Host "    $_" -ForegroundColor Red }
} else {
    Write-Host "  LinkedFiles wrote and read back twice, the second replacing the first." -ForegroundColor Green
    Write-Host "`nThe Project Task List is ready for linked files." -ForegroundColor Cyan
}
