<#
.SYNOPSIS
    The Panel SAP BOM Builder's ONE-TIME load, step 2 of 2 (BusinessIT#59):
    adds the parts and kits prepared by prepare-panel-bom-load.mjs to the
    Panel BOM Parts and Panel BOM Kits lists. Reports only unless -Apply.

.DESCRIPTION
    ADD-ONLY. A part already on the list (same SAP # in the same category) and
    a kit already on the list (same name) are SKIPPED, never rewritten — ARC is
    the master once people start editing there (Tim, 2026-11-05), so a re-run
    must never put the workbook's values back over theirs. Re-running adds only
    what's missing, which is also the way to resume after an interruption.

    Step 1 (writes JSON outside the repo, touches nothing in SharePoint):
      node scripts/prepare-panel-bom-load.mjs "<PANEL Parts Database.xlsm>" "<qiu_map.json>" <dir>

    Step 2 (this script):
      .\load-panel-bom-lists.ps1 -DataDir <dir> -PartsListId <id> -KitsListId <id>          # report
      .\load-panel-bom-lists.ps1 -DataDir <dir> -PartsListId <id> -KitsListId <id> -Apply   # add

    No cost is loaded: the workbook's COGS stays behind; the builder reads cost
    from SAP through Fabric.

    RUN IN YOUR OWN TERMINAL - the sign-in is interactive. -DeviceCode if the
    Windows account window doesn't appear.
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory)] [string]$DataDir,
    [Parameter(Mandatory)] [string]$PartsListId,
    [Parameter(Mandatory)] [string]$KitsListId,
    [switch]$Apply,
    [switch]$DeviceCode
)

$ErrorActionPreference = "Stop"
Import-Module Microsoft.Graph.Authentication

$siteId = "coopermachineryservices.sharepoint.com,fdf31131-2076-4618-923b-a1856e6b0f2a,3eb6cb9c-6535-4c69-a8d7-e90b2f90a9eb"
$graph = "https://graph.microsoft.com/v1.0/sites/$siteId"

$parts = Get-Content -Raw -Path (Join-Path $DataDir "parts.json") | ConvertFrom-Json
$kits = Get-Content -Raw -Path (Join-Path $DataDir "kits.json") | ConvertFrom-Json

$ctx = Get-MgContext
if (-not $ctx -or (($ctx.Scopes -notcontains "Sites.ReadWrite.All") -and ($ctx.Scopes -notcontains "Sites.Manage.All"))) {
    Write-Host "Signing in (Sites.ReadWrite.All)..." -ForegroundColor Cyan
    if ($DeviceCode) { Connect-MgGraph -Scopes "Sites.ReadWrite.All" -UseDeviceCode -NoWelcome }
    else             { Connect-MgGraph -Scopes "Sites.ReadWrite.All" -NoWelcome }
}
if (-not $Apply) { Write-Host "`n*** Report only - add -Apply to write ***" -ForegroundColor Magenta }

function Read-All($listId, $select) {
    $rows = @()
    $uri = "$graph/lists/$listId/items?`$expand=fields(`$select=$select)&`$top=999"
    while ($uri) {
        $page = Invoke-MgGraphRequest -Method GET -Uri $uri
        $rows += $page.value
        $uri = $page["@odata.nextLink"]
    }
    return $rows
}

# A throttled POST waits as asked and tries again; anything else stops the run
# (re-running resumes, since existing rows are skipped).
function Add-Item($listId, $fields) {
    for ($try = 1; $try -le 6; $try++) {
        try {
            return Invoke-MgGraphRequest -Method POST -Uri "$graph/lists/$listId/items" -ContentType "application/json" `
                -Body (@{ fields = $fields } | ConvertTo-Json -Depth 4)
        } catch {
            $status = $_.Exception.Response.StatusCode.value__
            if ($status -ne 429 -and $status -ne 503) { throw }
            $wait = 10 * $try
            Write-Host "    throttled - waiting ${wait}s" -ForegroundColor Yellow
            Start-Sleep -Seconds $wait
        }
    }
    throw "Still throttled after 6 tries."
}

# --- parts ------------------------------------------------------------------
Write-Host "`n=== Panel BOM Parts ===" -ForegroundColor Cyan
$have = @{}
foreach ($r in (Read-All $PartsListId "Title,Category")) {
    $have["$($r.fields.Title)".ToUpperInvariant() + "|" + "$($r.fields.Category)".ToLowerInvariant()] = $true
}
$toAdd = @($parts | Where-Object { -not $have.ContainsKey("$($_.Title)".ToUpperInvariant() + "|" + "$($_.Category)".ToLowerInvariant()) })
Write-Host "  $($parts.Count) prepared, $($parts.Count - $toAdd.Count) already on the list, $($toAdd.Count) to add"
if ($Apply) {
    $n = 0
    foreach ($p in $toAdd) {
        $fields = @{}
        foreach ($prop in $p.PSObject.Properties) { if ($null -ne $prop.Value) { $fields[$prop.Name] = $prop.Value } }
        Add-Item $PartsListId $fields | Out-Null
        $n++
        if ($n % 50 -eq 0) { Write-Host "    added $n of $($toAdd.Count)" }
    }
    Write-Host "  added $n parts" -ForegroundColor Green
}

# --- kits -------------------------------------------------------------------
Write-Host "`n=== Panel BOM Kits ===" -ForegroundColor Cyan
$haveKits = @{}
foreach ($r in (Read-All $KitsListId "Title")) { $haveKits["$($r.fields.Title)".ToLowerInvariant()] = $true }
$kitsToAdd = @($kits | Where-Object { -not $haveKits.ContainsKey("$($_.Title)".ToLowerInvariant()) })
Write-Host "  $($kits.Count) prepared, $($kits.Count - $kitsToAdd.Count) already on the list, $($kitsToAdd.Count) to add"
if ($Apply) {
    foreach ($k in $kitsToAdd) {
        $fields = @{}
        foreach ($prop in $k.PSObject.Properties) { if ($null -ne $prop.Value) { $fields[$prop.Name] = $prop.Value } }
        $row = Add-Item $KitsListId $fields
        # Components is the one value that matters most — read it back.
        $back = Invoke-MgGraphRequest -Method GET -Uri "$graph/lists/$KitsListId/items/$($row.id)?`$expand=fields(`$select=Components)"
        if ("$($back.fields.Components)" -ne $k.Components) {
            Write-Host "    $($k.Title): Components did NOT read back as written - check it in ARC" -ForegroundColor Red
        }
    }
    Write-Host "  added $($kitsToAdd.Count) kits" -ForegroundColor Green
}

if (-not $Apply) { Write-Host "`nReport only - nothing was written. Re-run with -Apply.`n" -ForegroundColor Yellow }
else { Write-Host "`nDone. Re-running adds only what's missing.`n" -ForegroundColor Green }
