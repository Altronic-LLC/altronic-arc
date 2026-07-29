<#
.SYNOPSIS
    Dumps the id, columns, and sample rows of a SharePoint list so ARC can be
    coded against its real field names.

.DESCRIPTION
    Generalised from discover-teradyne-lists.ps1, because every new ARC app needs
    this same snapshot before a line of code is worth writing. Resolves the list
    by DISPLAY NAME on a named ARC site, so you only need the name off the list's
    URL — no GUID hunting.

    For the list it finds, it records:
      - the list's id (the value that goes in src/api/config.ts), name, web URL
      - every column: internal name (what Graph returns under item.fields),
        display name, type, required / read-only / hidden, choice values, and
        lookup targets
      - up to 5 sample rows' raw `fields` payloads, so the real data shapes
        (person envelopes, lookup ids, date formats) are visible

    Results are written to scripts/<slug>-schema.json — Claude reads that file
    directly, so there's nothing to copy and paste.

.PARAMETER ListName
    One or more list display names, e.g. "CSA Listings" (from
    .../Lists/CSA%20Listings/). Pass several comma-separated to snapshot a whole
    feature's lists in one go.

.PARAMETER Site
    Which ARC site to look on. Defaults to engineering.

.PARAMETER SiteId
    A raw Graph site id, if the list lives on a site not in the table below.

.EXAMPLE
    ./scripts/discover-list.ps1 -ListName "CSA Listings"

.EXAMPLE
    ./scripts/discover-list.ps1 -ListName "CAD Drawings","CCC Drawings","CEC Drawings"

.EXAMPLE
    ./scripts/discover-list.ps1 -ListName "Panel Order Headers" -Site panelTeam

.NOTES
    Requires the Microsoft.Graph.Authentication module. Run interactively —
    Connect-MgGraph will prompt for sign-in the first time. Read-only: GETs only.
#>

param(
    [Parameter(Mandatory = $true)]
    [string[]]$ListName,

    [ValidateSet("engineering", "pmo", "panelTeam", "salesTeam", "salesOrderEntry")]
    [string]$Site = "engineering",

    [string]$SiteId
)

$ErrorActionPreference = "Stop"

# Mirrored from src/api/config.ts (SITES). Keep in sync if that file changes.
$sites = @{
    engineering     = "coopermachineryservices.sharepoint.com,ddb5fc80-ea51-4d56-b008-ce6a82af49b0,aa6b9467-3f57-4213-bbd4-60b94403421a"
    pmo             = "coopermachineryservices.sharepoint.com,915a6183-2b71-4dfd-a8b9-181126dfbe78,3eb6cb9c-6535-4c69-a8d7-e90b2f90a9eb"
    panelTeam       = "coopermachineryservices.sharepoint.com,fdf31131-2076-4618-923b-a1856e6b0f2a,3eb6cb9c-6535-4c69-a8d7-e90b2f90a9eb"
    salesTeam       = "coopermachineryservices.sharepoint.com,dd86bf69-a010-481a-9920-78b079c5ec1e,aa6b9467-3f57-4213-bbd4-60b94403421a"
    salesOrderEntry = "coopermachineryservices.sharepoint.com,dd86bf69-a010-481a-9920-78b079c5ec1e,583688a6-3238-4f79-aed5-8e2d8ce38c41"
}

$targetSite = if ($SiteId) { $SiteId } else { $sites[$Site] }

if (-not (Get-Module -ListAvailable -Name Microsoft.Graph.Authentication)) {
    Write-Host "Microsoft.Graph.Authentication module not found. Install it with:" -ForegroundColor Yellow
    Write-Host "  Install-Module Microsoft.Graph.Authentication -Scope CurrentUser" -ForegroundColor Yellow
    exit 1
}
Import-Module Microsoft.Graph.Authentication

if (-not (Get-MgContext)) {
    Connect-MgGraph -Scopes "Sites.Read.All" -NoWelcome
}

# Every list on the site, following @odata.nextLink.
#
# The paging matters: the Engineering site has more lists than one page holds, and
# a single $top=200 call silently returned a subset — which is why this script
# once reported "CAD Drawings" as missing when the list was there all along.
Write-Host "Reading lists on $Site..." -ForegroundColor Cyan
$allLists = @()
$next = "https://graph.microsoft.com/v1.0/sites/$targetSite/lists?`$top=200"
while ($next) {
    $page = Invoke-MgGraphRequest -Method GET -Uri $next
    $allLists += $page.value
    $next = if ($page.ContainsKey('@odata.nextLink')) { $page['@odata.nextLink'] } else { $null }
}
Write-Host "  $($allLists.Count) lists" -ForegroundColor Cyan

$written = @()
foreach ($name in $ListName) {

# ---------------------------------------------------------------------------
# 1. Find the list by display name.
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "=== $name ===" -ForegroundColor Cyan
$lists = $allLists
$squash = { param($t) if ($t) { $t.Replace(" ", "").ToLower() } else { "" } }
$want = & $squash $name

# Match on DISPLAY name, then on URL name, then on the webUrl's /Lists/<name>
# segment. Those three drift apart: SharePoint fixes a list's URL when it's
# created and keeps it through every later rename, so a list whose URL still says
# "CAD Drawings" can have any display name at all. Comparing only display names
# is how this script first failed to find one.
$list = $lists | Where-Object { $_["displayName"] -eq $name }
if (-not $list) { $list = $lists | Where-Object { (& $squash $_["displayName"]) -eq $want } }
if (-not $list) { $list = $lists | Where-Object { (& $squash $_["name"]) -eq $want } }
if (-not $list) {
    $list = $lists | Where-Object {
        $leaf = ($_["webUrl"] -split "/" | Where-Object { $_ } | Select-Object -Last 1)
        (& $squash ([System.Uri]::UnescapeDataString($leaf))) -eq $want
    }
}
if ($list -is [array]) { $list = $list[0] }

if (-not $list) {
    Write-Host "  No list matching '$name' on $Site. Skipping." -ForegroundColor Red
    Write-Host "  Lists visible to you there (display name <- URL name):" -ForegroundColor Yellow
    $lists |
        Sort-Object { $_["displayName"] } |
        ForEach-Object { "    {0}  <-  {1}" -f $_["displayName"], $_["name"] }
    continue
}

$listId = $list["id"]
Write-Host "  FOUND — id $listId" -ForegroundColor Green
Write-Host "  $($list['webUrl'])"

# ---------------------------------------------------------------------------
# 2. Columns.
# ---------------------------------------------------------------------------
$cols = (Invoke-MgGraphRequest -Method GET `
    -Uri "https://graph.microsoft.com/v1.0/sites/$targetSite/lists/$listId/columns").value

$columns = foreach ($c in $cols) {
    $type = "unknown"
    foreach ($k in @("text", "choice", "number", "dateTime", "boolean", "lookup",
                     "personOrGroup", "currency", "calculated", "hyperlinkOrPicture",
                     "thumbnail", "term", "contentApprovalStatus", "geolocation")) {
        if ($c.ContainsKey($k) -and $c[$k]) { $type = $k; break }
    }

    $row = [ordered]@{
        internalName = $c["name"]
        displayName  = $c["displayName"]
        type         = $type
        required     = [bool]$c["required"]
        readOnly     = [bool]$c["readOnly"]
        hidden       = [bool]$c["hidden"]
    }
    if ($type -eq "choice") {
        $row["choices"] = @($c["choice"]["choices"])
    }
    if ($type -eq "lookup") {
        $row["lookupListId"]  = $c["lookup"]["listId"]
        $row["lookupColumn"]  = $c["lookup"]["columnName"]
        $row["allowMultiple"] = [bool]$c["lookup"]["allowMultipleValues"]
    }
    if ($type -eq "personOrGroup") {
        $row["allowMultiple"] = [bool]$c["personOrGroup"]["allowMultipleSelection"]
    }
    if ($type -eq "dateTime")   { $row["format"] = $c["dateTime"]["format"] }
    if ($type -eq "calculated") { $row["formula"] = $c["calculated"]["formula"] }
    if ($type -eq "number")     { $row["decimalPlaces"] = $c["number"]["decimalPlaces"] }
    $row
}

Write-Host ""
Write-Host "=== Columns ===" -ForegroundColor Green
$columns | Where-Object { -not $_.hidden } | ForEach-Object {
    $extra = ""
    if ($_.type -eq "choice") { $extra = " [" + ($_.choices -join " | ") + "]" }
    if ($_.type -eq "lookup") {
        $extra = " -> list " + $_.lookupListId + "." + $_.lookupColumn +
                 $(if ($_.allowMultiple) { " MULTI" } else { " single" })
    }
    if ($_.type -eq "personOrGroup" -and $_.allowMultiple) { $extra = " (multi)" }
    if ($_.type -eq "calculated") { $extra = " = " + $_.formula }
    $flags = @()
    if ($_.required) { $flags += "required" }
    if ($_.readOnly) { $flags += "readonly" }
    $flagStr = if ($flags) { "  {" + ($flags -join ",") + "}" } else { "" }
    "  $($_.internalName.PadRight(34))$($_.type.PadRight(15))$($_.displayName)$extra$flagStr"
}

# ---------------------------------------------------------------------------
# 3. Sample rows + rough size.
# ---------------------------------------------------------------------------
$samples = @()
try {
    $items = Invoke-MgGraphRequest -Method GET `
        -Uri "https://graph.microsoft.com/v1.0/sites/$targetSite/lists/$listId/items?expand=fields&`$top=5"
    $samples = @($items.value | ForEach-Object { $_["fields"] })
    Write-Host ""
    Write-Host "Sample rows captured: $($samples.Count)"
} catch {
    Write-Host "Could not read items: $($_.Exception.Message)" -ForegroundColor Yellow
}

$itemCount = $null
try {
    $resp = Invoke-MgGraphRequest -Method GET `
        -Uri "https://graph.microsoft.com/v1.0/sites/$targetSite/lists/$listId/items?`$select=id&`$top=999"
    $itemCount = @($resp.value).Count
    if ($resp.ContainsKey('@odata.nextLink')) { $itemCount = "$itemCount+ (more pages)" }
    Write-Host "Approx item count: $itemCount"
} catch { }

# ---------------------------------------------------------------------------
# 4. Write the snapshot.
# ---------------------------------------------------------------------------
$report = [ordered]@{
    listName    = $list["displayName"]
    listId      = $listId
    site        = $Site
    siteId      = $targetSite
    webUrl      = $list["webUrl"]
    itemCount   = $itemCount
    columns     = @($columns)
    sampleRows  = $samples
}

$slug = ($name.ToLower() -replace '[^a-z0-9]+', '-').Trim('-')
$outPath = Join-Path $PSScriptRoot "$slug-schema.json"
$report | ConvertTo-Json -Depth 12 | Set-Content -Path $outPath -Encoding utf8

Write-Host "  Wrote $outPath" -ForegroundColor Green
Write-Host "  List id for src/api/config.ts: $listId" -ForegroundColor Green
$written += [pscustomobject]@{ List = $list["displayName"]; Id = $listId; File = $outPath }

}  # end foreach list

Write-Host ""
Write-Host "=== Snapshots written ===" -ForegroundColor Green
$written | Format-Table -AutoSize
