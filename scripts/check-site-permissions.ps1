<#
.SYNOPSIS
    Checks Microsoft Graph Sites.Selected permission grants for every ARC
    SharePoint site registered in src/api/config.ts's SITES object.

.DESCRIPTION
    Requires the Microsoft.Graph.Sites PowerShell module and an account with
    rights to read site permissions (Sites.FullControl.All or equivalent, or
    Global/SharePoint admin). Run interactively — Connect-MgGraph will prompt
    for sign-in.

.NOTES
    Site IDs below are mirrored from src/api/config.ts (SITES). If that file
    changes, update this list to match.
#>

$sites = @(
    [pscustomobject]@{ Name = "engineering";     SiteId = "coopermachineryservices.sharepoint.com,ddb5fc80-ea51-4d56-b008-ce6a82af49b0,aa6b9467-3f57-4213-bbd4-60b94403421a" }
    [pscustomobject]@{ Name = "panelTeam";       SiteId = "coopermachineryservices.sharepoint.com,fdf31131-2076-4618-923b-a1856e6b0f2a,3eb6cb9c-6535-4c69-a8d7-e90b2f90a9eb" }
    [pscustomobject]@{ Name = "salesTeam";       SiteId = "coopermachineryservices.sharepoint.com,dd86bf69-a010-481a-9920-78b079c5ec1e,aa6b9467-3f57-4213-bbd4-60b94403421a" }
    [pscustomobject]@{ Name = "salesOrderEntry"; SiteId = "coopermachineryservices.sharepoint.com,dd86bf69-a010-481a-9920-78b079c5ec1e,583688a6-3238-4f79-aed5-8e2d8ce38c41" }
    [pscustomobject]@{ Name = "pmo";             SiteId = "coopermachineryservices.sharepoint.com,915a6183-2b71-4dfd-a8b9-181126dfbe78,3eb6cb9c-6535-4c69-a8d7-e90b2f90a9eb" }
)

if (-not (Get-Module -ListAvailable -Name Microsoft.Graph.Sites)) {
    Write-Host "Microsoft.Graph.Sites module not found. Install it with:" -ForegroundColor Yellow
    Write-Host "  Install-Module Microsoft.Graph.Sites -Scope CurrentUser" -ForegroundColor Yellow
    exit 1
}

Import-Module Microsoft.Graph.Sites -ErrorAction Stop

if (-not (Get-MgContext)) {
    Connect-MgGraph -Scopes "Sites.FullControl.All" -NoWelcome
}

$results = foreach ($site in $sites) {
    Write-Host "Checking $($site.Name) ($($site.SiteId))..." -ForegroundColor Cyan
    try {
        $perms = Get-MgSitePermission -SiteId $site.SiteId -ErrorAction Stop
        if (-not $perms) {
            [pscustomobject]@{
                Site        = $site.Name
                AppId       = "(none)"
                AppName     = "(none)"
                Roles       = "NO GRANTS FOUND"
                Status      = "MISSING"
            }
        } else {
            foreach ($p in $perms) {
                $appId   = $p.GrantedToIdentities.Application.Id          -join ", "
                $appName = $p.GrantedToIdentities.Application.DisplayName -join ", "
                if (-not $appId) {
                    $appId   = $p.GrantedToIdentitiesV2.Application.Id          -join ", "
                    $appName = $p.GrantedToIdentitiesV2.Application.DisplayName -join ", "
                }
                [pscustomobject]@{
                    Site    = $site.Name
                    AppId   = $appId
                    AppName = $appName
                    Roles   = ($p.Roles -join ", ")
                    Status  = "GRANTED"
                }
            }
        }
    } catch {
        [pscustomobject]@{
            Site    = $site.Name
            AppId   = "(error)"
            AppName = "(error)"
            Roles   = $_.Exception.Message
            Status  = "ERROR"
        }
    }
}

Write-Host ""
Write-Host "=== Sites.Selected grant summary ===" -ForegroundColor Green
$results | Format-Table -AutoSize

$missing = $results | Where-Object { $_.Status -ne "GRANTED" }
if ($missing) {
    Write-Host ""
    Write-Host "Sites needing a grant (run for each): " -ForegroundColor Yellow
    foreach ($m in $missing) {
        Write-Host "  POST https://graph.microsoft.com/v1.0/sites/<siteId>/permissions" -ForegroundColor Yellow
    }
}
