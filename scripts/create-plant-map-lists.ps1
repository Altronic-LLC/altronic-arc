<#
.SYNOPSIS
    Creates the Plant Map lists and library on Altronic_PMO (Operations):
    "Plant Map Roles", "Layout Components", "Plant Layouts" and the
    "Plant Layout Files" document library. Idempotent; -WhatIf reports only.

.DESCRIPTION
    The Plant Map draws the plant's layouts to scale over each building's walls
    drawing. Everything is in INCHES.

      Plant Map Roles     Title (shown "Email"), PersonName, Roles (lowercase
                          CSV: viewer, editor, admin), Note
      Layout Components   Title (shown "Name"), ComponentKey, Category (choice),
                          SvgMarkup (the symbol, viewBox in inches), FootprintW,
                          FootprintD, AllowResize, AllowRotate, MinScale,
                          MaxScale, Collides, Clearance, DefaultStroke,
                          DefaultFill, Version, IsActive, CollisionPolygon
                          (JSON [[x, y], ...] in the symbol's inches - its
                          real shape when it isn't a rectangle)
      Plant Layouts       Title (shown "Layout"), Building (indexed; the
                          Layouts list's tabs), Area, LayoutKey (indexed;
                          groups a layout's versions), Status (choice: Draft /
                          Published / Superseded), Version, WallsFile (drive
                          item id), LayoutJson (the whole layout), SupersedesId
      Plant Layout Files  document library; walls drawings go in walls/

    The internal names are the contract with src/api/plantLayouts.ts,
    src/api/layoutComponents.ts and src/api/plantMapRoles.ts.

    Five things are load-bearing:

    - The name column on Plant Map Roles is PersonName, never DisplayName:
      Graph silently drops a listItem field of that name.
    - LayoutJson, SvgMarkup and CollisionPolygon are PLAIN multi-line text with Append Changes
      OFF. ARC rewrites the whole value on every save; append mode would
      concatenate it into something unreadable. Graph's answer about that flag
      has been wrong before (FAIT 89), so after the first real save, open the
      row's version history and check the value was REPLACED.
    - Status and Category are strict choices (allowTextEntry off). Their
      choices are src/types/plant.ts PLANT_LAYOUT_STATUSES and
      LAYOUT_COMPONENT_CATEGORIES - change both together. A re-run ADDS
      any choice listed here that the column is missing (and reads it back);
      it never removes one.
    - Layout Components is SEEDED (unless -NoSeed) from src/data/plantComponentSeed.json ONLY
      while it is EMPTY. After that the list is the source of truth, and a
      re-run must never put back a symbol somebody retired.
    - Every column is then WRITTEN AND READ BACK with a throwaway row (and the
      row deleted). A 2xx from a write is not evidence the value landed.

    Permissions are set by hand afterwards (Graph can't): everyone READ on all
    four; Plant Map editors and admins EDIT on Plant Layouts and Plant Layout
    Files; Plant Map admins EDIT on Layout Components and Plant Map Roles.

    RUN IN YOUR OWN TERMINAL - the sign-in is interactive.

.PARAMETER NoSeed
    Don't seed the 12 starter symbols into an empty Layout Components list -
    for a library that will be loaded from CAD instead
    (load-plant-cad-extract.ps1).

.EXAMPLE
    .\create-plant-map-lists.ps1 -WhatIf
    .\create-plant-map-lists.ps1
    .\create-plant-map-lists.ps1 -NoSeed
#>

[CmdletBinding()]
param(
    [switch]$WhatIf,
    [switch]$NoSeed,
    [switch]$DeviceCode
)

$ErrorActionPreference = "Stop"
Import-Module Microsoft.Graph.Authentication

$siteId = "coopermachineryservices.sharepoint.com,915a6183-2b71-4dfd-a8b9-181126dfbe78,3eb6cb9c-6535-4c69-a8d7-e90b2f90a9eb"
$graph = "https://graph.microsoft.com/v1.0/sites/$siteId"
$ROLES_NAME = "Plant Map Roles"
$COMPONENTS_NAME = "Layout Components"
$LAYOUTS_NAME = "Plant Layouts"
$FILES_NAME = "Plant Layout Files"
$seedPath = Join-Path $PSScriptRoot "..\src\data\plantComponentSeed.json"

$plainNote = @{ allowMultipleLines = $true; appendChangesToExistingText = $false; linesForEditing = 6; textType = "plain" }
$decimal = @{ decimalPlaces = "automatic" }
$whole = @{ decimalPlaces = "none" }

$roleColumns = @(
    @{ name = "PersonName"; displayName = "Name"; text = @{} },
    @{ name = "Roles"; displayName = "Roles"; text = @{}
       description = "Lowercase, comma-separated: editor, admin. Managed in ARC under Plant Map > Roles." },
    @{ name = "Note"; displayName = "Note"; text = $plainNote }
)

$componentColumns = @(
    @{ name = "ComponentKey"; displayName = "Key"; text = @{}
       description = "A stable text key, e.g. cnc-vmc-120x96." },
    @{ name = "Category"; displayName = "Category"; defaultValue = @{ value = "Other" }
       choice = @{ allowTextEntry = $false; displayAs = "dropDownMenu"; choices = @("Desk", "Machine", "Bench", "Rack", "Storage", "Safety", "Utility", "Zone", "Other") } },
    @{ name = "SvgMarkup"; displayName = "Symbol (SVG)"; text = $plainNote
       description = "The symbol as SVG, viewBox 0 0 FootprintW FootprintD in inches. ARC sanitises it before drawing." },
    @{ name = "FootprintW"; displayName = "Width (in)"; number = $decimal },
    @{ name = "FootprintD"; displayName = "Depth (in)"; number = $decimal },
    @{ name = "AllowResize"; displayName = "Allow Resize"; boolean = @{} },
    @{ name = "AllowRotate"; displayName = "Allow Rotate"; boolean = @{} },
    @{ name = "MinScale"; displayName = "Min Scale"; number = $decimal },
    @{ name = "MaxScale"; displayName = "Max Scale"; number = $decimal },
    @{ name = "Collides"; displayName = "Collides"; boolean = @{}
       description = "No for floor markings and zones, which may sit under other items." },
    @{ name = "Clearance"; displayName = "Clearance (in)"; number = $decimal },
    @{ name = "DefaultStroke"; displayName = "Default Stroke"; text = @{} },
    @{ name = "DefaultFill"; displayName = "Default Fill"; text = @{} },
    @{ name = "Version"; displayName = "Version"; number = $whole },
    @{ name = "IsActive"; displayName = "Active"; boolean = @{}
       description = "Untick to retire a symbol. Layouts already using it keep it." },
    @{ name = "CollisionPolygon"; displayName = "Collision Outline"; text = $plainNote
       description = "The symbol's real shape when it isn't a rectangle: JSON [[x, y], ...] in the symbol's inches. Blank = the footprint rectangle." }
)

$layoutColumns = @(
    @{ name = "Building"; displayName = "Building"; text = @{}; indexed = $true
       description = "The building the layout is in. A new name starts a new building." },
    @{ name = "Area"; displayName = "Area"; text = @{} },
    @{ name = "LayoutKey"; displayName = "Layout Key"; text = @{}; indexed = $true
       description = "Groups the versions of one layout. Set by ARC." },
    @{ name = "Status"; displayName = "Status"; defaultValue = @{ value = "Draft" }
       choice = @{ allowTextEntry = $false; displayAs = "dropDownMenu"; choices = @("Draft", "Published", "Superseded") } },
    @{ name = "Version"; displayName = "Version"; number = $whole },
    @{ name = "WallsFile"; displayName = "Walls File"; text = @{}
       description = "Drive item id of the walls drawing in Plant Layout Files. Set by ARC." },
    @{ name = "LayoutJson"; displayName = "Layout (JSON)"; text = $plainNote
       description = "The whole layout, written by ARC. Don't edit by hand." },
    @{ name = "SupersedesId"; displayName = "Supersedes"; number = $whole
       description = "The id of the version this one replaces." }
)

# --- auth -------------------------------------------------------------------
$ctx = Get-MgContext
if (-not $ctx -or $ctx.Scopes -notcontains "Sites.Manage.All") {
    Write-Host "Signing in for write access (Sites.Manage.All)..." -ForegroundColor Cyan
    if ($DeviceCode) { Connect-MgGraph -Scopes "Sites.Manage.All" -UseDeviceCode -NoWelcome }
    else             { Connect-MgGraph -Scopes "Sites.Manage.All" -NoWelcome }
}
if ($WhatIf) { Write-Host "`n*** -WhatIf: nothing will be changed ***" -ForegroundColor Magenta }

# --- find existing lists (paged: an unpaged call silently returns a subset) --
$found = @{}
$uri = "$graph/lists?`$select=id,displayName&`$top=200"
while ($uri) {
    $page = Invoke-MgGraphRequest -Method GET -Uri $uri
    foreach ($l in $page.value) { $found[$l.displayName] = $l.id }
    $uri = $page["@odata.nextLink"]
}

function Ensure-List($name, $columns, $template = "genericList") {
    $id = $found[$name]
    if ($id) { Write-Host "  EXISTS  $name ($id)" -ForegroundColor Yellow; return $id }
    if ($WhatIf) { Write-Host "  WOULD CREATE  $name ($template) with $($columns.Count) columns" -ForegroundColor Cyan; return $null }
    Write-Host "  CREATE  $name..." -ForegroundColor Green
    $body = @{ displayName = $name; list = @{ template = $template } }
    if ($columns.Count -gt 0) { $body.columns = $columns }
    $created = Invoke-MgGraphRequest -Method POST -Uri "$graph/lists" -Body ($body | ConvertTo-Json -Depth 8) -ContentType "application/json"
    return $created["id"]
}

function Ensure-Columns($listId, $label, $columns) {
    $have = (Invoke-MgGraphRequest -Method GET -Uri "$graph/lists/$listId/columns").value
    foreach ($c in $columns) {
        $existing = $have | Where-Object { $_["name"] -eq $c.name }
        if (-not $existing) {
            if ($WhatIf) { Write-Host "    WOULD ADD  $label / $($c.name)" -ForegroundColor Cyan; continue }
            Invoke-MgGraphRequest -Method POST -Uri "$graph/lists/$listId/columns" `
                -Body ($c | ConvertTo-Json -Depth 6) -ContentType "application/json" | Out-Null
            Write-Host "    added      $label / $($c.name)" -ForegroundColor Green
        } elseif ($c.indexed -and -not $existing["indexed"]) {
            if ($WhatIf) { Write-Host "    WOULD INDEX  $label / $($c.name)" -ForegroundColor Cyan; continue }
            Invoke-MgGraphRequest -Method PATCH -Uri "$graph/lists/$listId/columns/$($existing["id"])" `
                -Body (@{ indexed = $true } | ConvertTo-Json) -ContentType "application/json" | Out-Null
            Write-Host "    indexed    $label / $($c.name)" -ForegroundColor Green
        }
        # A strict choice column refuses a value it doesn't declare, so a
        # choice added here must reach a column created before it. Choices are
        # only ever ADDED: one somebody added in SharePoint is kept.
        if ($existing -and $c.choice -and $existing["choice"]) {
            $haveChoices = @($existing["choice"]["choices"])
            $missing = @($c.choice.choices | Where-Object { $haveChoices -notcontains $_ })
            if ($missing.Count -gt 0) {
                if ($WhatIf) { Write-Host "    WOULD ADD CHOICES  $label / $($c.name): $($missing -join ', ')" -ForegroundColor Cyan; continue }
                $merged = @($haveChoices + $missing)
                Invoke-MgGraphRequest -Method PATCH -Uri "$graph/lists/$listId/columns/$($existing["id"])" -ContentType "application/json" `
                    -Body (@{ choice = @{ allowTextEntry = $false; displayAs = $existing["choice"]["displayAs"]; choices = $merged } } | ConvertTo-Json -Depth 4) | Out-Null
                $after = @((Invoke-MgGraphRequest -Method GET -Uri "$graph/lists/$listId/columns/$($existing["id"])")["choice"]["choices"])
                $still = @($missing | Where-Object { $after -notcontains $_ })
                if ($still.Count -gt 0) { throw "$label / $($c.name): choices $($still -join ', ') did not stick." }
                Write-Host "    choices    $label / $($c.name) + $($missing -join ', ')" -ForegroundColor Green
            }
        }
    }
}

function Set-TitleColumn($listId, $displayName, [bool]$required) {
    $title = (Invoke-MgGraphRequest -Method GET -Uri "$graph/lists/$listId/columns").value |
        Where-Object { $_["name"] -eq "Title" }
    if ($WhatIf) { Write-Host "    WOULD SET  Title -> '$displayName'" -ForegroundColor Cyan; return }
    Invoke-MgGraphRequest -Method PATCH -Uri "$graph/lists/$listId/columns/$($title["id"])" `
        -Body (@{ displayName = $displayName; required = $required } | ConvertTo-Json) -ContentType "application/json" | Out-Null
    Write-Host "    Title shown as '$displayName'" -ForegroundColor Green
}

Write-Host "`n=== $ROLES_NAME ===" -ForegroundColor Cyan
$rolesId = Ensure-List $ROLES_NAME $roleColumns
if ($rolesId) { Ensure-Columns $rolesId $ROLES_NAME $roleColumns; Set-TitleColumn $rolesId "Email" $true }

Write-Host "`n=== $COMPONENTS_NAME ===" -ForegroundColor Cyan
$componentsId = Ensure-List $COMPONENTS_NAME $componentColumns
if ($componentsId) { Ensure-Columns $componentsId $COMPONENTS_NAME $componentColumns; Set-TitleColumn $componentsId "Name" $true }

Write-Host "`n=== $LAYOUTS_NAME ===" -ForegroundColor Cyan
$layoutsId = Ensure-List $LAYOUTS_NAME $layoutColumns
if ($layoutsId) { Ensure-Columns $layoutsId $LAYOUTS_NAME $layoutColumns; Set-TitleColumn $layoutsId "Layout" $true }

Write-Host "`n=== $FILES_NAME ===" -ForegroundColor Cyan
$filesId = Ensure-List $FILES_NAME @() "documentLibrary"
if ($filesId -and -not $WhatIf) {
    $drive = Invoke-MgGraphRequest -Method GET -Uri "$graph/lists/$filesId/drive?`$select=id"
    try {
        Invoke-MgGraphRequest -Method POST -Uri "https://graph.microsoft.com/v1.0/drives/$($drive.id)/root/children" `
            -Body (@{ name = "walls"; folder = @{}; "@microsoft.graph.conflictBehavior" = "fail" } | ConvertTo-Json) `
            -ContentType "application/json" | Out-Null
        Write-Host "    folder     walls/ created" -ForegroundColor Green
    } catch {
        if ("$_" -match "nameAlreadyExists|409") { Write-Host "    folder     walls/ exists" -ForegroundColor Yellow }
        else { throw }
    }
}

# --- seed the symbol library, ONLY while it is empty --------------------------
if ($componentsId -and -not $WhatIf -and $NoSeed) {
    Write-Host "`n  -NoSeed: not seeding the starter symbols." -ForegroundColor Yellow
} elseif ($componentsId -and -not $WhatIf) {
    $any = Invoke-MgGraphRequest -Method GET -Uri "$graph/lists/$componentsId/items?`$top=1"
    if ($any.value.Count -gt 0) {
        Write-Host "`n  Layout Components already has symbols - not seeding (the list is the source of truth)." -ForegroundColor Yellow
    } else {
        $seed = Get-Content -Raw -Encoding UTF8 $seedPath | ConvertFrom-Json
        Write-Host "`n=== Seeding $($seed.Count) symbols ===" -ForegroundColor Cyan
        foreach ($s in $seed) {
            $fields = @{
                Title = $s.Title; ComponentKey = $s.key; Category = $s.Category; SvgMarkup = $s.SvgMarkup
                FootprintW = $s.FootprintW; FootprintD = $s.FootprintD; AllowResize = $s.AllowResize; AllowRotate = $s.AllowRotate
                MinScale = $s.MinScale; MaxScale = $s.MaxScale; Collides = $s.Collides; Clearance = $s.Clearance
                DefaultStroke = $s.DefaultStroke; DefaultFill = $s.DefaultFill; Version = $s.Version; IsActive = $s.IsActive
            }
            if ($s.CollisionPolygon) { $fields.CollisionPolygon = (ConvertTo-Json -InputObject @($s.CollisionPolygon) -Compress -Depth 3) }
            Invoke-MgGraphRequest -Method POST -Uri "$graph/lists/$componentsId/items" -ContentType "application/json" `
                -Body (@{ fields = $fields } | ConvertTo-Json -Depth 4) | Out-Null
            Write-Host "    seeded     $($s.Title)" -ForegroundColor Green
        }
    }
}

# --- write and read back every column ---------------------------------------
function Compare-Field($label, $wrote, $got) {
    if ($wrote -is [double] -or $wrote -is [int]) {
        if ([Math]::Abs([double]$got - [double]$wrote) -gt 1e-9) { return "$label = '$got' (wrote '$wrote')" }
    } elseif ($wrote -is [bool]) {
        if ([bool]$got -ne $wrote) { return "$label = '$got' (wrote '$wrote')" }
    } elseif ("$got" -ne "$wrote") { return "$label = '$got' (wrote '$wrote')" }
    return $null
}

function Test-ReadBack($listId, $label, $fields) {
    $row = Invoke-MgGraphRequest -Method POST -Uri "$graph/lists/$listId/items" -ContentType "application/json" `
        -Body (@{ fields = $fields } | ConvertTo-Json -Depth 4)
    $back = Invoke-MgGraphRequest -Method GET -Uri "$graph/lists/$listId/items/$($row.id)?`$expand=fields"
    $problems = @()
    foreach ($k in $fields.Keys) {
        $p = Compare-Field "$label $k" $fields[$k] $back.fields[$k]
        if ($p) { $problems += $p }
    }
    Invoke-MgGraphRequest -Method DELETE -Uri "$graph/lists/$listId/items/$($row.id)" | Out-Null
    return $problems
}

if (-not $WhatIf -and $rolesId -and $componentsId -and $layoutsId) {
    Write-Host "`n=== Write/read-back check ===" -ForegroundColor Cyan
    $json = '{"schema":1,"units":"in","extent":{"w":100,"h":50},"items":[]}'
    # Collected then filtered: a function that finds nothing returns $null, and
    # several $nulls in an array would otherwise read as "problems".
    $results = @()
    $results += Test-ReadBack $rolesId "roles" @{ Title = "verify@example.com"; PersonName = "ARC Verify"; Roles = "editor,admin"; Note = "verify" }
    $results += Test-ReadBack $componentsId "components" @{
        Title = "ARC-VERIFY"; ComponentKey = "arc-verify"; Category = "Machine"; SvgMarkup = '<svg viewBox="0 0 10 5"><rect width="10" height="5"/></svg>'
        FootprintW = 10; FootprintD = 5; AllowResize = $true; AllowRotate = $true; MinScale = 0.5; MaxScale = 2; Collides = $false
        Clearance = 6; DefaultStroke = "#374151"; DefaultFill = "#f3f4f6"; Version = 1; IsActive = $false
        CollisionPolygon = "[[0,0],[10,0],[10,2],[4,2],[4,5],[0,5]]"
    }
    $results += Test-ReadBack $layoutsId "layouts" @{
        Title = "ARC-VERIFY"; Building = "ARC-VERIFY"; Area = "verify"; LayoutKey = "arc-verify"; Status = "Superseded"; Version = 2
        WallsFile = "VERIFY"; LayoutJson = $json; SupersedesId = 1
    }
    $bad = @($results | Where-Object { $_ })
    if ($bad.Count -gt 0) {
        Write-Host "  These did NOT read back as written - fix before using ARC:" -ForegroundColor Red
        $bad | ForEach-Object { Write-Host "    $_" -ForegroundColor Red }
    } else {
        Write-Host "  Every column wrote and read back correctly (test rows deleted)." -ForegroundColor Green
    }
}

Write-Host "`n=== Next ===" -ForegroundColor Cyan
if ($rolesId)      { Write-Host "  VITE_SP_PLANT_MAP_ROLES_LIST_ID = $rolesId" -ForegroundColor Green }
if ($componentsId) { Write-Host "  VITE_SP_LAYOUT_COMPONENTS_LIST_ID = $componentsId" -ForegroundColor Green }
if ($layoutsId)    { Write-Host "  VITE_SP_PLANT_LAYOUTS_LIST_ID = $layoutsId" -ForegroundColor Green }
if ($filesId)      { Write-Host "  VITE_SP_PLANT_LAYOUT_FILES_LIST_ID = $filesId" -ForegroundColor Green }
Write-Host "  Set all four as repo variables (and in .env.local) and redeploy." -ForegroundColor Gray
Write-Host "  Then set the list permissions by hand (see the help above), and add" -ForegroundColor Gray
Write-Host "  yourself in ARC: Operations > Plant Map > Roles (an ARC admin can)." -ForegroundColor Gray
Write-Host "  VITE_PLANT_MAP_LIVE=true opens it to everyone; until then it's a pilot." -ForegroundColor Gray
