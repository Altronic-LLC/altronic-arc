<#
.SYNOPSIS
    Loads the 175 legacy parts lists into "Altronic Part List" and "Altronic
    Component List" — reporting only, unless -Apply is passed.

.DESCRIPTION
    Reads every legacy list on the Altronic_Engineering site straight from
    Graph (NOT from exports — an export-based merge shifted ~3,200 dates by a
    day and dropped Purchased on ~13,900 rows), applies the agreed clean-up
    rules, and CREATES or UPDATES rows in the two new lists.

    Rows are matched on LegacySource ("<old list>#<old item id>"), not on part
    number: the legacy data holds duplicated part numbers, and one part moves
    between lists, so a part number is not a unique key.

    Never deletes anything. A row in a target list that no legacy row accounts
    for is listed in target-only.csv and left alone.

    Clean-up rules (agreed with Tim, 2026-09-25). Every row a rule touches is
    written to fixes.csv:
      - Target: 601/611/701/711/712/722 -> Component List, everything else ->
        Part List. So 722044 (from the old "722" list) lands in the Component
        List as SIL.
      - Category from the prefix: 601/611 Through Hole, 701/711/712 Surface
        Mount, 722 SIL.
      - Prototype or Production: anything but Prototype/Production is blanked.
        The 201/502/609 values are bad data from an older migration.
      - Item Value: blanked on every 501 part (same bad data).
      - Through Hole Parts had its columns mislabelled — MfgName held the
        manufacturer PART NUMBER and Mfg_PartNum the manufacturer. Where
        Mfg_PartNum is set it becomes Mfg Name; where Mfg Number is blank /
        N/A / TBD the old MfgName value becomes Mfg Number.
        EXCEPT a row entered the right way round — Mfg_PartNum equal to Mfg
        Number (611315, 611316). There MfgName really is the manufacturer and
        nothing is swapped.
      - Where the old MfgName and Mfg Number are two DIFFERENT part numbers,
        which one is kept was decided per row by Tim against the SAP export
        (2026-09-25) and lives in data/through-hole-mfg-decisions.csv:
          UseOldMfgName     the old MfgName becomes Mfg Number
          KeepMfgNumber     Mfg Number stays
          AlternateSources  both are approved sources in SAP — Mfg Number
                            stays, the other is added to Notes as
                            "Alternate Mfg #: <value>" so neither is lost
          NeedsReview /     Mfg Number stays, and the row is listed in
          Unconfirmed       fixes.csv for a person to settle in ARC
        A decision is applied only while the live legacy row still holds the
        two values it was made against; if the old list has been edited since,
        the row falls back to keeping Mfg Number and is flagged
        "th-decision-stale".
      - HOC Sign-off "Pending" -> "Pending Engineering Review". Blank stays
        blank: those rows predate approval tracking.
      - Dates: read at the stored instant, a time after 12:00 UTC counting as
        the next day (ARC's parseSpDateOnly rule), and written at 12:00 UTC so
        they read the same in every US time zone.
      - A row with no part number is skipped.

    The export-built "Master Part List" / "Component List" are NOT read at all.
    Two parts existed only there: 732100 (a test row) and 204602 (assigned
    9/10/2026, then deleted from the "204" list after the export) — neither is
    loaded. If 204602 turns out to be real, re-add it in ARC.

    Duplicated part numbers are loaded as they are and listed in
    duplicates.csv. Which one survives is a person's decision.

.PARAMETER Apply
    Write to SharePoint. Without it nothing is changed.

.PARAMETER OnlyCreate
    With -Apply: add rows that are missing, never update an existing one. Use
    this for a top-up once people have started editing parts in ARC, where a
    full re-run would overwrite their edits with legacy values.

.PARAMETER ReportDir
    Where the CSV reports go. Defaults to a timestamped folder under %TEMP%.

.PARAMETER MfgDecisions
    The Through Hole Mfg Number decisions file. Defaults to
    data/through-hole-mfg-decisions.csv beside this script.

.EXAMPLE
    ./scripts/load-altronic-parts-lists.ps1
.EXAMPLE
    ./scripts/load-altronic-parts-lists.ps1 -Apply
.EXAMPLE
    ./scripts/load-altronic-parts-lists.ps1 -Apply -OnlyCreate

.NOTES
    Reading needs Sites.Read.All; -Apply needs Sites.Manage.All. Run
    create-altronic-parts-lists.ps1 first. PowerShell 7.5+ (for
    ConvertFrom-Json -DateKind String, which keeps dates as the exact stored
    strings instead of converting them to local time).
#>
param(
    [switch]$Apply,
    [switch]$OnlyCreate,
    [string]$ReportDir,
    [string]$MfgDecisions = (Join-Path $PSScriptRoot "data/through-hole-mfg-decisions.csv")
)

$ErrorActionPreference = "Stop"
if ($PSVersionTable.PSVersion -lt [version]"7.5") { throw "PowerShell 7.5 or later is required (ConvertFrom-Json -DateKind)." }

# Mirrored from src/api/config.ts (SITES.engineering).
$Site = "coopermachineryservices.sharepoint.com,ddb5fc80-ea51-4d56-b008-ce6a82af49b0,aa6b9467-3f57-4213-bbd4-60b94403421a"

$PartListName      = "Altronic Part List"
$ComponentListName = "Altronic Component List"
$HocLists          = @("Surface Mount Parts", "Through Hole Parts", "SIL Parts")
$ExpectedLegacy    = 175

$CategoryByPrefix = @{
    "601" = "Through Hole"; "611" = "Through Hole"
    "701" = "Surface Mount"; "711" = "Surface Mount"; "712" = "Surface Mount"
    "722" = "SIL"
}

$DateFields = @("DateAssigned", "DateDrawing")
$BoolFields = @("HasDataSheet")

if (-not $ReportDir) { $ReportDir = Join-Path $env:TEMP ("arc-parts-load-" + (Get-Date -Format "yyyyMMdd-HHmmss")) }
New-Item -ItemType Directory -Force -Path $ReportDir | Out-Null

# Per-row Through Hole decisions, keyed by LegacySource. Missing file = every
# conflict keeps Mfg Number (the behaviour before the decisions existed).
$ValidDecisions = @("UseOldMfgName", "KeepMfgNumber", "AlternateSources", "NeedsReview", "Unconfirmed")
$thDecisions = @{}
if (Test-Path $MfgDecisions) {
    foreach ($d in (Import-Csv $MfgDecisions)) {
        if ($ValidDecisions -notcontains $d.Decision) { throw "Unknown Decision '$($d.Decision)' for $($d.LegacySource) in $MfgDecisions." }
        if ($thDecisions.ContainsKey($d.LegacySource)) { throw "$($d.LegacySource) appears twice in $MfgDecisions." }
        $thDecisions[$d.LegacySource] = $d
    }
    Write-Host "Through Hole decisions: $($thDecisions.Count) from $MfgDecisions" -ForegroundColor Cyan
} else {
    Write-Host "WARNING: $MfgDecisions not found — every Through Hole conflict keeps Mfg Number." -ForegroundColor Yellow
}
$usedDecisions = [System.Collections.Generic.HashSet[string]]::new()

# ---------------------------------------------------------------------------
# Sign-in
# ---------------------------------------------------------------------------
Import-Module Microsoft.Graph.Authentication
$scope = if ($Apply) { "Sites.Manage.All" } else { "Sites.Read.All" }
$ctx = Get-MgContext
if (-not $ctx -or ($ctx.Scopes -notcontains $scope -and $ctx.Scopes -notcontains "Sites.Manage.All")) {
    Write-Host "Signing in ($scope)..." -ForegroundColor Cyan
    try { Connect-MgGraph -Scopes $scope -NoWelcome }
    catch { Connect-MgGraph -Scopes $scope -UseDeviceCode -NoWelcome }
}

# ---------------------------------------------------------------------------
# Graph helpers — raw JSON, so dates stay the exact stored ISO strings.
# ---------------------------------------------------------------------------
function Get-Json([string]$Uri) {
    for ($attempt = 1; ; $attempt++) {
        try {
            $raw = Invoke-MgGraphRequest -Method GET -Uri $Uri -OutputType Json
            return ($raw | ConvertFrom-Json -AsHashtable -DateKind String)
        } catch {
            if ($attempt -ge 5) { throw }
            Start-Sleep -Seconds ([Math]::Pow(2, $attempt))
        }
    }
}
function Get-All([string]$Uri) {
    $out = [System.Collections.Generic.List[object]]::new()
    while ($Uri) {
        $page = Get-Json $Uri
        foreach ($v in $page.value) { $out.Add($v) }
        $Uri = $page['@odata.nextLink']
    }
    return , $out
}

# ---------------------------------------------------------------------------
# Value normalisation — used for BOTH the planned value and the value already
# in the target list, so a re-run finds nothing to change.
# ---------------------------------------------------------------------------
$fixes = [System.Collections.Generic.List[object]]::new()
function Add-Fix($target, $source, $pn, $rule, $field, $original, $loaded) {
    $fixes.Add([pscustomobject]@{ Target = $target; LegacySource = $source; PartNumber = $pn; Rule = $rule; Field = $field; Original = "$original"; Loaded = "$loaded" })
}

function Str($v) {
    if ($null -eq $v) { return $null }
    $s = "$v".Trim()
    if ($s -eq "") { return $null }
    return $s
}

# Returns "yyyy-MM-ddT12:00:00Z" or $null. $bad receives the original when a
# value couldn't be read or is outside SharePoint's range.
function DateOnly($v, [ref]$bad) {
    $bad.Value = $null
    $s = Str $v
    if (-not $s) { return $null }
    $d = $null
    if ($s -match '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}') {
        $dto = [DateTimeOffset]::Parse($s, [Globalization.CultureInfo]::InvariantCulture).ToUniversalTime()
        $d = $dto.Date
        if ($dto.Hour -ge 12) { $d = $d.AddDays(1) }   # parseSpDateOnly's midday pivot
    } elseif ($s -match '^(\d{1,2})/(\d{1,2})/(\d{4})$') {
        try { $d = [datetime]::new([int]$Matches[3], [int]$Matches[1], [int]$Matches[2]) } catch { $d = $null }
    }
    if (-not $d -or $d.Year -lt 1900 -or $d.Year -gt 2999) { $bad.Value = $s; return $null }
    return $d.ToString("yyyy-MM-dd") + "T12:00:00Z"
}

function Bool($v) {
    if ($v -is [bool]) { return $v }
    return ("$v".Trim() -match '^(true|yes|1)$')
}

function Norm($field, $v) {
    if ($DateFields -contains $field) { $b = $null; return (DateOnly $v ([ref]$b)) }
    if ($BoolFields -contains $field) { return (Bool $v) }
    return (Str $v)
}

# ---------------------------------------------------------------------------
# Lists
# ---------------------------------------------------------------------------
Write-Host "Reading lists on the Engineering site..." -ForegroundColor Cyan
$allLists = Get-All "https://graph.microsoft.com/v1.0/sites/$Site/lists?`$select=id,displayName&`$top=200"
$byName = @{}; foreach ($l in $allLists) { $byName[$l.displayName] = $l.id }

$legacy = @($allLists | Where-Object { $_.displayName -match '^\d{3}(/\d{3})?$' -or $HocLists -contains $_.displayName } | Sort-Object displayName)
Write-Host "  legacy lists: $($legacy.Count)"
if ($legacy.Count -ne $ExpectedLegacy) {
    Write-Host "  WARNING: expected $ExpectedLegacy legacy lists, found $($legacy.Count). Check before applying." -ForegroundColor Yellow
}
foreach ($h in $HocLists) { if (-not $byName.ContainsKey($h)) { throw "Legacy list '$h' not found." } }

$targets = @{ part = $byName[$PartListName]; component = $byName[$ComponentListName] }
foreach ($k in $targets.Keys) {
    if (-not $targets[$k]) {
        if ($Apply) { throw "Target list for '$k' not found. Run create-altronic-parts-lists.ps1 first." }
        Write-Host "  target list '$k' does not exist yet — reporting everything as a create." -ForegroundColor Yellow
    }
}

# ---------------------------------------------------------------------------
# Build the plan
# ---------------------------------------------------------------------------
$plan    = [System.Collections.Generic.List[object]]::new()
$skipped = [System.Collections.Generic.List[object]]::new()

function New-Record($target, $source, $pn, [hashtable]$fields) {
    $fields["Title"] = $pn
    $fields["LegacySource"] = $source
    [pscustomobject]@{ Target = $target; Source = $source; PartNumber = $pn; Fields = $fields }
}

function ConvertTo-PartFields($f, $source, $pn, [hashtable]$names) {
    # $names: target field -> source field name
    $out = @{}
    foreach ($t in $names.Keys) {
        $raw = $f[$names[$t]]
        if ($DateFields -contains $t) {
            $bad = $null; $out[$t] = DateOnly $raw ([ref]$bad)
            if ($bad) { Add-Fix "part" $source $pn "unreadable-date" $t $bad "" }
        } else {
            $out[$t] = Str $raw
        }
    }
    $p = $out["PrototypeOrProduction"]
    if ($p -and $p -notin @("Prototype", "Production")) { Add-Fix "part" $source $pn "invalid-prototype-blanked" "PrototypeOrProduction" $p ""; $out["PrototypeOrProduction"] = $null }
    $u = $out["Purchased"]
    if ($u -and $u -notin @("Purchased", "Not Purchased")) { Add-Fix "part" $source $pn "invalid-purchased-blanked" "Purchased" $u ""; $out["Purchased"] = $null }
    if ($pn.StartsWith("501") -and $out["ItemValue"]) { Add-Fix "part" $source $pn "501-item-value-blanked" "ItemValue" $out["ItemValue"] ""; $out["ItemValue"] = $null }
    $out["SignOffStatus"] = $null
    return $out
}

$legacyNumericMap = @{
    Description = "Title"; DateAssigned = "DateAssigned"; DrawingSize = "Drawing_x0020_Size"; DateDrawing = "DateDrawing"
    Manufacturer = "Manufacturer"; MfgPartNumber = "Mfg_x0020_Part_x0023_"; Notes = "Note"; AssignedBy = "AssignedBy"
    PrototypeOrProduction = "Prototype_x0020_or_x0020_Product"; Purchased = "Purchased"; SAPNumber = "SAP_x0023_"; ItemValue = "ItemValue"
}
foreach ($l in $legacy) {
    $name = $l.displayName
    $items = Get-All "https://graph.microsoft.com/v1.0/sites/$Site/lists/$($l.id)/items?expand=fields&`$top=999"
    Write-Host ("  {0,-20} {1,6} rows" -f $name, $items.Count)
    $isHoc = $HocLists -contains $name

    foreach ($it in $items) {
        $f = $it.fields
        $source = "$name#$($it.id)"
        $rawPn = $f["Altronic_PartNumber"]
        $pn = Str $rawPn
        if (-not $pn) { $skipped.Add([pscustomobject]@{ LegacySource = $source; Reason = "no part number"; Description = (Str $f["Title"]) }); continue }
        if ("$rawPn" -ne $pn) { Add-Fix "" $source $pn "part-number-trimmed" "Title" "[$rawPn]" $pn }

        $prefix = if ($pn.Length -ge 3) { $pn.Substring(0, 3) } else { $pn }
        $isComponent = $CategoryByPrefix.ContainsKey($prefix)

        if ($isHoc) {
            if (-not $isComponent) { Add-Fix "component" $source $pn "hoc-row-with-non-hoc-prefix" "Title" $pn "loaded to Component List anyway" }
            $category = if ($isComponent) { $CategoryByPrefix[$prefix] } else { @{ "Surface Mount Parts" = "Surface Mount"; "Through Hole Parts" = "Through Hole"; "SIL Parts" = "SIL" }[$name] }

            $mfgName = Str $f["MfgName"]; $mfgNumber = Str $f["Mfg_x0020_Number"]
            $notes = Str $f["Notes"]
            if ($name -eq "Through Hole Parts") {
                $mpn = Str $f["Mfg_PartNum"]
                if ($mpn -and $mpn -eq $mfgNumber) {
                    # Entered the right way round: Mfg_PartNum repeats the part
                    # number, so MfgName really is the manufacturer. Swapping
                    # would put the part number in Mfg Name.
                    Add-Fix "component" $source $pn "th-entered-correctly-not-swapped" "MfgName" $mpn $mfgName
                } elseif ($mpn) {
                    $oldName = $mfgName
                    $mfgName = $mpn
                    if ($oldName -ne $mpn) { Add-Fix "component" $source $pn "th-manufacturer-from-mfg_partnum" "MfgName" $oldName $mpn }
                    $placeholder = '^(n/?a|tbd)$'
                    if ($oldName -match $placeholder) {
                        # Nothing to move: the old MfgName was a placeholder too.
                    } elseif ((-not $mfgNumber -or $mfgNumber -match $placeholder) -and $oldName -and $oldName -ne $mpn) {
                        Add-Fix "component" $source $pn "th-mfgnumber-from-old-mfgname" "MfgNumber" $mfgNumber $oldName
                        $mfgNumber = $oldName
                    } elseif ($oldName -and $oldName -ne $mpn -and $oldName -ne $mfgNumber) {
                        # Two different part numbers — see data/through-hole-mfg-decisions.csv.
                        $dec = $thDecisions[$source]
                        if (-not $dec) {
                            Add-Fix "component" $source $pn "th-conflict-no-decision-CHECK" "MfgNumber" $oldName $mfgNumber
                        } elseif ((Str $dec.MfgNumberKept) -ne $mfgNumber -or (Str $dec.OldMfgName) -ne $oldName) {
                            # The old list was edited after the decision was made.
                            [void]$usedDecisions.Add($source)
                            Add-Fix "component" $source $pn "th-decision-stale" "MfgNumber" "decided on [$($dec.MfgNumberKept)] / [$($dec.OldMfgName)], now [$mfgNumber] / [$oldName]" $mfgNumber
                        } else {
                            [void]$usedDecisions.Add($source)
                            switch ($dec.Decision) {
                                "UseOldMfgName" {
                                    Add-Fix "component" $source $pn "th-decision-use-old-mfgname" "MfgNumber" $mfgNumber $oldName
                                    $mfgNumber = $oldName
                                }
                                "KeepMfgNumber" {
                                    Add-Fix "component" $source $pn "th-decision-keep-mfgnumber" "MfgNumber" $oldName $mfgNumber
                                }
                                "AlternateSources" {
                                    $alt = "Alternate Mfg #: $oldName"
                                    $newNotes = if ($notes) { "$notes`n$alt" } else { $alt }
                                    Add-Fix "component" $source $pn "th-decision-alternate-to-notes" "Notes" $notes $newNotes
                                    $notes = $newNotes
                                }
                                default {
                                    # NeedsReview / Unconfirmed — a person settles it in ARC.
                                    Add-Fix "component" $source $pn "th-decision-$($dec.Decision.ToLower())-CHECK" "MfgNumber" $oldName $mfgNumber
                                }
                            }
                        }
                    }
                }
            }

            $sign = Str $f["Sign_x002d_off_x0020_status"]
            $signOut = $null
            if ($sign -eq "Pending") { $signOut = "Pending Engineering Review" }
            elseif ($sign) { Add-Fix "component" $source $pn "unknown-signoff-blanked" "SignOffStatus" $sign "" }

            $plan.Add((New-Record "component" $source $pn @{
                Category = $category; Description = (Str $f["Title"]); MfgName = $mfgName; MfgNumber = $mfgNumber
                RatingA = (Str $f["RatingA"]); RatingB = (Str $f["RatingB"]); RatingC = (Str $f["RatingC"])
                TempMin = (Str $f["TempMin"]); TempMax = (Str $f["TempMax"]); Tolerance = (Str $f["Tolerance"])
                Footprint = (Str $f["Footprint"]); Notes = $notes; HasDataSheet = (Bool $f["HasDataSheet"])
                SignOffStatus = $signOut
            }))
        } elseif ($isComponent) {
            # A HOC-numbered part sitting in a numeric list (722044). The
            # Component List has no home for the drawing/date/purchase columns.
            foreach ($k in @("DateAssigned", "Drawing_x0020_Size", "DateDrawing", "AssignedBy", "Prototype_x0020_or_x0020_Product", "Purchased", "SAP_x0023_", "ItemValue")) {
                $v = Str $f[$k]; if ($v) { Add-Fix "component" $source $pn "numeric-row-to-component-field-dropped" $k $v "" }
            }
            Add-Fix "component" $source $pn "moved-to-component-list" "Title" "list $name" $ComponentListName
            $plan.Add((New-Record "component" $source $pn @{
                Category = $CategoryByPrefix[$prefix]; Description = (Str $f["Title"])
                MfgName = (Str $f["Manufacturer"]); MfgNumber = (Str $f["Mfg_x0020_Part_x0023_"]); Notes = (Str $f["Note"])
                RatingA = $null; RatingB = $null; RatingC = $null; TempMin = $null; TempMax = $null; Tolerance = $null; Footprint = $null
                HasDataSheet = $false; SignOffStatus = $null
            }))
        } else {
            $plan.Add((New-Record "part" $source $pn (ConvertTo-PartFields $f $source $pn $legacyNumericMap)))
        }
    }
}

# A decision no row asked for: the row was deleted, fixed in the old list, or
# is now handled by the entered-correctly rule. Listed so none is silently
# ignored.
foreach ($k in $thDecisions.Keys) {
    if (-not $usedDecisions.Contains($k)) {
        $d = $thDecisions[$k]
        Add-Fix "component" $k $d.PartNumber "th-decision-unused" "MfgNumber" "$($d.Decision): [$($d.MfgNumberKept)] / [$($d.OldMfgName)]" ""
    }
}

# ---------------------------------------------------------------------------
# Diff against what the target lists already hold
# ---------------------------------------------------------------------------
$changes    = [System.Collections.Generic.List[object]]::new()
$targetOnly = [System.Collections.Generic.List[object]]::new()
$work       = [System.Collections.Generic.List[object]]::new()   # @{ target; method; url; body; record }

foreach ($t in @("part", "component")) {
    $existing = @{}
    if ($targets[$t]) {
        $rows = Get-All "https://graph.microsoft.com/v1.0/sites/$Site/lists/$($targets[$t])/items?expand=fields&`$top=999"
        foreach ($r in $rows) {
            $key = Str $r.fields["LegacySource"]
            if ($key -and -not $existing.ContainsKey($key)) { $existing[$key] = $r } else { $targetOnly.Add([pscustomobject]@{ Target = $t; ItemId = $r.id; PartNumber = (Str $r.fields["Title"]); LegacySource = $key; Reason = $(if ($key) { "duplicate LegacySource" } else { "no LegacySource" }) }) }
        }
    }
    $planned = @($plan | Where-Object Target -eq $t)
    $plannedKeys = [System.Collections.Generic.HashSet[string]]::new([string[]]@($planned | ForEach-Object Source))
    foreach ($key in $existing.Keys) {
        if (-not $plannedKeys.Contains($key)) { $targetOnly.Add([pscustomobject]@{ Target = $t; ItemId = $existing[$key].id; PartNumber = (Str $existing[$key].fields["Title"]); LegacySource = $key; Reason = "no matching legacy row" }) }
    }

    foreach ($rec in $planned) {
        $cur = $existing[$rec.Source]
        if (-not $cur) {
            $body = @{}; foreach ($k in $rec.Fields.Keys) { if ($null -ne $rec.Fields[$k]) { $body[$k] = $rec.Fields[$k] } }
            $changes.Add([pscustomobject]@{ Action = "create"; Target = $t; LegacySource = $rec.Source; PartNumber = $rec.PartNumber; Field = ""; Current = ""; New = "" })
            $work.Add(@{ target = $t; method = "POST"; url = "/sites/$Site/lists/$($targets[$t])/items"; body = @{ fields = $body }; record = $rec })
        } elseif (-not $OnlyCreate) {
            $patch = @{}
            foreach ($k in $rec.Fields.Keys) {
                $a = Norm $k $cur.fields[$k]; $b = Norm $k $rec.Fields[$k]
                if ("$a" -ne "$b") {
                    $patch[$k] = $rec.Fields[$k]
                    $changes.Add([pscustomobject]@{ Action = "update"; Target = $t; LegacySource = $rec.Source; PartNumber = $rec.PartNumber; Field = $k; Current = "$a"; New = "$b" })
                }
            }
            if ($patch.Count) { $work.Add(@{ target = $t; method = "PATCH"; url = "/sites/$Site/lists/$($targets[$t])/items/$($cur.id)/fields"; body = $patch; record = $rec }) }
        }
    }
}

$dups = $plan | Group-Object { "$($_.Target)|$($_.PartNumber)" } | Where-Object Count -gt 1 | ForEach-Object {
    foreach ($r in $_.Group) { [pscustomobject]@{ Target = $r.Target; PartNumber = $r.PartNumber; LegacySource = $r.Source; Description = $r.Fields["Description"] } }
}

# ---------------------------------------------------------------------------
# Reports
# ---------------------------------------------------------------------------
$fixes      | Export-Csv (Join-Path $ReportDir "fixes.csv") -NoTypeInformation -Encoding utf8
$changes    | Export-Csv (Join-Path $ReportDir "changes.csv") -NoTypeInformation -Encoding utf8
$skipped    | Export-Csv (Join-Path $ReportDir "skipped.csv") -NoTypeInformation -Encoding utf8
@($dups)    | Export-Csv (Join-Path $ReportDir "duplicates.csv") -NoTypeInformation -Encoding utf8
$targetOnly | Export-Csv (Join-Path $ReportDir "target-only.csv") -NoTypeInformation -Encoding utf8

$summary = @(
    "Legacy lists read:      $($legacy.Count)"
    "Planned rows:           $($plan.Count)  (part $(@($plan | Where-Object Target -eq 'part').Count), component $(@($plan | Where-Object Target -eq 'component').Count))"
    "Creates:                $(@($changes | Where-Object Action -eq 'create').Count)"
    "Rows to update:         $(@($work | Where-Object method -eq 'PATCH').Count)  ($(@($changes | Where-Object Action -eq 'update').Count) field changes)"
    "Skipped:                $($skipped.Count)"
    "Duplicate part numbers: $(@($dups | Group-Object { "$($_.Target)|$($_.PartNumber)" }).Count)"
    "Target-only rows:       $($targetOnly.Count)  (never deleted)"
    ""
    "Fixes by rule:"
) + @($fixes | Group-Object Rule | Sort-Object Name | ForEach-Object { "  {0,-42} {1,6}" -f $_.Name, $_.Count })
$summary | Set-Content (Join-Path $ReportDir "summary.txt") -Encoding utf8
Write-Host ""; $summary | ForEach-Object { Write-Host $_ }
Write-Host "`nReports: $ReportDir" -ForegroundColor Cyan

if (-not $Apply) { Write-Host "`nReport only — nothing was written. Re-run with -Apply to load.`n" -ForegroundColor Yellow; exit 0 }
if ($work.Count -eq 0) { Write-Host "`nNothing to write.`n" -ForegroundColor Green; exit 0 }

# ---------------------------------------------------------------------------
# Apply — Graph $batch, 20 requests a call, retrying throttled requests.
# ---------------------------------------------------------------------------
$failures = [System.Collections.Generic.List[object]]::new()
$pending = [System.Collections.Generic.List[object]]::new(); $work | ForEach-Object { $pending.Add($_) }
$done = 0; $round = 0
while ($pending.Count -gt 0 -and $round -lt 6) {
    $round++
    $retry = [System.Collections.Generic.List[object]]::new()
    $waitSeconds = 0
    for ($i = 0; $i -lt $pending.Count; $i += 20) {
        $chunk = @($pending[$i..([Math]::Min($i + 19, $pending.Count - 1))])
        $reqs = for ($j = 0; $j -lt $chunk.Count; $j++) {
            @{ id = "$j"; method = $chunk[$j].method; url = $chunk[$j].url; headers = @{ "Content-Type" = "application/json" }; body = $chunk[$j].body }
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
                $failures.Add([pscustomobject]@{ Method = $w.method; Target = $w.target; LegacySource = $w.record.Source; PartNumber = $w.record.PartNumber; Status = $r.status; Error = $msg })
            }
        }
        Write-Progress -Activity "Writing parts (round $round)" -Status "$done written, $($failures.Count) failed" -PercentComplete ([Math]::Min(100, 100 * ($i + $chunk.Count) / $pending.Count))
    }
    $pending = $retry
    if ($pending.Count) { Write-Host "  $($pending.Count) throttled — waiting $waitSeconds s, then retrying" -ForegroundColor Yellow; Start-Sleep -Seconds $waitSeconds }
}
foreach ($w in $pending) { $failures.Add([pscustomobject]@{ Method = $w.method; Target = $w.target; LegacySource = $w.record.Source; PartNumber = $w.record.PartNumber; Status = "throttled"; Error = "gave up after $round rounds" }) }
$failures | Export-Csv (Join-Path $ReportDir "failures.csv") -NoTypeInformation -Encoding utf8

Write-Host "`nWritten: $done   Failed: $($failures.Count)" -ForegroundColor $(if ($failures.Count) { "Red" } else { "Green" })
if ($failures.Count) { Write-Host "See failures.csv. Re-running the script is safe — it only writes what still differs." -ForegroundColor Yellow }
