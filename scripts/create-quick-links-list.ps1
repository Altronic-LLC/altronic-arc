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

    Idempotent: a list that already exists is left alone and missing columns
    are added. An existing Url column still stuck on single-line (255-char
    cap) is fixed by DELETING and RECREATING just that column — SharePoint
    refuses an in-place PATCH from single-line to multi-line text (confirmed
    live 2026-08-28: "Provided data is not compatible with target field
    type"), so there is no non-destructive way to convert it. The script
    checks the list is empty first and refuses to touch a Url column that
    already has rows against it — see the item-count guard below.

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
                # Single-line, capped at 255 characters. SharePoint refuses a
                # PATCH that changes allowMultipleLines — it is a genuine
                # underlying field-type change (Text -> Note), not a property
                # tweak — so the only fix is delete-and-recreate. That drops
                # any values already stored against this column, so check the
                # list is actually empty first.
                $itemCount = (Invoke-MgGraphRequest -Method GET `
                    -Uri "https://graph.microsoft.com/v1.0/sites/$EngineeringSite/lists/$listId/items?`$top=1&`$select=id").value.Count
                if ($itemCount -gt 0) {
                    Write-Host "    $($col.name) — still single-line (255-char cap), but the list has rows" -ForegroundColor Red
                    Write-Host "      Refusing to delete/recreate Url automatically — that would lose" -ForegroundColor Red
                    Write-Host "      whatever is stored in it on existing rows. Move the data (or accept" -ForegroundColor Red
                    Write-Host "      the loss) and re-run, or fix it by hand in SharePoint list settings." -ForegroundColor Red
                    continue
                }
                Invoke-MgGraphRequest -Method DELETE `
                    -Uri "https://graph.microsoft.com/v1.0/sites/$EngineeringSite/lists/$listId/columns/$($existingUrl.id)" | Out-Null
                Invoke-MgGraphRequest -Method POST `
                    -Uri "https://graph.microsoft.com/v1.0/sites/$EngineeringSite/lists/$listId/columns" `
                    -Body ($col | ConvertTo-Json -Depth 10) -ContentType "application/json" | Out-Null
                Write-Host "    $($col.name) — was single-line (255-char cap); list was empty, so recreated as multi-line" -ForegroundColor Green
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
