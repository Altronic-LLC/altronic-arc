<#
.SYNOPSIS
    Audits - and optionally cleans - the 378 rows in the Altronic Equipment List.

.DESCRIPTION
    The Equipment List becomes the asset register for the ARC CMMS module, so
    everything downstream (dashboards grouped by Department, PMs attached to an
    asset, maintenance history) inherits whatever state this list is in. Two
    problems were visible in a five-row sample and need measuring across all
    378 before anything is built on top:

      - Location and Department are SPARSE, and can contradict each other
        (20 HP COMPRESSOR: Location PANELS, Department MACH SHOP).
      - The Location choice list carries near-duplicates and a typo as three
        separate options: HARNESS / HARNESS DEPARMENT / HARNESS DEPARTMENT,
        and QC / QC DIGITAL / Q.C. DIGITAL. Each one silently splits a
        dashboard group.

    DEFAULT IS READ-ONLY. With no switches it audits and writes a CSV; it
    changes nothing. -Apply is what writes, and only for the mappings you have
    explicitly put in $LOCATION_MAP / $DEPARTMENT_MAP below.

    IT NEVER DELETES A ROW, AND NEVER BLANKS A VALUE. The only write it makes
    is replacing one choice value with another one you named.

.PARAMETER Apply
    Actually write the remappings. Without it, every proposed change is only
    printed and exported.

.PARAMETER PruneChoices
    After remapping rows, remove the now-unused duplicate options from the
    Location / Department choice column definitions. ORDER MATTERS - this runs
    last, because removing a choice while rows still hold it leaves those rows
    carrying a value the column no longer offers. Refuses to remove any option
    still in use.

.PARAMETER OutDir
    Where the CSV reports go. Defaults to the folder this script is in.

.EXAMPLE
    .\Scrub-EquipmentList.ps1
    Audit only. Read-only. Start here.

.EXAMPLE
    .\Scrub-EquipmentList.ps1 -Apply -PruneChoices
    Apply the mappings below, then tidy the choice lists.

.NOTES
    Requires Sites.Manage.All to write; the audit alone needs only Sites.Read.All
    but asks for the write scope so one sign-in covers both.

    RUN IN YOUR OWN TERMINAL - the sign-in is interactive.

    WHAT THIS SCRIPT DELIBERATELY WILL NOT DO:
    It detects near-duplicate choice values automatically, but it will NEVER
    merge them automatically. "QC" and "QC DIGITAL" look like duplicates to a
    string comparison and may well be two genuinely different places. The
    script SUGGESTS; a person decides by editing the maps below. Merging two
    real locations is not recoverable from the CSV alone.
#>

[CmdletBinding()]
param(
    [switch]$Apply,
    [switch]$PruneChoices,
    [switch]$DeviceCode,
    [string]$OutDir = $PSScriptRoot
)

$ErrorActionPreference = "Stop"
Import-Module Microsoft.Graph.Authentication

$siteId = "coopermachineryservices.sharepoint.com,915a6183-2b71-4dfd-a8b9-181126dfbe78,3eb6cb9c-6535-4c69-a8d7-e90b2f90a9eb"
$listId = "6f2fb6e1-3b41-40de-b78b-2c43c3c3d068"   # Altronic Equipment List

# =============================================================================
# THE MAPPINGS - EDIT THESE. Nothing is remapped that isn't named here.
# Left = the value stored today. Right = what it becomes.
# =============================================================================

$LOCATION_MAP = @{
    # Unambiguous typo - the same words, one letter missing.
    "HARNESS DEPARMENT" = "HARNESS DEPARTMENT"

    # --- SUGGESTED, NOT ENABLED --------------------------------------------
    # Each of these merges two values a person has to confirm really are the
    # same physical place. Uncomment only what the team confirms.
    #
    # "HARNESS"            = "HARNESS DEPARTMENT"
    # "Q.C. DIGITAL"       = "QC DIGITAL"
    # "QC IGNITION"        = "QC"
    # "MS"                 = "MACHINE SHOP"
    # "COIL"               = "COIL DEPARTMENT"
    # "PRODUCTION"         = "PRODUCTION DEPARTMENT"
}

$DEPARTMENT_MAP = @{
    # Casing is inconsistent ("Panels" among otherwise upper-case values).
    # Left commented because changing it is cosmetic and touches real rows.
    # "Panels" = "PANELS"
}

# Columns the audit reports fill rates for.
$AUDIT_FIELDS = @("Title", "Description", "SerialNo", "EquipmentType", "Department", "Location")

# =============================================================================

function Get-Similarity($a, $b) {
    # Cheap normalised comparison - strips punctuation and spaces so
    # "Q.C. DIGITAL" and "QC DIGITAL" collapse to the same key.
    $na = ($a -replace '[^A-Za-z0-9]', '').ToUpperInvariant()
    $nb = ($b -replace '[^A-Za-z0-9]', '').ToUpperInvariant()
    if ($na -eq $nb) { return "identical-normalised" }
    if ($na.StartsWith($nb) -or $nb.StartsWith($na)) { return "prefix" }
    return $null
}

$ctx = Get-MgContext
if (-not $ctx -or $ctx.Scopes -notcontains "Sites.Manage.All") {
    Write-Host "Signing in (Sites.Manage.All)..." -ForegroundColor Cyan
    if ($DeviceCode) { Connect-MgGraph -Scopes "Sites.Manage.All" -UseDeviceCode -NoWelcome }
    else             { Connect-MgGraph -Scopes "Sites.Manage.All" -NoWelcome }
}

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$mode  = if ($Apply) { "APPLIED" } else { "DRYRUN" }

# --- Read every row ----------------------------------------------------------
Write-Host "Reading all rows..." -ForegroundColor Cyan
$rows = @()
$uri = "https://graph.microsoft.com/v1.0/sites/$siteId/lists/$listId/items" +
       "?`$expand=fields(`$select=Title,Description,SerialNo,EquipmentType,Department,Location)&`$top=500"
while ($uri) {
    $page = Invoke-MgGraphRequest -Method GET -Uri $uri
    $rows += $page.value
    $uri = $page['@odata.nextLink']
}
Write-Host ("  $($rows.Count) rows") -ForegroundColor Gray

if ($rows.Count -eq 0) { Write-Host "Nothing to audit." -ForegroundColor Yellow; return }

# --- 1. Fill rates -----------------------------------------------------------
Write-Host ""
Write-Host "=== Fill rates ($($rows.Count) rows) ===" -ForegroundColor Cyan
$fill = foreach ($f in $AUDIT_FIELDS) {
    $filled = ($rows | Where-Object {
        $v = $_.fields[$f]
        $null -ne $v -and "$v".Trim() -ne ""
    }).Count
    [pscustomobject]@{
        Field   = $f
        Filled  = $filled
        Blank   = $rows.Count - $filled
        Percent = [math]::Round(100 * $filled / $rows.Count, 1)
    }
}
$fill | Format-Table -AutoSize

# --- 2. Distinct values per choice field -------------------------------------
foreach ($f in @("EquipmentType", "Department", "Location")) {
    Write-Host ""
    Write-Host "=== $f - distinct values in use ===" -ForegroundColor Cyan
    $groups = $rows | Where-Object { "$($_.fields[$f])".Trim() -ne "" } |
        Group-Object { $_.fields[$f] } | Sort-Object Count -Descending
    Write-Host ("  $($groups.Count) distinct values") -ForegroundColor Gray
    $groups | Select-Object @{n='Value';e={$_.Name}}, Count | Format-Table -AutoSize
}

# --- 3. Near-duplicate detection (SUGGESTIONS ONLY) --------------------------
Write-Host ""
Write-Host "=== Near-duplicate choice values - SUGGESTIONS, NOT APPLIED ===" -ForegroundColor Magenta
$suspects = @()
foreach ($f in @("Department", "Location")) {
    $vals = @($rows | ForEach-Object { $_.fields[$f] } |
             Where-Object { "$_".Trim() -ne "" } | Sort-Object -Unique)
    for ($i = 0; $i -lt $vals.Count; $i++) {
        for ($j = $i + 1; $j -lt $vals.Count; $j++) {
            $kind = Get-Similarity $vals[$i] $vals[$j]
            if ($kind) {
                $suspects += [pscustomobject]@{
                    Field = $f; ValueA = $vals[$i]; ValueB = $vals[$j]; Match = $kind
                    Mapped = $(if ($f -eq "Location") { $LOCATION_MAP.ContainsKey($vals[$i]) -or $LOCATION_MAP.ContainsKey($vals[$j]) }
                               else { $DEPARTMENT_MAP.ContainsKey($vals[$i]) -or $DEPARTMENT_MAP.ContainsKey($vals[$j]) })
                }
            }
        }
    }
}
if ($suspects) {
    $suspects | Format-Table -AutoSize
    Write-Host "  'Mapped = False' means nothing in this script will touch it." -ForegroundColor Magenta
    Write-Host "  Add it to `$LOCATION_MAP / `$DEPARTMENT_MAP only if a person confirms" -ForegroundColor Magenta
    Write-Host "  the two really are the same place." -ForegroundColor Magenta
} else {
    Write-Host "  none found" -ForegroundColor Gray
}

# --- 4. Duplicate asset names ------------------------------------------------
Write-Host ""
Write-Host "=== Duplicate Title values ===" -ForegroundColor Cyan
$dupTitles = $rows | Group-Object { "$($_.fields.Title)".Trim().ToUpperInvariant() } |
    Where-Object { $_.Count -gt 1 -and $_.Name -ne "" }
if ($dupTitles) {
    Write-Host "  Two assets sharing a name make the equipment picker ambiguous." -ForegroundColor Yellow
    $dupTitles | ForEach-Object {
        $ids = ($_.Group | ForEach-Object { $_.id }) -join ", "
        Write-Host ("  {0,-40} x{1}  (ids {2})" -f $_.Name, $_.Count, $ids) -ForegroundColor Yellow
    }
} else { Write-Host "  none" -ForegroundColor Gray }

# --- 5. Manufacturer hint ----------------------------------------------------
# Feeds the open question "split Manufacturer/Model out of Description, or leave
# it as prose?" - the leading word of Description is usually the maker.
Write-Host ""
Write-Host "=== Leading word of Description (likely manufacturer) ===" -ForegroundColor Cyan
$rows | Where-Object { "$($_.fields.Description)".Trim() -ne "" } |
    Group-Object { ("$($_.fields.Description)".Trim() -split '\s+')[0].ToUpperInvariant() } |
    Sort-Object Count -Descending | Select-Object -First 20 @{n='FirstWord';e={$_.Name}}, Count |
    Format-Table -AutoSize
Write-Host "  A short tail here means a Manufacturer column would backfill cleanly." -ForegroundColor Gray

# --- 6. Rows missing the fields the CMMS needs -------------------------------
$incomplete = $rows | Where-Object {
    "$($_.fields.Department)".Trim() -eq "" -or "$($_.fields.Location)".Trim() -eq ""
}
Write-Host ""
Write-Host ("=== Rows missing Department and/or Location: {0} ===" -f $incomplete.Count) -ForegroundColor Cyan
Write-Host "  Dashboards group by Department - these rows fall into no group." -ForegroundColor Gray

$auditCsv = Join-Path $OutDir "equipment-audit-$stamp.csv"
$rows | ForEach-Object {
    [pscustomobject]@{
        Id = $_.id; Title = $_.fields.Title; Description = $_.fields.Description
        SerialNo = $_.fields.SerialNo; EquipmentType = $_.fields.EquipmentType
        Department = $_.fields.Department; Location = $_.fields.Location
        MissingDept = ("$($_.fields.Department)".Trim() -eq "")
        MissingLoc  = ("$($_.fields.Location)".Trim() -eq "")
    }
} | Export-Csv -NoTypeInformation -Encoding UTF8 $auditCsv
Write-Host ""
Write-Host "Full audit exported: $auditCsv" -ForegroundColor Green

# --- 7. Build the change set -------------------------------------------------
$changes = @()
foreach ($r in $rows) {
    $patch = @{}
    $loc = "$($r.fields.Location)"
    if ($loc -and $LOCATION_MAP.ContainsKey($loc)) { $patch["Location"] = $LOCATION_MAP[$loc] }
    $dep = "$($r.fields.Department)"
    if ($dep -and $DEPARTMENT_MAP.ContainsKey($dep)) { $patch["Department"] = $DEPARTMENT_MAP[$dep] }
    if ($patch.Count -gt 0) {
        $changes += [pscustomobject]@{
            Id = $r.id; Title = $r.fields.Title
            FromLocation = $loc;  ToLocation   = $(if ($patch.ContainsKey("Location"))   { $patch["Location"] }   else { "" })
            FromDept     = $dep;  ToDepartment = $(if ($patch.ContainsKey("Department")) { $patch["Department"] } else { "" })
            Patch = $patch
        }
    }
}

Write-Host ""
Write-Host ("=== Remapping: {0} rows affected ===" -f $changes.Count) -ForegroundColor Cyan
if ($changes.Count -eq 0) {
    Write-Host "  No mappings matched. Nothing to change." -ForegroundColor Gray
} else {
    $changes | Select-Object Id, Title, FromLocation, ToLocation, FromDept, ToDepartment |
        Format-Table -AutoSize
    $changeCsv = Join-Path $OutDir "equipment-scrub-$mode-$stamp.csv"
    $changes | Select-Object Id, Title, FromLocation, ToLocation, FromDept, ToDepartment |
        Export-Csv -NoTypeInformation -Encoding UTF8 $changeCsv
    Write-Host "Change set exported: $changeCsv" -ForegroundColor Green
}

if (-not $Apply) {
    Write-Host ""
    Write-Host "*** DRY RUN - nothing was written. Re-run with -Apply to commit. ***" -ForegroundColor Magenta
    return
}

# --- 8. Apply ----------------------------------------------------------------
Write-Host ""
Write-Host "Applying..." -ForegroundColor Green
$ok = 0; $failed = @()
foreach ($c in $changes) {
    try {
        Invoke-MgGraphRequest -Method PATCH `
            -Uri "https://graph.microsoft.com/v1.0/sites/$siteId/lists/$listId/items/$($c.Id)/fields" `
            -Body ($c.Patch | ConvertTo-Json -Depth 4) -ContentType "application/json" | Out-Null
        $ok++
        Write-Host ("  OK   {0,-6} {1}" -f $c.Id, $c.Title) -ForegroundColor Green
    } catch {
        $failed += [pscustomobject]@{ Id = $c.Id; Title = $c.Title; Error = $_.Exception.Message }
        Write-Host ("  FAIL {0,-6} {1} - {2}" -f $c.Id, $c.Title, $_.Exception.Message) -ForegroundColor Red
    }
}
Write-Host ""
Write-Host ("Updated {0} of {1} rows." -f $ok, $changes.Count) -ForegroundColor Cyan
if ($failed) {
    Write-Host "Failures - the CSV above is what to retry:" -ForegroundColor Red
    $failed | Format-Table -AutoSize
}

# --- 9. Prune the now-unused choice options ----------------------------------
if (-not $PruneChoices) {
    Write-Host ""
    Write-Host "Choice lists left as they are. Re-run with -PruneChoices to remove" -ForegroundColor Yellow
    Write-Host "options no longer used by any row." -ForegroundColor Yellow
    return
}

Write-Host ""
Write-Host "=== Pruning unused choice options ===" -ForegroundColor Cyan
# Re-read rows so 'in use' reflects the remapping that just happened.
$after = @()
$uri = "https://graph.microsoft.com/v1.0/sites/$siteId/lists/$listId/items" +
       "?`$expand=fields(`$select=Department,Location)&`$top=500"
while ($uri) {
    $page = Invoke-MgGraphRequest -Method GET -Uri $uri
    $after += $page.value
    $uri = $page['@odata.nextLink']
}

$cols = (Invoke-MgGraphRequest -Method GET `
    -Uri "https://graph.microsoft.com/v1.0/sites/$siteId/lists/$listId/columns").value

foreach ($f in @("Department", "Location")) {
    $col = $cols | Where-Object { $_["name"] -eq $f }
    if (-not $col -or -not $col.ContainsKey("choice")) { continue }
    $defined = @($col["choice"]["choices"])
    $inUse   = @($after | ForEach-Object { $_.fields[$f] } | Where-Object { "$_".Trim() -ne "" } | Sort-Object -Unique)
    # Only ever drop an option that (a) is not used by any row and (b) was on
    # the left-hand side of a map, i.e. we are the reason it is now unused.
    $mappedAway = if ($f -eq "Location") { $LOCATION_MAP.Keys } else { $DEPARTMENT_MAP.Keys }
    $drop = $defined | Where-Object { $inUse -notcontains $_ -and $mappedAway -contains $_ }
    if (-not $drop) { Write-Host "  $f - nothing to prune" -ForegroundColor Gray; continue }

    $keep = $defined | Where-Object { $drop -notcontains $_ }
    Write-Host ("  {0} - removing: {1}" -f $f, ($drop -join ", ")) -ForegroundColor Green
    Invoke-MgGraphRequest -Method PATCH `
        -Uri "https://graph.microsoft.com/v1.0/sites/$siteId/lists/$listId/columns/$($col['id'])" `
        -Body (@{ choice = @{ choices = @($keep) } } | ConvertTo-Json -Depth 5) `
        -ContentType "application/json" | Out-Null
    Write-Host ("       {0} options remain" -f $keep.Count) -ForegroundColor Green
}

Write-Host ""
Write-Host "Done. Re-run without -Apply to confirm the audit now reads clean." -ForegroundColor Cyan
