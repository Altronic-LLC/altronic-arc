<#
.SYNOPSIS
    Loads a building's CAD extract into the Plant Map: its symbols into Layout
    Components, and its placements into an EMPTY Draft layout already created
    in ARC. Reports only unless -Apply.

.DESCRIPTION
    The extract lives OUTSIDE the repo (it is real plant data; the repo is
    public): by default C:\Working_Dir\ProcessImprovement\Arc\plant manager\cad-extract,
    which holds

      components-reduced.json            the symbol library, one row per symbol
                                         in Layout Components' shape
      current-layout-<building>.json     the placements, centre x / y, real
                                         w / d, rot, label, in inches

    Before running it, create the layout in ARC: Plant Map -> New layout,
    uploading walls-<building>-cad.svg. That stores the walls drawing and makes
    the Draft row this script fills. (The walls drawing goes through ARC so it
    is sanitised and reviewed like any other.)

    What it does:

    - SYMBOLS: adds every symbol the building uses, matched on ComponentKey
      (case-insensitive) and ADD-ONLY - a symbol already on the list is left
      exactly as it is and its id is used. Symbols other buildings use are
      skipped. A symbol on a layer (the safety items) is still added. A
      symbol's CollisionPolygon (its real shape) goes in the column of that
      name, which create-plant-map-lists.ps1 adds; a missing column stops the
      run before anything is written.
    - CATEGORIES: the extract's category is written as it is. One the
      Category column doesn't allow stops the run before anything is written,
      naming create-plant-map-lists.ps1, which adds the missing choices
      (Safety, Utility and Zone are ARC categories since 2026-11-10).
    - PLACEMENTS: every placement NOT on a layer goes into the Draft's
      LayoutJson. ARC has no layers yet, so the safety layer's items are left
      out and counted. Each item points at its symbol's SharePoint id.
    - It REFUSES a layout that isn't a Draft, already has items, can't be
      read, or whose size doesn't match the extract's (a different walls
      drawing). Areas already drawn on the draft are kept.
    - The row is read FRESH just before the write, the write is read back and
      compared character for character. Nothing is deleted. No email is sent.

    RUN IN YOUR OWN TERMINAL - the sign-in is interactive.

.PARAMETER Building
    The extract's building key, as in current-layout-<Building>.json and the
    symbols' InstancesByBuilding. Default main-plant.

.PARAMETER LayoutId
    The Draft row to fill. Left out, the one Draft whose Building or Title
    matches the building ("main plant") is used; more than one stops the run.

.EXAMPLE
    .\load-plant-cad-extract.ps1
    .\load-plant-cad-extract.ps1 -Apply
    .\load-plant-cad-extract.ps1 -LayoutId 12 -Apply
#>

[CmdletBinding()]
param(
    [string]$ExtractDir = "C:\Working_Dir\ProcessImprovement\Arc\plant manager\cad-extract",
    [string]$Building = "main-plant",
    [int]$LayoutId,
    [switch]$Apply,
    [switch]$DeviceCode
)

$ErrorActionPreference = "Stop"
Import-Module Microsoft.Graph.Authentication

$siteId = "coopermachineryservices.sharepoint.com,915a6183-2b71-4dfd-a8b9-181126dfbe78,3eb6cb9c-6535-4c69-a8d7-e90b2f90a9eb"
$graph = "https://graph.microsoft.com/v1.0/sites/$siteId"
$COMPONENTS_NAME = "Layout Components"
$LAYOUTS_NAME = "Plant Layouts"
# The same limits ARC applies (lib/plantSymbolImport.ts, lib/plantLayoutDoc.ts).
$MAX_SYMBOL_MARKUP_CHARS = 60000
$LAYOUT_JSON_MAX_CHARS = 1000000

function Fail($message) { Write-Host "`nSTOPPED: $message" -ForegroundColor Red; exit 1 }

# --- read the extract ----------------------------------------------------------
$componentsPath = Join-Path $ExtractDir "components-reduced.json"
$layoutPath = Join-Path $ExtractDir "current-layout-$Building.json"
foreach ($p in $componentsPath, $layoutPath) { if (-not (Test-Path $p)) { Fail "Can't find $p" } }
$allSymbols = @(Get-Content $componentsPath -Raw -Encoding UTF8 | ConvertFrom-Json)
$extract = Get-Content $layoutPath -Raw -Encoding UTF8 | ConvertFrom-Json

$symbols = @($allSymbols | Where-Object { $_.InstancesByBuilding -and $_.InstancesByBuilding.$Building -gt 0 })
$placements = @($extract.items | Where-Object { -not $_.layer })
$layered = @($extract.items | Where-Object { $_.layer })

Write-Host "Extract: $ExtractDir" -ForegroundColor Gray
Write-Host ("  {0} symbols in the library, {1} used by {2}" -f $allSymbols.Count, $symbols.Count, $Building)
Write-Host ("  {0} placements: {1} to load, {2} on a layer left out" -f $extract.items.Count, $placements.Count, $layered.Count)
foreach ($g in ($layered | Group-Object layer)) { Write-Host ("      layer '{0}': {1} items (not loaded until ARC has layers)" -f $g.Name, $g.Count) -ForegroundColor DarkGray }

# Checks that need nothing from SharePoint.
$byKey = @{}
foreach ($s in $symbols) { $byKey[$s.key.ToLower()] = $s }
$problems = @()
foreach ($s in $symbols) {
    if (-not ($s.FootprintW -gt 0 -and $s.FootprintD -gt 0)) { $problems += "symbol $($s.key) has no footprint" }
    if ($s.SvgMarkup.Length -gt $MAX_SYMBOL_MARKUP_CHARS) { $problems += "symbol $($s.key) SVG is $($s.SvgMarkup.Length) characters (limit $MAX_SYMBOL_MARKUP_CHARS)" }
}
$uids = @{}
foreach ($p in $placements) {
    if (-not $byKey.ContainsKey("$($p.componentKey)".ToLower())) { $problems += "placement $($p.id) uses '$($p.componentKey)', which isn't one of $Building's symbols" }
    if ($uids.ContainsKey($p.id)) { $problems += "placement id $($p.id) appears twice" }
    $uids[$p.id] = $true
}
if ($problems.Count -gt 0) { $problems | Select-Object -First 20 | ForEach-Object { Write-Host "  $_" -ForegroundColor Red }; Fail "the extract has $($problems.Count) problem(s)." }

# --- auth + lists ----------------------------------------------------------------
$ctx = Get-MgContext
if (-not $ctx -or ($ctx.Scopes -notcontains "Sites.Manage.All" -and $ctx.Scopes -notcontains "Sites.ReadWrite.All")) {
    Write-Host "Signing in (Sites.Manage.All)..." -ForegroundColor Cyan
    if ($DeviceCode) { Connect-MgGraph -Scopes "Sites.Manage.All" -UseDeviceCode -NoWelcome }
    else             { Connect-MgGraph -Scopes "Sites.Manage.All" -NoWelcome }
}

$found = @{}
$uri = "$graph/lists?`$select=id,displayName&`$top=200"
while ($uri) {
    $page = Invoke-MgGraphRequest -Method GET -Uri $uri
    foreach ($l in $page.value) { $found[$l.displayName] = $l.id }
    $uri = $page["@odata.nextLink"]
}
$componentsId = $found[$COMPONENTS_NAME]
$layoutsId = $found[$LAYOUTS_NAME]
if (-not $componentsId -or -not $layoutsId) { Fail "'$COMPONENTS_NAME' or '$LAYOUTS_NAME' isn't on Altronic_PMO. Run create-plant-map-lists.ps1." }

function Get-AllItems($listId, $select) {
    $rows = @()
    $u = "$graph/lists/$listId/items?`$expand=fields(`$select=$select)&`$top=500"
    while ($u) {
        $page = Invoke-MgGraphRequest -Method GET -Uri $u
        $rows += $page.value
        $u = $page["@odata.nextLink"]
    }
    return $rows
}

# --- categories ----------------------------------------------------------------------
$categoryColumn = (Invoke-MgGraphRequest -Method GET -Uri "$graph/lists/$componentsId/columns").value | Where-Object { $_["name"] -eq "Category" } | Select-Object -First 1
$allowed = @($categoryColumn["choice"]["choices"])
$componentColumns = @((Invoke-MgGraphRequest -Method GET -Uri "$graph/lists/$componentsId/columns").value | ForEach-Object { $_["name"] })
$shaped = @($symbols | Where-Object { $_.CollisionPolygon })
if ($shaped.Count -gt 0 -and $componentColumns -notcontains "CollisionPolygon") {
    Fail "$($shaped.Count) symbols have a CollisionPolygon but '$COMPONENTS_NAME' has no CollisionPolygon column. Run create-plant-map-lists.ps1 -NoSeed, then this again."
}
foreach ($s in $shaped) {
    $pts = @($s.CollisionPolygon)
    if ($pts.Count -lt 3 -or @($pts | Where-Object { @($_).Count -lt 2 }).Count -gt 0) { Fail "symbol $($s.key)'s CollisionPolygon isn't a list of [x, y] points." }
}
$categoryFor = @{}
$missingChoices = @()
foreach ($s in $symbols) {
    $cat = "$($s.Category)".Trim()
    if ($allowed -notcontains $cat) { $missingChoices += $cat }
    $categoryFor[$s.key.ToLower()] = $cat
}
$missingChoices = @($missingChoices | Sort-Object -Unique)
if ($missingChoices.Count -gt 0) {
    Fail "the Category column doesn't allow: $($missingChoices -join ', '). Run create-plant-map-lists.ps1 -NoSeed (it adds missing choices), then this again."
}

# --- symbols: which are new ----------------------------------------------------------
$existing = @{}
foreach ($row in (Get-AllItems $componentsId "ComponentKey,Version")) {
    $k = "$($row.fields.ComponentKey)".Trim().ToLower()
    if ($k) { $existing[$k] = @{ id = [int]$row.id; version = [int]($(if ($row.fields.Version) { $row.fields.Version } else { 1 })) } }
}
$toAdd = @($symbols | Where-Object { -not $existing.ContainsKey($_.key.ToLower()) })
Write-Host "`nSymbols: $($symbols.Count - $toAdd.Count) already on '$COMPONENTS_NAME', $($toAdd.Count) to add ($(@($toAdd | Where-Object { $_.CollisionPolygon }).Count) with a collision outline)"
foreach ($g in ($toAdd | Group-Object { $categoryFor[$_.key.ToLower()] } | Sort-Object Name)) { Write-Host ("    {0,-8} {1}" -f $g.Name, $g.Count) -ForegroundColor DarkGray }

# --- the target layout ----------------------------------------------------------------
function Read-Layout($id) {
    return Invoke-MgGraphRequest -Method GET -Uri "$graph/lists/$layoutsId/items/$id`?`$expand=fields(`$select=Title,Building,Status,Version,LayoutJson)"
}

function Test-Target($row) {
    $f = $row.fields
    if ($f.Status -ne "Draft") { return "layout $($row.id) is $($f.Status), not a Draft" }
    try { $doc = "$($f.LayoutJson)" | ConvertFrom-Json } catch { return "layout $($row.id)'s LayoutJson can't be read - ARC never writes over one it can't read" }
    if (-not $doc -or -not $doc.extent) { return "layout $($row.id)'s LayoutJson has no extent" }
    if (@($doc.items).Count -gt 0) { return "layout $($row.id) already has $(@($doc.items).Count) items - use an empty draft" }
    if ([math]::Abs($doc.extent.w - $extract.width) -gt 0.5 -or [math]::Abs($doc.extent.h - $extract.height) -gt 0.5) {
        return "layout $($row.id) is $($doc.extent.w) x $($doc.extent.h) in, the extract is $($extract.width) x $($extract.height) - a different walls drawing?"
    }
    return $null
}

$target = $null
if ($LayoutId) {
    $target = Read-Layout $LayoutId
} else {
    $words = $Building -replace "-", " "
    $drafts = @(Get-AllItems $layoutsId "Title,Building,Status" | Where-Object {
        $_.fields.Status -eq "Draft" -and ("$($_.fields.Building)" -like "*$words*" -or "$($_.fields.Title)" -like "*$words*")
    })
    if ($drafts.Count -eq 1) {
        $target = Read-Layout $drafts[0].id
    } elseif ($drafts.Count -gt 1) {
        Write-Host "`nMore than one Draft matches '$words':" -ForegroundColor Yellow
        $drafts | ForEach-Object { Write-Host "    id $($_.id): $($_.fields.Title) ($($_.fields.Building))" }
        Fail "pass -LayoutId."
    }
}

Write-Host ""
if (-not $target) {
    Write-Host "Layout: no Draft found for '$($Building -replace '-', ' ')'. Create it in ARC (Plant Map -> New layout, walls-$Building-cad.svg), then run this again." -ForegroundColor Yellow
    if ($Apply) { Fail "nothing to load the placements into." }
} else {
    $why = Test-Target $target
    Write-Host "Layout: id $($target.id) '$($target.fields.Title)' ($($target.fields.Building)), $($target.fields.Status) v$($target.fields.Version)"
    if ($why) { Fail $why }
    Write-Host "    empty, and the same size as the extract ($($extract.width) x $($extract.height) in)" -ForegroundColor DarkGray
}

if (-not $Apply) {
    Write-Host "`nNothing written. Run again with -Apply to add the symbols and fill the layout." -ForegroundColor Magenta
    exit 0
}

# --- APPLY 1: symbols ---------------------------------------------------------------------
Write-Host "`nAdding symbols..." -ForegroundColor Cyan
$n = 0
foreach ($s in $toAdd) {
    $resize = [bool]$s.AllowResize
    $fields = [ordered]@{
        Title = "$($s.Title)".Trim(); ComponentKey = $s.key; Category = $categoryFor[$s.key.ToLower()]
        SvgMarkup = $s.SvgMarkup; FootprintW = [double]$s.FootprintW; FootprintD = [double]$s.FootprintD
        AllowResize = $resize; AllowRotate = [bool]$s.AllowRotate
        MinScale = $(if ($resize) { [double]$s.MinScale } else { 1 }); MaxScale = $(if ($resize) { [double]$s.MaxScale } else { 1 })
        Collides = [bool]$s.Collides; Clearance = [math]::Max(0, [double]$s.Clearance)
        DefaultStroke = "$($s.DefaultStroke)"; DefaultFill = "$($s.DefaultFill)"; Version = 1; IsActive = $true
    }
    if ($s.CollisionPolygon) { $fields.CollisionPolygon = (ConvertTo-Json -InputObject @($s.CollisionPolygon) -Compress -Depth 3) }
    $created = Invoke-MgGraphRequest -Method POST -Uri "$graph/lists/$componentsId/items" -ContentType "application/json; charset=utf-8" `
        -Body (@{ fields = $fields } | ConvertTo-Json -Depth 4 -Compress)
    $existing[$s.key.ToLower()] = @{ id = [int]$created.id; version = 1 }
    $n++
    if ($n % 25 -eq 0) { Write-Host "    $n of $($toAdd.Count)" -ForegroundColor DarkGray }
}
Write-Host "    added $n" -ForegroundColor Green

# --- APPLY 2: the layout --------------------------------------------------------------------
$fresh = Read-Layout $target.id
$why = Test-Target $fresh
if ($why) { Fail "$why (it changed since the check above)" }
$doc = "$($fresh.fields.LayoutJson)" | ConvertFrom-Json

$items = [System.Collections.Generic.List[object]]::new()
foreach ($p in $placements) {
    $sym = $existing["$($p.componentKey)".ToLower()]
    $items.Add([ordered]@{
        uid = "i_cad_$($p.id)"; componentId = $sym.id; componentVersion = $sym.version
        x = [double]$p.x; y = [double]$p.y; w = [double]$p.w; d = [double]$p.d; rot = [double]$p.rot
        label = "$($p.label)"; equipmentId = $null; locked = $false
    })
}
$out = [ordered]@{
    schema = 1; units = "in"
    extent = [ordered]@{ w = [double]$doc.extent.w; h = [double]$doc.extent.h }
    items = $items.ToArray()
    areas = @($doc.areas | Where-Object { $_ })
}
$json = $out | ConvertTo-Json -Depth 8 -Compress
if ($json.Length -gt $LAYOUT_JSON_MAX_CHARS) { Fail "the layout is $($json.Length) characters; ARC's limit is $LAYOUT_JSON_MAX_CHARS." }

Write-Host ("Writing {0} items to layout {1} ({2:N0} characters)..." -f $items.Count, $target.id, $json.Length) -ForegroundColor Cyan
Invoke-MgGraphRequest -Method PATCH -Uri "$graph/lists/$layoutsId/items/$($target.id)/fields" -ContentType "application/json; charset=utf-8" `
    -Body (@{ LayoutJson = $json } | ConvertTo-Json -Depth 2 -Compress) | Out-Null
$back = (Invoke-MgGraphRequest -Method GET -Uri "$graph/lists/$layoutsId/items/$($target.id)/fields?`$select=LayoutJson")["LayoutJson"]
if ($back -cne $json) { Fail "the layout read back DIFFERENT from what was written ($("$back".Length) vs $($json.Length) characters). Check it in ARC before editing it." }

Write-Host "    written and read back identical" -ForegroundColor Green
Write-Host "`nDone. Open Plant Map -> '$($target.fields.Title)' in ARC." -ForegroundColor Cyan
Write-Host "Shaped symbols are checked by their CollisionPolygon outline, everything else by its rectangle." -ForegroundColor Gray
