<#
.SYNOPSIS
    Creates the two SharePoint lists the Open Orders Report Tool needs, on the
    ALTRONICSALESTEAM site.

.DESCRIPTION
    Two lists, both small and admin-maintained:

      Open Orders Report Customers — who gets an individual workbook each week
        Title            the SOLD-TO ACCOUNT NUMBER (not a name)
        CustomerName     the customer-facing name, used for the FILENAME
        RegionalManager  who sends it; printed on the customer's Summary tab
        Active           yes/no — off the weekly run without deleting the row
        Notes            free text

      Open Orders Roles — who may edit that list and run the weekly job
        Title            the user's EMAIL
        DisplayName      their name, for the admin table
        Roles            lowercase CSV of tags; today only "report manager"
        Note             free text

    `CustomerName` is a separate column for a reason worth keeping in mind: SAP
    truncates its own Customer Name at 30 characters ("Wabtec Transportation
    Systems,", "INNIO Waukesha Canada Corporat"), and the workbook a CUSTOMER
    receives is named from this list rather than from a truncation.

    The Roles list is the same shape as EIR Roles on the Engineering site — Ray
    asked for these permissions to work "like the eir permissions"
    (2026-08-24). If you would rather run one roles list company-wide, skip
    creating this one and point VITE_SP_OPEN_ORDERS_ROLES_LIST_ID at the EIR
    Roles list instead; the shape is identical and the tag namespace separate.

    Idempotent: a list that already exists is left alone, and only missing
    columns are added.

.PARAMETER SeedFromExtract
    Optional path to a raw open-orders extract. Seeds the customer list with
    the accounts in it, so there is something to work with immediately.
    Names come from SAP and WILL be truncated at 30 characters — fix them by
    hand afterwards, which is the whole point of the column.

.PARAMETER WhatIf
    Print what would be created without creating anything.

.EXAMPLE
    ./scripts/create-open-orders-lists.ps1 -WhatIf

.EXAMPLE
    ./scripts/create-open-orders-lists.ps1

.NOTES
    Needs Sites.Manage.All — creating a list is a write. Connect-MgGraph will
    prompt for consent the first time.
#>
param(
    [string]$SeedFromExtract,
    [switch]$WhatIf
)

$ErrorActionPreference = "Stop"

# Mirrored from src/api/config.ts (SITES.salesTeam).
$SiteId = "coopermachineryservices.sharepoint.com,dd86bf69-a010-481a-9920-78b079c5ec1e,aa6b9467-3f57-4213-bbd4-60b94403421a"

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
        Description = "Customers who receive an individual open orders workbook each week. Title = sold-to account number."
        Columns     = @(
            (New-TextColumn "CustomerName" "Customer Name"),
            (New-TextColumn "RegionalManager" "Regional Manager"),
            (New-BoolColumn "Active" "Active"),
            (New-TextColumn "Notes" "Notes" $true)
        )
    },
    @{
        Name        = "Open Orders Roles"
        Description = "Who may edit the Open Orders customer list and run the weekly generation. Title = email."
        Columns     = @(
            (New-TextColumn "DisplayName" "Display Name"),
            (New-TextColumn "Roles" "Roles"),
            (New-TextColumn "Note" "Note")
        )
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

Write-Host "`nReading existing lists on the Sales site..." -ForegroundColor Cyan
$existing = @{}
$uri = "https://graph.microsoft.com/v1.0/sites/$SiteId/lists?`$select=id,displayName&`$top=200"
while ($uri) {
    # /lists is PAGED, and an unpaged call silently returns a subset — that is
    # how CAD's drawing log looked missing for a day. Follow nextLink.
    $page = Invoke-MgGraphRequest -Method GET -Uri $uri
    foreach ($l in $page.value) { $existing[$l.displayName] = $l.id }
    $uri = $page.'@odata.nextLink'
}
Write-Host "  $($existing.Count) lists"

$envLines = @()

foreach ($spec in $Lists) {
    $name = $spec.Name
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

    $varName = if ($name -like "*Customers*") { "VITE_SP_OPEN_ORDERS_CUSTOMERS_LIST_ID" } else { "VITE_SP_OPEN_ORDERS_ROLES_LIST_ID" }
    $envLines += "$varName=$listId"
}

if ($WhatIf) {
    Write-Host "`n-WhatIf — nothing was created.`n" -ForegroundColor Yellow
    exit 0
}

# Optionally seed the customer list from a real extract.
if ($SeedFromExtract) {
    if (-not (Test-Path $SeedFromExtract)) { throw "No such file: $SeedFromExtract" }
    Write-Host "`nSeeding is NOT done by this script." -ForegroundColor Yellow
    Write-Host "  Run the app's own seeding from the Open Orders screen instead — it" -ForegroundColor Yellow
    Write-Host "  uses the same parser as the report, so the account numbers match" -ForegroundColor Yellow
    Write-Host "  exactly what the weekly run will look for." -ForegroundColor Yellow
}

Write-Host "`nAdd these to .env.local (and to the GitHub Actions repo variables):" -ForegroundColor Cyan
foreach ($line in $envLines) { Write-Host "  $line" -ForegroundColor Green }
Write-Host ""
Write-Host "Until the ROLES list id is set, role gating stays OFF and anyone signed" -ForegroundColor Yellow
Write-Host "in can edit the customer list — deliberate, so nobody is locked out of a" -ForegroundColor Yellow
Write-Host "list before an admin has populated it." -ForegroundColor Yellow
Write-Host ""
