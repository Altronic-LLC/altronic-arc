<#
.SYNOPSIS
    Loads the cleaned Access export into "Harness Part Numbers" and "Harness
    Production Log". Reports only unless -Apply is passed.

.DESCRIPTION
    Input is the folder scripts/clean-harness-production-log.mjs wrote:
      harness-part-numbers.csv            -> Harness Part Numbers
      harness-production-log.clean.csv    -> Harness Production Log

    ADD-ONLY, and safe to re-run:
    - A part number already on the list (matched on Title, case-insensitive) is
      left exactly as it is - an admin may have renamed, described or retired
      it in ARC since.
    - A log row is matched on LegacySource, and a row that is already there is
      never rewritten. The Access database stays in use until cutover, so the
      expected use is: export again, clean again, re-run - and only the new
      rows go in.

    Never deletes anything.

    Throttling is handled the way load-altronic-parts-lists.ps1 learned to: by
    PAUSING at the batch that was throttled, not by carrying on.

    RUN IN YOUR OWN TERMINAL - the sign-in is interactive.

.EXAMPLE
    .\load-harness-production-log.ps1 -CleanDir "C:\Working_Dir\ProcessImprovement\Arc\harness-clean"
    .\load-harness-production-log.ps1 -CleanDir "C:\Working_Dir\ProcessImprovement\Arc\harness-clean" -Apply

    The list ids come from VITE_SP_HARNESS_PART_NUMBERS_LIST_ID and
    VITE_SP_HARNESS_PRODUCTION_LOG_LIST_ID in .env.local; -PartsListId and
    -LogListId override them.
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$CleanDir,
    # Both default to the VITE_SP_HARNESS_* values in the repo's .env.local —
    # the same ids the app is built with, so the load can't target other lists.
    [string]$PartsListId,
    [string]$LogListId,
    [switch]$Apply,
    [switch]$DeviceCode
)

$ErrorActionPreference = "Stop"

# --- list ids: parameters win, else .env.local -------------------------------
function Get-EnvLocalValue($name) {
    $envFile = Join-Path (Split-Path $PSScriptRoot -Parent) ".env.local"
    if (-not (Test-Path $envFile)) { return $null }
    foreach ($line in Get-Content $envFile) {
        if ($line -match "^\s*$name\s*=\s*(.*?)\s*$") { return $Matches[1].Trim('"', "'") }
    }
    return $null
}
if (-not $PartsListId) { $PartsListId = Get-EnvLocalValue "VITE_SP_HARNESS_PART_NUMBERS_LIST_ID" }
if (-not $LogListId) { $LogListId = Get-EnvLocalValue "VITE_SP_HARNESS_PRODUCTION_LOG_LIST_ID" }
if (-not $PartsListId -or -not $LogListId) {
    throw "List ids not found. Pass -PartsListId and -LogListId, or set VITE_SP_HARNESS_PART_NUMBERS_LIST_ID and VITE_SP_HARNESS_PRODUCTION_LOG_LIST_ID in .env.local."
}
Write-Host "Harness Part Numbers:   $PartsListId" -ForegroundColor Gray
Write-Host "Harness Production Log: $LogListId" -ForegroundColor Gray
Import-Module Microsoft.Graph.Authentication

$siteId = "coopermachineryservices.sharepoint.com,915a6183-2b71-4dfd-a8b9-181126dfbe78,3eb6cb9c-6535-4c69-a8d7-e90b2f90a9eb"
$graph = "https://graph.microsoft.com/v1.0/sites/$siteId"

$partsCsv = Import-Csv (Join-Path $CleanDir "harness-part-numbers.csv") -Encoding utf8
$logCsv = Import-Csv (Join-Path $CleanDir "harness-production-log.clean.csv") -Encoding utf8
Write-Host "Read $($partsCsv.Count) part numbers and $($logCsv.Count) log rows from $CleanDir" -ForegroundColor Cyan

$ctx = Get-MgContext
if (-not $ctx -or $ctx.Scopes -notcontains "Sites.ReadWrite.All") {
    if ($DeviceCode) { Connect-MgGraph -Scopes "Sites.ReadWrite.All" -UseDeviceCode -NoWelcome }
    else             { Connect-MgGraph -Scopes "Sites.ReadWrite.All" -NoWelcome }
}

function Get-AllItems($listId, $select) {
    $out = [System.Collections.Generic.List[object]]::new()
    $uri = "$graph/lists/$listId/items?`$expand=fields(`$select=$select)&`$top=999"
    while ($uri) {
        $page = Invoke-MgGraphRequest -Method GET -Uri $uri
        foreach ($v in $page.value) { $out.Add($v) }
        $uri = $page["@odata.nextLink"]
    }
    $out
}

# The same string ARC builds (buildHarnessLogTitle in src/lib/harnessLogMapper.ts).
function Get-EntryTitle($part, $wo) {
    if ($part -and $wo) { return "$part / WO $wo" }
    if ($part) { return $part }
    if ($wo) { return "WO $wo" }
    return "(untitled entry)"
}

function Invoke-Batched($work, $activity) {
    $failures = [System.Collections.Generic.List[object]]::new()
    $pending = [System.Collections.Generic.List[object]]::new(); $work | ForEach-Object { $pending.Add($_) }
    $done = 0; $round = 0
    while ($pending.Count -gt 0 -and $round -lt 10) {
        $round++
        $retry = [System.Collections.Generic.List[object]]::new()
        $waitSeconds = 0
        for ($i = 0; $i -lt $pending.Count; $i += 20) {
            if ($waitSeconds -gt 0) {
                Write-Host "  throttled - pausing $waitSeconds s ($done written so far)" -ForegroundColor Yellow
                Start-Sleep -Seconds $waitSeconds
                $waitSeconds = 0
            }
            $chunk = @($pending[$i..([Math]::Min($i + 19, $pending.Count - 1))])
            $reqs = for ($j = 0; $j -lt $chunk.Count; $j++) {
                @{ id = "$j"; method = "POST"; url = $chunk[$j].url; headers = @{ "Content-Type" = "application/json" }; body = $chunk[$j].body }
            }
            try {
                $resp = Invoke-MgGraphRequest -Method POST -Uri "https://graph.microsoft.com/v1.0/`$batch" `
                    -Body (@{ requests = @($reqs) } | ConvertTo-Json -Depth 10) -ContentType "application/json"
            } catch {
                foreach ($c in $chunk) { $retry.Add($c) }; $waitSeconds = [Math]::Max($waitSeconds, 30); continue
            }
            foreach ($r in $resp.responses) {
                $w = $chunk[[int]$r.id]
                if ($r.status -ge 200 -and $r.status -lt 300) { $done++ }
                elseif ($r.status -in 429, 503, 504) {
                    $retry.Add($w)
                    $ra = 10; if ($r.headers -and $r.headers['Retry-After']) { $ra = [int]$r.headers['Retry-After'] }
                    $waitSeconds = [Math]::Max($waitSeconds, $ra)
                } else {
                    $msg = if ($r.body -and $r.body.error) { $r.body.error.message } else { "HTTP $($r.status)" }
                    $failures.Add([pscustomobject]@{ Key = $w.key; Status = $r.status; Error = $msg })
                }
            }
            Write-Progress -Activity "$activity (round $round)" -Status "$done written, $($failures.Count) failed" `
                -PercentComplete ([Math]::Min(100, 100 * ($i + $chunk.Count) / $pending.Count))
        }
        $pending = $retry
        if ($pending.Count) {
            Write-Host "  $($pending.Count) throttled - waiting 10 s, then retrying" -ForegroundColor Yellow
            Start-Sleep -Seconds 10
        }
    }
    foreach ($w in $pending) { $failures.Add([pscustomobject]@{ Key = $w.key; Status = "throttled"; Error = "gave up after $round rounds" }) }
    Write-Host "  $activity - written: $done   failed: $($failures.Count)" -ForegroundColor $(if ($failures.Count) { "Red" } else { "Green" })
    return $failures
}

# --- part numbers -------------------------------------------------------------
Write-Host "`nReading Harness Part Numbers..." -ForegroundColor Cyan
$partIds = @{}
foreach ($p in (Get-AllItems $PartsListId "Title")) { $partIds["$($p.fields.Title)".ToUpperInvariant()] = [int]$p.id }
$newParts = @($partsCsv | Where-Object { -not $partIds.ContainsKey($_.PartNumber.ToUpperInvariant()) })
Write-Host "  $($partIds.Count) already on the list, $($newParts.Count) to add" -ForegroundColor Gray

# --- log rows ----------------------------------------------------------------
Write-Host "Reading Harness Production Log (LegacySource only)..." -ForegroundColor Cyan
$haveSources = [System.Collections.Generic.HashSet[string]]::new()
foreach ($r in (Get-AllItems $LogListId "LegacySource")) { if ($r.fields.LegacySource) { [void]$haveSources.Add($r.fields.LegacySource) } }
$newRows = @($logCsv | Where-Object { -not $haveSources.Contains($_.LegacySource) })
Write-Host "  $($haveSources.Count) already loaded, $($newRows.Count) to add" -ForegroundColor Gray

if (-not $Apply) {
    Write-Host "`nReport only - nothing was written. Re-run with -Apply to load.`n" -ForegroundColor Yellow
    exit 0
}

$allFailures = [System.Collections.Generic.List[object]]::new()
if ($newParts.Count) {
    $work = foreach ($p in $newParts) {
        $fields = @{ Title = $p.PartNumber; Active = ($p.Active -eq "TRUE"); Note = $p.Note }
        @{ key = "part:$($p.PartNumber)"; url = "/sites/$siteId/lists/$PartsListId/items"; body = @{ fields = $fields } }
    }
    (Invoke-Batched $work "Adding part numbers") | ForEach-Object { $allFailures.Add($_) }
    $partIds = @{}
    foreach ($p in (Get-AllItems $PartsListId "Title")) { $partIds["$($p.fields.Title)".ToUpperInvariant()] = [int]$p.id }
}

if ($newRows.Count) {
    $work = foreach ($r in $newRows) {
        $fields = @{
            Title            = Get-EntryTitle $r.PartNumber $r.WorkOrder
            WorkOrder        = $r.WorkOrder
            Comments         = $r.Comments
            BuiltBy          = $r.BuiltBy
            VisualCheck      = $r.VisualCheck
            DataQualityNotes = $r.DataQualityNotes
            LegacySource     = $r.LegacySource
        }
        if ($r.ProductionDate) { $fields.ProductionDate = "$($r.ProductionDate)T12:00:00Z" }
        if ($r.Quantity -ne "") { $fields.Quantity = [int]$r.Quantity }
        if ($r.ReworkQuantity -ne "") { $fields.ReworkQuantity = [int]$r.ReworkQuantity }
        if ($r.PartNumber) {
            $id = $partIds[$r.PartNumber.ToUpperInvariant()]
            if ($id) { $fields.PartNumberLookupId = $id }
            else { $allFailures.Add([pscustomobject]@{ Key = $r.LegacySource; Status = "skipped"; Error = "part $($r.PartNumber) is not on the part list" }); continue }
        }
        @{ key = $r.LegacySource; url = "/sites/$siteId/lists/$LogListId/items"; body = @{ fields = $fields } }
    }
    (Invoke-Batched @($work) "Adding log rows") | ForEach-Object { $allFailures.Add($_) }
}

$failPath = Join-Path $CleanDir "load-failures.csv"
$allFailures | Export-Csv $failPath -NoTypeInformation -Encoding utf8
if ($allFailures.Count) {
    Write-Host "`n$($allFailures.Count) failures - see $failPath. Re-running is safe: only what is missing is written." -ForegroundColor Yellow
} else {
    Write-Host "`nDone." -ForegroundColor Green
}
