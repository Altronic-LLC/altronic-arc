<#
.SYNOPSIS
    Refreshes the three CMMS list snapshots and answers the specific questions
    ARC needs answered before the next round of work can be coded.

.DESCRIPTION
    Ray changed the lists on 2026-08-28: an Asset Tag column on the Equipment
    List (surfaced somehow on both maintenance lists), an hour-meter option on
    the schedule trigger, and a current hour-meter reading on the asset.

    This script does two things:

      1. Re-runs discover-list.ps1 for the three lists, so
         scripts/*-schema.json is current. Nothing gets coded against a guessed
         column name.

      2. Prints a focused report answering four questions the raw snapshot
         makes you hunt for:

         Q1  What SHAPE is the asset tag on the maintenance lists? A read-only
             PROJECTED column off the existing EquipmentRef lookup is the right
             answer. A SECOND independent lookup into the Equipment List is
             not: a work order could then name one asset by tag and a different
             one by name, with nothing keeping them honest.

         Q2  What are the hour-meter columns actually called, on both the
             schedule (the trigger choice) and the asset (the reading)?

         Q3  Are Department and Location plain CHOICE columns, and do they
             allow free-text entry? This decides how new values can be added
             from inside ARC - see the note printed at the end.

         Q4  How much of the Equipment List is filled in for the new columns,
             so we know whether they can be relied on yet.

    READ-ONLY. GETs only. No column is created and no row is touched.

.PARAMETER SkipRefresh
    Report from the snapshots already on disk instead of re-reading SharePoint.
    Useful if you have just run discovery and only want the summary again.

    NOTE: there is deliberately no -DeviceCode here. discover-list.ps1 does not
    take one; if the browser popup cannot open, run Connect-MgGraph -UseDeviceCode
    yourself first and this script will reuse that session.

.NOTES
    Requires the Microsoft.Graph.Authentication module, same as
    discover-list.ps1. RUN IN YOUR OWN TERMINAL - the sign-in is interactive
    and cannot be surfaced from a background shell.
#>

[CmdletBinding()]
param(
    # Report from the snapshots on disk instead of re-reading SharePoint.
    [switch]$SkipRefresh
)

$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path

$lists = @(
    @{ Name = "Altronic Equipment List";    File = "altronic-equipment-list-schema.json" }
    @{ Name = "Altronic Maintenance Tasks"; File = "altronic-maintenance-tasks-schema.json" }
    @{ Name = "Scheduled Maintenance";      File = "scheduled-maintenance-schema.json" }
)

# --- 1. Refresh -------------------------------------------------------------
if (-not $SkipRefresh) {
    Write-Host "Refreshing the three CMMS snapshots..." -ForegroundColor Cyan
    # NOT $args - that is a PowerShell automatic variable and assigning to it
    # inside a script is asking for trouble.
    $discoverArgs = @{ ListName = $lists.Name; Site = "pmo" }
    & (Join-Path $here "discover-list.ps1") @discoverArgs
    Write-Host ""
} else {
    Write-Host "Reporting from the snapshots already on disk (-SkipRefresh)." -ForegroundColor Yellow
    Write-Host ""
}

# --- helpers ----------------------------------------------------------------
function Get-Snapshot($file) {
    $path = Join-Path $here $file
    if (-not (Test-Path $path)) {
        Write-Host "  MISSING snapshot: $file - run without -SkipRefresh" -ForegroundColor Red
        return $null
    }
    Get-Content $path -Raw | ConvertFrom-Json
}

function Show-Col($c) {
    $bits = @("type=$($c.type)")
    if ($c.readOnly)      { $bits += "READ-ONLY" }
    if ($c.required)      { $bits += "required" }
    if ($c.lookupListId)  { $bits += "lookupList=$($c.lookupListId)"; $bits += "lookupCol=$($c.lookupColumn)" }
    if ($null -ne $c.allowMultiple) { $bits += "multi=$($c.allowMultiple)" }
    "    {0,-34} {1,-26} {2}" -f $c.internalName, $c.displayName, ($bits -join "  ")
}

$snapshots = @{}
foreach ($l in $lists) { $snapshots[$l.Name] = Get-Snapshot $l.File }

$EQUIP_LIST_ID = "6f2fb6e1-3b41-40de-b78b-2c43c3c3d068"

Write-Host "=======================================================================" -ForegroundColor Cyan
Write-Host " Q1  The asset tag - what shape is it?" -ForegroundColor Cyan
Write-Host "=======================================================================" -ForegroundColor Cyan
foreach ($l in $lists) {
    $s = $snapshots[$l.Name]; if (-not $s) { continue }
    $tagCols = $s.columns | Where-Object {
        $_.internalName -match "(?i)tag" -or $_.displayName -match "(?i)asset\s*tag"
    }
    Write-Host "  $($l.Name)" -ForegroundColor White
    if (-not $tagCols) { Write-Host "    (nothing matching 'tag')" -ForegroundColor DarkGray; continue }
    foreach ($c in $tagCols) { Write-Host (Show-Col $c) }

    # The verdict only matters on the two maintenance lists.
    if ($l.Name -ne "Altronic Equipment List") {
        $lookupsToEquip = $tagCols | Where-Object { $_.lookupListId -eq $EQUIP_LIST_ID }
        $equipRef = $s.columns | Where-Object { $_.internalName -eq "EquipmentRef" }
        foreach ($c in $lookupsToEquip) {
            if ($c.readOnly) {
                Write-Host "    => GOOD: read-only projection off a lookup. Free, cannot disagree." -ForegroundColor Green
            } elseif ($equipRef) {
                Write-Host "    => WARNING: a SECOND WRITABLE lookup into the Equipment List, alongside" -ForegroundColor Red
                Write-Host "       EquipmentRef. Nothing stops the two naming different assets." -ForegroundColor Red
                Write-Host "       Prefer a projected column, or drop this and read the tag off the asset." -ForegroundColor Red
            }
        }
    }
}

Write-Host ""
Write-Host "=======================================================================" -ForegroundColor Cyan
Write-Host " Q2  Hour meter - trigger choice and current reading" -ForegroundColor Cyan
Write-Host "=======================================================================" -ForegroundColor Cyan
foreach ($l in $lists) {
    $s = $snapshots[$l.Name]; if (-not $s) { continue }
    $meter = $s.columns | Where-Object {
        $_.internalName -match "(?i)hour|meter|runtime|hrs" -or
        $_.displayName  -match "(?i)hour|meter|runtime"
    }
    Write-Host "  $($l.Name)" -ForegroundColor White
    if (-not $meter) { Write-Host "    (nothing matching hour/meter/runtime)" -ForegroundColor DarkGray; continue }
    foreach ($c in $meter) {
        Write-Host (Show-Col $c)
        if ($c.choices) { Write-Host "      choices: $($c.choices -join ' | ')" -ForegroundColor DarkGray }
    }
}

# The schedule's basis/trigger column, whatever it ended up called.
$sched = $snapshots["Scheduled Maintenance"]
if ($sched) {
    Write-Host "  Scheduled Maintenance - every choice column (so the new trigger option is visible):" -ForegroundColor White
    foreach ($c in ($sched.columns | Where-Object { $_.choices -and -not $_.readOnly })) {
        Write-Host ("    {0,-26} {1}" -f $c.internalName, ($c.choices -join " | "))
    }
}

Write-Host ""
Write-Host "=======================================================================" -ForegroundColor Cyan
Write-Host " Q3  Department and Location - can new values be added?" -ForegroundColor Cyan
Write-Host "=======================================================================" -ForegroundColor Cyan
foreach ($l in $lists) {
    $s = $snapshots[$l.Name]; if (-not $s) { continue }
    foreach ($name in @("Department", "Location")) {
        $c = $s.columns | Where-Object { $_.internalName -eq $name }
        if (-not $c) { continue }
        $count = if ($c.choices) { $c.choices.Count } else { 0 }
        $freeText = if ($null -ne $c.allowTextEntry) { $c.allowTextEntry } else { "(not reported)" }
        Write-Host ("  {0,-28} {1,-12} type={2}  choices={3}  allowTextEntry={4}" -f `
            $l.Name, $name, $c.type, $count, $freeText)
    }
}

Write-Host ""
Write-Host "=======================================================================" -ForegroundColor Cyan
Write-Host " Q4  Fill rates on the Equipment List's new columns" -ForegroundColor Cyan
Write-Host "=======================================================================" -ForegroundColor Cyan
$eq = $snapshots["Altronic Equipment List"]
if ($eq) {
    Write-Host "  items on the list: $($eq.itemCount)" -ForegroundColor White
    Write-Host "  sampled rows in this snapshot: $($eq.sampleRows.Count) (discover-list samples, it does not scan)" -ForegroundColor DarkGray
    $watch = @("Title", "AssetTag", "Department", "Location", "Criticality", "AssetStatus")
    foreach ($c in ($eq.columns | Where-Object { $_.internalName -match "(?i)hour|meter|tag" })) {
        $watch += $c.internalName
    }
    foreach ($f in ($watch | Select-Object -Unique)) {
        $filled = 0
        foreach ($r in $eq.sampleRows) {
            # discover-list.ps1 writes each sample row's fields at the TOP level
            # of the object, not under a `fields` property. Reading $r.fields.$f
            # returned null for everything, which showed as "Title 0 of 5" - a
            # column that is 100% populated. Wrong-and-plausible beats missing,
            # so it went unnoticed until Title gave it away.
            $v = $r.$f
            if ($null -ne $v -and "$v".Trim() -ne "") { $filled++ }
        }
        Write-Host ("    {0,-22} {1} of {2} sampled" -f $f, $filled, $eq.sampleRows.Count)
    }
    Write-Host "  For a REAL fill rate across all rows, run Scrub-EquipmentList.ps1 (read-only)." -ForegroundColor DarkGray
}

Write-Host ""
Write-Host "=======================================================================" -ForegroundColor Yellow
Write-Host " On adding new Department / Location values from inside ARC" -ForegroundColor Yellow
Write-Host "=======================================================================" -ForegroundColor Yellow
Write-Host @"
  A choice column's allowed values are part of the COLUMN DEFINITION, not the
  data. Adding one is a PATCH to the column (this is what Add-CMMSColumns.ps1
  does when it re-vocabularies Status and Category) - NOT a list-item write.

  That matters because it needs a much bigger permission than ARC has. ARC is
  granted Sites.Selected, which is read/write on list ITEMS. Editing a column
  definition needs site-manage rights. So an ARC admin screen cannot patch a
  choice column with the app's current grant.

  Three ways out, in the order they are worth considering:

  1. CONVERT Department and Location to admin-managed LOOKUP LISTS.
     Adding a value then becomes adding a LIST ITEM, which the existing grant
     already allows - and ARC already does exactly this for Operations
     Projects, Panel Projects and the three Teradyne reference lists, with
     admin screens for each. Costs a one-off migration on 378 rows.
     RECOMMENDED.

  2. Raise the app's SharePoint permission to site-manage.
     Smallest code change, biggest security change: it would let the app
     rewrite any column on the site, for one admin screen's benefit.

  3. Leave the choice columns fixed and keep editing them in SharePoint.
     No work, but it is the thing being moved away from.
"@ -ForegroundColor Gray

Write-Host ""
Write-Host "Snapshots refreshed. Paste this output back to Claude." -ForegroundColor Green
