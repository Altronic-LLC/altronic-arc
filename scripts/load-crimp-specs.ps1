<#
.SYNOPSIS
    Loads the Mecal applicator spec sheet (a CSV) into the "Crimp Specs" list
    (BusinessIT#55). Reports only unless -Apply. ADD-ONLY.

.DESCRIPTION
    The CSV is the typed-up "Technical Data for Mecal Applicators" sheet, with
    the columns:

      Altronic Terminal Part #, Table Height, Man. Part #, Applicator Serial #,
      Wire Setting, Insulation Setting, Wire Gauge (AWG), Crimp Height (nom),
      Tolerance, Notes

    Columns are matched by the START of each header, so "Tolerance (+/-)" in
    any encoding still matches.

    Rules, each because the sheet does it:

    - A CONTINUATION ROW (blank terminal, but a gauge, setting or height) is
      the same applicator crimping another gauge. It inherits the terminal,
      manufacturer part #, applicator and table height from the row above.
    - One spec per terminal + applicator + gauge - the key ARC refuses a
      duplicate on (crimpSpecKey in src/lib/crimpCheck.ts). A row whose key is
      already on the list is SKIPPED, never overwritten: once admins edit specs
      in ARC, a re-run must not undo them.
    - A row with no crimp height is still loaded (the spec exists, it just
      can't judge a check yet) and reported, so an admin can fill it in.
    - A crimp height with no tolerance is loaded and reported too - ARC can't
      judge a check against it until the tolerance is filled in.
    - The CSV may be UTF-8 or Windows-1252 (Excel's "CSV" vs "CSV UTF-8"). It
      is read as UTF-8 when valid, else 1252, so "mm2" and "+/-" come through.
      A U+FFFD replacement character already IN the file is cleaned: "mm?" in
      a gauge becomes "mm2" (superscript), between two numbers "+/-",
      anywhere else " - ".
    - The footer ("Yellow cells were handwritten...") and blank rows are
      skipped: a terminal must look like a part number.

    The CSV holds Altronic data. Keep it OUT of the repo (it is public).

    RUN IN YOUR OWN TERMINAL - the sign-in is interactive. -ParseOnly needs
    no sign-in and shows what would be loaded.

.EXAMPLE
    .\load-crimp-specs.ps1 -CsvPath C:\temp\Mecal_Applicator_Technical_Data.csv -ParseOnly
    .\load-crimp-specs.ps1 -CsvPath ... -SpecsListId <id>
    .\load-crimp-specs.ps1 -CsvPath ... -SpecsListId <id> -Apply
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$CsvPath,
    [string]$SpecsListId,
    [switch]$Apply,
    [switch]$ParseOnly,
    [switch]$DeviceCode
)

$ErrorActionPreference = "Stop"
$siteId = "coopermachineryservices.sharepoint.com,915a6183-2b71-4dfd-a8b9-181126dfbe78,3eb6cb9c-6535-4c69-a8d7-e90b2f90a9eb"
$REPLACEMENT = [char]0xFFFD

# --- read the file, UTF-8 if it is valid UTF-8, else Windows-1252 -------------
$bytes = [System.IO.File]::ReadAllBytes((Resolve-Path $CsvPath))
try {
    $text = ([System.Text.UTF8Encoding]::new($false, $true)).GetString($bytes)
    $encoding = "UTF-8"
} catch {
    $text = [System.Text.Encoding]::GetEncoding(1252).GetString($bytes)
    $encoding = "Windows-1252"
}
$text = $text.TrimStart([char]0xFEFF)
$lines = $text -split "`r?`n"
$headerIndex = [Array]::FindIndex($lines, [Predicate[string]] { param($l) $l -match '^\s*"?Altronic Terminal' })
if ($headerIndex -lt 0) { throw "No header row starting 'Altronic Terminal' in $CsvPath." }
$rows = ($lines[$headerIndex..($lines.Count - 1)] -join "`n") | ConvertFrom-Csv
$headers = $rows[0].PSObject.Properties.Name

function Find-Header($prefix) {
    $h = $headers | Where-Object { $_ -like "$prefix*" } | Select-Object -First 1
    if (-not $h) { throw "No column starting '$prefix' in the CSV header." }
    return $h
}
$H = @{
    Terminal = Find-Header "Altronic Terminal"; TableHeight = Find-Header "Table Height"
    ManPart = Find-Header "Man. Part"; Applicator = Find-Header "Applicator Serial"
    WireSetting = Find-Header "Wire Setting"; InsulationSetting = Find-Header "Insulation Setting"
    Gauge = Find-Header "Wire Gauge"; CrimpHeight = Find-Header "Crimp Height"
    Tolerance = Find-Header "Tolerance"; Notes = Find-Header "Notes"
}

function Clean($value, [switch]$Gauge) {
    $v = "$value".Trim()
    if ($Gauge) { $v = $v -replace "mm$REPLACEMENT", "mm$([char]0x00B2)" }
    # Between two numbers it was a plus-or-minus ("0.120 ? 0.005"); elsewhere a dash.
    $v = $v -replace "(\d)\s*$REPLACEMENT\s*(\.?\d)", "`$1 $([char]0x00B1) `$2"
    return ($v -replace "\s*$REPLACEMENT\s*", " - ").Trim()
}
function To-Number($value, $label, $terminal) {
    $v = "$value".Trim() -replace '^[\u00B1+]\s*', ''
    if (-not $v) { return $null }
    $n = 0.0
    if ([double]::TryParse($v, [System.Globalization.NumberStyles]::Float, [System.Globalization.CultureInfo]::InvariantCulture, [ref]$n)) { return $n }
    $script:attention += "$terminal - $label '$value' isn't a number; left blank"
    return $null
}
function Get-Key($t, $a, $g) { "{0}|{1}|{2}" -f ($t.Trim().ToUpper() -replace '\s+', ' '), ($a.Trim().ToUpper() -replace '\s+', ' '), ($g.Trim().ToUpper() -replace '\s+', ' ') }

# --- build the specs -----------------------------------------------------------
$specs = @()
$attention = @()
$skipped = @()
$last = $null
foreach ($r in $rows) {
    $terminal = Clean $r.($H.Terminal)
    $gauge = Clean $r.($H.Gauge) -Gauge
    $wire = Clean $r.($H.WireSetting)
    $height = "$($r.($H.CrimpHeight))".Trim()
    $notes = Clean $r.($H.Notes)
    if (-not $terminal) {
        if (-not ($gauge -or $wire -or $height)) { continue }  # blank row
        if (-not $last) { $skipped += "continuation row with no row above it: gauge '$gauge'"; continue }
        $terminal = $last.Title; $manPart = $last.ManufacturerPartNumber
        $applicator = $last.Applicator; $table = $last.TableHeight
    } else {
        if ($terminal -notmatch '^[A-Za-z0-9-]{3,20}$') { $skipped += "not a part number: '$terminal'"; continue }
        $manPart = Clean $r.($H.ManPart)
        $applicator = (Clean $r.($H.Applicator)).ToUpper()
        $table = Clean $r.($H.TableHeight)
    }
    if ($notes -match '^Continuation row') { $notes = "" }
    $spec = [ordered]@{
        Title = $terminal.ToUpper(); ManufacturerPartNumber = $manPart; Applicator = $applicator
        WireGauge = $gauge; TableHeight = $table; WireSetting = $wire
        InsulationSetting = Clean $r.($H.InsulationSetting)
        CrimpHeight = To-Number $height "crimp height" $terminal
        Tolerance = To-Number $r.($H.Tolerance) "tolerance" $terminal
        Notes = $notes; Active = $true
    }
    if ($null -eq $spec.CrimpHeight) { $attention += "$terminal $gauge ($applicator) - no crimp height; checks can't be judged until it's filled in" }
    elseif ($null -eq $spec.Tolerance) { $attention += "$terminal $gauge ($applicator) - crimp height $($spec.CrimpHeight) but no tolerance" }
    if ($notes) { $attention += "$terminal $gauge ($applicator) - note: $notes" }
    $specs += $spec
    $last = $spec
}

# One per key, first wins - a second row for the same key is reported.
$byKey = [ordered]@{}
foreach ($s in $specs) {
    $k = Get-Key $s.Title $s.Applicator $s.WireGauge
    if ($byKey.Contains($k)) { $skipped += "duplicate in the CSV: $($s.Title) / $($s.Applicator) / $($s.WireGauge)"; continue }
    $byKey[$k] = $s
}

Write-Host "`nRead $CsvPath as $encoding - $($byKey.Count) specs" -ForegroundColor Cyan
$byKey.Values | ForEach-Object {
    [pscustomobject]@{
        Terminal = $_.Title; Gauge = $_.WireGauge; Applicator = $_.Applicator; MfrPart = $_.ManufacturerPartNumber
        Height = if ($null -ne $_.CrimpHeight) { $_.CrimpHeight.ToString("0.000#", [cultureinfo]::InvariantCulture) } else { "" }
        Tol = if ($null -ne $_.Tolerance) { $_.Tolerance.ToString("0.000#", [cultureinfo]::InvariantCulture) } else { "" }; Wire = $_.WireSetting; Ins = $_.InsulationSetting; Table = $_.TableHeight
    }
} | Format-Table -AutoSize | Out-String -Width 200 | Write-Host
if ($attention) { Write-Host "Needs a look:" -ForegroundColor Yellow; $attention | ForEach-Object { Write-Host "  $_" -ForegroundColor Yellow } }
if ($skipped)   { Write-Host "Skipped:" -ForegroundColor DarkGray; $skipped | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray } }

if ($ParseOnly) { return }
if (-not $SpecsListId) { throw "Pass -SpecsListId (printed by create-crimp-lists.ps1), or -ParseOnly to stop here." }

# --- compare with the list -----------------------------------------------------
Import-Module Microsoft.Graph.Authentication
$ctx = Get-MgContext
if (-not $ctx -or $ctx.Scopes -notcontains "Sites.Manage.All") {
    if ($DeviceCode) { Connect-MgGraph -Scopes "Sites.Manage.All" -UseDeviceCode -NoWelcome }
    else             { Connect-MgGraph -Scopes "Sites.Manage.All" -NoWelcome }
}
$items = "https://graph.microsoft.com/v1.0/sites/$siteId/lists/$SpecsListId/items"
$existing = @{}
$uri = "$items`?`$expand=fields(`$select=Title,Applicator,WireGauge)&`$top=999"
while ($uri) {
    $page = Invoke-MgGraphRequest -Method GET -Uri $uri
    foreach ($i in $page.value) { $existing[(Get-Key "$($i.fields.Title)" "$($i.fields.Applicator)" "$($i.fields.WireGauge)")] = $i.id }
    $uri = $page["@odata.nextLink"]
}

$toAdd = @($byKey.Keys | Where-Object { -not $existing.ContainsKey($_) })
Write-Host "`n$($existing.Count) specs already on the list; $($toAdd.Count) to add; $($byKey.Count - $toAdd.Count) already there (left alone)." -ForegroundColor Cyan
if (-not $Apply) { Write-Host "Report only. Re-run with -Apply to add them." -ForegroundColor Magenta; return }

$added = 0
foreach ($k in $toAdd) {
    $fields = @{}
    foreach ($e in $byKey[$k].GetEnumerator()) { if ($null -ne $e.Value) { $fields[$e.Key] = $e.Value } }
    Invoke-MgGraphRequest -Method POST -Uri $items -ContentType "application/json" `
        -Body (@{ fields = $fields } | ConvertTo-Json -Depth 4) | Out-Null
    $added++
}
Write-Host "Added $added specs." -ForegroundColor Green
