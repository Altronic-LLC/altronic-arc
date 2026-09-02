<#
.SYNOPSIS
    Creates the ARC Feature Requests list on the Altronic_Engineering site.

.DESCRIPTION
    Backs a new "Suggest a feature" screen next to the Report Issue button in
    the ARC header — a place to ask for a new ARC feature or change, separate
    from Report Issue (which is for something that's BROKEN).

        ARC Feature Requests
            Title           short summary (built-in column)
            Description     what's needed and why, multi-line plain text
            Department      choice — which team this is for; mirrors
                             DASHBOARD_DEPARTMENTS in src/types/task.ts, plus
                             "Cross-department" for something that isn't one
                             team's alone
            RequestedBy     single person — auto-filled to the submitter on
                             create, never hand-picked
            Priority        choice — Low / Medium / High
            Status          choice — Pending Review / In Work / Completed /
                             Not Implementing
            TargetVersion   text — filled in once the request is scheduled or
                             shipped (e.g. "v0.142.0"); blank until then
            Communication   the comment thread, SAME shape as every other
                             comment-carrying list in ARC (pipe-delimited
                             records — see src/lib/communicationParser.ts) —
                             NOT a single text field, so it supports the
                             ordinary @-mention/reply flow every other list
                             gets for free
            Watchers        multi-person — auto: requester + anyone who
                             comments, same as every other list in ARC

    Idempotent: a list that already exists is left alone and missing columns
    are added.

.PARAMETER WhatIf
    Print what would be created without creating anything.

.EXAMPLE
    ./scripts/create-feature-requests-list.ps1 -WhatIf

.EXAMPLE
    ./scripts/create-feature-requests-list.ps1

.NOTES
    Needs Sites.Manage.All — creating a list is a write. Connect-MgGraph will
    prompt for consent the first time.
#>
param(
    [switch]$WhatIf
)

$ErrorActionPreference = "Stop"

# Mirrored from src/api/config.ts (SITES.engineering).
$EngineeringSite = "coopermachineryservices.sharepoint.com,ddb5fc80-ea51-4d56-b008-ce6a82af49b0,aa6b9467-3f57-4213-bbd4-60b94403421a"

# Mirrors DASHBOARD_DEPARTMENTS in src/types/task.ts, plus one extra choice
# for a request that isn't any one team's — most feature requests about ARC
# itself (navigation, the dashboard, cross-cutting behavior) aren't owned by
# a single department the way a task or an EIR is.
$Departments = @(
    "Cross-department",
    "Engineering",
    "Panels",
    "Operations",
    "Coils",
    "Quality Control",
    "Supply Chain",
    "Customer Service / Sales"
)

$Priorities = @("Low", "Medium", "High")
$Statuses   = @("Pending Review", "In Work", "Completed", "Not Implementing")

$ListName    = "ARC Feature Requests"
$EnvVar      = "VITE_SP_FEATURE_REQUESTS_LIST_ID"
$Description = "Requests for new ARC features or changes, raised by any signed-in user. Title = short summary."

$Columns = @(
    @{ name = "Description"; displayName = "Description"; text = @{ allowMultipleLines = $true; textType = "plain" } },
    @{
        name        = "Department"
        displayName = "Department"
        choice      = @{
            choices        = $Departments
            displayAs      = "dropDownMenu"
            allowTextEntry = $false
        }
    },
    @{ name = "RequestedBy"; displayName = "Requested By"; personOrGroup = @{ allowMultipleSelection = $false } },
    @{
        name        = "Priority"
        displayName = "Priority"
        choice      = @{
            choices        = $Priorities
            displayAs      = "dropDownMenu"
            allowTextEntry = $false
        }
    },
    @{
        name        = "Status"
        displayName = "Status"
        choice      = @{
            choices        = $Statuses
            displayAs      = "dropDownMenu"
            allowTextEntry = $false
        }
        defaultValue = @{ value = "Pending Review" }
    },
    @{ name = "TargetVersion"; displayName = "Target Version"; text = @{ allowMultipleLines = $false } },
    # The comment thread — pipe-delimited records, the same shape ARC already
    # parses for tasks/EIRs/etc (src/lib/communicationParser.ts). A plain
    # multi-line text column, NOT SharePoint's "Enhanced rich text" — that
    # distinction matters: EIRs' long-text columns ARE Enhanced rich text and
    # need HTML written into them (see CLAUDE.md, "The EIR long-text columns
    # are Enhanced rich text"), but Communication columns everywhere else in
    # ARC are plain text holding the pipe-delimited format, and this one
    # should match those, not the EIR fields.
    @{ name = "Communication"; displayName = "Communication"; text = @{ allowMultipleLines = $true; textType = "plain" } },
    @{ name = "Watchers"; displayName = "Watchers"; personOrGroup = @{ allowMultipleSelection = $true } }
)

$ctx = Get-MgContext
if (-not $ctx -or $ctx.Scopes -notcontains "Sites.Manage.All") {
    Write-Host "Signing in (Sites.Manage.All — creating a list is a write)..." -ForegroundColor Cyan
    try {
        Connect-MgGraph -Scopes "Sites.Manage.All" -NoWelcome
    } catch {
        Connect-MgGraph -Scopes "Sites.Manage.All" -UseDeviceCode -NoWelcome
    }
}

function Get-ExistingLists([string]$Site) {
    $found = @{}
    $uri = "https://graph.microsoft.com/v1.0/sites/$Site/lists?`$select=id,displayName&`$top=200"
    while ($uri) {
        # /lists is PAGED, and an unpaged call silently returns a subset — that
        # is how CAD's drawing log looked missing for a day. Follow nextLink.
        $page = Invoke-MgGraphRequest -Method GET -Uri $uri
        foreach ($l in $page.value) { $found[$l.displayName] = $l.id }
        $uri = $page.'@odata.nextLink'
    }
    return $found
}

Write-Host "`n$ListName" -ForegroundColor Cyan
$existing = Get-ExistingLists $EngineeringSite

if ($existing.ContainsKey($ListName)) {
    $listId = $existing[$ListName]
    Write-Host "  exists — id $listId" -ForegroundColor Yellow
} elseif ($WhatIf) {
    Write-Host "  WOULD CREATE with columns: $(($Columns | ForEach-Object { $_.name }) -join ', ')" -ForegroundColor Yellow
    Write-Host "`n-WhatIf — nothing was created.`n" -ForegroundColor Yellow
    exit 0
} else {
    $body = @{
        displayName = $ListName
        description = $Description
        list        = @{ template = "genericList" }
        columns     = $Columns
    } | ConvertTo-Json -Depth 10
    $created = Invoke-MgGraphRequest -Method POST `
        -Uri "https://graph.microsoft.com/v1.0/sites/$EngineeringSite/lists" `
        -Body $body -ContentType "application/json"
    $listId = $created.id
    Write-Host "  CREATED — id $listId" -ForegroundColor Green
}

# Add any column the list is missing (covers a list created by hand, or a
# choice value someone forgot to add).
if (-not $WhatIf) {
    $existingCols = (Invoke-MgGraphRequest -Method GET `
        -Uri "https://graph.microsoft.com/v1.0/sites/$EngineeringSite/lists/$listId/columns").value
    $have = @($existingCols | ForEach-Object { $_.name })

    foreach ($col in $Columns) {
        if (-not ($have -contains $col.name)) {
            Invoke-MgGraphRequest -Method POST `
                -Uri "https://graph.microsoft.com/v1.0/sites/$EngineeringSite/lists/$listId/columns" `
                -Body ($col | ConvertTo-Json -Depth 10) -ContentType "application/json" | Out-Null
            Write-Host "    $($col.name) — added" -ForegroundColor Green
        } else {
            Write-Host "    $($col.name) — already there"
        }
    }
}

Write-Host "`nAdd this to .env.local (and to the GitHub Actions repo variables):" -ForegroundColor Cyan
Write-Host "  $EnvVar=$listId" -ForegroundColor Green
Write-Host ""
Write-Host "THEN REDEPLOY. VITE_* variables are baked into the bundle when it is" -ForegroundColor Yellow
Write-Host "built, so setting a repo variable does nothing until the next deploy" -ForegroundColor Yellow
Write-Host "runs. Until then the Feature Requests screen reports itself as not" -ForegroundColor Yellow
Write-Host "configured, the same way an unconfigured list works everywhere else" -ForegroundColor Yellow
Write-Host "in ARC." -ForegroundColor Yellow
Write-Host ""
