<#
.SYNOPSIS
    Copies CPU-95 test sheets from the old "CPU-95" list (Altronic_Engineering)
    to the new QCFRM-012 list on Altronic_PMO, in the new column layout.
    Reports only unless -Apply is passed.

.DESCRIPTION
    Only the sheets entered since the ARC form went live are copied (Tim,
    2026-10-21). The rows before that came from the Power Apps form and have
    paper copies; there is a gap in the data between the two. Run without
    -Since first: the report lists the biggest gaps between created dates
    and who created the rows, so the cut-over date can be read off it. Then
    pass that date as -Since. The cut-over is 2026-09-18, the day the first
    sheet was entered through ARC (Tim, 2026-10-21).

    How a row is translated - all of it read from
    scripts/data/qc-cpu95-columns.json, the layout the create script built:
    - A peak-volt reading takes the 791952/62-18 column on those two part
      numbers and the standard column on every other; a value only in the
      other column is still carried, with a note.
    - Firing angles come from the grid for the unit's cylinder count (16, 18
      or 20), in row order. Actuals in another grid are noted, not copied.
    - Date-only columns are read the way ARC reads them and written at midday
      UTC, so a row shows the date it showed in ARC before.
    - "Firing Actuals at Spec" is Yes when every actual typed matches its
      spec, No when any differs (and only the differing actuals are copied),
      blank when no actual was typed.
    - A ticked check becomes "Yes". An unticked one stays BLANK, never "No":
      the old list can't tell "not done" from "failed".
    - Project Tag (a lookup) becomes its project titles as text.
    - The oven ON/OFF times, SAP Number and Memory No. are left blank, to be
      filled in with operations from the paper copies.
    - LegacySource ("CPU-95#<id>"), LegacyCreated and LegacyCreatedBy record
      where the row came from. Anything that couldn't be carried cleanly goes
      in Data Quality Notes, with the original value.

    ADD-ONLY and safe to re-run: a row whose LegacySource is already on the new
    list is skipped. Never changes or deletes anything on either list. Row
    attachments are NOT copied; the report counts them.

    The preview CSV holds real test data, so it is written to -OutDir (outside
    the repo), never next to this script.

    RUN IN YOUR OWN TERMINAL - the sign-in is interactive.

.EXAMPLE
    .\migrate-qc-cpu95-to-pmo.ps1
    .\migrate-qc-cpu95-to-pmo.ps1 -Since 2026-09-18
    .\migrate-qc-cpu95-to-pmo.ps1 -Since 2026-09-18 -Apply
#>

[CmdletBinding()]
param(
    # Copy rows CREATED on or after this date (local time). Required for -Apply.
    [datetime]$Since,
    [string]$SourceListId,
    [string]$TargetListId,
    [string]$OutDir = (Join-Path $env:TEMP "qc-cpu95-migration"),
    [switch]$Apply,
    [switch]$DeviceCode
)

$ErrorActionPreference = "Stop"
if ($Apply -and -not $Since) { throw "-Apply needs -Since: run once without it to find the cut-over date." }

$engineeringSite = "coopermachineryservices.sharepoint.com,ddb5fc80-ea51-4d56-b008-ce6a82af49b0,aa6b9467-3f57-4213-bbd4-60b94403421a"
$pmoSite = "coopermachineryservices.sharepoint.com,915a6183-2b71-4dfd-a8b9-181126dfbe78,3eb6cb9c-6535-4c69-a8d7-e90b2f90a9eb"
$spec = Get-Content (Join-Path $PSScriptRoot "data/qc-cpu95-columns.json") -Raw -Encoding utf8 | ConvertFrom-Json

# --- source list id: parameter, else .env.local, else the documented default --
function Get-EnvLocalValue($name) {
    $envFile = Join-Path (Split-Path $PSScriptRoot -Parent) ".env.local"
    if (-not (Test-Path $envFile)) { return $null }
    foreach ($line in Get-Content $envFile) {
        if ($line -match "^\s*$name\s*=\s*(.*?)\s*$") { return $Matches[1].Trim('"', "'") }
    }
    return $null
}
if (-not $SourceListId) { $SourceListId = Get-EnvLocalValue "VITE_SP_QC_CPU95_LIST_ID" }
if (-not $SourceListId) { $SourceListId = "4843afdc-5697-4f44-8113-003cc220b57a" }

Import-Module Microsoft.Graph.Authentication
$ctx = Get-MgContext
# Sites.Manage.All (what the create script signs in with) covers this too, so a
# session left open after creating the list carries straight on.
if (-not $ctx -or ($ctx.Scopes -notcontains "Sites.ReadWrite.All" -and $ctx.Scopes -notcontains "Sites.Manage.All")) {
    if ($DeviceCode) { Connect-MgGraph -Scopes "Sites.ReadWrite.All" -UseDeviceCode -NoWelcome }
    else             { Connect-MgGraph -Scopes "Sites.ReadWrite.All" -NoWelcome }
}

function Get-AllItems($site, $listId, $expand) {
    $out = [System.Collections.Generic.List[object]]::new()
    $uri = "https://graph.microsoft.com/v1.0/sites/$site/lists/$listId/items?`$expand=$expand&`$top=999"
    while ($uri) {
        $page = Invoke-MgGraphRequest -Method GET -Uri $uri
        foreach ($v in $page.value) { $out.Add($v) }
        $uri = $page["@odata.nextLink"]
    }
    $out
}

# Invoke-MgGraphRequest hands a date back as a [datetime]; Graph wants ISO 8601.
function ConvertTo-IsoDate($v) {
    if ($null -eq $v -or "$v" -eq "") { return $null }
    if ($v -is [datetime]) { return $v.ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ") }
    return "$v"
}
# A date-only value the way ARC reads it (parseSpDateOnly in src/lib/spDates.ts:
# a stored time after 12:00 UTC belongs to the next day) and writes it (midday
# UTC), so a migrated row shows the date ARC showed on the old list.
function ConvertTo-SpDateOnly($v) {
    if ($null -eq $v -or "$v" -eq "") { return $null }
    $d = if ($v -is [datetime]) { $v.ToUniversalTime() } else { ([datetimeoffset]::Parse("$v")).UtcDateTime }
    $day = $d.Date
    if ($d.Hour -gt 12 -or ($d.Hour -eq 12 -and ($d.Minute -gt 0 -or $d.Second -gt 0))) { $day = $day.AddDays(1) }
    return $day.ToString("yyyy-MM-dd") + "T12:00:00Z"
}
function Get-CreatedLocal($item) {
    $c = $item.createdDateTime
    if ($c -is [datetime]) { return $c.ToLocalTime() }
    return ([datetime]::Parse("$c")).ToLocalTime()
}
function Test-Blank($v) { return ($null -eq $v -or "$v".Trim() -eq "") }

# --- read the old list ------------------------------------------------------
# No $select: naming ~230 columns makes a URL SharePoint answers with a bare 404
# (see "There is deliberately NO $select on the CPU-95 read" in CLAUDE.md).
Write-Host "Reading the old CPU-95 list ($SourceListId)..." -ForegroundColor Cyan
$items = @(Get-AllItems $engineeringSite $SourceListId "fields" | Sort-Object { Get-CreatedLocal $_ })
Write-Host "  $($items.Count) rows" -ForegroundColor Gray
if (-not $items.Count) { Write-Host "Nothing to do." -ForegroundColor Yellow; exit 0 }

# --- report: when rows were created, and the gaps between them ---------------
Write-Host "`n=== Rows created per month ===" -ForegroundColor Cyan
$items | Group-Object { (Get-CreatedLocal $_).ToString("yyyy-MM") } | ForEach-Object {
    "  {0}  {1,5}" -f $_.Name, $_.Count
} | Write-Host

Write-Host "`n=== Biggest gaps between one row and the next ===" -ForegroundColor Cyan
$gaps = for ($i = 1; $i -lt $items.Count; $i++) {
    $a = Get-CreatedLocal $items[$i - 1]; $b = Get-CreatedLocal $items[$i]
    [pscustomobject]@{ Days = [Math]::Round(($b - $a).TotalDays, 1); Before = $a; After = $b; RowsFromHere = $items.Count - $i }
}
$gaps | Sort-Object Days -Descending | Select-Object -First 5 | ForEach-Object {
    "  {0,6} days   last before {1:yyyy-MM-dd HH:mm}   first after {2:yyyy-MM-dd HH:mm}   ({3} rows from there on)" -f `
        $_.Days, $_.Before, $_.After, $_.RowsFromHere
} | Write-Host

# Rows created through an app (ARC, or a Power Apps/Flow connector) carry the
# app in AppAuthor; a cut-over usually shows as that value changing.
Write-Host "`n=== Created by (person, and the app that wrote it) ===" -ForegroundColor Cyan
$items | Group-Object {
    $who = $_.createdBy.user.displayName; $app = $_.createdBy.application.displayName
    if (-not $app -and $_.fields.AppAuthorLookupId) { $app = "app #$($_.fields.AppAuthorLookupId)" }
    "$who | $(if ($app) { $app } else { '(no app)' })"
} | Sort-Object Count -Descending | ForEach-Object {
    $first = Get-CreatedLocal ($_.Group | Select-Object -First 1); $last = Get-CreatedLocal ($_.Group | Select-Object -Last 1)
    "  {0,5}  {1}   {2:yyyy-MM-dd} .. {3:yyyy-MM-dd}" -f $_.Count, $_.Name, $first, $last
} | Write-Host

if (-not $Since) {
    $biggest = $gaps | Sort-Object Days -Descending | Select-Object -First 1
    Write-Host "`nNo -Since given, so nothing is translated yet." -ForegroundColor Yellow
    if ($biggest) {
        Write-Host ("The biggest gap ends {0:yyyy-MM-dd}. If that is when the ARC form went live, re-run with -Since {0:yyyy-MM-dd}." -f $biggest.After) -ForegroundColor Yellow
    }
    exit 0
}

# --- translate ----------------------------------------------------------------
$ALTMODE = @{ "791950-08" = 1; "791950-16" = 2; "791950-20" = 3; "791962-20" = 3; "791950-18" = 4; "791952-18" = 5; "791962-18" = 6 }
# Must agree with qcCpu95Altmode() in src/lib/qcCpu95Mapper.ts.
function Get-Altmode($pn) {
    $t = "$pn".Trim()
    if ($t -match '^(.+-)(\d)$') { $t = "$($Matches[1])0$($Matches[2])" }
    if ($ALTMODE.ContainsKey($t)) { return $ALTMODE[$t] }
    return 0
}
function Get-Grid($altmode) {
    if ($altmode -eq 3) { return "20" }
    if ($altmode -ge 4) { return "18" }
    return "16"
}

function ConvertTo-NewRow($item) {
    $f = $item.fields
    $out = @{}; $notes = [System.Collections.Generic.List[string]]::new()
    $altmode = Get-Altmode $f.AltronicPartNumber
    $useAlt = $altmode -ge 5
    $grid = Get-Grid $altmode

    foreach ($c in $spec.columns) {
        if ($c.firing -or $c.transform -eq "actualsAtSpec") { continue }  # below, as one step
        $v = $null
        switch ($c.transform) {
            "voltageSet" {
                $std = $f[$c.from[0]]; $alt = $f[$c.from[1]]
                $preferred = if ($useAlt) { $alt } else { $std }; $other = if ($useAlt) { $std } else { $alt }
                if (-not (Test-Blank $preferred)) {
                    $v = $preferred
                    if (-not (Test-Blank $other) -and [double]$other -ne [double]$preferred) { $notes.Add("$($c.name): the other voltage set also held $other") }
                } elseif (-not (Test-Blank $other)) {
                    $v = $other
                    $notes.Add("$($c.name): taken from the $(if ($useAlt) { 'standard' } else { '791952/62-18' }) column, which doesn't match the part number")
                }
            }
            "lookupTitles" {
                $raw = @($f[$c.from]) | Where-Object { $_ }
                $titles = @($raw | ForEach-Object { if ($_ -is [System.Collections.IDictionary]) { $_["LookupValue"] } else { $null } } | Where-Object { $_ })
                if ($titles.Count) { $v = $titles -join "; " }
                elseif ($raw.Count) { $notes.Add("Project Tag held lookup ids only: $($raw -join ', ')") }
            }
            "legacySource"    { $v = "CPU-95#$($item.id)" }
            "legacyCreated"   { $v = ConvertTo-IsoDate $item.createdDateTime }
            "legacyCreatedBy" { $v = $item.createdBy.user.displayName }
            "dataQualityNotes" { }  # filled in last
            default { if ($c.from) { $v = $f[$c.from] } }
        }
        if (Test-Blank $v) { continue }
        switch ($c.type) {
            "check"    { if ($v -eq $true) { $out[$c.name] = "Yes" } }
            "flag"     { if ($v -eq $true) { $out[$c.name] = $true } }
            "number"   { $out[$c.name] = [double]$v }
            "date"     { $out[$c.name] = ConvertTo-SpDateOnly $v }
            "dateTime" { $out[$c.name] = ConvertTo-IsoDate $v }
            default    { $out[$c.name] = "$v" }
        }
    }

    # Firing angles: the unit's grid, in row order, into the 20 slots.
    $letters = @($spec.firingLetters.$grid)
    $typed = 0; $differs = 0
    for ($n = 1; $n -le $letters.Count; $n++) {
        $nn = "{0:D2}" -f $n
        $s = $f["FiringAngleSpec$grid$($letters[$n - 1])"]; $a = $f["FiringAngleActual$grid$($letters[$n - 1])"]
        if (-not (Test-Blank $s)) { $out["FiringSpec$nn"] = [double]$s }
        if (-not (Test-Blank $a)) {
            $typed++
            if ((Test-Blank $s) -or [double]$a -ne [double]$s) { $differs++; $out["FiringActual$nn"] = [double]$a }
        }
    }
    if ($typed) { $out["FiringActualsAtSpec"] = if ($differs) { "No" } else { "Yes" } }
    # Only stray ACTUALS are noted: the Power Apps form pre-filled the 16-cyl
    # specs (0, 45, 90 ...) on every unit, so stray specs are its defaults.
    foreach ($g in @("16", "18", "20" | Where-Object { $_ -ne $grid })) {
        $stray = foreach ($l in $spec.firingLetters.$g) {
            $x = $f["FiringAngleActual$g$l"]; if (-not (Test-Blank $x)) { "$g$l=$x" } }
        if ($stray) { $notes.Add("Firing actuals in the $g-cyl grid, not copied (unit uses $grid): $($stray -join ', ')") }
    }

    if ($notes.Count) { $out["DataQualityNotes"] = "Migrated from CPU-95#$($item.id): " + ($notes -join "; ") }
    [pscustomobject]@{ Item = $item; Fields = $out; Notes = $notes }
}

$picked = @($items | Where-Object { (Get-CreatedLocal $_) -ge $Since })
Write-Host ("`n=== Translating {0} rows created on or after {1:yyyy-MM-dd} ===" -f $picked.Count, $Since) -ForegroundColor Cyan

# Rows already on the new list (matched on LegacySource) are skipped.
if (-not $TargetListId) {
    $uri = "https://graph.microsoft.com/v1.0/sites/$pmoSite/lists?`$select=id,displayName&`$top=200"
    while ($uri -and -not $TargetListId) {
        $page = Invoke-MgGraphRequest -Method GET -Uri $uri
        foreach ($l in $page.value) { if ($l.displayName -eq $spec.listName) { $TargetListId = $l.id } }
        $uri = $page["@odata.nextLink"]
    }
}
$already = [System.Collections.Generic.HashSet[string]]::new()
if ($TargetListId) {
    foreach ($r in (Get-AllItems $pmoSite $TargetListId "fields(`$select=LegacySource)")) {
        if ($r.fields.LegacySource) { [void]$already.Add($r.fields.LegacySource) }
    }
    Write-Host "  New list: $TargetListId - $($already.Count) migrated rows already there" -ForegroundColor Gray
} else {
    Write-Host "  The new list '$($spec.listName)' doesn't exist on Altronic_PMO yet - run create-qc-form-list.ps1 -Columns qc-cpu95-columns.json before -Apply." -ForegroundColor Yellow
}

$rows = @($picked | ForEach-Object { ConvertTo-NewRow $_ })
$new = @($rows | Where-Object { -not $already.Contains($_.Fields.LegacySource) })
$withNotes = @($new | Where-Object { $_.Notes.Count })
$withAttachments = @($new | Where-Object { $_.Item.fields.Attachments -eq $true })
Write-Host "  $($new.Count) to add, $($rows.Count - $new.Count) already migrated" -ForegroundColor Gray
Write-Host "  $($withNotes.Count) carry a Data Quality Note" -ForegroundColor $(if ($withNotes.Count) { "Yellow" } else { "Gray" })
if ($withAttachments.Count) {
    Write-Host "  $($withAttachments.Count) have attachments, which are NOT copied: $(($withAttachments | ForEach-Object { "CPU-95#$($_.Item.id)" }) -join ', ')" -ForegroundColor Yellow
}

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$previewPath = Join-Path $OutDir "qc-cpu95-migration-preview.csv"
$new | ForEach-Object {
    [pscustomobject]@{
        LegacySource = $_.Fields.LegacySource; SerialNumber = $_.Fields.Title; PartNumber = $_.Fields.AltronicPartNumber
        Created = (Get-CreatedLocal $_.Item).ToString("yyyy-MM-dd HH:mm"); CreatedBy = $_.Fields.LegacyCreatedBy
        Columns = $_.Fields.Count; ActualsAtSpec = $_.Fields.FiringActualsAtSpec; Notes = ($_.Notes -join "; ")
    }
} | Export-Csv $previewPath -NoTypeInformation -Encoding utf8
Write-Host "  Preview: $previewPath" -ForegroundColor Gray

if (-not $Apply) {
    Write-Host "`nReport only - nothing was written. Re-run with -Apply to copy these rows.`n" -ForegroundColor Yellow
    exit 0
}
if (-not $TargetListId) { throw "The new list doesn't exist yet." }

# --- write, 20 per $batch, pausing at a throttled batch -------------------------
$failures = [System.Collections.Generic.List[object]]::new()
$pending = [System.Collections.Generic.List[object]]::new(); $new | ForEach-Object { $pending.Add($_) }
$done = 0; $round = 0
while ($pending.Count -gt 0 -and $round -lt 10) {
    $round++
    $retry = [System.Collections.Generic.List[object]]::new(); $wait = 0
    for ($i = 0; $i -lt $pending.Count; $i += 20) {
        if ($wait -gt 0) { Write-Host "  throttled - pausing $wait s" -ForegroundColor Yellow; Start-Sleep -Seconds $wait; $wait = 0 }
        $chunk = @($pending[$i..([Math]::Min($i + 19, $pending.Count - 1))])
        $reqs = for ($j = 0; $j -lt $chunk.Count; $j++) {
            @{ id = "$j"; method = "POST"; url = "/sites/$pmoSite/lists/$TargetListId/items"
               headers = @{ "Content-Type" = "application/json" }; body = @{ fields = $chunk[$j].Fields } }
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
                $failures.Add([pscustomobject]@{ LegacySource = $w.Fields.LegacySource; Status = $r.status; Error = $msg })
            }
        }
    }
    $pending = $retry
    if ($pending.Count) { Write-Host "  $($pending.Count) throttled - waiting 10 s, then retrying" -ForegroundColor Yellow; Start-Sleep -Seconds 10 }
}
foreach ($w in $pending) { $failures.Add([pscustomobject]@{ LegacySource = $w.Fields.LegacySource; Status = "throttled"; Error = "gave up after $round rounds" }) }

Write-Host "`nWritten: $done   failed: $($failures.Count)" -ForegroundColor $(if ($failures.Count) { "Red" } else { "Green" })
if ($failures.Count) {
    $failPath = Join-Path $OutDir "qc-cpu95-migration-failures.csv"
    $failures | Export-Csv $failPath -NoTypeInformation -Encoding utf8
    Write-Host "See $failPath. Re-running is safe: only rows not yet on the new list are written." -ForegroundColor Yellow
}
