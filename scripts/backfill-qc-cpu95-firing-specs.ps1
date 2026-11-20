<#
.SYNOPSIS
    Fills the blank firing-angle specs on the QCFRM-012 CPU-95 Test Sheets list
    (Altronic_PMO) with each unit's standard TEST spec. Reports only unless
    -Apply is passed.

.DESCRIPTION
    The 30 sheets migrated from the old CPU-95 list on 2026-10-21 came across
    with no specs (Tim). ARC now fills a new sheet's specs from its part number;
    this does the same for the rows already on the list.

    The standards are read from src/data/qcCpu95FiringSpecs.json - the same
    table the ARC form and the blank sheet use - so the two can't disagree.
    Row i's angle (0-based) is (floor(i/2) * pair + (i % 2) * offset) mod 360,
    for the unit's cylinders only.

    ONLY BLANK SPECS ARE FILLED. A spec already on a row is the spec that unit
    was tested to, and is never changed - that is the record of it. A row whose
    typed specs differ from today's standard is listed in the report, and left
    alone. A part number with no standard (a customer sheet, say) is skipped.

    Writes only the FiringSpecNN columns, one PATCH per row, 20 per $batch.
    Safe to re-run: a row with nothing blank is skipped.

    RUN IN YOUR OWN TERMINAL - the sign-in is interactive.

.EXAMPLE
    .\backfill-qc-cpu95-firing-specs.ps1
    .\backfill-qc-cpu95-firing-specs.ps1 -Apply
#>

[CmdletBinding()]
param(
    [string]$ListId = "01d4cb25-a642-4652-b3db-0370f9a04b98",
    [switch]$Apply,
    [switch]$DeviceCode
)

$ErrorActionPreference = "Stop"
$pmoSite = "coopermachineryservices.sharepoint.com,915a6183-2b71-4dfd-a8b9-181126dfbe78,3eb6cb9c-6535-4c69-a8d7-e90b2f90a9eb"
$tablePath = Join-Path (Split-Path $PSScriptRoot -Parent) "src/data/qcCpu95FiringSpecs.json"
$table = Get-Content $tablePath -Raw -Encoding utf8 | ConvertFrom-Json

# Matched the way ARC matches it: trimmed, upper case, a bare one-digit suffix
# padded ("791950-8" is 791950-08).
function Get-SpecKey($pn) {
    $t = "$pn".Trim().ToUpperInvariant()
    if ($t -match '^(.+-)(\d)$') { $t = "$($Matches[1])0$($Matches[2])" }
    return $t
}
$standards = @{}
foreach ($s in $table.specs) { $standards[(Get-SpecKey $s.partNumber)] = $s }

function Get-StandardAngles($s) {
    for ($i = 0; $i -lt $s.cylinders; $i++) {
        ([Math]::Floor($i / 2) * $s.pair + ($i % 2) * $s.offset) % 360
    }
}
function Test-Blank($v) { return ($null -eq $v -or "$v".Trim() -eq "") }

Import-Module Microsoft.Graph.Authentication
$ctx = Get-MgContext
if (-not $ctx -or ($ctx.Scopes -notcontains "Sites.ReadWrite.All" -and $ctx.Scopes -notcontains "Sites.Manage.All")) {
    if ($DeviceCode) { Connect-MgGraph -Scopes "Sites.ReadWrite.All" -UseDeviceCode -NoWelcome }
    else             { Connect-MgGraph -Scopes "Sites.ReadWrite.All" -NoWelcome }
}

# --- read the list --------------------------------------------------------------
$slotCols = 1..20 | ForEach-Object { "FiringSpec{0:D2}" -f $_ }
$select = (@("Title", "AltronicPartNumber", "LegacySource") + $slotCols) -join ","
Write-Host "Reading QCFRM-012 CPU-95 Test Sheets ($ListId)..." -ForegroundColor Cyan
$items = [System.Collections.Generic.List[object]]::new()
$uri = "https://graph.microsoft.com/v1.0/sites/$pmoSite/lists/$ListId/items?`$expand=fields(`$select=$select)&`$top=999"
while ($uri) {
    $page = Invoke-MgGraphRequest -Method GET -Uri $uri
    foreach ($v in $page.value) { $items.Add($v) }
    $uri = $page["@odata.nextLink"]
}
Write-Host "  $($items.Count) rows" -ForegroundColor Gray

# --- work out what each row needs ---------------------------------------------------
$plan = foreach ($item in $items) {
    $f = $item.fields
    $s = $standards[(Get-SpecKey $f.AltronicPartNumber)]
    $row = [pscustomobject]@{
        Id = $item.id; Serial = $f.Title; PartNumber = $f.AltronicPartNumber; Legacy = $f.LegacySource
        Fill = @{}; Kept = [System.Collections.Generic.List[string]]::new(); Standard = $null
    }
    if (-not $s) { $row; continue }
    $row.Standard = "$($s.partNumber) [$($s.offset), $($s.pair)]"
    $angles = @(Get-StandardAngles $s)
    for ($i = 0; $i -lt $angles.Count; $i++) {
        $col = $slotCols[$i]; $have = $f[$col]
        if (Test-Blank $have) { $row.Fill[$col] = [double]$angles[$i] }
        elseif ([double]$have -ne [double]$angles[$i]) { $row.Kept.Add("$($i + 1)=$have (standard $($angles[$i]))") }
    }
    $row
}

$noStandard = @($plan | Where-Object { -not $_.Standard })
$toFill = @($plan | Where-Object { $_.Fill.Count })
$differs = @($plan | Where-Object { $_.Kept.Count })

Write-Host "`n=== Rows to fill ($($toFill.Count)) ===" -ForegroundColor Cyan
$toFill | ForEach-Object {
    "  #{0,-5} {1,-8} {2,-14} {3,2} specs blank -> {4}{5}" -f $_.Id, $_.Serial, $_.PartNumber, $_.Fill.Count, $_.Standard,
        $(if ($_.Legacy) { "   ($($_.Legacy))" } else { "" })
} | Write-Host

if ($differs.Count) {
    Write-Host "`n=== Typed specs that differ from today's standard - KEPT as tested ($($differs.Count)) ===" -ForegroundColor Yellow
    $differs | ForEach-Object { "  #{0,-5} {1,-8} {2,-14} {3}" -f $_.Id, $_.Serial, $_.PartNumber, ($_.Kept -join ", ") } | Write-Host
}
if ($noStandard.Count) {
    Write-Host "`n=== No standard for the part number - skipped ($($noStandard.Count)) ===" -ForegroundColor Yellow
    $noStandard | Group-Object PartNumber | ForEach-Object {
        "  {0,-16} {1,3} rows" -f $(if ($_.Name) { $_.Name } else { "(blank)" }), $_.Count
    } | Write-Host
}

if (-not $Apply) {
    Write-Host "`nReport only - nothing was written. Re-run with -Apply to fill the $($toFill.Count) rows above.`n" -ForegroundColor Yellow
    exit 0
}
if (-not $toFill.Count) { Write-Host "`nNothing to fill." -ForegroundColor Green; exit 0 }

# --- write, 20 per $batch, pausing at a throttled batch -----------------------------
$failures = [System.Collections.Generic.List[object]]::new()
$pending = [System.Collections.Generic.List[object]]::new(); $toFill | ForEach-Object { $pending.Add($_) }
$done = 0; $round = 0
while ($pending.Count -gt 0 -and $round -lt 10) {
    $round++
    $retry = [System.Collections.Generic.List[object]]::new(); $wait = 0
    for ($i = 0; $i -lt $pending.Count; $i += 20) {
        if ($wait -gt 0) { Write-Host "  throttled - pausing $wait s" -ForegroundColor Yellow; Start-Sleep -Seconds $wait; $wait = 0 }
        $chunk = @($pending[$i..([Math]::Min($i + 19, $pending.Count - 1))])
        $reqs = for ($j = 0; $j -lt $chunk.Count; $j++) {
            @{ id = "$j"; method = "PATCH"; url = "/sites/$pmoSite/lists/$ListId/items/$($chunk[$j].Id)/fields"
               headers = @{ "Content-Type" = "application/json" }; body = $chunk[$j].Fill }
        }
        try {
            $resp = Invoke-MgGraphRequest -Method POST -Uri "https://graph.microsoft.com/v1.0/`$batch" `
                -Body (@{ requests = @($reqs) } | ConvertTo-Json -Depth 10) -ContentType "application/json"
        } catch { foreach ($c in $chunk) { $retry.Add($c) }; $wait = 30; continue }
        foreach ($r in $resp.responses) {
            $w = $chunk[[int]$r.id]
            if ($r.status -ge 200 -and $r.status -lt 300) { $done++ }
            elseif ($r.status -in 429, 503, 504) {
                $retry.Add($w); $ra = 10
                if ($r.headers -and $r.headers['Retry-After']) { $ra = [int]$r.headers['Retry-After'] }
                $wait = [Math]::Max($wait, $ra)
            } else {
                $msg = if ($r.body -and $r.body.error) { $r.body.error.message } else { "HTTP $($r.status)" }
                $failures.Add([pscustomobject]@{ Id = $w.Id; Serial = $w.Serial; Status = $r.status; Error = $msg })
            }
        }
    }
    $pending = $retry
    if ($pending.Count) { Write-Host "  $($pending.Count) throttled - waiting 10 s, then retrying" -ForegroundColor Yellow; Start-Sleep -Seconds 10 }
}
foreach ($w in $pending) { $failures.Add([pscustomobject]@{ Id = $w.Id; Serial = $w.Serial; Status = "throttled"; Error = "gave up after $round rounds" }) }

Write-Host "`nFilled: $done   failed: $($failures.Count)" -ForegroundColor $(if ($failures.Count) { "Red" } else { "Green" })
if ($failures.Count) {
    $failures | Format-Table -AutoSize | Out-String | Write-Host
    Write-Host "Re-running is safe: only blank specs are written." -ForegroundColor Yellow
}
