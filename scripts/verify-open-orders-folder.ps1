<#
.SYNOPSIS
    Confirms the Open Orders folder tree ARC writes to actually exists, and
    reports what is in it.

.DESCRIPTION
    Ray supplied the destination as a SHARING link:

        https://coopermachineryservices.sharepoint.com/:f:/s/ALTRONICSALESTEAM/IgABH6FP…

    A share token is a poor thing to hardcode — it can be regenerated, and the
    two links he sent carried different `e=` values. The path ARC uses was
    derived instead from the OneDrive sync mapping for that same folder:

        MountPoint    C:\…\ALTRONIC SALES TEAM - General 1\Order Management\OPEN ORDERS
        UrlNamespace  https://coopermachineryservices.sharepoint.com/sites/
                        ALTRONICSALESTEAM/Shared Documents/

    which resolves to `General/Order Management/OPEN ORDERS` in the default
    drive of SITES.salesTeam.

    This script proves that resolution against live Graph. It is READ-ONLY —
    GETs only, no folder is created and nothing is written.

.PARAMETER ShareLink
    Optionally also resolve a sharing link through /shares and print the path
    it lands on, so the two can be compared. Paste the link Ray sent.

.EXAMPLE
    ./scripts/verify-open-orders-folder.ps1

.EXAMPLE
    ./scripts/verify-open-orders-folder.ps1 -ShareLink "https://…/:f:/s/ALTRONICSALESTEAM/IgABH6FP…"

.NOTES
    Connect-MgGraph will prompt for sign-in the first time.
#>
param(
    [string]$ShareLink
)

$ErrorActionPreference = "Stop"

# Mirrored from src/api/config.ts (SITES) and src/api/openOrdersFiles.ts.
$SalesTeamSite = "coopermachineryservices.sharepoint.com,dd86bf69-a010-481a-9920-78b079c5ec1e,aa6b9467-3f57-4213-bbd4-60b94403421a"
$OpenOrdersPath = "General/Order Management/OPEN ORDERS"

if (-not (Get-MgContext)) {
    Connect-MgGraph -Scopes "Sites.Read.All" -NoWelcome
}

function Get-EncodedPath([string]$Path) {
    # Graph wants each segment percent-encoded, but the slashes intact.
    ($Path -split "/" | ForEach-Object { [System.Uri]::EscapeDataString($_) }) -join "/"
}

$encoded = Get-EncodedPath $OpenOrdersPath
$base = "https://graph.microsoft.com/v1.0/sites/$SalesTeamSite/drive/root:/$encoded"

Write-Host "`nResolving  $OpenOrdersPath" -ForegroundColor Cyan
try {
    $folder = Invoke-MgGraphRequest -Method GET -Uri $base
} catch {
    Write-Host "  NOT FOUND — ARC would fail to write here." -ForegroundColor Red
    Write-Host "  $($_.Exception.Message)"
    Write-Host "`n  Check the folder name and casing in SharePoint, then update" -ForegroundColor Yellow
    Write-Host "  OPEN_ORDERS_PATH in src/api/openOrdersFiles.ts to match." -ForegroundColor Yellow
    exit 1
}

Write-Host "  FOUND" -ForegroundColor Green
Write-Host "  name     $($folder['name'])"
Write-Host "  id       $($folder['id'])"
Write-Host "  webUrl   $($folder['webUrl'])"
Write-Host "  children $($folder['folder']['childCount'])"

Write-Host "`nContents:" -ForegroundColor Cyan
$children = Invoke-MgGraphRequest -Method GET -Uri "${base}:/children?`$select=id,name,size,folder,file,lastModifiedDateTime"
foreach ($c in $children.value | Sort-Object { $_['folder'] -eq $null }, { $_['name'] }) {
    if ($c['folder']) {
        Write-Host ("  [dir ] {0,-40} {1} item(s)" -f $c['name'], $c['folder']['childCount'])
    } else {
        $kb = [math]::Round(($c['size'] / 1KB), 0)
        Write-Host ("  [file] {0,-40} {1} KB   {2}" -f $c['name'], $kb, $c['lastModifiedDateTime'])
    }
}
if ($children.value.Count -eq 0) { Write-Host "  (empty)" }

# The RAW UPLOADS subfolder is where the weekly extract is dropped.
$rawEncoded = Get-EncodedPath "$OpenOrdersPath/RAW UPLOADS"
Write-Host "`nResolving  $OpenOrdersPath/RAW UPLOADS" -ForegroundColor Cyan
try {
    $raw = Invoke-MgGraphRequest -Method GET `
        -Uri "https://graph.microsoft.com/v1.0/sites/$SalesTeamSite/drive/root:/${rawEncoded}:/children?`$select=name,size,lastModifiedDateTime"
    if ($raw.value.Count -eq 0) {
        Write-Host "  FOUND, empty — no extract uploaded yet." -ForegroundColor Yellow
    } else {
        Write-Host "  FOUND" -ForegroundColor Green
        foreach ($c in $raw.value) {
            Write-Host ("  {0,-46} {1} KB   {2}" -f $c['name'], [math]::Round(($c['size'] / 1KB), 0), $c['lastModifiedDateTime'])
        }
    }
} catch {
    Write-Host "  NOT FOUND — ARC creates it on the first run, so this is fine." -ForegroundColor Yellow
}

# Optional: resolve the sharing link and compare where it actually points.
if ($ShareLink) {
    Write-Host "`nResolving the sharing link through /shares" -ForegroundColor Cyan
    $b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($ShareLink))
    $token = "u!" + $b64.TrimEnd("=").Replace("/", "_").Replace("+", "-")
    try {
        $item = Invoke-MgGraphRequest -Method GET `
            -Uri "https://graph.microsoft.com/v1.0/shares/$token/driveItem?`$select=id,name,webUrl,parentReference"
        Write-Host "  name    $($item['name'])" -ForegroundColor Green
        Write-Host "  webUrl  $($item['webUrl'])"
        Write-Host "  path    $($item['parentReference']['path'])"
        Write-Host "`n  Compare that path with '$OpenOrdersPath' above — they should agree." -ForegroundColor Yellow
    } catch {
        Write-Host "  Couldn't resolve it: $($_.Exception.Message)" -ForegroundColor Red
        Write-Host "  (A share token can expire or be regenerated, which is exactly why" -ForegroundColor Yellow
        Write-Host "   ARC addresses the folder by path instead.)" -ForegroundColor Yellow
    }
}

Write-Host ""
