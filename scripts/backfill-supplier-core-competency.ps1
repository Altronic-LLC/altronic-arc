<#
.SYNOPSIS
    Fills the blank Core Competency on the Suppliers List (Altronic_PMO) from
    what SAP says we buy from each supplier. Two steps: -PlanTo writes a
    proposal CSV for review; -Csv reports (or with -Apply, writes) a reviewed one.

.DESCRIPTION
    The Core Competency choices ARE SAP material-group descriptions (T023T),
    and every purchase order line carries a material group. So a supplier's
    competencies are the groups that make up a real share of what we have
    bought from them.

    STEP 0 - the column's choices (Supply Chain, 2026-11-24):
      .\backfill-supplier-core-competency.ps1 -UpdateChoices           # report
      .\backfill-supplier-core-competency.ps1 -UpdateChoices -Apply    # change

      Adds Packaging, Raw Material, Freight, Machinery & Equipment and
      Services, and replaces "Casting / Steel Chemical Connectors" (three
      choices glued into one) with "Casting / Steel". Keeps every other
      choice, sorts A-Z, keeps checkBoxes, reads the list back. Refuses to
      retire a choice any supplier still holds. Run it BEFORE -Csv: a value
      the column doesn't declare is refused. ARC reads the live choices, so
      no deploy is needed for them to appear.

    STEP 1 - plan (reads only):
      .\backfill-supplier-core-competency.ps1 -PlanTo C:\Working_Dir\suppliers

      Reads every PO line in the mirrored S/4 database in Fabric
      (sap.EKKO -> sap.EKPO -> sap.T023T, deleted lines left out) and the
      Suppliers List, and writes core-competency-proposal.csv. A group counts
      when it is at least -MinShare (10%) of the supplier's PO spend (line
      count when the spend is 0), top -MaxPicks (3). Groups with no matching
      choice are named in "unmappedTop" rather than guessed at.
      The CSV holds supplier spend, so -PlanTo must be OUTSIDE the repo
      (it is public).

    STEP 2 - apply the reviewed CSV:
      .\backfill-supplier-core-competency.ps1 -Csv <reviewed.csv>          # report
      .\backfill-supplier-core-competency.ps1 -Csv <reviewed.csv> -Apply   # write

      Uses the "proposed" column as the reviewer left it ("; " between
      values; blank = leave that supplier alone). Rules:
        - ONLY a supplier whose Core Competency is still blank is written,
          re-read just before the write. Anything set in ARC or SharePoint
          since the plan is kept.
        - The row's id must still be the supplier with that BP number.
        - Every value must be a choice the live column declares (the column
          refuses anything else). One unknown value refuses that whole row,
          so a half-set supplier is never written.
        - The write is a multi-choice array WITH its Collection(Edm.String)
          annotation (a bare array is a 400), then read back and compared.
      A results CSV is written beside the input, and the summary counts
      suppliers per choice. Without -Apply it is a REPORT: nothing is
      written, and a choice -UpdateChoices will add counts as valid
      ("needs -UpdateChoices first"), so the whole fill can be previewed
      before SharePoint changes at all.

    Sign-in: Graph through Microsoft.Graph.Authentication (Sites.Manage.All
    for -Apply, Sites.Read.All otherwise). The SAP read uses an Azure CLI
    token (az login), passed to the Fabric SQL endpoint.

    RUN IN YOUR OWN TERMINAL - the Graph sign-in is interactive. If the
    Windows account window never appears (it can open behind VS Code), use
    -DeviceCode.

.EXAMPLE
    .\backfill-supplier-core-competency.ps1 -UpdateChoices -Apply
    .\backfill-supplier-core-competency.ps1 -PlanTo C:\Working_Dir\suppliers
    .\backfill-supplier-core-competency.ps1 -Csv C:\Working_Dir\suppliers\reviewed.csv
    .\backfill-supplier-core-competency.ps1 -Csv C:\Working_Dir\suppliers\reviewed.csv -Apply -Limit 5
    .\backfill-supplier-core-competency.ps1 -Csv C:\Working_Dir\suppliers\reviewed.csv -Apply
#>

[CmdletBinding()]
param(
    [string]$PlanTo,
    [string]$Csv,
    # Fix the column's choice list first (report; with -Apply, change it).
    [switch]$UpdateChoices,
    [switch]$Apply,
    [double]$MinShare = 0.10,
    [int]$MaxPicks = 3,
    # Apply mode: stop after this many writes (try a few first).
    [int]$Limit = 0,
    [switch]$DeviceCode
)

$ErrorActionPreference = "Stop"

if (@(@([bool]$PlanTo, [bool]$Csv, [bool]$UpdateChoices) | Where-Object { $_ }).Count -ne 1) {
    throw "Pass ONE of -UpdateChoices (fix the column's choices), -PlanTo <folder> (make a proposal) or -Csv <reviewed.csv> (apply one)."
}
if ($Apply -and $PlanTo) { throw "-PlanTo only reads; -Apply goes with -UpdateChoices or -Csv." }

$siteId = "coopermachineryservices.sharepoint.com,915a6183-2b71-4dfd-a8b9-181126dfbe78,3eb6cb9c-6535-4c69-a8d7-e90b2f90a9eb"
$listId = "7e4dc4a4-40bf-4abd-a939-1c5d313526d0"   # Suppliers List
$graph = "https://graph.microsoft.com/v1.0/sites/$siteId/lists/$listId"
$sqlServer = "ajxorpkbyzjetf7sthvg3g4ofe-fas76qoazr4urkfi2pqhona6tu.datawarehouse.fabric.microsoft.com"
$sqlDatabase = "db-s4-altronic-prod-roundhouse"

# SAP material group -> Core Competency choice(s), where the group's text is
# not itself a choice. A group whose text matches a choice exactly (case and
# spacing aside) needs no entry here.
$GroupToChoices = @{
    "153310000" = @("IC")                          # Integrated Circuits (IC)
    "153312000" = @("PCB/PCBA")                    # Printed CB - PCB Assy
    "153391000" = @("PCB/PCBA")                    # Circuit board
    "153319000" = @("Magnetics - Transformers")    # Magnetics - Transformers, Ferrite, Choke, Inductor, etc
    "153320000" = @("Displays")                    # Display - LCD, HMI, Touchscreen, etc.
    "152013000" = @("Casting / Steel")             # was glued to Chemical and Connectors in SharePoint; -UpdateChoices fixes it
    "152100000" = @("Seals and Gaskets")           # Seal and sealing element / Gasket
    "152110000" = @("Seals and Gaskets")           # Membrane / elastomer
    "151300000" = @("Standardized part")           # Standardized Part (DIN ISO etc.) others
    "151330000" = @("Standardized part", "Nut")    # Standardized part (DIN ISO etc.); Nut
    "151400000" = @("Nut")                         # Machining Element / JL Nut
    "151000000" = @("Machined Parts")              # Turning Parts
    "151100000" = @("Machined Parts")              # Milling Parts
    "201000000" = @("Machined Parts")              # Outsourced Process / machining
    "153800000" = @("Labels")                      # Type Plate / Label
    "201500000" = @("Labels")                      # Outsourced Process / labeling
    "301300000" = @("Lubricants / Chemicals")      # Lubricants / Chemicals / Hazardous- and Working Materials
    "301400000" = @("Chemical")                    # Adhesives
    "251300000" = @("Supplier Tools")              # Supplier Tools (miscellaneous)
    "451800000" = @("Software")                    # Software and Software maintenance
    "401700000" = @("Engineering Services")        # Service / Engineering
    "153500000" = @("Monitoring / Sensors")        # Monitoring
    "153350000" = @("Transducers")                 # Piezo Transducer
    "153340000" = @("Inductor")                    # Coil
    "153100000" = @("Assembly")                    # Mechanical Assembly
    "153110000" = @("Assembly")                    # Assembly Material
    "201600000" = @("Assembly")                    # Outsourced Process / assembling
    "101110000" = @("Profile")                     # Aluminum / Profile
    "301100000" = @("Perishable Tool")             # Grinding Material and -tools
    "551000000" = @("Office Material")             # Office Equipment
    "401013000" = @("Logistics / Handling")        # Logistics
    "401013110" = @("Logistics / Handling")        # Logistics / Storage
    "401013210" = @("Logistics / Handling")        # Logistics / Empties Handling / Washing
    "401013220" = @("Logistics / Handling")        # Logistics / Customs Clearance Brokerage

    # The five choices Supply Chain added (2026-11-24). A "USE ONLY IF..."
    # parent group is mapped only where the parent alone says what we buy
    # (raw material, freight, a service, machinery) - **PRODUCT and the rest
    # say nothing about the supplier and stay unmapped.
    "301200000" = @("Packaging")                   # Auxiliary Material / Packaging
    "100000000" = @("Raw Material")                # **RAW MATERIAL (parent)
    "101000000" = @("Raw Material")                # **RAW MAT. / STEEL (parent)
    "101010001" = @("Raw Material")                # Strip Steel / Carbon Steel
    "101010002" = @("Raw Material")                # Strip Steel / Stainless Steel
    "101011000" = @("Raw Material")                # Steel / Cold Rolled / Coil
    "101015000" = @("Raw Material")                # Steel / Tube
    "101016000" = @("Raw Material")                # **RAW MAT. / BAR (parent)
    "101016110" = @("Raw Material")                # Steel / Bar / Miscellaneous grades
    "101016150" = @("Raw Material")                # Steel / Bar / Carbon Steel
    "101016170" = @("Raw Material")                # Steel / Bar / Stainless Steel
    "101016340" = @("Raw Material")                # Steel / Bar / Stainless Steel
    "101017000" = @("Raw Material")                # Steel / Hot Rolled / Coil
    "101100000" = @("Raw Material")                # Aluminum / other grades
    "101200000" = @("Raw Material")                # Raw Material / Non-Ferrous
    "101300000" = @("Raw Material")                # Plastics / Semi-finished (Bushings)
    "101311000" = @("Raw Material")                # Plastics / Tube
    "101312000" = @("Raw Material")                # Plastics / Bar
    "101313000" = @("Raw Material")                # Plastics / Blank
    "101400000" = @("Raw Material")                # Sinter Raw Material
    "350000000" = @("Freight")                     # **FREIGHT (parent)
    "351000000" = @("Freight")                     # Land
    "351100000" = @("Freight")                     # FTL
    "351200000" = @("Freight")                     # LTL
    "351300000" = @("Freight")                     # Groupage
    "352100000" = @("Freight")                     # Air
    "354100000" = @("Freight")                     # Courier
    "500000000" = @("Machinery & Equipment")       # **MACHINERY & EQUIPMENT (parent)
    "501000000" = @("Machinery & Equipment")       # Machinery and Equipment
    "400000000" = @("Services")                    # **SERVICE (parent)
    "401100000" = @("Services")                    # Consulting general
    "401400000" = @("Services")                    # Production incl. fitter assignments
    "401500000" = @("Services")                    # Maintenance service
    "401600000" = @("Services")                    # Personnel hiring / technical
    "401800000" = @("Services")                    # IT Consulting
}

# -UpdateChoices: the choices the column must offer, and the old spellings
# they replace. A rename is refused while any supplier still holds the old
# value (SharePoint keeps a stored value after its choice is gone).
$AddChoices = @("Packaging", "Raw Material", "Freight", "Machinery & Equipment", "Services", "Casting / Steel")
$RetireChoices = @{ "Casting / Steel Chemical Connectors" = "Casting / Steel" }
# Matches a choice by name but says nothing about the supplier.
$SkipGroups = @("109999999")   # PM Material (Mat group to be to revised)

function Get-RepoRoot { (Resolve-Path (Join-Path $PSScriptRoot "..")).Path }
function Normalize([string]$s) { (($s ?? "") -replace "\s+", " ").Trim().ToLowerInvariant() }
function Strip-Zeros([string]$s) { (($s ?? "").Trim()) -replace "^0+", "" }

function Connect-Graph([string]$scope) {
    Import-Module Microsoft.Graph.Authentication
    $ctx = Get-MgContext
    if (-not $ctx -or ($ctx.Scopes -notcontains $scope -and $ctx.Scopes -notcontains "Sites.Manage.All")) {
        Write-Host "Signing in to Graph ($scope)..." -ForegroundColor Cyan
        if ($DeviceCode) { Connect-MgGraph -Scopes $scope -UseDeviceCode -NoWelcome }
        else { Connect-MgGraph -Scopes $scope -NoWelcome }
    }
}

# The column's live choices, keyed by normalized name -> exact spelling.
function Get-LiveChoices {
    $cols = Invoke-MgGraphRequest -Method GET -Uri "$graph/columns"
    $col = $cols.value | Where-Object { $_.name -eq "CoreCompetency" }
    if (-not $col) { throw "The Suppliers List has no CoreCompetency column." }
    if ($col.choice.displayAs -ne "checkBoxes") {
        throw "CoreCompetency is not a multi-choice (checkBoxes) column any more (displayAs = '$($col.choice.displayAs)'). Stopping."
    }
    $map = @{}
    foreach ($c in $col.choice.choices) { $map[(Normalize $c)] = $c }
    return $map
}

function Get-CoreCompetency($fields) {
    $v = $fields.CoreCompetency
    if ($null -eq $v) { return @() }
    return @($v | Where-Object { "$_".Trim() } | ForEach-Object { "$_" })
}

# =============================================================================
# STEP 0 - the column's choice list
# =============================================================================
if ($UpdateChoices) {
    Connect-Graph ($Apply ? "Sites.Manage.All" : "Sites.Read.All")
    $cols = Invoke-MgGraphRequest -Method GET -Uri "$graph/columns"
    $col = $cols.value | Where-Object { $_.name -eq "CoreCompetency" }
    if (-not $col) { throw "The Suppliers List has no CoreCompetency column." }
    if ($col.choice.displayAs -ne "checkBoxes") {
        throw "CoreCompetency is not a multi-choice (checkBoxes) column any more (displayAs = '$($col.choice.displayAs)'). Stopping."
    }
    $now = @($col.choice.choices)

    # A choice can't be retired while a supplier still holds it: SharePoint
    # keeps the stored value, and the next edit in ARC would offer a value
    # the column refuses.
    $retiring = @($RetireChoices.Keys | Where-Object { $now -contains $_ })
    if ($retiring.Count) {
        Write-Host "Checking no supplier holds $($retiring -join ', ')..." -ForegroundColor Cyan
        $uri = "$graph/items?`$expand=fields(`$select=CompanyName,CoreCompetency)&`$top=999"
        $holders = @()
        while ($uri) {
            $page = Invoke-MgGraphRequest -Method GET -Uri $uri
            foreach ($s in $page.value) {
                $held = @(Get-CoreCompetency $s.fields | Where-Object { $retiring -contains $_ })
                if ($held.Count) { $holders += "  item $($s.id) $($s.fields.CompanyName): $($held -join ', ')" }
            }
            $uri = $page["@odata.nextLink"]
        }
        if ($holders.Count) {
            $holders | ForEach-Object { Write-Host $_ -ForegroundColor Red }
            throw "These suppliers still hold a choice being retired. Change them first (in ARC or SharePoint), then run again."
        }
    }

    $next = [System.Collections.Generic.List[string]]::new()
    foreach ($c in $now) { if (-not $RetireChoices.ContainsKey($c) -and -not $next.Contains($c)) { $next.Add($c) } }
    foreach ($c in $AddChoices) {
        if (-not ($next | Where-Object { (Normalize $_) -eq (Normalize $c) })) { $next.Add($c) }
    }
    $next = @($next | Sort-Object { $_.ToLowerInvariant() })

    $added = @($next | Where-Object { $now -notcontains $_ })
    $removed = @($now | Where-Object { $next -notcontains $_ })
    Write-Host "`n=== CoreCompetency choices ===" -ForegroundColor Cyan
    Write-Host "  Now      $($now.Count)"
    Write-Host "  Adding   $(if ($added.Count) { $added -join ', ' } else { '(none)' })" -ForegroundColor Green
    Write-Host "  Removing $(if ($removed.Count) { $removed -join ', ' } else { '(none)' })" -ForegroundColor Yellow
    Write-Host "  After    $($next.Count)"
    if (-not $added.Count -and -not $removed.Count) { Write-Host "`nNothing to change.`n" -ForegroundColor Green; return }
    if (-not $Apply) { Write-Host "`nReport only - add -Apply to change the column.`n" -ForegroundColor Yellow; return }

    $body = @{ choice = @{ choices = $next; displayAs = "checkBoxes"; allowTextEntry = [bool]$col.choice.allowTextEntry } } |
        ConvertTo-Json -Depth 4
    Invoke-MgGraphRequest -Method PATCH -Uri "$graph/columns/$($col.id)" -Body $body -ContentType "application/json" | Out-Null

    # Read it back - a 2xx is not proof.
    $back = Invoke-MgGraphRequest -Method GET -Uri "$graph/columns/$($col.id)"
    if ((@($back.choice.choices) -join "`n") -ne ($next -join "`n")) {
        throw "The choices didn't read back as set: $(@($back.choice.choices) -join ' | ')"
    }
    if ($back.choice.displayAs -ne "checkBoxes") { throw "The column read back as '$($back.choice.displayAs)', not checkBoxes." }
    Write-Host "`nSet and read back: $(@($back.choice.choices).Count) choices.`n" -ForegroundColor Green
    return
}

# =============================================================================
# STEP 1 - plan
# =============================================================================
if ($PlanTo) {
    $outDir = [System.IO.Path]::GetFullPath($PlanTo)
    $repo = Get-RepoRoot
    if ($outDir.StartsWith($repo, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "-PlanTo is inside the repo ($repo). The proposal holds supplier spend and the repo is public - pick a folder outside it."
    }
    New-Item -ItemType Directory -Force -Path $outDir | Out-Null

    Connect-Graph "Sites.Read.All"
    $choices = Get-LiveChoices

    Write-Host "Reading the Suppliers List..." -ForegroundColor Cyan
    $suppliers = @()
    $uri = "$graph/items?`$expand=fields(`$select=CompanyName,BusinessPartnerNumber,Status,CoreCompetency)&`$top=999"
    while ($uri) {
        $page = Invoke-MgGraphRequest -Method GET -Uri $uri
        $suppliers += $page.value
        $uri = $page["@odata.nextLink"]
    }
    Write-Host "  $($suppliers.Count) suppliers"

    Write-Host "Reading SAP purchase order lines from Fabric..." -ForegroundColor Cyan
    $token = az account get-access-token --resource https://database.windows.net/ --query accessToken -o tsv
    if ($LASTEXITCODE -ne 0 -or -not $token) { throw "Couldn't get an Azure CLI token - run 'az login' first." }
    $cn = [System.Data.SqlClient.SqlConnection]::new("Server=$sqlServer,1433;Database=$sqlDatabase;Encrypt=True;Connect Timeout=60")
    $cn.AccessToken = $token
    $cn.Open()
    $cmd = $cn.CreateCommand()
    $cmd.CommandTimeout = 300
    # The warehouse collation is case-sensitive: names are as SAP has them.
    $cmd.CommandText = @"
select k.LIFNR, p.MATKL, t.WGBEZ, t.WGBEZ60, count(*) as lines,
       cast(sum(p.NETWR) as float) as spend, max(k.BEDAT) as last_po
from sap.EKKO k
join sap.EKPO p on p.MANDT = k.MANDT and p.EBELN = k.EBELN
left join sap.T023T t on t.MANDT = p.MANDT and t.MATKL = p.MATKL and t.SPRAS = 'E'
where k.BSTYP = 'F' and (p.LOEKZ is null or p.LOEKZ = '')
group by k.LIFNR, p.MATKL, t.WGBEZ, t.WGBEZ60
"@
    $byBp = @{}
    $reader = $cmd.ExecuteReader()
    while ($reader.Read()) {
        $bp = Strip-Zeros ([string]$reader["LIFNR"])
        if (-not $byBp.ContainsKey($bp)) { $byBp[$bp] = [System.Collections.Generic.List[object]]::new() }
        $byBp[$bp].Add([pscustomobject]@{
            Group = [string]$reader["MATKL"]
            Short = if ($reader["WGBEZ"] -is [DBNull]) { "" } else { [string]$reader["WGBEZ"] }
            Text  = if ($reader["WGBEZ60"] -is [DBNull]) { "" } else { [string]$reader["WGBEZ60"] }
            Lines = [int]$reader["lines"]
            Spend = if ($reader["spend"] -is [DBNull]) { 0.0 } else { [double]$reader["spend"] }
            Last  = [string]$reader["last_po"]
        })
    }
    $reader.Close(); $cn.Close()
    Write-Host "  $($byBp.Count) vendors with PO history"

    $rows = foreach ($s in $suppliers) {
        $f = $s.fields
        $bp = Strip-Zeros ([string]$f.BusinessPartnerNumber)
        $po = if ($bp -and $byBp.ContainsKey($bp)) { $byBp[$bp] } else { @() }
        $totSpend = ($po | ForEach-Object { [math]::Max($_.Spend, 0) } | Measure-Object -Sum).Sum
        $totLines = ($po | Measure-Object -Property Lines -Sum).Sum
        $score = @{}; $unmapped = @{}
        foreach ($r in $po) {
            $share = if ($totSpend -gt 0) { [math]::Max($r.Spend, 0) / $totSpend } else { $r.Lines / $totLines }
            $picked = @()
            if ($SkipGroups -notcontains $r.Group) {
                if ($GroupToChoices.ContainsKey($r.Group)) { $picked = $GroupToChoices[$r.Group] }
                elseif ($choices.ContainsKey((Normalize $r.Text))) { $picked = @($choices[(Normalize $r.Text)]) }
            }
            if (-not $picked.Count) {
                $label = if ($r.Text -and $r.Text -notlike "USE ONLY*") { $r.Text } elseif ($r.Short) { $r.Short } else { $r.Group }
                $unmapped[$label] = ($unmapped[$label] ?? 0) + $share
                continue
            }
            foreach ($c in $picked) { $score[$c] = ($score[$c] ?? 0) + $share }
        }
        $top = @($score.GetEnumerator() | Where-Object { $_.Value -ge $MinShare } |
            Sort-Object -Property Value -Descending | Select-Object -First $MaxPicks)
        [pscustomobject]@{
            id          = $s.id
            bp          = $bp
            name        = $f.CompanyName
            status      = $f.Status
            current     = (Get-CoreCompetency $f) -join "; "
            proposed    = ($top | ForEach-Object { $_.Key }) -join "; "
            detail      = ($top | ForEach-Object { "{0} {1:0}%" -f $_.Key, ($_.Value * 100) }) -join "; "
            unmappedTop = (@($unmapped.GetEnumerator() | Sort-Object Value -Descending | Select-Object -First 3) |
                ForEach-Object { "{0} {1:0}%" -f $_.Key, ($_.Value * 100) }) -join "; "
            poLines     = [int]($totLines ?? 0)
            spend       = [math]::Round(($totSpend ?? 0), 0)
            lastPo      = ($po | Sort-Object Last -Descending | Select-Object -First 1).Last
        }
    }

    $file = Join-Path $outDir "core-competency-proposal.csv"
    $rows | Export-Csv -Path $file -NoTypeInformation -Encoding utf8BOM
    $blank = @($rows | Where-Object { -not $_.current })
    Write-Host "`n=== Proposal ===" -ForegroundColor Cyan
    Write-Host "  Suppliers                     $($rows.Count)"
    Write-Host "  Already have a value          $($rows.Count - $blank.Count)"
    Write-Host "  Blank, value proposed         $(@($blank | Where-Object proposed).Count)" -ForegroundColor Green
    Write-Host "  Blank, PO history, no match   $(@($blank | Where-Object { -not $_.proposed -and $_.poLines }).Count)" -ForegroundColor Yellow
    Write-Host "  Blank, no PO history          $(@($blank | Where-Object { -not $_.poLines }).Count)" -ForegroundColor Yellow
    Write-Host "`nWrote $file" -ForegroundColor Green
    Write-Host "Edit the 'proposed' column (values separated by ';', blank = leave alone), then run with -Csv.`n"
    return
}

# =============================================================================
# STEP 2 - apply a reviewed CSV
# =============================================================================
$csvPath = (Resolve-Path $Csv).Path
$reviewed = @(Import-Csv -Path $csvPath)
foreach ($h in "id", "bp", "proposed") {
    if (-not ($reviewed.Count -and $reviewed[0].PSObject.Properties.Name -contains $h)) {
        throw "The CSV has no '$h' column. Use the file -PlanTo wrote (columns id, bp, name, ..., proposed)."
    }
}

Connect-Graph ($Apply ? "Sites.Manage.All" : "Sites.Read.All")
$choices = Get-LiveChoices
# Choices -UpdateChoices will add but the column doesn't have yet. A REPORT
# treats them as valid (flagged), so the whole fill can be previewed before
# SharePoint changes at all; -Apply refuses them, as the column would.
$pending = @{}
foreach ($c in $AddChoices) {
    if (-not $choices.ContainsKey((Normalize $c))) { $pending[(Normalize $c)] = $c }
}
if ($Apply) {
    Write-Host "`n*** -Apply: writing to the Suppliers List ***" -ForegroundColor Magenta
    if ($pending.Count) {
        Write-Host "  Not on the column yet: $($pending.Values -join ', ') - rows using them will be REFUSED. Run -UpdateChoices -Apply first." -ForegroundColor Red
    }
} else {
    Write-Host "`n*** Report only - nothing is written; add -Apply to write ***" -ForegroundColor Yellow
    if ($pending.Count) {
        Write-Host "  Not on the column yet (counted as if -UpdateChoices had run): $($pending.Values -join ', ')" -ForegroundColor Yellow
        foreach ($k in $pending.Keys) { $choices[$k] = $pending[$k] }
    }
}

$results = [System.Collections.Generic.List[object]]::new()
$seen = @{}
$writes = 0
function Add-Result($row, [string]$outcome, [string]$values, [string]$note) {
    $results.Add([pscustomobject]@{ id = $row.id; bp = $row.bp; name = $row.name; outcome = $outcome; values = $values; note = $note })
    $colour = switch -Wildcard ($outcome) { "SET" { "Green" } "WOULD SET" { "Cyan" } "REFUSED*" { "Red" } "FAILED*" { "Red" } default { "DarkGray" } }
    Write-Host ("  {0,-12} {1,5}  {2,-40} {3} {4}" -f $outcome, $row.id, "$($row.name)".Substring(0, [math]::Min(40, "$($row.name)".Length)), $values, $note) -ForegroundColor $colour
}

foreach ($row in $reviewed) {
    $raw = @("$($row.proposed)" -split ";" | ForEach-Object { $_.Trim() } | Where-Object { $_ })
    if (-not $raw.Count) { continue }   # blank = the reviewer left this supplier alone

    $id = "$($row.id)".Trim()
    if ($id -notmatch '^\d+$') { Add-Result $row "REFUSED" ($raw -join "; ") "id '$id' is not a list item id"; continue }
    if ($seen.ContainsKey($id)) { Add-Result $row "REFUSED" ($raw -join "; ") "item $id is on more than one row"; continue }
    $seen[$id] = $true

    # Every value must be a live choice; spelled the way the column has it.
    $values = [System.Collections.Generic.List[string]]::new()
    $unknown = @()
    foreach ($v in $raw) {
        $k = Normalize $v
        if ($choices.ContainsKey($k)) { if (-not $values.Contains($choices[$k])) { $values.Add($choices[$k]) } }
        else { $unknown += $v }
    }
    if ($unknown.Count) { Add-Result $row "REFUSED" ($raw -join "; ") "not a Core Competency choice: $($unknown -join ', ')"; continue }
    $joined = $values -join "; "

    # Fresh read: the supplier must still be this BP and still blank.
    try {
        $item = Invoke-MgGraphRequest -Method GET -Uri "$graph/items/$id`?`$expand=fields(`$select=CompanyName,BusinessPartnerNumber,CoreCompetency)"
    } catch {
        if ("$_" -match "404|itemNotFound|NotFound") { Add-Result $row "SKIPPED" $joined "item $id no longer exists"; continue }
        throw
    }
    $liveBp = Strip-Zeros ([string]$item.fields.BusinessPartnerNumber)
    if ($liveBp -ne (Strip-Zeros "$($row.bp)")) {
        Add-Result $row "REFUSED" $joined "item $id is BP '$liveBp' ($($item.fields.CompanyName)), not '$($row.bp)'"; continue
    }
    $current = Get-CoreCompetency $item.fields
    if ($current.Count) { Add-Result $row "SKIPPED" $joined "already set: $($current -join '; ')"; continue }

    if (-not $Apply) {
        $needs = @($values | Where-Object { $pending.ContainsKey((Normalize $_)) })
        Add-Result $row "WOULD SET" $joined ($(if ($needs.Count) { "needs -UpdateChoices first: $($needs -join ', ')" } else { "" }))
        continue
    }
    if ($Limit -gt 0 -and $writes -ge $Limit) { Add-Result $row "NOT RUN" $joined "-Limit $Limit reached"; continue }

    # A multi-choice write needs the annotation; a bare array is a bare 400.
    $body = [ordered]@{
        "CoreCompetency@odata.type" = "Collection(Edm.String)"
        "CoreCompetency"            = @($values)
    } | ConvertTo-Json -Depth 4
    try {
        Invoke-MgGraphRequest -Method PATCH -Uri "$graph/items/$id/fields" -Body $body -ContentType "application/json" | Out-Null
        $writes++
    } catch {
        Add-Result $row "FAILED" $joined "$($_.Exception.Message)"; continue
    }

    # Read it back - a 2xx is not proof the value landed.
    $back = Invoke-MgGraphRequest -Method GET -Uri "$graph/items/$id`?`$expand=fields(`$select=CoreCompetency)"
    $got = @(Get-CoreCompetency $back.fields | Sort-Object)
    $want = @($values | Sort-Object)
    if (($got -join "|") -eq ($want -join "|")) { Add-Result $row "SET" $joined "" }
    else { Add-Result $row "FAILED READBACK" $joined "reads back as: $($got -join '; ')" }
}

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$resultFile = Join-Path (Split-Path $csvPath) ("{0}-results-{1}.csv" -f [System.IO.Path]::GetFileNameWithoutExtension($csvPath), $stamp)
$results | Export-Csv -Path $resultFile -NoTypeInformation -Encoding utf8BOM

Write-Host "`n=== Summary ===" -ForegroundColor Cyan
$results | Group-Object outcome | Sort-Object Name | ForEach-Object { Write-Host ("  {0,-16} {1}" -f $_.Name, $_.Count) }
$landing = @($results | Where-Object { $_.outcome -in "WOULD SET", "SET" })
if ($landing.Count) {
    Write-Host "`n  Suppliers per choice ($(if ($Apply) { 'set' } else { 'would be set' })):" -ForegroundColor Cyan
    $landing | ForEach-Object { $_.values -split "; " } | Where-Object { $_ } | Group-Object |
        Sort-Object Count -Descending | ForEach-Object { Write-Host ("    {0,4}  {1}" -f $_.Count, $_.Name) }
}
Write-Host "`nWrote $resultFile`n" -ForegroundColor Green
