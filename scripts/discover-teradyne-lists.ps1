<#
.SYNOPSIS
    Discovers the site, columns, and sample rows for the four Teradyne
    SharePoint lists so ARC can be coded against their real field names.

.DESCRIPTION
    You give Graph four list IDs; Graph needs a SITE to resolve them against.
    This script walks every site already registered in src/api/config.ts
    (SITES) and asks each one for each list, so it figures out which site hosts
    the Teradyne lists without anyone having to look it up.

    For every list it finds, it records:
      - the list's display name + web URL
      - every column: internal name (what Graph returns under item.fields),
        display name, type, whether it's required / read-only / hidden,
        choice values for choice columns, and the target list for lookups
      - up to 5 sample items' raw `fields` payloads, so the actual data shape
        (person-field envelopes, lookup shapes, date formats) is visible

    Results are written to scripts/teradyne-schema.json — Claude reads that
    file directly, so there's nothing to copy and paste.

.PARAMETER ExtraSiteId
    Optional. A Graph site ID to search IN ADDITION to the registered ones,
    in case the Teradyne lists live on a site ARC doesn't know about yet.
    Format: "host,siteCollectionGuid,webGuid".

.EXAMPLE
    ./scripts/discover-teradyne-lists.ps1

.EXAMPLE
    ./scripts/discover-teradyne-lists.ps1 -ExtraSiteId "coopermachineryservices.sharepoint.com,<coll>,<web>"

.NOTES
    Requires the Microsoft.Graph.Authentication module. Run interactively —
    Connect-MgGraph will prompt for sign-in the first time. Read-only: this
    script only issues GETs.
#>

param(
    [string]$ExtraSiteId
)

$ErrorActionPreference = "Stop"

# Mirrored from src/api/config.ts (SITES). Keep in sync if that file changes.
# PMO is first because that's where the Teradyne lists live (confirmed by Ray,
# 2026-07-28) — the rest stay in the list as a fallback in case a list ID turns
# out to point somewhere else.
$sites = [ordered]@{
    pmo             = "coopermachineryservices.sharepoint.com,915a6183-2b71-4dfd-a8b9-181126dfbe78,3eb6cb9c-6535-4c69-a8d7-e90b2f90a9eb"
    engineering     = "coopermachineryservices.sharepoint.com,ddb5fc80-ea51-4d56-b008-ce6a82af49b0,aa6b9467-3f57-4213-bbd4-60b94403421a"
    panelTeam       = "coopermachineryservices.sharepoint.com,fdf31131-2076-4618-923b-a1856e6b0f2a,3eb6cb9c-6535-4c69-a8d7-e90b2f90a9eb"
    salesTeam       = "coopermachineryservices.sharepoint.com,dd86bf69-a010-481a-9920-78b079c5ec1e,aa6b9467-3f57-4213-bbd4-60b94403421a"
    salesOrderEntry = "coopermachineryservices.sharepoint.com,dd86bf69-a010-481a-9920-78b079c5ec1e,583688a6-3238-4f79-aed5-8e2d8ce38c41"
}
if ($ExtraSiteId) { $sites["extra"] = $ExtraSiteId }

# The four lists. "Teradyne Log" is the primary; the other three are its lookups.
$lists = [ordered]@{
    "Teradyne Log"       = "1fc8d786-cbc0-4c0d-8473-b1eb7aca8f3d"
    "Teradyne Employees" = "1d7900c4-a6a0-4a14-86f7-62024d846a7a"
    "Teradyne Products"  = "0113f8d2-4c8b-4bba-955f-323c90a91a16"
    "Teradyne Remarks"   = "3d7ccd9a-e1d8-4faa-9d46-bcbf94d76e3b"
}

if (-not (Get-Module -ListAvailable -Name Microsoft.Graph.Authentication)) {
    Write-Host "Microsoft.Graph.Authentication module not found. Install it with:" -ForegroundColor Yellow
    Write-Host "  Install-Module Microsoft.Graph.Authentication -Scope CurrentUser" -ForegroundColor Yellow
    exit 1
}
Import-Module Microsoft.Graph.Authentication

if (-not (Get-MgContext)) {
    Connect-MgGraph -Scopes "Sites.Read.All" -NoWelcome
}

function Get-ListOnSite {
    param([string]$SiteId, [string]$ListId)
    try {
        return Invoke-MgGraphRequest -Method GET `
            -Uri "https://graph.microsoft.com/v1.0/sites/$SiteId/lists/$ListId"
    } catch {
        return $null
    }
}

# ---------------------------------------------------------------------------
# 1. Locate the lists. Probe with Teradyne Log first — the other three almost
#    certainly live beside it, but we verify each one rather than assuming.
# ---------------------------------------------------------------------------
$hostSiteName = $null
$hostSiteId = $null

foreach ($entry in $sites.GetEnumerator()) {
    Write-Host "Probing $($entry.Key) for Teradyne Log..." -ForegroundColor Cyan
    if (Get-ListOnSite -SiteId $entry.Value -ListId $lists["Teradyne Log"]) {
        $hostSiteName = $entry.Key
        $hostSiteId = $entry.Value
        Write-Host "  FOUND on '$($entry.Key)'" -ForegroundColor Green
        break
    }
}

if (-not $hostSiteId) {
    Write-Host ""
    Write-Host "Teradyne Log was not found on any known site." -ForegroundColor Red
    Write-Host "Find its site ID and re-run with -ExtraSiteId. To list the sites you can see:" -ForegroundColor Yellow
    Write-Host '  Invoke-MgGraphRequest -Method GET -Uri "https://graph.microsoft.com/v1.0/sites?search=*" |' -ForegroundColor Yellow
    Write-Host '    ForEach-Object { $_.value } | ForEach-Object { "$($_.displayName) => $($_.id)" }' -ForegroundColor Yellow
    exit 1
}

# ---------------------------------------------------------------------------
# 2. Dump columns + sample rows for each list.
# ---------------------------------------------------------------------------
$report = [ordered]@{
    discoveredAt = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
    siteName     = $hostSiteName
    siteId       = $hostSiteId
    lists        = [ordered]@{}
}

foreach ($entry in $lists.GetEnumerator()) {
    $name = $entry.Key
    $listId = $entry.Value
    Write-Host ""
    Write-Host "=== $name ===" -ForegroundColor Green

    $list = Get-ListOnSite -SiteId $hostSiteId -ListId $listId
    if (-not $list) {
        Write-Host "  NOT FOUND on '$hostSiteName' — is the ID right, or is it on another site?" -ForegroundColor Red
        $report.lists[$name] = [ordered]@{ listId = $listId; error = "not found on $hostSiteName" }
        continue
    }

    Write-Host "  Display name: $($list['displayName'])"
    Write-Host "  Web URL:      $($list['webUrl'])"

    $cols = Invoke-MgGraphRequest -Method GET `
        -Uri "https://graph.microsoft.com/v1.0/sites/$hostSiteId/lists/$listId/columns"

    $columns = foreach ($c in $cols.value) {
        # Work out the column's type from whichever type-specific facet is present.
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
            $row["allowFillIn"] = [bool]$c["choice"]["displayAs"]
        }
        if ($type -eq "lookup") {
            $row["lookupListId"] = $c["lookup"]["listId"]
            $row["lookupColumn"] = $c["lookup"]["columnName"]
            $row["allowMultiple"] = [bool]$c["lookup"]["allowMultipleValues"]
        }
        if ($type -eq "personOrGroup") {
            $row["allowMultiple"] = [bool]$c["personOrGroup"]["allowMultipleSelection"]
            $row["chooseFrom"] = $c["personOrGroup"]["chooseFromType"]
        }
        if ($type -eq "dateTime") {
            $row["displayAs"] = $c["dateTime"]["displayAs"]
            $row["format"] = $c["dateTime"]["format"]
        }
        if ($type -eq "calculated") {
            $row["formula"] = $c["calculated"]["formula"]
            $row["outputType"] = $c["calculated"]["outputType"]
        }
        if ($type -eq "number") {
            $row["decimalPlaces"] = $c["number"]["decimalPlaces"]
        }

        $row
    }

    # Console summary — the useful-at-a-glance view.
    $columns |
        Where-Object { -not $_.hidden } |
        ForEach-Object {
            $extra = ""
            if ($_.type -eq "choice") { $extra = " [$($_.choices -join ' | ')]" }
            if ($_.type -eq "lookup") { $extra = " -> list $($_.lookupListId).$($_.lookupColumn)$(if ($_.allowMultiple) { ' (multi)' })" }
            if ($_.type -eq "personOrGroup") { $extra = "$(if ($_.allowMultiple) { ' (multi)' })" }
            $flags = @()
            if ($_.required) { $flags += "required" }
            if ($_.readOnly) { $flags += "readonly" }
            $flagStr = if ($flags) { " {$($flags -join ',')}" } else { "" }
            "    $($_.internalName)  ($($_.displayName))  $($_.type)$extra$flagStr"
        }

    # Sample rows — the only reliable way to see how values actually come back.
    $samples = @()
    try {
        $items = Invoke-MgGraphRequest -Method GET `
            -Uri "https://graph.microsoft.com/v1.0/sites/$hostSiteId/lists/$listId/items?expand=fields&`$top=5"
        $samples = @($items.value | ForEach-Object { $_["fields"] })
        Write-Host "  Sample rows captured: $($samples.Count)"
    } catch {
        Write-Host "  Could not read items: $($_.Exception.Message)" -ForegroundColor Yellow
    }

    $itemCount = $null
    try {
        $countResp = Invoke-MgGraphRequest -Method GET `
            -Uri "https://graph.microsoft.com/v1.0/sites/$hostSiteId/lists/$listId/items?`$select=id&`$top=1000"
        $itemCount = @($countResp.value).Count
        if ($countResp.ContainsKey('@odata.nextLink')) { $itemCount = "$itemCount+" }
        Write-Host "  Approx item count: $itemCount"
    } catch { }

    $report.lists[$name] = [ordered]@{
        listId      = $listId
        displayName = $list["displayName"]
        webUrl      = $list["webUrl"]
        itemCount   = $itemCount
        columns     = @($columns)
        sampleRows  = $samples
    }
}

$outPath = Join-Path $PSScriptRoot "teradyne-schema.json"
$report | ConvertTo-Json -Depth 12 | Set-Content -Path $outPath -Encoding utf8

Write-Host ""
Write-Host "Wrote $outPath" -ForegroundColor Green
Write-Host "Site hosting the Teradyne lists: $hostSiteName" -ForegroundColor Green
Write-Host "  $hostSiteId" -ForegroundColor Green
