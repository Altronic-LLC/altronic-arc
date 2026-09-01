<#
.SYNOPSIS
    Creates the "Maintenance Roles" list on the Altronic_PMO site.

.DESCRIPTION
    One row per person, saying what they are allowed to do in the CMMS. Same
    shape as the EIR Roles and Panel User Roles lists ARC already uses, so the
    api/hook/admin-screen pattern carries over unchanged:

      Title        the person's EMAIL. Never a display name - names are not
                   unique, they arrive written several ways ("Waldron, Jerrod"),
                   and matching on one is how the wrong person gets access.
      DisplayName  who it is, for the admin screen to show.
      Role         a single-value choice: "Tech" or "Admin". Admin implies Tech.
      Note         free text - why they have it, who asked, when to revisit.

    The two levels:

      tech    can COMPLETE a work order, and can log a PM (which is what
              creates a work order off a schedule).
      admin   everything tech can, PLUS managing the asset register, the
              department and location lists, and creating or editing PM
              schedules.

    Idempotent: an existing list is left alone and only missing columns are
    added. Start with -WhatIf.

    RUN IN YOUR OWN TERMINAL - the sign-in is interactive and a browser popup
    cannot be surfaced from a background shell.

.PARAMETER Seed
    Also add a first row for the signed-in user as Admin, so whoever runs this
    cannot lock themselves out of the screens it gates. Admin implies Tech, so
    one row covers both. Strongly recommended on the first run.

.NOTES
    After creating it, put the id it prints into src/api/config.ts as
    SP_MAINTENANCE_ROLES_LIST_ID (env VITE_SP_MAINTENANCE_ROLES_LIST_ID) AND add
    that var to .github/workflows/deploy.yml's named list - a VITE_* var absent
    from that list can never reach a production build.

    LOCKOUT SAFETY, mirroring EIR_ROLES_ENFORCED: gating stays OFF until the
    list id is configured, and ARC admins always count as maintenance admins.
    So an empty or unconfigured list means "everyone keeps what they have
    today", never "nobody can do anything".
#>

[CmdletBinding()]
param(
    [switch]$WhatIf,
    [switch]$DeviceCode,
    [switch]$Seed
)

$ErrorActionPreference = "Stop"
Import-Module Microsoft.Graph.Authentication

$siteId = "coopermachineryservices.sharepoint.com,915a6183-2b71-4dfd-a8b9-181126dfbe78,3eb6cb9c-6535-4c69-a8d7-e90b2f90a9eb"
$listName = "Maintenance Roles"

$columns = @(
    @{
        name        = "DisplayName"
        displayName = "Display Name"
        description = "Who this is. Shown on the admin screen; never used for matching."
        text        = @{ allowMultipleLines = $false; maxLength = 255; textType = "plain" }
    },
    @{
        name        = "Role"
        displayName = "Role"
        description = "The person's level. Admin implies Tech - an admin who could create PM schedules but not complete a work order would be absurd."
        choice      = @{ allowTextEntry = $false; choices = @("Tech", "Admin"); displayAs = "dropDownMenu" }
    },
    @{
        name        = "Note"
        displayName = "Note"
        description = "Why this person has this level, who asked for it, and when to revisit."
        text        = @{ allowMultipleLines = $true; appendChangesToExistingText = $false; linesForEditing = 4; textType = "plain" }
    }
)

$ctx = Get-MgContext
if (-not $ctx -or $ctx.Scopes -notcontains "Sites.Manage.All") {
    Write-Host "Signing in for write access (Sites.Manage.All)..." -ForegroundColor Cyan
    if ($DeviceCode) { Connect-MgGraph -Scopes "Sites.Manage.All" -UseDeviceCode -NoWelcome }
    else             { Connect-MgGraph -Scopes "Sites.Manage.All" -NoWelcome }
}

if ($WhatIf) {
    Write-Host ""
    Write-Host "*** -WhatIf: nothing will be changed ***" -ForegroundColor Magenta
}

# --- Does it already exist? -------------------------------------------------
# /lists is PAGED. An unpaged $top=200 call silently returned a subset once and
# made a list that was there look missing (see CLAUDE.md, drawing logs).
Write-Host "Looking for an existing '$listName'..." -ForegroundColor Cyan
$found = @{}
$uri = "https://graph.microsoft.com/v1.0/sites/$siteId/lists?`$select=id,displayName&`$top=200"
while ($uri) {
    $page = Invoke-MgGraphRequest -Method GET -Uri $uri
    foreach ($l in $page.value) { $found[$l.displayName] = $l.id }
    $uri = $page["@odata.nextLink"]
}
Write-Host ("  {0} lists on the site" -f $found.Count) -ForegroundColor Gray

$listId = $found[$listName]

if (-not $listId) {
    if ($WhatIf) {
        Write-Host "  WOULD CREATE '$listName' with columns: $(($columns | ForEach-Object { $_.name }) -join ', ')" -ForegroundColor Cyan
        Write-Host ""
        Write-Host "Re-run without -WhatIf to create it." -ForegroundColor Yellow
        return
    }
    Write-Host "  CREATE '$listName'..." -ForegroundColor Green
    $body = @{
        displayName = $listName
        list        = @{ template = "genericList" }
        columns     = $columns
    } | ConvertTo-Json -Depth 8
    $created = Invoke-MgGraphRequest -Method POST `
        -Uri "https://graph.microsoft.com/v1.0/sites/$siteId/lists" `
        -Body $body -ContentType "application/json"
    $listId = $created["id"]
    Write-Host "       created" -ForegroundColor Green
} else {
    Write-Host "  EXISTS - checking its columns" -ForegroundColor Yellow
    $have = (Invoke-MgGraphRequest -Method GET `
        -Uri "https://graph.microsoft.com/v1.0/sites/$siteId/lists/$listId/columns").value |
        ForEach-Object { $_["name"] }
    foreach ($col in $columns) {
        if ($have -contains $col.name) {
            Write-Host ("    SKIP   {0}" -f $col.name) -ForegroundColor Yellow
            continue
        }
        if ($WhatIf) { Write-Host ("    WOULD ADD {0}" -f $col.name) -ForegroundColor Cyan; continue }
        Write-Host ("    ADD    {0}" -f $col.name) -ForegroundColor Green
        Invoke-MgGraphRequest -Method POST `
            -Uri "https://graph.microsoft.com/v1.0/sites/$siteId/lists/$listId/columns" `
            -Body ($col | ConvertTo-Json -Depth 6) -ContentType "application/json" | Out-Null
    }
}

# --- Seed the runner, so nobody locks themselves out -----------------------
if ($Seed -and -not $WhatIf) {
    $me = Invoke-MgGraphRequest -Method GET `
        -Uri "https://graph.microsoft.com/v1.0/me?`$select=mail,displayName,userPrincipalName"
    # The MAILBOX, falling back to the UPN. A sign-in name is not a mailbox and
    # in this tenant they differ - matching on the wrong one is what cost
    # Steven Pirko his EIR role access (CLAUDE.md, lib/emailIdentity.ts).
    $email = if ($me["mail"]) { $me["mail"] } else { $me["userPrincipalName"] }
    Write-Host ""
    Write-Host "Seeding '$email' as Admin (which implies Tech)..." -ForegroundColor Cyan

    $rows = (Invoke-MgGraphRequest -Method GET `
        -Uri "https://graph.microsoft.com/v1.0/sites/$siteId/lists/$listId/items?`$expand=fields(`$select=Title)").value
    $already = $rows | Where-Object { "$($_.fields.Title)".ToLower() -eq $email.ToLower() }
    if ($already) {
        Write-Host "  SKIP - already listed" -ForegroundColor Yellow
    } else {
        $item = @{ fields = @{
            Title       = $email
            DisplayName = $me["displayName"]
            Role        = "Admin"
            Note        = "Seeded by create-maintenance-roles-list.ps1 on first run."
        } } | ConvertTo-Json -Depth 6
        Invoke-MgGraphRequest -Method POST `
            -Uri "https://graph.microsoft.com/v1.0/sites/$siteId/lists/$listId/items" `
            -Body $item -ContentType "application/json" | Out-Null
        Write-Host "  added" -ForegroundColor Green
    }
} elseif (-not $Seed) {
    Write-Host ""
    Write-Host "NOT seeded. Pass -Seed to add yourself as tech,admin on the first run —" -ForegroundColor Yellow
    Write-Host "otherwise the list exists with nobody in it." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "=== Next steps ===" -ForegroundColor Cyan
Write-Host "  List id for src/api/config.ts:" -ForegroundColor White
Write-Host "    $listId" -ForegroundColor Green
Write-Host ""
Write-Host "  1. SP_MAINTENANCE_ROLES_LIST_ID in src/api/config.ts" -ForegroundColor Gray
Write-Host "  2. VITE_SP_MAINTENANCE_ROLES_LIST_ID in .github/workflows/deploy.yml" -ForegroundColor Gray
Write-Host "  3. A LISTS entry is NOT needed - this is a roles list, not a mail recipient list." -ForegroundColor Gray
Write-Host ""
Write-Host "  Remember: gating stays OFF until that id is set, and ARC admins always" -ForegroundColor Gray
Write-Host "  count. An unconfigured list must never mean 'nobody can do anything'." -ForegroundColor Gray
