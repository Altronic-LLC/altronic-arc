<#
.SYNOPSIS
    Loads an industry standard's pull force table (a CSV) into the "Pull Test
    Specs" list as any-terminal specs (BusinessIT#64). Reports only unless
    -Apply. ADD-ONLY.

.DESCRIPTION
    Built for IPC/WHMA-A-620 Table 19-8, "Pull Test Force Values". The CSV is
    the table typed up, one row per conductor size:

      Wire Gauge, mm2,
      Machined Silver/Tin lb, Machined Silver/Tin N,
      Machined Nickel lb, Machined Nickel N,
      Crimp Splice lb, Crimp Splice N,
      Stamped and Formed lb, Stamped and Formed N

    Each pound figure becomes ONE spec: blank terminal (any terminal on that
    gauge), Source = Industry standard, unit lbF, and the reference naming the
    column it came from, e.g.
      "IPC/WHMA-A-620 Table 19-8, crimp splices"
    A "-" or blank in the table is no spec for that gauge.

    Rules:

    - Wire Gauge is stored as written, so write it the way ARC should show it:
      "20" (ARC adds "AWG"), "1/0 AWG", "250 kcmil".
    - POUNDS are what's loaded (lbF is the tester's default unit). The table's
      newtons go in Notes, with the conductor's mm2, and a row where the two
      disagree by more than 1% is reported - the published table has a few,
      and someone should decide which figure the drawing means.
    - Note 1 of the table (plated or unplated copper stranded wire) goes in
      the Notes of the crimp splice and stamped/formed specs it applies to.
    - One any-terminal spec per gauge + reference - the key ARC refuses a
      duplicate on (pullSpecKey in src/lib/pullTest.ts). A spec whose key is
      already on the list is SKIPPED, never overwritten: once admins edit
      specs in ARC, a re-run must not undo them.

    The table is from a published standard and the repo is public. Keep the
    CSV OUT of the repo.

    RUN IN YOUR OWN TERMINAL - the sign-in is interactive. -ParseOnly needs
    no sign-in and shows what would be loaded.

.EXAMPLE
    .\load-pull-test-specs.ps1 -CsvPath C:\temp\ipc-whma-a-620-table-19-8.csv -ParseOnly
    .\load-pull-test-specs.ps1 -CsvPath ...
    .\load-pull-test-specs.ps1 -CsvPath ... -Apply
    .\load-pull-test-specs.ps1 -CsvPath ... -Standard "IPC/WHMA-A-620E" -Apply
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$CsvPath,
    [string]$SpecsListId = "98e48b60-d1c6-4fc0-9677-be8f61741991",
    # Add the revision if the drawings cite one, e.g. "IPC/WHMA-A-620E".
    [string]$Standard = "IPC/WHMA-A-620",
    [string]$Table = "Table 19-8",
    [switch]$Apply,
    [switch]$ParseOnly,
    [switch]$DeviceCode
)

$ErrorActionPreference = "Stop"
$siteId = "coopermachineryservices.sharepoint.com,915a6183-2b71-4dfd-a8b9-181126dfbe78,3eb6cb9c-6535-4c69-a8d7-e90b2f90a9eb"
$MM2 = "mm$([char]0x00B2)"
$NEWTONS_PER_POUND = 4.4482216152605
$NOTE_1 = "Plated or unplated copper stranded wire (table note 1)."

# The table's four columns: the CSV header prefix, the words in the reference,
# and whether note 1 applies.
$columns = @(
    @{ Prefix = "Machined Silver/Tin"; Name = "machined contacts, silver/tin plated wire"; Note1 = $false },
    @{ Prefix = "Machined Nickel";     Name = "machined contacts, nickel plated wire";     Note1 = $false },
    @{ Prefix = "Crimp Splice";        Name = "crimp splices";                             Note1 = $true },
    @{ Prefix = "Stamped and Formed";  Name = "stamped and formed contacts and terminals"; Note1 = $true }
)

$rows = Import-Csv -Path (Resolve-Path $CsvPath)
if (-not $rows) { throw "$CsvPath has no rows." }
$headers = $rows[0].PSObject.Properties.Name
function Find-Header($name) {
    $h = $headers | Where-Object { $_.Trim() -eq $name } | Select-Object -First 1
    if (-not $h) { throw "No '$name' column in the CSV header." }
    return $h
}
$gaugeHeader = Find-Header "Wire Gauge"
$mm2Header = Find-Header "mm2"
foreach ($c in $columns) { $c.Lb = Find-Header "$($c.Prefix) lb"; $c.N = Find-Header "$($c.Prefix) N" }

function To-Number($value) {
    $v = "$value".Trim()
    if (-not $v -or $v -match '^[-\u2013\u2014]+$') { return $null }
    $n = 0.0
    if ([double]::TryParse($v, [System.Globalization.NumberStyles]::Float, [System.Globalization.CultureInfo]::InvariantCulture, [ref]$n)) { return $n }
    throw "'$value' isn't a number."
}
# Mirrors pullSpecKey: an any-terminal spec is one per gauge + reference.
function Norm($s) { ("$s".Trim().ToUpper() -replace '\s+', ' ') }
function Get-Key($terminal, $gauge, $reference) {
    $t = Norm $terminal
    if ($t) { return "$t|$(Norm $gauge)" }
    return "|$(Norm $gauge)|$(Norm $reference)"
}
function Format-Number([double]$n) { $n.ToString("0.0##", [cultureinfo]::InvariantCulture) }

# --- build the specs -----------------------------------------------------------
$specs = [ordered]@{}
$attention = @()
foreach ($r in $rows) {
    $gauge = "$($r.$gaugeHeader)".Trim()
    if (-not $gauge) { continue }
    $mm2 = "$($r.$mm2Header)".Trim()
    foreach ($c in $columns) {
        try {
            $lb = To-Number $r.($c.Lb)
            $n = To-Number $r.($c.N)
        } catch { throw "$gauge, $($c.Prefix): $($_.Exception.Message)" }
        if ($null -eq $lb) {
            if ($null -ne $n) { $attention += "$gauge, $($c.Name): $n N but no pounds; not loaded" }
            continue
        }
        $reference = "$Standard $Table, $($c.Name)"
        $notes = @()
        if ($mm2) { $notes += "Conductor $mm2 $MM2." }
        if ($null -ne $n) {
            $notes += "Table also gives $(Format-Number $n) N."
            $expected = $lb * $NEWTONS_PER_POUND
            if ([math]::Abs($n - $expected) / $expected -gt 0.01) {
                $attention += "$gauge, $($c.Name): $lb lb is $(Format-Number $expected) N, but the table says $(Format-Number $n) N - the pounds are loaded"
            }
        }
        if ($c.Note1) { $notes += $NOTE_1 }
        $key = Get-Key "" $gauge $reference
        if ($specs.Contains($key)) { $attention += "$gauge, $($c.Name): twice in the CSV; the first is loaded"; continue }
        $specs[$key] = [ordered]@{
            Title = ""; ManufacturerPartNumber = ""; WireGauge = $gauge
            MinimumForce = $lb; ForceUnit = "lbF"; SpecSource = "Industry standard"
            SpecReference = $reference; Notes = ($notes -join " "); Active = $true
        }
    }
}

Write-Host "`n$($specs.Count) specs from $CsvPath" -ForegroundColor Cyan
$specs.Values | ForEach-Object {
    [pscustomobject]@{ Gauge = $_.WireGauge; Minimum = "$($_.MinimumForce) lbF"; Reference = $_.SpecReference }
} | Format-Table -AutoSize | Out-String -Width 200 | Write-Host
if ($attention) { Write-Host "Needs a look:" -ForegroundColor Yellow; $attention | ForEach-Object { Write-Host "  $_" -ForegroundColor Yellow } }

if ($ParseOnly) { return }

# --- compare with the list -----------------------------------------------------
Import-Module Microsoft.Graph.Authentication
$ctx = Get-MgContext
if (-not $ctx -or $ctx.Scopes -notcontains "Sites.Manage.All") {
    if ($DeviceCode) { Connect-MgGraph -Scopes "Sites.Manage.All" -UseDeviceCode -NoWelcome }
    else             { Connect-MgGraph -Scopes "Sites.Manage.All" -NoWelcome }
}
$items = "https://graph.microsoft.com/v1.0/sites/$siteId/lists/$SpecsListId/items"
$existing = @{}
$uri = "$items`?`$expand=fields(`$select=Title,WireGauge,SpecReference)&`$top=999"
while ($uri) {
    $page = Invoke-MgGraphRequest -Method GET -Uri $uri
    foreach ($i in $page.value) {
        $existing[(Get-Key "$($i.fields.Title)" "$($i.fields.WireGauge)" "$($i.fields.SpecReference)")] = $i.id
    }
    $uri = $page["@odata.nextLink"]
}

$toAdd = @($specs.Keys | Where-Object { -not $existing.ContainsKey($_) })
Write-Host "`n$($existing.Count) specs already on the list; $($toAdd.Count) to add; $($specs.Count - $toAdd.Count) already there (left alone)." -ForegroundColor Cyan
if (-not $Apply) { Write-Host "Report only. Re-run with -Apply to add them." -ForegroundColor Magenta; return }

$added = 0
foreach ($k in $toAdd) {
    Invoke-MgGraphRequest -Method POST -Uri $items -ContentType "application/json" `
        -Body (@{ fields = $specs[$k] } | ConvertTo-Json -Depth 4) | Out-Null
    $added++
}
Write-Host "Added $added specs." -ForegroundColor Green
