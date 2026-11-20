<#
.SYNOPSIS
    Confirms the folder ARC saves customer quote PDFs to exists. READ-ONLY.

.DESCRIPTION
    Insourcing Quotes saves a generated PDF (only when somebody presses Save to
    folder) into `General/IC Quotes` in the default Documents library of the
    Altronic_PMO site (SITES.pmo). Ray gave the location as a sharing link; a
    share token can be regenerated, so ARC addresses the folder by PATH, and
    this script proves that path against live Graph before anything is built
    on it.

    GETs only. No folder is created and nothing is written. If the folder is
    missing, create it in SharePoint by hand — ARC never creates it, and a
    folder is never written with conflictBehavior "replace" (that would
    replace its contents).

.PARAMETER SiteId
    Graph site id. Defaults to Altronic_PMO (SITES.pmo in src/api/config.ts).

.PARAMETER FolderPath
    Path inside the default drive. Defaults to "General/IC Quotes".

.EXAMPLE
    ./scripts/verify-quote-pdf-folder.ps1

.NOTES
    Connect-MgGraph will prompt for sign-in the first time (Sites.Read.All).
#>
param(
    [string]$SiteId = "coopermachineryservices.sharepoint.com,915a6183-2b71-4dfd-a8b9-181126dfbe78,3eb6cb9c-6535-4c69-a8d7-e90b2f90a9eb",
    [string]$FolderPath = "General/IC Quotes"
)

$ErrorActionPreference = "Stop"

if (-not (Get-MgContext)) {
    Connect-MgGraph -Scopes "Sites.Read.All" -NoWelcome
}

function Get-EncodedPath([string]$Path) {
    # Graph wants each segment percent-encoded, but the slashes intact.
    ($Path -split "/" | ForEach-Object { [System.Uri]::EscapeDataString($_) }) -join "/"
}

Write-Host "`nResolving the default Documents library" -ForegroundColor Cyan
try {
    $drive = Invoke-MgGraphRequest -Method GET `
        -Uri "https://graph.microsoft.com/v1.0/sites/$SiteId/drive?`$select=id,name,webUrl,driveType"
} catch {
    Write-Host "  Couldn't read the site's default drive: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
Write-Host "  name     $($drive['name'])"
Write-Host "  drive id $($drive['id'])"
Write-Host "  webUrl   $($drive['webUrl'])"

$encoded = Get-EncodedPath $FolderPath
$base = "https://graph.microsoft.com/v1.0/sites/$SiteId/drive/root:/$encoded"

Write-Host "`nResolving  $FolderPath" -ForegroundColor Cyan
try {
    $folder = Invoke-MgGraphRequest -Method GET -Uri $base
} catch {
    Write-Host "  NOT FOUND — ARC would fail to save quote PDFs here." -ForegroundColor Red
    Write-Host "  $($_.Exception.Message)"
    Write-Host "`n  Check the folder name and casing in SharePoint (Ray: 'IC Quotes', under General)." -ForegroundColor Yellow
    Write-Host "  This script never creates it." -ForegroundColor Yellow
    exit 1
}

if (-not $folder['folder']) {
    Write-Host "  FOUND, but it is a FILE, not a folder — ARC cannot save into it." -ForegroundColor Red
    exit 1
}

Write-Host "  FOUND" -ForegroundColor Green
Write-Host "  name     $($folder['name'])"
Write-Host "  drive id $($folder['parentReference']['driveId'])"
Write-Host "  item id  $($folder['id'])"
Write-Host "  webUrl   $($folder['webUrl'])"
Write-Host "  children $($folder['folder']['childCount'])"

if ($folder['name'] -cne ($FolderPath -split "/")[-1]) {
    Write-Host "`n  Note: SharePoint's name is '$($folder['name'])' — the path lookup is case-insensitive," -ForegroundColor Yellow
    Write-Host "  so match ARC's constant to that spelling." -ForegroundColor Yellow
}

Write-Host "`nContents (first 50):" -ForegroundColor Cyan
$children = Invoke-MgGraphRequest -Method GET `
    -Uri "${base}:/children?`$select=id,name,size,folder,file,lastModifiedDateTime&`$top=50"
foreach ($c in $children.value | Sort-Object { $_['folder'] -eq $null }, { $_['name'] }) {
    if ($c['folder']) {
        Write-Host ("  [dir ] {0,-44} {1} item(s)" -f $c['name'], $c['folder']['childCount'])
    } else {
        $kb = [math]::Round(($c['size'] / 1KB), 0)
        Write-Host ("  [file] {0,-44} {1} KB   {2}" -f $c['name'], $kb, $c['lastModifiedDateTime'])
    }
}
if ($children.value.Count -eq 0) { Write-Host "  (empty)" }
Write-Host ""
