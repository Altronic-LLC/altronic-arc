<#
.SYNOPSIS
    Checks the "Crimp Specs" list against the crimp tables in work instruction
    MWI-054 (Table 3-1 AMP, Table 3-2 Packard) and, with -Apply, adds any spec
    the list is missing. ADD-ONLY: never changes or deletes a spec.

.DESCRIPTION
    Reads the tables straight out of the WI's .docx, so no spec data lives in
    this script (the repo is public).

    What it understands in the WI:

    - A table whose header starts "Altronic P/N". Column 2 is the applicator:
      a serial number on the AMP table, the tooling COLOUR on the Packard
      table (ARC's Applicator column holds a colour where there's no serial).
    - Merged cells (vMerge) carry the part number and applicator down to the
      rows below them, the way the table reads.
    - "604104 & 604105", "610550 or 610485" = one spec per part number.
    - Crimp height "0.036 ± 0.002" = nominal and tolerance; "0.031 to 0.033"
      = 0.032 ± 0.001 (the same limits). Anything after it, like
      "(see Note 2)", goes in the spec's Notes with the note's text.
    - "N/A" or "See Note 1" = no crimp height check required. Those rows are
      reported and NOT loaded unless -IncludeNotRequired, since the WI tells
      operators not to record a check for them.
    - The WI's "Setting" column goes to ARC's Wire Setting.

    How it compares, per WI row, on the key ARC itself uses (terminal +
    applicator + gauge, case and spacing ignored; "AWG" ignored on the gauge):

      MATCH       on the list, crimp height, tolerance and setting agree
      DIFFERS     on the list, but height / tolerance / setting disagree -
                  reported, NEVER changed (fix it on ARC's Specs screen)
      RETIRED     on the list but retired (Active = No)
      MISSING     not on the list - added by -Apply
      NOT NEEDED  the WI says no crimp height check (N/A / See Note)

    and every spec on the list that no WI row matches is listed as
    "NOT IN WI" (the Mecal sheet's specs land here - that's expected).

    MACHINES (-MachinesByTable): which presses each WI table's specs run on,
    by their names in the Altronic Equipment List, e.g.
        -MachinesByTable @{ "3-1" = "AMP PRESS #1", "AMP PRESS #2"; "3-2" = "PACKARD APPLICATOR PRESS" }
    A spec -Apply adds gets them, and a spec ALREADY on the list for a WI row
    gets them only if it names no machine yet - a machine somebody set in ARC
    is never changed. Needs the Machines column (create-crimp-lists.ps1).

    A report CSV is written beside the .docx (or -ReportPath).

    RUN IN YOUR OWN TERMINAL - the Graph sign-in is interactive. -ParseOnly
    needs no sign-in and shows what was read from the WI.

.EXAMPLE
    .\check-crimp-specs-against-wi.ps1 -DocxPath "C:\Working_Dir\ProcessImprovement\Arc\Harness Crimp\MWI-054_REV9.docx" -ParseOnly
    .\check-crimp-specs-against-wi.ps1 -DocxPath "...\MWI-054_REV9.docx"
    .\check-crimp-specs-against-wi.ps1 -DocxPath "...\MWI-054_REV9.docx" -Apply
    .\check-crimp-specs-against-wi.ps1 -DocxPath "...\MWI-054_REV9.docx" -Apply `
        -MachinesByTable @{ "3-1" = "AMP PRESS #1", "AMP PRESS #2"; "3-2" = "PACKARD APPLICATOR PRESS" }
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$DocxPath,
    # Defaults to VITE_SP_CRIMP_SPECS_LIST_ID from the repo's .env.local.
    [string]$SpecsListId,
    [string]$ReportPath,
    [switch]$Apply,
    [switch]$ParseOnly,
    [switch]$IncludeNotRequired,
    # Table ("3-1", "3-2") -> press names in the Altronic Equipment List.
    [hashtable]$MachinesByTable,
    [string]$EquipmentListId = "6f2fb6e1-3b41-40de-b78b-2c43c3c3d068",
    [switch]$DeviceCode
)

$ErrorActionPreference = "Stop"
$siteId = "coopermachineryservices.sharepoint.com,915a6183-2b71-4dfd-a8b9-181126dfbe78,3eb6cb9c-6535-4c69-a8d7-e90b2f90a9eb"
$inv = [cultureinfo]::InvariantCulture
$PM = [char]0x00B1

# --- read word/document.xml (works while the file is open in Word) -----------
Add-Type -AssemblyName System.IO.Compression
$docx = (Resolve-Path $DocxPath).Path
$stream = [System.IO.File]::Open($docx, 'Open', 'Read', 'ReadWrite')
try {
    $zip = [System.IO.Compression.ZipArchive]::new($stream, 'Read')
    $entry = $zip.GetEntry("word/document.xml")
    if (-not $entry) { throw "$docx has no word/document.xml - is it a .docx?" }
    $reader = [System.IO.StreamReader]::new($entry.Open())
    $xmlText = $reader.ReadToEnd()
    $reader.Close()
} finally { $stream.Close() }

$xml = [xml]$xmlText
$ns = [System.Xml.XmlNamespaceManager]::new($xml.NameTable)
$ns.AddNamespace("w", "http://schemas.openxmlformats.org/wordprocessingml/2006/main")

function Get-ParaText($p) {
    (($p.SelectNodes(".//w:t", $ns) | ForEach-Object { $_.InnerText }) -join "")
}
function Get-CellText($tc) {
    $parts = foreach ($p in $tc.SelectNodes("w:p", $ns)) { (Get-ParaText $p).Trim() }
    (($parts | Where-Object { $_ }) -join " ") -replace '\s+', ' '
}

$body = $xml.SelectSingleNode("/w:document/w:body", $ns)
$revision = ""
foreach ($p in $body.SelectNodes("w:p", $ns)) {
    if ((Get-ParaText $p) -match '^\s*Revision\s+(\d+)\s*$') { $revision = $Matches[1]; break }
}
$source = if ($revision) { "MWI-054 Rev $revision" } else { "MWI-054" }

# --- walk the body in order: spec tables, then the NOTES under each ----------
$tables = @()          # @{ Kind; Label; Rows = @(@{ PN; App; Setting; Gauge; Height }) ; Notes = @{} }
$current = $null
foreach ($node in $body.ChildNodes) {
    if ($node.LocalName -eq "tbl") {
        $rows = @($node.SelectNodes("w:tr", $ns))
        if ($rows.Count -lt 2) { $current = $null; continue }
        $header = @($rows[0].SelectNodes("w:tc", $ns) | ForEach-Object { Get-CellText $_ })
        if ($header[0] -notmatch '^Altronic P/N') { $current = $null; continue }
        $kind = if ($header[1] -match 'Packard') { "Packard" } else { "AMP" }
        $label = if ($kind -eq "Packard") { "Table 3-2 (Packard)" } else { "Table 3-1 (AMP)" }
        $settingWhere = if ($header[2] -match '\((.+)\)') { $Matches[1] } else { "" }
        $above = @{}   # logical column -> text, for vMerge continuations
        $parsed = @()
        foreach ($tr in $rows[1..($rows.Count - 1)]) {
            $col = 0
            $vals = @{}
            foreach ($tc in $tr.SelectNodes("w:tc", $ns)) {
                $span = $tc.SelectSingleNode("w:tcPr/w:gridSpan", $ns)
                $width = if ($span) { [int]$span.GetAttribute("val", $ns.LookupNamespace("w")) } else { 1 }
                $vm = $tc.SelectSingleNode("w:tcPr/w:vMerge", $ns)
                $text = Get-CellText $tc
                if ($vm -and $vm.GetAttribute("val", $ns.LookupNamespace("w")) -ne "restart") { $text = $above[$col] }
                $vals[$col] = $text
                $above[$col] = $text
                $col += $width
            }
            $parsed += @{ PN = "$($vals[0])"; App = "$($vals[1])"; Setting = "$($vals[2])"; Gauge = "$($vals[3])"; Height = "$($vals[4])" }
        }
        $current = @{ Kind = $kind; Label = $label; SettingWhere = $settingWhere; Rows = $parsed; Notes = @{} }
        $tables += $current
        continue
    }
    if ($node.LocalName -eq "p" -and $current) {
        $t = (Get-ParaText $node).Trim()
        if ($t -match '^Table\s+3') { $current = $null; continue }
        if ($t -match '^(\d+)\.\s+(.+)$') { $current.Notes[$Matches[1]] = $Matches[2].Trim() }
    }
}
if ($tables.Count -eq 0) { throw "No table with an 'Altronic P/N' header in $docx." }

function Expand-Note($notes, $n) {
    $text = $notes["$n"]
    if (-not $text) { return "Note $n" }
    # "follow Note 1" - carry that note's words too, so the spec reads on its own.
    if ($text -match 'Note\s+(\d+)' -and $Matches[1] -ne "$n" -and $notes[$Matches[1]]) {
        $text = "$text (Note $($Matches[1]): $($notes[$Matches[1]]))"
    }
    return "Note ${n}: $text"
}
function To-Num($s) { [double]::Parse($s, [System.Globalization.NumberStyles]::Float, $inv) }
function Get-Key($t, $a, $g) {
    $n = { param($s) ("$s".Trim().ToUpper() -replace '\s+', ' ') }
    $gauge = (& $n $g) -replace '\s*AWG$', ''
    "{0}|{1}|{2}" -f (& $n $t), (& $n $a), $gauge
}

# --- WI rows -> specs ----------------------------------------------------------
$wiSpecs = @()
$problems = @()
foreach ($tbl in $tables) {
    foreach ($r in $tbl.Rows) {
        if (-not $r.PN -and -not $r.Gauge) { continue }
        $height = $null; $tol = $null; $notes = @(); $required = $true
        $h = $r.Height.Trim()
        $rest = ""
        if ($h -match "^(\d*\.\d+)\s*(?:$PM|\+/-|\+-)\s*(\d*\.\d+)(.*)$") {
            $height = To-Num $Matches[1]; $tol = To-Num $Matches[2]; $rest = $Matches[3]
        } elseif ($h -match '^(\d*\.\d+)\s*to\s*(\d*\.\d+)(.*)$') {
            $lo = To-Num $Matches[1]; $hi = To-Num $Matches[2]; $rest = $Matches[3]
            $height = [math]::Round(($lo + $hi) / 2, 5); $tol = [math]::Round(($hi - $lo) / 2, 5)
        } elseif ($h -match '^N/?A\b') {
            $required = $false; $notes += "No crimp height check required ($source $($tbl.Label))."
        } elseif ($h -match '^See\s+Note\s+(\d+)') {
            $required = $false; $notes += (Expand-Note $tbl.Notes $Matches[1])
        } else {
            $problems += "$($tbl.Label) $($r.PN) $($r.Gauge) AWG - crimp height '$h' not understood; skipped"
            continue
        }
        if ($rest -match 'Note\s+(\d+)') { $notes += (Expand-Note $tbl.Notes $Matches[1]) }
        $where = if ($tbl.SettingWhere) { "; setting $($tbl.SettingWhere)" } else { "" }
        $notes += "From $source $($tbl.Label)$where."

        $terminals = $r.PN -split '\s*(?:&|,|\bor\b|\band\b)\s*' | Where-Object { $_ }
        foreach ($t in $terminals) {
            $wiSpecs += [ordered]@{
                Table = $tbl.Label; Required = $required
                Title = $t.Trim().ToUpper(); Applicator = $r.App.Trim().ToUpper()
                WireGauge = ($r.Gauge.Trim() -replace '\s*AWG$', ''); WireSetting = $r.Setting.Trim()
                CrimpHeight = $height; Tolerance = $tol; Notes = ($notes -join " ")
            }
        }
    }
}

# One per key - a repeat in the WI is reported.
$byKey = [ordered]@{}
foreach ($s in $wiSpecs) {
    $k = Get-Key $s.Title $s.Applicator $s.WireGauge
    if ($byKey.Contains($k)) { $problems += "duplicate in the WI: $($s.Title) / $($s.Applicator) / $($s.WireGauge)"; continue }
    $byKey[$k] = $s
}

function Fmt($n) { if ($null -eq $n -or "$n" -eq "") { "" } else { ([double]$n).ToString("0.000#", $inv) } }

Write-Host "`nRead $source from $docx - $($byKey.Count) specs ($(@($byKey.Values | Where-Object { $_.Required }).Count) need a crimp height check)" -ForegroundColor Cyan
$byKey.Values | ForEach-Object {
    [pscustomobject]@{
        Table = $_.Table; Terminal = $_.Title; Applicator = $_.Applicator; Gauge = $_.WireGauge; Setting = $_.WireSetting
        Height = Fmt $_.CrimpHeight; Tol = Fmt $_.Tolerance; Check = if ($_.Required) { "yes" } else { "not required" }
    }
} | Format-Table -AutoSize | Out-String -Width 200 | Write-Host
if ($problems) { Write-Host "Needs a look:" -ForegroundColor Yellow; $problems | ForEach-Object { Write-Host "  $_" -ForegroundColor Yellow } }
if ($ParseOnly) { return }

# --- read the list -------------------------------------------------------------
if (-not $SpecsListId) {
    $envFile = Join-Path $PSScriptRoot "..\.env.local"
    if (Test-Path $envFile) {
        $line = Select-String -Path $envFile -Pattern '^\s*VITE_SP_CRIMP_SPECS_LIST_ID\s*=\s*(\S+)' | Select-Object -First 1
        if ($line) { $SpecsListId = $line.Matches[0].Groups[1].Value.Trim('"', "'") }
    }
}
if (-not $SpecsListId) { throw "Pass -SpecsListId (the Crimp Specs list id), or -ParseOnly to stop here." }

Import-Module Microsoft.Graph.Authentication
$ctx = Get-MgContext
if (-not $ctx -or $ctx.Scopes -notcontains "Sites.Manage.All") {
    if ($DeviceCode) { Connect-MgGraph -Scopes "Sites.Manage.All" -UseDeviceCode -NoWelcome }
    else             { Connect-MgGraph -Scopes "Sites.Manage.All" -NoWelcome }
}
$items = "https://graph.microsoft.com/v1.0/sites/$siteId/lists/$SpecsListId/items"

# --- machines: table -> press ids, resolved by name on the asset list ---------
$machineIdsFor = @{}
if ($MachinesByTable) {
    $assets = @{}
    $uri = "https://graph.microsoft.com/v1.0/sites/$siteId/lists/$EquipmentListId/items?`$expand=fields(`$select=Title,EquipmentType)&`$top=999"
    while ($uri) {
        $page = Invoke-MgGraphRequest -Method GET -Uri $uri
        foreach ($i in $page.value) {
            $name = "$($i.fields.Title)".Trim().ToUpper()
            if ($name) { $assets[$name] = @{ Id = [int]$i.id; Type = "$($i.fields.EquipmentType)" } }
        }
        $uri = $page["@odata.nextLink"]
    }
    foreach ($table in $MachinesByTable.Keys) {
        $ids = @()
        foreach ($n in @($MachinesByTable[$table])) {
            $a = $assets["$n".Trim().ToUpper()]
            if (-not $a) { throw "No asset called '$n' on the Altronic Equipment List - check the spelling." }
            if ($a.Type.Trim().ToUpper() -ne "PRESS") {
                Write-Host "  note: '$n' is typed '$($a.Type)', not PRESS, so ARC won't offer it in the pickers until maintenance retypes it." -ForegroundColor Yellow
            }
            $ids += $a.Id
        }
        $machineIdsFor[$table] = $ids
    }
}
function Get-MachineIds($tableLabel) {
    foreach ($t in $machineIdsFor.Keys) { if ($tableLabel -like "*$t*") { return ,@($machineIdsFor[$t]) } }
    return ,@()
}

$existing = @{}
$select = "Title,Applicator,WireGauge,WireSetting,CrimpHeight,Tolerance,Active"
if ($MachinesByTable) { $select += ",Machines" }
$uri = "$items`?`$expand=fields(`$select=$select)&`$top=999"
while ($uri) {
    $page = Invoke-MgGraphRequest -Method GET -Uri $uri
    foreach ($i in $page.value) {
        $f = $i.fields
        $k = Get-Key "$($f.Title)" "$($f.Applicator)" "$($f.WireGauge)"
        if ($existing.ContainsKey($k)) { $problems += "two specs on the list share a key: $k (ids $($existing[$k].Id), $($i.id))"; continue }
        $existing[$k] = @{
            Id = $i.id; Title = "$($f.Title)"; Applicator = "$($f.Applicator)"; WireGauge = "$($f.WireGauge)"
            WireSetting = "$($f.WireSetting)"
            CrimpHeight = if ($null -ne $f.CrimpHeight) { [double]$f.CrimpHeight } else { $null }
            Tolerance = if ($null -ne $f.Tolerance) { [double]$f.Tolerance } else { $null }
            Active = ($null -eq $f.Active -or $f.Active -eq $true)
            Machines = @($f.Machines | Where-Object { $_ } | ForEach-Object { [int]$_["LookupId"] })
        }
    }
    $uri = $page["@odata.nextLink"]
}

function Same-Num($a, $b) {
    if ($null -eq $a -and $null -eq $b) { return $true }
    if ($null -eq $a -or $null -eq $b) { return $false }
    return [math]::Abs($a - $b) -lt 1e-6
}

# --- compare -------------------------------------------------------------------
$report = @()
$toAdd = @()
$toSetMachines = @()
foreach ($k in $byKey.Keys) {
    $s = $byKey[$k]
    $e = $existing[$k]
    $status = ""; $detail = ""
    if (-not $s.Required) {
        $status = if ($e) { "NOT NEEDED (on list)" } else { "NOT NEEDED" }
        $detail = "WI: no crimp height check required"
        if (-not $e -and $IncludeNotRequired) { $toAdd += $k; $status = "NOT NEEDED (will add)" }
    } elseif (-not $e) {
        $status = "MISSING"; $toAdd += $k
        # A near match usually means a typo or a different applicator on one side.
        $near = $existing.Values | Where-Object {
            $_.Title.Trim().ToUpper() -eq $s.Title -and (
                (Get-Key "" "" $_.WireGauge) -eq (Get-Key "" "" $s.WireGauge) -or $_.Applicator.Trim().ToUpper() -eq $s.Applicator)
        }
        if ($near) { $detail = "similar on the list: " + (($near | ForEach-Object { "$($_.Title)/$($_.Applicator)/$($_.WireGauge) (id $($_.Id))" }) -join "; ") }
    } else {
        $diffs = @()
        if (-not (Same-Num $s.CrimpHeight $e.CrimpHeight)) { $diffs += "height WI $(Fmt $s.CrimpHeight) vs ARC $(Fmt $e.CrimpHeight)" }
        if (-not (Same-Num $s.Tolerance $e.Tolerance)) { $diffs += "tolerance WI $(Fmt $s.Tolerance) vs ARC $(Fmt $e.Tolerance)" }
        if ($s.WireSetting.ToUpper() -ne $e.WireSetting.Trim().ToUpper()) { $diffs += "setting WI '$($s.WireSetting)' vs ARC '$($e.WireSetting)'" }
        if (-not $e.Active) { $status = "RETIRED" } elseif ($diffs) { $status = "DIFFERS" } else { $status = "MATCH" }
        $detail = $diffs -join "; "
        $want = Get-MachineIds $s.Table
        if ($want.Count -and $e.Machines.Count -eq 0) {
            $toSetMachines += $k
            $detail = (@($detail, "machines to set") | Where-Object { $_ }) -join "; "
        }
    }
    $report += [pscustomobject]@{
        Status = $status; Table = $s.Table; Terminal = $s.Title; Applicator = $s.Applicator; Gauge = $s.WireGauge
        WiSetting = $s.WireSetting; WiHeight = Fmt $s.CrimpHeight; WiTolerance = Fmt $s.Tolerance
        ArcId = if ($e) { $e.Id } else { "" }; ArcSetting = if ($e) { $e.WireSetting } else { "" }
        ArcHeight = if ($e) { Fmt $e.CrimpHeight } else { "" }; ArcTolerance = if ($e) { Fmt $e.Tolerance } else { "" }
        Detail = $detail
    }
}
foreach ($k in $existing.Keys) {
    if ($byKey.Contains($k)) { continue }
    $e = $existing[$k]
    $report += [pscustomobject]@{
        Status = "NOT IN WI"; Table = ""; Terminal = $e.Title; Applicator = $e.Applicator; Gauge = $e.WireGauge
        WiSetting = ""; WiHeight = ""; WiTolerance = ""
        ArcId = $e.Id; ArcSetting = $e.WireSetting; ArcHeight = Fmt $e.CrimpHeight; ArcTolerance = Fmt $e.Tolerance
        Detail = if ($e.Active) { "" } else { "retired" }
    }
}

$order = @{ "MISSING" = 0; "DIFFERS" = 1; "RETIRED" = 2; "MATCH" = 3 }
$report = $report | Sort-Object @{ e = { if ($order.ContainsKey($_.Status)) { $order[$_.Status] } else { 9 } } }, Status, Terminal, Gauge
$report | Format-Table Status, Table, Terminal, Applicator, Gauge, WiSetting, WiHeight, WiTolerance, ArcId, ArcSetting, ArcHeight, ArcTolerance, Detail -AutoSize -Wrap |
    Out-String -Width 260 | Write-Host

if (-not $ReportPath) {
    $ReportPath = Join-Path (Split-Path $docx) ("crimp-spec-check-{0}.csv" -f (Get-Date -Format "yyyy-MM-dd-HHmm"))
}
$report | Export-Csv -Path $ReportPath -NoTypeInformation -Encoding utf8
Write-Host "Report: $ReportPath" -ForegroundColor Cyan

$counts = $report | Group-Object Status | ForEach-Object { "$($_.Name): $($_.Count)" }
Write-Host ("`n" + ($counts -join "   ")) -ForegroundColor Cyan
if ($problems) { Write-Host "Needs a look:" -ForegroundColor Yellow; $problems | ForEach-Object { Write-Host "  $_" -ForegroundColor Yellow } }
if (@($report | Where-Object Status -eq "DIFFERS").Count) {
    Write-Host "DIFFERS rows are left alone - correct them on ARC's Crimp Specs screen (or tell Claude which side is right)." -ForegroundColor Yellow
}

if (-not $Apply) {
    if ($toAdd.Count) { Write-Host "Report only. Re-run with -Apply to add the $($toAdd.Count) missing spec(s)." -ForegroundColor Magenta }
    else { Write-Host "Nothing to add." -ForegroundColor Green }
    if ($toSetMachines.Count) { Write-Host "-Apply would also set the machines on $($toSetMachines.Count) spec(s) that name none." -ForegroundColor Magenta }
    return
}

$added = 0
foreach ($k in $toAdd) {
    $s = $byKey[$k]
    $fields = @{
        Title = $s.Title; Applicator = $s.Applicator; WireGauge = $s.WireGauge; WireSetting = $s.WireSetting
        Notes = $s.Notes; Active = $true
    }
    if ($null -ne $s.CrimpHeight) { $fields.CrimpHeight = $s.CrimpHeight }
    if ($null -ne $s.Tolerance) { $fields.Tolerance = $s.Tolerance }
    $machineIds = Get-MachineIds $s.Table
    if ($machineIds.Count) {
        # A MULTI lookup: the annotated two-key shape, or Graph answers a bare 400.
        $fields["MachinesLookupId@odata.type"] = "Collection(Edm.Int32)"
        $fields["MachinesLookupId"] = $machineIds
    }
    $created = Invoke-MgGraphRequest -Method POST -Uri $items -ContentType "application/json" `
        -Body (@{ fields = $fields } | ConvertTo-Json -Depth 4)
    # Read it back - a 2xx alone isn't proof the values landed.
    $back = Invoke-MgGraphRequest -Method GET -Uri "$items/$($created.id)?`$expand=fields(`$select=Title,Applicator,WireGauge,CrimpHeight,Tolerance)"
    if ("$($back.fields.Title)" -ne $s.Title -or -not (Same-Num $s.CrimpHeight $(if ($null -ne $back.fields.CrimpHeight) { [double]$back.fields.CrimpHeight } else { $null }))) {
        Write-Host "  CHECK id $($created.id): read back didn't match what was sent ($($s.Title) $($s.WireGauge))" -ForegroundColor Red
    } else {
        Write-Host "  added $($s.Title) / $($s.Applicator) / $($s.WireGauge) AWG (id $($created.id))" -ForegroundColor Green
    }
    $added++
}
$set = 0
foreach ($k in $toSetMachines) {
    $e = $existing[$k]
    $ids = Get-MachineIds $byKey[$k].Table
    # Re-read first: only a spec that STILL names no machine is touched.
    $now = Invoke-MgGraphRequest -Method GET -Uri "$items/$($e.Id)?`$expand=fields(`$select=Machines)"
    if (@($now.fields.Machines | Where-Object { $_ }).Count) {
        Write-Host "  skipped id $($e.Id) - a machine was set on it meanwhile" -ForegroundColor Yellow
        continue
    }
    Invoke-MgGraphRequest -Method PATCH -Uri "$items/$($e.Id)/fields" -ContentType "application/json" `
        -Body (@{ "MachinesLookupId@odata.type" = "Collection(Edm.Int32)"; MachinesLookupId = $ids } | ConvertTo-Json -Depth 4) | Out-Null
    $back = Invoke-MgGraphRequest -Method GET -Uri "$items/$($e.Id)?`$expand=fields(`$select=Machines)"
    $got = @($back.fields.Machines | Where-Object { $_ } | ForEach-Object { [int]$_["LookupId"] }) | Sort-Object
    if (($got -join ",") -ne (($ids | Sort-Object) -join ",")) {
        Write-Host "  CHECK id $($e.Id): machines read back as '$($got -join ",")'" -ForegroundColor Red
    } else {
        Write-Host "  machines set on $($e.Title) / $($e.Applicator) / $($e.WireGauge) (id $($e.Id))" -ForegroundColor Green
        $set++
    }
}
Write-Host "Added $added spec(s); set machines on $set. Re-run without -Apply to confirm everything now matches." -ForegroundColor Green
