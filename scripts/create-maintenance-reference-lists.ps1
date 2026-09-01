<#
.SYNOPSIS
    Creates "Maintenance Departments" and "Maintenance Locations" as
    admin-managed lookup lists, seeded from the choice values already in use.

.DESCRIPTION
    Department and Location are CHOICE columns today. A choice column's allowed
    values live in the column DEFINITION, so adding one is a column PATCH -
    which needs site-manage rights that ARC (granted Sites.Selected) does not
    have. That is why an ARC admin screen cannot add a new department.

    Converting them to lookup lists fixes that: adding a value becomes adding a
    LIST ITEM, which the existing grant already allows. It is also the pattern
    ARC already uses five times over - Operations Projects, Panel Projects and
    the three Teradyne reference lists, each with its own admin screen.

    STAGED ON PURPOSE. Run it in this order, checking between stages:

      (default)           Create the two lists and seed them. Purely additive -
                          nothing existing is touched, and it is safe to re-run.
      -AddLookupColumns   Add DepartmentRef / LocationRef lookup columns to the
                          Equipment List and both maintenance lists. Still
                          additive: the old choice columns keep working.
      -MigrateValues      Copy each row's existing choice value into the new
                          lookup. Reads 378 equipment rows; reports anything it
                          could not match instead of guessing.

    RETIRING the old choice columns is deliberately NOT here. Do it by hand once
    ARC reads the lookups and you are satisfied nothing else depends on them -
    deleting a column is the one step with no undo.

    RUN IN YOUR OWN TERMINAL - the sign-in is interactive.

.PARAMETER SeedFrom
    Where the seed values come from.
      Choices  (default) every value defined on the Equipment List's choice
               column - lossless, including values nobody has used yet.
      InUse    only values at least one row actually holds. Tighter, but drops
               legitimate options nobody has picked yet.
    Either way the script REPORTS which seeded values are unused, so the dead
    ones can be pruned deliberately rather than silently.

.EXAMPLE
    .\create-maintenance-reference-lists.ps1 -WhatIf

.EXAMPLE
    .\create-maintenance-reference-lists.ps1
    .\create-maintenance-reference-lists.ps1 -AddLookupColumns
    .\create-maintenance-reference-lists.ps1 -MigrateValues

.NOTES
    The Location list has 62 values including known near-duplicates
    (HARNESS / HARNESS DEPARMENT / HARNESS DEPARTMENT, QC / QC DIGITAL /
    Q.C. DIGITAL, MS / MACHINE SHOP). Seeding is the natural moment to clean
    them - but this script will NOT merge anything automatically, for the same
    reason Scrub-EquipmentList.ps1 won't: only somebody who knows the plant can
    say which pairs are the same room. It flags them and moves on.
#>

[CmdletBinding()]
param(
    [switch]$WhatIf,
    [switch]$DeviceCode,
    [switch]$AddLookupColumns,
    [switch]$MigrateValues,
    [ValidateSet("Choices", "InUse")]
    [string]$SeedFrom = "Choices"
)

$ErrorActionPreference = "Stop"
Import-Module Microsoft.Graph.Authentication

$siteId = "coopermachineryservices.sharepoint.com,915a6183-2b71-4dfd-a8b9-181126dfbe78,3eb6cb9c-6535-4c69-a8d7-e90b2f90a9eb"
$LIST_EQUIPMENT  = "6f2fb6e1-3b41-40de-b78b-2c43c3c3d068"
$LIST_MAINTTASKS = "ff9d837f-227f-4a9b-b534-5fc722ff8c3b"
$LIST_SCHEDULED  = "9179e16d-5cc8-41bd-b085-eccd39293f98"

$specs = @(
    @{ Key = "Department"; ListName = "Maintenance Departments"; RefName = "DepartmentRef"; RefLabel = "Department Ref" },
    @{ Key = "Location";   ListName = "Maintenance Locations";   RefName = "LocationRef";   RefLabel = "Location Ref" }
)

$refColumns = @(
    @{
        name        = "Active"
        displayName = "Active"
        description = "Untick to retire a value without deleting it. A retired value stops being offered but keeps every row that already points at it."
        boolean     = @{}
    },
    @{
        name        = "Note"
        displayName = "Note"
        description = "Free text - what this covers, or why it was retired."
        text        = @{ allowMultipleLines = $true; appendChangesToExistingText = $false; linesForEditing = 3; textType = "plain" }
    }
)

# --- auth -------------------------------------------------------------------
$ctx = Get-MgContext
if (-not $ctx -or $ctx.Scopes -notcontains "Sites.Manage.All") {
    Write-Host "Signing in for write access (Sites.Manage.All)..." -ForegroundColor Cyan
    if ($DeviceCode) { Connect-MgGraph -Scopes "Sites.Manage.All" -UseDeviceCode -NoWelcome }
    else             { Connect-MgGraph -Scopes "Sites.Manage.All" -NoWelcome }
}
if ($WhatIf) {
    Write-Host ""
    Write-Host "*** -WhatIf: nothing will be changed ***" -ForegroundColor Magenta
}

function Get-AllItems($listId, $select) {
    $out = @()
    $uri = "https://graph.microsoft.com/v1.0/sites/$siteId/lists/$listId/items?`$expand=fields(`$select=$select)&`$top=500"
    while ($uri) {
        $page = Invoke-MgGraphRequest -Method GET -Uri $uri
        $out += $page.value
        $uri = $page["@odata.nextLink"]
    }
    $out
}

# --- read the source of truth ----------------------------------------------
Write-Host "Reading the Equipment List..." -ForegroundColor Cyan
$eqCols = (Invoke-MgGraphRequest -Method GET `
    -Uri "https://graph.microsoft.com/v1.0/sites/$siteId/lists/$LIST_EQUIPMENT/columns").value
$eqRows = Get-AllItems $LIST_EQUIPMENT "Title,Department,Location"
Write-Host ("  {0} assets" -f $eqRows.Count) -ForegroundColor Gray

# --- find the lists (paged: an unpaged call silently returns a subset) ------
$found = @{}
$uri = "https://graph.microsoft.com/v1.0/sites/$siteId/lists?`$select=id,displayName&`$top=200"
while ($uri) {
    $page = Invoke-MgGraphRequest -Method GET -Uri $uri
    foreach ($l in $page.value) { $found[$l.displayName] = $l.id }
    $uri = $page["@odata.nextLink"]
}

$resolved = @{}

foreach ($spec in $specs) {
    Write-Host ""
    Write-Host ("=== {0} ===" -f $spec.ListName) -ForegroundColor Cyan

    $col = $eqCols | Where-Object { $_["name"] -eq $spec.Key }
    $defined = if ($col -and $col["choice"]) { @($col["choice"]["choices"]) } else { @() }
    $inUse = @($eqRows | ForEach-Object { $_.fields.($spec.Key) } |
        Where-Object { "$_".Trim() -ne "" } | Sort-Object -Unique)

    $seed = if ($SeedFrom -eq "InUse") { $inUse } else { @($defined + $inUse | Sort-Object -Unique) }
    $unused = @($seed | Where-Object { $inUse -notcontains $_ })

    Write-Host ("  defined on the choice column: {0}" -f $defined.Count) -ForegroundColor Gray
    Write-Host ("  actually used by a row:       {0}" -f $inUse.Count) -ForegroundColor Gray
    Write-Host ("  seeding:                      {0}  (-SeedFrom {1})" -f $seed.Count, $SeedFrom) -ForegroundColor Gray
    if ($unused) {
        Write-Host ("  NOT used by any row ({0}) - prune these deliberately, not silently:" -f $unused.Count) -ForegroundColor Yellow
        foreach ($u in $unused) { Write-Host ("    - {0}" -f $u) -ForegroundColor DarkYellow }
    }

    # Near-duplicate flag. Reported only - merging is a human decision.
    $norm = @{}
    foreach ($v in $seed) {
        $k = ($v -replace '[^A-Za-z0-9]', '').ToUpperInvariant()
        if (-not $norm.ContainsKey($k)) { $norm[$k] = @() }
        $norm[$k] += $v
    }
    $dupes = $norm.GetEnumerator() | Where-Object { $_.Value.Count -gt 1 }
    if ($dupes) {
        Write-Host "  NEAR-DUPLICATES (same once punctuation and spacing are ignored):" -ForegroundColor Red
        foreach ($d in $dupes) { Write-Host ("    {0}" -f ($d.Value -join "  ==  ")) -ForegroundColor Red }
        Write-Host "  Not merged - only someone who knows the plant can say if they are the same place." -ForegroundColor Red
    }

    # --- create the list ---------------------------------------------------
    $listId = $found[$spec.ListName]
    if (-not $listId) {
        if ($WhatIf) {
            Write-Host ("  WOULD CREATE '{0}' and seed {1} values" -f $spec.ListName, $seed.Count) -ForegroundColor Cyan
            continue
        }
        Write-Host ("  CREATE '{0}'..." -f $spec.ListName) -ForegroundColor Green
        $body = @{
            displayName = $spec.ListName
            list        = @{ template = "genericList" }
            columns     = $refColumns
        } | ConvertTo-Json -Depth 8
        $created = Invoke-MgGraphRequest -Method POST `
            -Uri "https://graph.microsoft.com/v1.0/sites/$siteId/lists" `
            -Body $body -ContentType "application/json"
        $listId = $created["id"]
        Write-Host "         created" -ForegroundColor Green
    } else {
        Write-Host "  EXISTS" -ForegroundColor Yellow
    }
    $resolved[$spec.Key] = @{ ListId = $listId; Spec = $spec }
    if (-not $listId) { continue }

    # --- seed --------------------------------------------------------------
    $existing = Get-AllItems $listId "Title"
    $have = @($existing | ForEach-Object { "$($_.fields.Title)" })
    $toAdd = @($seed | Where-Object { $have -notcontains $_ })
    Write-Host ("  {0} already on the list, {1} to add" -f $have.Count, $toAdd.Count) -ForegroundColor Gray
    foreach ($v in $toAdd) {
        if ($WhatIf) { Write-Host ("    WOULD ADD  {0}" -f $v) -ForegroundColor Cyan; continue }
        $item = @{ fields = @{ Title = $v; Active = $true } } | ConvertTo-Json -Depth 5
        Invoke-MgGraphRequest -Method POST `
            -Uri "https://graph.microsoft.com/v1.0/sites/$siteId/lists/$listId/items" `
            -Body $item -ContentType "application/json" | Out-Null
        Write-Host ("    added      {0}" -f $v) -ForegroundColor Green
    }
    Write-Host ("  List id: {0}" -f $listId) -ForegroundColor Green
}

# --- stage 2: the lookup columns -------------------------------------------
if ($AddLookupColumns) {
    Write-Host ""
    Write-Host "=== Adding lookup columns ===" -ForegroundColor Cyan
    $targets = @(
        @{ Label = "Altronic Equipment List";    Id = $LIST_EQUIPMENT },
        @{ Label = "Altronic Maintenance Tasks"; Id = $LIST_MAINTTASKS },
        @{ Label = "Scheduled Maintenance";      Id = $LIST_SCHEDULED }
    )
    foreach ($t in $targets) {
        $u = "https://graph.microsoft.com/v1.0/sites/$siteId/lists/$($t.Id)/columns"
        $have = (Invoke-MgGraphRequest -Method GET -Uri $u).value | ForEach-Object { $_["name"] }
        foreach ($spec in $specs) {
            $r = $resolved[$spec.Key]
            if (-not $r) { continue }
            if ($have -contains $spec.RefName) {
                Write-Host ("  SKIP    {0} / {1}" -f $t.Label, $spec.RefName) -ForegroundColor Yellow
                continue
            }
            if ($WhatIf) {
                Write-Host ("  WOULD ADD  {0} / {1}" -f $t.Label, $spec.RefName) -ForegroundColor Cyan
                continue
            }
            $col = @{
                name        = $spec.RefName
                displayName = $spec.RefLabel
                description = "Lookup into the $($spec.ListName) list. Replaces the old $($spec.Key) choice column - add new values by adding a row there, which ARC can do; a choice column's values need site-manage rights it does not have."
                lookup      = @{ listId = $r.ListId; columnName = "Title" }
            }
            Write-Host ("  ADD     {0} / {1}" -f $t.Label, $spec.RefName) -ForegroundColor Green
            Invoke-MgGraphRequest -Method POST -Uri $u `
                -Body ($col | ConvertTo-Json -Depth 6) -ContentType "application/json" | Out-Null
        }
    }
}

# --- stage 3: copy the values across ---------------------------------------
if ($MigrateValues) {
    Write-Host ""
    Write-Host "=== Copying Equipment values into the new lookups ===" -ForegroundColor Cyan
    $maps = @{}
    foreach ($spec in $specs) {
        $r = $resolved[$spec.Key]; if (-not $r) { continue }
        $m = @{}
        foreach ($row in (Get-AllItems $r.ListId "Title")) {
            $m["$($row.fields.Title)"] = [int]$row.id
        }
        $maps[$spec.Key] = $m
    }

    $updated = 0; $skipped = 0; $unmatched = @()
    foreach ($row in $eqRows) {
        $patch = @{}
        foreach ($spec in $specs) {
            $v = "$($row.fields.($spec.Key))".Trim()
            if ($v -eq "") { continue }
            $id = $maps[$spec.Key][$v]
            if (-not $id) { $unmatched += "$($row.fields.Title): $($spec.Key) = '$v'"; continue }
            $patch["$($spec.RefName)LookupId"] = $id
        }
        if ($patch.Count -eq 0) { $skipped++; continue }
        if ($WhatIf) { $updated++; continue }
        Invoke-MgGraphRequest -Method PATCH `
            -Uri "https://graph.microsoft.com/v1.0/sites/$siteId/lists/$LIST_EQUIPMENT/items/$($row.id)/fields" `
            -Body ($patch | ConvertTo-Json -Depth 4) -ContentType "application/json" | Out-Null
        $updated++
    }
    Write-Host ("  {0} rows {1}, {2} had nothing to copy" -f $updated, $(if ($WhatIf) { "would be updated" } else { "updated" }), $skipped) -ForegroundColor Green
    if ($unmatched) {
        Write-Host ("  {0} values had no matching row on the reference list:" -f $unmatched.Count) -ForegroundColor Red
        $unmatched | Select-Object -First 20 | ForEach-Object { Write-Host ("    {0}" -f $_) -ForegroundColor Red }
        Write-Host "  Add them to the reference list and re-run - nothing was guessed." -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "=== Next ===" -ForegroundColor Cyan
Write-Host "  Put the two list ids in src/api/config.ts, and add their VITE_* vars" -ForegroundColor Gray
Write-Host "  to .github/workflows/deploy.yml." -ForegroundColor Gray
Write-Host "  Retiring the old Department / Location CHOICE columns is deliberately" -ForegroundColor Gray
Write-Host "  manual - do it only once ARC reads the lookups. Deleting a column has no undo." -ForegroundColor Gray
