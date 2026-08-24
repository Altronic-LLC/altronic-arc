<#
.SYNOPSIS
    Creates the Open Orders Report Tool's customer list on the ALTRONICSALESTEAM
    site.

.DESCRIPTION
    One list by default (Ray, 2026-08-24 — "i only want customer list not
    roles"):

      Open Orders Report Customers — who gets an individual workbook each week
        Title            the SOLD-TO ACCOUNT NUMBER (not a name)
        CustomerName     the customer-facing name, used for the FILENAME
        Active           yes/no — off the weekly run without deleting the row
        Notes            free text

    With no roles list, Open Orders role gating stays OFF: **any signed-in user
    can run the weekly job and edit the customer list**. That is the designed
    fail-open behaviour, and it matches Visit Reports, the other Sales feature —
    open to anyone signed in, with SharePoint's own list permission as the real
    boundary. Pass -IncludeOpenOrdersRoles later if that turns out to be too
    open.

    `CustomerName` is a separate column for a reason worth keeping in mind: SAP
    truncates its own Customer Name at 30 characters ("Wabtec Transportation
    Systems,", "INNIO Waukesha Canada Corporat"), and the workbook a CUSTOMER
    receives is named from this list rather than from a truncation.

    Idempotent: a list that already exists is left alone, and only missing
    columns are added.

.PARAMETER IncludeOpenOrdersRoles
    Also create the **Open Orders Roles** list, which switches role gating on:
    only a tagged "report manager" (or an ARC admin) could then run the weekly
    job or edit the customer list. Off by default.

    Do NOT point VITE_SP_OPEN_ORDERS_ROLES_LIST_ID at the existing EIR Roles
    list to save making one. The two screens parse different tag sets and each
    DROPS tags it does not recognise on save, so editing a shared row in
    /admin/eir-roles would silently strip "report manager" from it — and the
    reverse in /admin/open-orders-roles would strip "engineer". One list per
    tag namespace.

.PARAMETER IncludeEirRoles
    Also create the **EIR Roles** list on the Engineering site.

    ARC has had the full EIR role-gating feature since Aug 2026 — api/eirRoles.ts,
    useMyEirRoles, and an admin screen at /admin/eir-roles — but the SharePoint
    list behind it was never created, so VITE_SP_EIR_ROLES_LIST_ID is unset and
    EIR field gating is OFF in production (that is deliberate: gating stays off
    until the list exists, so nobody is locked out of a field before an admin
    can grant the role). This switch creates it, with the same columns
    api/eirRoles.ts reads.

.PARAMETER WhatIf
    Print what would be created without creating anything.

.EXAMPLE
    ./scripts/create-open-orders-lists.ps1 -WhatIf

.EXAMPLE
    ./scripts/create-open-orders-lists.ps1

.EXAMPLE
    ./scripts/create-open-orders-lists.ps1 -IncludeEirRoles

.NOTES
    Needs Sites.Manage.All — creating a list is a write. Connect-MgGraph will
    prompt for consent the first time.
#>
param(
    [switch]$IncludeOpenOrdersRoles,
    [switch]$IncludeEirRoles,
    [switch]$WhatIf
)

$ErrorActionPreference = "Stop"

# Mirrored from src/api/config.ts (SITES).
$SalesSite = "coopermachineryservices.sharepoint.com,dd86bf69-a010-481a-9920-78b079c5ec1e,aa6b9467-3f57-4213-bbd4-60b94403421a"
$EngineeringSite = "coopermachineryservices.sharepoint.com,ddb5fc80-ea51-4d56-b008-ce6a82af49b0,aa6b9467-3f57-4213-bbd4-60b94403421a"

function New-TextColumn([string]$Name, [string]$Display, [bool]$MultiLine = $false) {
    if ($MultiLine) {
        return @{ name = $Name; displayName = $Display; text = @{ allowMultipleLines = $true; textType = "plain" } }
    }
    return @{ name = $Name; displayName = $Display; text = @{ allowMultipleLines = $false } }
}

function New-BoolColumn([string]$Name, [string]$Display) {
    return @{ name = $Name; displayName = $Display; boolean = @{} }
}

$Lists = @(
    @{
        Name        = "Open Orders Report Customers"
        Site        = $SalesSite
        EnvVar      = "VITE_SP_OPEN_ORDERS_CUSTOMERS_LIST_ID"
        Description = "Customers who receive an individual open orders workbook each week. Title = sold-to account number."
        Columns     = @(
            (New-TextColumn "CustomerName" "Customer Name"),
            (New-BoolColumn "Active" "Active"),
            (New-TextColumn "Notes" "Notes" $true)
        )
    }
)

if ($IncludeOpenOrdersRoles) {
    $Lists += @{
        Name        = "Open Orders Roles"
        Site        = $SalesSite
        EnvVar      = "VITE_SP_OPEN_ORDERS_ROLES_LIST_ID"
        Description = "Who may edit the Open Orders customer list and run the weekly generation. Title = email."
        Columns     = @(
            (New-TextColumn "DisplayName" "Display Name"),
            (New-TextColumn "Roles" "Roles"),
            (New-TextColumn "Note" "Note")
        )
    }
}

if ($IncludeEirRoles) {
    $Lists += @{
        Name        = "EIR Roles"
        Site        = $EngineeringSite
        EnvVar      = "VITE_SP_EIR_ROLES_LIST_ID"
        Description = "Which EIR fields a user may edit. Title = email; Roles is a CSV of 'engineer' / 'supply chain'."
        Columns     = @(
            (New-TextColumn "DisplayName" "Display Name"),
            (New-TextColumn "Roles" "Roles"),
            (New-TextColumn "Note" "Note")
        )
    }
}

$ctx = Get-MgContext
if (-not $ctx -or $ctx.Scopes -notcontains "Sites.Manage.All") {
    Write-Host "Signing in (Sites.Manage.All — creating a list is a write)..." -ForegroundColor Cyan
    try {
        Connect-MgGraph -Scopes "Sites.Manage.All" -NoWelcome
    } catch {
        Connect-MgGraph -Scopes "Sites.Manage.All" -UseDeviceCode -NoWelcome
    }
}

# Existing lists, cached per site.
$listsBySite = @{}
function Get-ExistingLists([string]$Site) {
    if ($listsBySite.ContainsKey($Site)) { return $listsBySite[$Site] }
    $found = @{}
    $uri = "https://graph.microsoft.com/v1.0/sites/$Site/lists?`$select=id,displayName&`$top=200"
    while ($uri) {
        # /lists is PAGED, and an unpaged call silently returns a subset — that
        # is how CAD's drawing log looked missing for a day. Follow nextLink.
        $page = Invoke-MgGraphRequest -Method GET -Uri $uri
        foreach ($l in $page.value) { $found[$l.displayName] = $l.id }
        $uri = $page.'@odata.nextLink'
    }
    $listsBySite[$Site] = $found
    return $found
}

$envLines = @()

foreach ($spec in $Lists) {
    $name = $spec.Name
    $SiteId = $spec.Site
    $existing = Get-ExistingLists $SiteId
    Write-Host "`n$name" -ForegroundColor Cyan

    if ($existing.ContainsKey($name)) {
        $listId = $existing[$name]
        Write-Host "  exists — id $listId" -ForegroundColor Yellow
    } elseif ($WhatIf) {
        Write-Host "  WOULD CREATE with columns: $(($spec.Columns | ForEach-Object { $_.name }) -join ', ')" -ForegroundColor Yellow
        continue
    } else {
        $body = @{
            displayName = $name
            description = $spec.Description
            list        = @{ template = "genericList" }
            columns     = $spec.Columns
        } | ConvertTo-Json -Depth 10
        $created = Invoke-MgGraphRequest -Method POST `
            -Uri "https://graph.microsoft.com/v1.0/sites/$SiteId/lists" `
            -Body $body -ContentType "application/json"
        $listId = $created.id
        Write-Host "  CREATED — id $listId" -ForegroundColor Green
    }

    # Add any column the list is missing (covers a list created by hand).
    if (-not $WhatIf) {
        $have = @((Invoke-MgGraphRequest -Method GET `
            -Uri "https://graph.microsoft.com/v1.0/sites/$SiteId/lists/$listId/columns").value | ForEach-Object { $_.name })
        foreach ($col in $spec.Columns) {
            if ($have -contains $col.name) {
                Write-Host "    $($col.name) — already there"
                continue
            }
            Invoke-MgGraphRequest -Method POST `
                -Uri "https://graph.microsoft.com/v1.0/sites/$SiteId/lists/$listId/columns" `
                -Body ($col | ConvertTo-Json -Depth 10) -ContentType "application/json" | Out-Null
            Write-Host "    $($col.name) — added" -ForegroundColor Green
        }
    }

    $envLines += "$($spec.EnvVar)=$listId"
}

if ($WhatIf) {
    Write-Host "`n-WhatIf — nothing was created.`n" -ForegroundColor Yellow
    exit 0
}

Write-Host "`nAdd these to .env.local (and to the GitHub Actions repo variables):" -ForegroundColor Cyan
foreach ($line in $envLines) { Write-Host "  $line" -ForegroundColor Green }
Write-Host ""
Write-Host "THEN REDEPLOY. VITE_* variables are baked into the bundle when it is" -ForegroundColor Yellow
Write-Host "built, so setting a repo variable does nothing until the next deploy" -ForegroundColor Yellow
Write-Host "runs. Until then the app still reports the list as not set up." -ForegroundColor Yellow
Write-Host ""
Write-Host "Populate the customer list from ARC: Open Orders -> Customer list ->" -ForegroundColor Cyan
Write-Host "'Import from an extract'. It reads the accounts with the same parser the" -ForegroundColor Cyan
Write-Host "report uses, so the account numbers match what the weekly run looks for." -ForegroundColor Cyan
Write-Host ""
if (-not $IncludeOpenOrdersRoles) {
    Write-Host "No Open Orders Roles list was created, so role gating stays OFF:" -ForegroundColor Yellow
    Write-Host "any signed-in user can run the weekly job and edit the customer list." -ForegroundColor Yellow
    Write-Host "Re-run with -IncludeOpenOrdersRoles if that needs locking down." -ForegroundColor Yellow
}
Write-Host ""
