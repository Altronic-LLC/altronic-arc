<#
.SYNOPSIS
    Creates the Quick Links list on the Altronic_Engineering site.

.DESCRIPTION
    Backs Admin -> Quick Links (/admin/quick-links) and the button row each
    Dashboard department can show above its cards (src/api/quickLinks.ts).

        Quick Links
            Title       button label (built-in column)
            Url         the link target, MULTI-LINE plain text — SharePoint
                        caps single-line text at 255 characters, and a real
                        SharePoint page URL (view IDs, encoded folder paths)
                        routinely runs past that. Confirmed live 2026-08-28:
                        an EX-4000 Documents-library link at 378 characters
                        400'd on a single-line column.
            Department  choice — must match DASHBOARD_DEPARTMENTS in
                        src/types/task.ts exactly, including the slash in
                        "Customer Service / Sales"
            SortOrder   number — admin-set, ascending, unique only WITHIN
                        one department

    Idempotent: a list that already exists is left alone, missing columns
    are added, and an existing Url column still stuck on single-line is
    converted to multi-line in place — safe to re-run after the 255-char
    limit bites, with no need to delete and recreate the list.

.PARAMETER WhatIf
    Print what would be created without creating anything.

.EXAMPLE
    ./scripts/create-quick-links-list.ps1 -WhatIf

.EXAMPLE
    ./scripts/create-quick-links-list.ps1

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

# Must match DASHBOARD_DEPARTMENTS in src/types/task.ts exactly — that array
# is also what DashboardView's own section titles come from, so drifting
# here means a link nobody's Dashboard section can ever show.
$Departments = @(
    "Engineering",
    "Panels",
    "Operations",
    "Coils",
    "Quality Control",
    "Supply Chain",
    "Customer Service / Sales"
)

$ListName   = "Quick Links"
$EnvVar     = "VITE_SP_QUICK_LINKS_LIST_ID"
$Description = "Admin-managed button links shown above a Dashboard department's cards. Title = button label."

$Columns = @(
    # Multi-line plain text, not single-line: SharePoint caps single-line
    # text at 255 characters, and a real page URL (view ids, encoded folder
    # names) routinely exceeds that. This still reads and writes as a plain
    # string in Graph — "plain" textType, unlike EIR's Enhanced rich text
    # columns, so there's no HTML to worry about.
    @{ name = "Url"; displayName = "Url"; text = @{ allowMultipleLines = $true; textType = "plain" } },
    @{
        name        = "Department"
        displayName = "Department"
        choice      = @{
            choices       = $Departments
            displayAs     = "dropDownMenu"
            allowTextEntry = $false
        }
    },
    @{
        name        = "SortOrder"
        displayName = "Sort Order"
        number      = @{ decimalPlaces = "none" }
    }
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
# choice value someone forgot to add). Also self-heals an existing Url column
# still stuck on single-line (255-char cap) from before that was fixed here.
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
            continue
        }

        if ($col.name -eq "Url") {
            $existingUrl = $existingCols | Where-Object { $_.name -eq "Url" }
            if ($existingUrl.text -and -not $existingUrl.text.allowMultipleLines) {
                # Was created (or hand-made) as single-line, capped at 255
                # characters — convert in place rather than delete/recreate,
                # which would orphan every link already saved against it.
                Invoke-MgGraphRequest -Method PATCH `
                    -Uri "https://graph.microsoft.com/v1.0/sites/$EngineeringSite/lists/$listId/columns/$($existingUrl.id)" `
                    -Body (@{ text = @{ allowMultipleLines = $true; textType = "plain" } } | ConvertTo-Json -Depth 10) `
                    -ContentType "application/json" | Out-Null
                Write-Host "    $($col.name) — was single-line (255-char cap), converted to multi-line" -ForegroundColor Green
                continue
            }
        }

        Write-Host "    $($col.name) — already there"
    }
}

Write-Host "`nAdd this to .env.local (and to the GitHub Actions repo variables):" -ForegroundColor Cyan
Write-Host "  $EnvVar=$listId" -ForegroundColor Green
Write-Host ""
Write-Host "THEN REDEPLOY. VITE_* variables are baked into the bundle when it is" -ForegroundColor Yellow
Write-Host "built, so setting a repo variable does nothing until the next deploy" -ForegroundColor Yellow
Write-Host "runs. Until then the Dashboard shows no Quick Links and the admin page" -ForegroundColor Yellow
Write-Host "says the list isn't configured yet." -ForegroundColor Yellow
Write-Host ""
