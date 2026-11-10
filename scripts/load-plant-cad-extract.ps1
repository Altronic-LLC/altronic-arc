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
                                         w / d, rot, label, in inches, and the
                                         layers they're on - in the extract
                                         folder or its <building> subfolder
                                         (eng-sales\)

    Before running it, create the layout in ARC: Plant Map -> New layout,
    uploading the building's walls drawing (walls-main-plant-cad.svg,
    eng-sales\walls-eng-sales.svg). That stores the walls drawing and makes
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
    - PLACEMENTS: every placement goes into the Draft's LayoutJson, each
      pointing at its symbol's SharePoint id. One on a layer (the safety
      items) keeps its layer and group, and the extract's layers block becomes
      the layout's declared layers - "default": "hidden" starts it hidden.
    - It REFUSES a layout that isn't a Draft, already has items, can't be
      read, or whose size doesn't match the extract's (a different walls
      drawing). Areas already drawn on the draft are kept.
    - -AddLayers is for a layout loaded BEFORE ARC had layers (the Main Plant,
      2026-11-10): it adds only the placements ON A LAYER, to a Draft that
      already has the rest, and leaves every existing item and area as it is.
      A layered placement already there (same uid) is skipped, so a re-run
      adds nothing. Needs PowerShell 7.5+, which reads the existing layout
      without turning label text into dates.
    - The row is read FRESH just before the write, the write is read back and
      compared character for character. Nothing is deleted. No email is sent.

    RUN IN YOUR OWN TERMINAL - the sign-in is interactive.

.PARAMETER Building
    The extract's building key, as in current-layout-<Building>.json and the
    symbols' InstancesByBuilding. Default main-plant.

.PARAMETER LayoutId
    The Draft row to fill. Left out, the one Draft whose Building or Title
    contains -BuildingName is used; more than one stops the run.

.PARAMETER BuildingName
    The words the Draft's Building or Title must contain. Defaults from the
    key: main-plant -> "main plant", eng-sales -> "engineering".

.PARAMETER AddLayers
    Add only the layered placements to a Draft that already has the others.

.EXAMPLE
    .\load-plant-cad-extract.ps1
    .\load-plant-cad-extract.ps1 -Apply
    .\load-plant-cad-extract.ps1 -Building eng-sales -Apply
    .\load-plant-cad-extract.ps1 -AddLayers -Apply
    .\load-plant-cad-extract.ps1 -LayoutId 12 -Apply
#>

[CmdletBinding()]
param(
    [string]$ExtractDir = "C:\Working_Dir\ProcessImprovement\Arc\plant manager\cad-extract",
    [string]$Building = "main-plant",
    [int]$LayoutId,
    [string]$BuildingName,
    [switch]$AddLayers,
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

# PowerShell 7.5+ can read JSON without turning text that looks like a date
# into a DateTime - which would change a label when it's written back.
$canKeepDates = (Get-Command ConvertFrom-Json).Parameters.ContainsKey("DateKind")
function Read-Json([string]$text) {
    if ($canKeepDates) { return $text | ConvertFrom-Json -DateKind String }
    return $text | ConvertFrom-Json
}
if ($AddLayers -and -not $canKeepDates) { Fail "-AddLayers rewrites a layout that already has items; run it in PowerShell 7.5 or later (pwsh)." }

# "fire-exits" -> "Fire exits": a title for a layer or group that doesn't give one (lib/plantLayoutDoc.ts titleFromKey).
function Get-TitleFromKey([string]$key) {
    $words = ($key -replace "[-_]+", " ").Trim()
    if (-not $words) { return $key }
    return $words.Substring(0, 1).ToUpper() + $words.Substring(1)
}

if (-not $BuildingName) {
    $BuildingName = switch ($Building) { "eng-sales" { "engineering" } default { $Building -replace "-", " " } }
}

# --- read the extract ----------------------------------------------------------
$componentsPath = Join-Path $ExtractDir "components-reduced.json"
$layoutPath = Join-Path $ExtractDir "current-layout-$Building.json"
if (-not (Test-Path $layoutPath)) { $layoutPath = Join-Path (Join-Path $ExtractDir $Building) "current-layout-$Building.json" }
foreach ($p in $componentsPath, $layoutPath) { if (-not (Test-Path $p)) { Fail "Can't find $p" } }
$allSymbols = @(Get-Content $componentsPath -Raw -Encoding UTF8 | ConvertFrom-Json)
$extract = Read-Json (Get-Content $layoutPath -Raw -Encoding UTF8)

$symbols = @($allSymbols | Where-Object { $_.InstancesByBuilding -and $_.InstancesByBuilding.$Building -gt 0 })
$layered = @($extract.items | Where-Object { $_.layer })
# -AddLayers loads only the layered placements; otherwise every placement.
$placements = if ($AddLayers) { $layered } else { @($extract.items) }

# The layers the extract declares ({ safety: { title, default, groups: [..] } }),
# as ARC's list ([{ key, title, hiddenByDefault, groups: [{ key, title }] }]),
# plus any a placement names that isn't declared.
$extractLayers = [System.Collections.Generic.List[object]]::new()
if ($extract.layers) {
    foreach ($prop in $extract.layers.PSObject.Properties) {
        $groups = @(@($prop.Value.groups) | Where-Object { $_ } | ForEach-Object { [ordered]@{ key = "$_"; title = (Get-TitleFromKey "$_") } })
        $extractLayers.Add([ordered]@{
            key = $prop.Name
            title = $(if ($prop.Value.title) { "$($prop.Value.title)" } else { Get-TitleFromKey $prop.Name })
            hiddenByDefault = ("$($prop.Value.default)" -eq "hidden")
            groups = $groups
        })
    }
}
foreach ($p in $layered) {
    $l = $extractLayers | Where-Object { $_.key -eq $p.layer } | Select-Object -First 1
    if (-not $l) {
        $l = [ordered]@{ key = "$($p.layer)"; title = (Get-TitleFromKey "$($p.layer)"); hiddenByDefault = $false; groups = @() }
        $extractLayers.Add($l)
    }
    if ($p.group -and -not (@($l.groups) | Where-Object { $_.key -eq $p.group })) {
        $l.groups = @($l.groups) + ,([ordered]@{ key = "$($p.group)"; title = (Get-TitleFromKey "$($p.group)") })
    }
}

Write-Host "Extract: $ExtractDir" -ForegroundColor Gray
Write-Host "  layout file: $layoutPath" -ForegroundColor Gray
Write-Host ("  {0} symbols in the library, {1} used by {2}" -f $allSymbols.Count, $symbols.Count, $Building)
Write-Host ("  {0} placements, {1} of them on a layer{2}" -f $extract.items.Count, $layered.Count, $(if ($AddLayers) { " - -AddLayers loads only those" } else { "" }))
foreach ($l in $extractLayers) {
    $n = @($layered | Where-Object { $_.layer -eq $l.key }).Count
    $state = if ($l.hiddenByDefault) { "hidden" } else { "shown" }
    $groupKeys = (@($l.groups) | ForEach-Object { $_.key }) -join ", "
    Write-Host ("      layer '{0}' ({1}, starts {2}): {3} items in {4}" -f $l.key, $l.title, $state, $n, $groupKeys) -ForegroundColor DarkGray
}

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
    if ($f.Status -ne "Draft") {
        $hint = if ($f.Status -eq "Published") { " - open it in ARC and press Edit, which makes a new Draft version, then run this against that" } else { "" }
        return "layout $($row.id) is $($f.Status), not a Draft$hint"
    }
    try { $doc = Read-Json "$($f.LayoutJson)" } catch { return "layout $($row.id)'s LayoutJson can't be read - ARC never writes over one it can't read" }
    if (-not $doc -or -not $doc.extent) { return "layout $($row.id)'s LayoutJson has no extent" }
    if ($doc.schema -ne 1 -or $null -eq $doc.items) { return "layout $($row.id)'s LayoutJson isn't schema 1 with an items list - ARC never writes over one it can't read" }
    if ($AddLayers) {
        if (@($doc.items).Count -eq 0) { return "layout $($row.id) is empty - load it without -AddLayers, which loads everything" }
    } elseif (@($doc.items).Count -gt 0) {
        $hint = if ($layered.Count -gt 0) { ", or -AddLayers to add just the layered items" } else { "" }
        return "layout $($row.id) already has $(@($doc.items).Count) items - use an empty draft$hint"
    }
    if ([math]::Abs($doc.extent.w - $extract.width) -gt 0.5 -or [math]::Abs($doc.extent.h - $extract.height) -gt 0.5) {
        return "layout $($row.id) is $($doc.extent.w) x $($doc.extent.h) in, the extract is $($extract.width) x $($extract.height) - a different walls drawing?"
    }
    return $null
}

$target = $null
if ($LayoutId) {
    $target = Read-Layout $LayoutId
} else {
    $words = $BuildingName
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
    Write-Host "Layout: no Draft whose Building or Title contains '$BuildingName'. Create it in ARC (Plant Map -> New layout, with the building's walls drawing), or pass -LayoutId / -BuildingName, then run this again." -ForegroundColor Yellow
    if ($Apply) { Fail "nothing to load the placements into." }
} else {
    $why = Test-Target $target
    Write-Host "Layout: id $($target.id) '$($target.fields.Title)' ($($target.fields.Building)), $($target.fields.Status) v$($target.fields.Version)"
    if ($why) { Fail $why }
    if ($AddLayers) {
        $haveNow = @{}
        foreach ($i in @((Read-Json "$($target.fields.LayoutJson)").items)) { $haveNow["$($i.uid)"] = $true }
        $already = @($layered | Where-Object { $haveNow.ContainsKey("i_cad_$($_.id)") }).Count
        Write-Host "    has $($haveNow.Count) items, the same size as the extract; $($layered.Count - $already) layered items to add, $already already there" -ForegroundColor DarkGray
        if ($layered.Count - $already -eq 0 -and $toAdd.Count -eq 0) { Write-Host "`nNothing to do." -ForegroundColor Green; exit 0 }
    } else {
        Write-Host "    empty, and the same size as the extract ($($extract.width) x $($extract.height) in)" -ForegroundColor DarkGray
    }
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
$doc = Read-Json "$($fresh.fields.LayoutJson)"

# -AddLayers keeps every item already there, exactly as it is, and adds after them.
$items = [System.Collections.Generic.List[object]]::new()
$have = @{}
if ($AddLayers) {
    foreach ($i in @($doc.items)) { $items.Add($i); $have["$($i.uid)"] = $true }
}
$before = $items.Count
foreach ($p in $placements) {
    $uid = "i_cad_$($p.id)"
    if ($have.ContainsKey($uid)) { continue }
    $sym = $existing["$($p.componentKey)".ToLower()]
    $item = [ordered]@{
        uid = $uid; componentId = $sym.id; componentVersion = $sym.version
        x = [double]$p.x; y = [double]$p.y; w = [double]$p.w; d = [double]$p.d; rot = [double]$p.rot
        label = "$($p.label)"; equipmentId = $null; locked = $false
    }
    if ($p.layer) {
        $item.layer = "$($p.layer)"
        if ($p.group) { $item.group = "$($p.group)" }
    }
    $items.Add($item)
}

# The layout's layers: what it already declares, kept, then the extract's -
# a layer it lacks added, and a group a layer lacks appended.
$layers = [System.Collections.Generic.List[object]]::new()
foreach ($l in @($doc.layers | Where-Object { $_ -and $_.key })) {
    $layers.Add([ordered]@{ key = "$($l.key)"; title = "$($l.title)"; hiddenByDefault = [bool]$l.hiddenByDefault; groups = @(@($l.groups) | Where-Object { $_ }) })
}
foreach ($l in $extractLayers) {
    $mine = $layers | Where-Object { $_.key -eq $l.key } | Select-Object -First 1
    if (-not $mine) { $layers.Add($l); continue }
    foreach ($g in @($l.groups)) {
        if (-not (@($mine.groups) | Where-Object { $_.key -eq $g.key })) { $mine.groups = @($mine.groups) + ,$g }
    }
}

$out = [ordered]@{
    schema = 1; units = "in"
    extent = [ordered]@{ w = [double]$doc.extent.w; h = [double]$doc.extent.h }
    items = $items.ToArray()
    areas = @($doc.areas | Where-Object { $_ })
}
if ($layers.Count -gt 0) { $out.layers = $layers.ToArray() }
$json = $out | ConvertTo-Json -Depth 8 -Compress
if ($json.Length -gt $LAYOUT_JSON_MAX_CHARS) { Fail "the layout is $($json.Length) characters; ARC's limit is $LAYOUT_JSON_MAX_CHARS." }

# Nothing already on the layout may be lost or changed on the way through.
$check = Read-Json $json
if (@($check.items).Count -ne $items.Count -or @($check.areas).Count -ne @($doc.areas | Where-Object { $_ }).Count) {
    Fail "the layout to write doesn't hold every item and area - nothing written."
}
for ($k = 0; $k -lt $before; $k++) {
    $a = $doc.items[$k]; $b = $check.items[$k]
    foreach ($f in "uid", "label", "x", "y", "w", "d", "rot", "componentId", "equipmentId", "locked") {
        if ("$($a.$f)" -cne "$($b.$f)") { Fail "existing item $($a.uid)'s $f would change ('$($a.$f)' -> '$($b.$f)') - nothing written." }
    }
}

Write-Host ("Writing {0} items ({1} new) to layout {2} ({3:N0} characters)..." -f $items.Count, ($items.Count - $before), $target.id, $json.Length) -ForegroundColor Cyan
Invoke-MgGraphRequest -Method PATCH -Uri "$graph/lists/$layoutsId/items/$($target.id)/fields" -ContentType "application/json; charset=utf-8" `
    -Body (@{ LayoutJson = $json } | ConvertTo-Json -Depth 2 -Compress) | Out-Null
$back = (Invoke-MgGraphRequest -Method GET -Uri "$graph/lists/$layoutsId/items/$($target.id)/fields?`$select=LayoutJson")["LayoutJson"]
if ($back -cne $json) { Fail "the layout read back DIFFERENT from what was written ($("$back".Length) vs $($json.Length) characters). Check it in ARC before editing it." }

Write-Host "    written and read back identical" -ForegroundColor Green
Write-Host "`nDone. Open Plant Map -> '$($target.fields.Title)' in ARC." -ForegroundColor Cyan
Write-Host "Shaped symbols are checked by their CollisionPolygon outline, everything else by its rectangle." -ForegroundColor Gray
if ($layers.Count -gt 0) { Write-Host "Layers: $(($layers | ForEach-Object { $_.title }) -join ', ') - tick them under Layers on the layout." -ForegroundColor Gray }
