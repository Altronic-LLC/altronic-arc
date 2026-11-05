<#
.SYNOPSIS
    Creates the three Panel SAP BOM Builder lists on ALTRONICPANELTEAM
    (BusinessIT#59). Idempotent; -WhatIf reports only.

.DESCRIPTION
    Mark Balent's standalone BOM builder, brought into ARC. ARC is the master
    for the parts and kits from now on (Tim, 2026-11-05); the PANEL Parts
    Database workbook loads them ONCE (load-panel-bom-lists.ps1) and retires.
    The internal names are the contract with src/api/panelBomParts.ts and
    src/api/panelBoms.ts:

    Panel BOM Parts                         one row per part
      Title (shown "SAP Part #")  text      ####-####-##, INDEXED
      AltronicPartNumber          text      MFG / Altronic #
      Description                 text
      Cluster                     number    0-9, required (drives SAP item numbers)
      Category                    text
      Standard, Preferred, DoNotQuote, Active   yes/no
      Datasheet                   text      file name
      QtyIfUsed                   number    "Qty if used" hint
      ** NO COST COLUMN ** - cost is SAP's, read through Fabric per viewer.

    Panel BOM Kits                          one row per kit
      Title (shown "Kit Name")    text      INDEXED, unique values
      Description, Category       text
      Standard, Preferred, Active yes/no
      Components                  multi-line plain text - JSON
                                  [{ qty, sap, mfg, desc }, ...]

    Panel BOMs                              saved BOMs
      Title (shown "Panel System #") text
      Notes                       multi-line plain text
      PanelOrderRef               single lookup -> Panel Order Headers (Title)
      Picks                       multi-line plain text - JSON { parts, kits }
      BomLines                    multi-line plain text - JSON snapshot

    Four things are load-bearing:

    - The JSON columns are MULTI-line (a kit's components run past 255
      characters) and must REPLACE, not append. Graph's
      appendChangesToExistingText answer has been wrong before (FAIT 89), so
      the check below writes a JSON value TWICE and confirms the second
      replaced the first.
    - PanelOrderRef is a SINGLE lookup: Graph hands back a bare
      PanelOrderRefLookupId, ARC writes a bare integer. The check writes one
      and reads both halves.
    - Graph cannot turn attachments off or take a list off the Quick Launch.
      Those are printed as manual steps at the end.
    - The lists get the panel site's permissions. Cost is not on them, so
      nothing here needs unique permissions.

    RUN IN YOUR OWN TERMINAL - the sign-in is interactive. If the Windows
    account window never appears (it can open behind VS Code), use -DeviceCode.

.EXAMPLE
    .\create-panel-bom-lists.ps1 -WhatIf
    .\create-panel-bom-lists.ps1
#>

[CmdletBinding()]
param(
    [switch]$WhatIf,
    [switch]$DeviceCode,
    # Panel Order Headers - the lookup target for a saved BOM's order.
    [string]$PanelOrdersListId = "8561acf4-b583-459b-aafd-2106803a70c7"
)

$ErrorActionPreference = "Stop"
Import-Module Microsoft.Graph.Authentication

$siteId = "coopermachineryservices.sharepoint.com,fdf31131-2076-4618-923b-a1856e6b0f2a,3eb6cb9c-6535-4c69-a8d7-e90b2f90a9eb"
$siteUrl = "https://coopermachineryservices.sharepoint.com/sites/ALTRONICPANELTEAM"
$graph = "https://graph.microsoft.com/v1.0/sites/$siteId"

$text = @{ text = @{ allowMultipleLines = $false; maxLength = 255 } }
$note = @{ text = @{ allowMultipleLines = $true; appendChangesToExistingText = $false; linesForEditing = 6; textType = "plain" } }
function Col($name, $display, $kind, $extra = @{}) {
    $c = @{ name = $name; displayName = $display } + $kind
    foreach ($k in $extra.Keys) { $c[$k] = $extra[$k] }
    return $c
}
$yesNo = @{ boolean = @{} }

$LISTS = @(
    @{
        name = "Panel BOM Parts"; env = "VITE_SP_PANEL_BOM_PARTS_LIST_ID"; title = "SAP Part #"; titleUnique = $false
        columns = @(
            (Col "AltronicPartNumber" "MFG / Altronic #" $text),
            (Col "Description" "Description" $text),
            (Col "Cluster" "Cluster" @{ number = @{ decimalPlaces = "none"; minimum = 0; maximum = 9 } } @{ required = $true
                description = "0-9. Sets where the part's SAP item number falls on a BOM." }),
            (Col "Category" "Category" $text),
            (Col "Standard" "Standard" $yesNo),
            (Col "Preferred" "Preferred" $yesNo),
            (Col "DoNotQuote" "Do Not Quote" $yesNo),
            (Col "Datasheet" "Datasheet" $text),
            (Col "QtyIfUsed" "Qty If Used" @{ number = @{ decimalPlaces = "automatic" } } @{ description = "The usual quantity when the part is used. A hint in the builder." }),
            (Col "Active" "Active" $yesNo @{ description = "No = retired: off the builder's picker, kept on BOMs that use it." })
        )
    },
    @{
        name = "Panel BOM Kits"; env = "VITE_SP_PANEL_BOM_KITS_LIST_ID"; title = "Kit Name"; titleUnique = $true
        columns = @(
            (Col "Description" "Description" $text),
            (Col "Category" "Category" $text),
            (Col "Standard" "Standard" $yesNo),
            (Col "Preferred" "Preferred" $yesNo),
            (Col "Active" "Active" $yesNo),
            (Col "Components" "Components" $note @{ description = "ARC writes this. JSON: [{ qty, sap, mfg, desc }]." })
        )
    },
    @{
        name = "Panel BOMs"; env = "VITE_SP_PANEL_BOMS_LIST_ID"; title = "Panel System #"; titleUnique = $false
        columns = @(
            (Col "Notes" "Notes" $note),
            (Col "PanelOrderRef" "Panel Order" @{ lookup = @{ listId = $PanelOrdersListId; columnName = "Title" } }),
            (Col "Picks" "Picks" $note @{ description = "ARC writes this. JSON: what was picked." }),
            (Col "BomLines" "BOM Lines" $note @{ description = "ARC writes this. JSON: the SAP lines when last saved." })
        )
    }
)

# --- auth -------------------------------------------------------------------
$ctx = Get-MgContext
if (-not $ctx -or $ctx.Scopes -notcontains "Sites.Manage.All") {
    Write-Host "Signing in for write access (Sites.Manage.All)..." -ForegroundColor Cyan
    if ($DeviceCode) { Connect-MgGraph -Scopes "Sites.Manage.All" -UseDeviceCode -NoWelcome }
    else             { Connect-MgGraph -Scopes "Sites.Manage.All" -NoWelcome }
}
if ($WhatIf) { Write-Host "`n*** -WhatIf: nothing will be changed ***" -ForegroundColor Magenta }

# --- find the lists (paged: an unpaged call silently returns a subset) ------
$byName = @{}
$uri = "$graph/lists?`$select=id,displayName&`$top=200"
while ($uri) {
    $page = Invoke-MgGraphRequest -Method GET -Uri $uri
    foreach ($l in $page.value) { $byName[$l.displayName] = $l.id }
    $uri = $page["@odata.nextLink"]
}

$ids = @{}
foreach ($spec in $LISTS) {
    Write-Host "`n=== $($spec.name) ===" -ForegroundColor Cyan
    $listId = $byName[$spec.name]
    if ($listId) {
        Write-Host "  EXISTS  ($listId)" -ForegroundColor Yellow
    } elseif ($WhatIf) {
        Write-Host "  WOULD CREATE with $($spec.columns.Count) columns; Title shown as '$($spec.title)', indexed" -ForegroundColor Cyan
        continue
    } else {
        Write-Host "  CREATE..." -ForegroundColor Green
        $body = @{ displayName = $spec.name; list = @{ template = "genericList" }; columns = $spec.columns } | ConvertTo-Json -Depth 8
        $listId = (Invoke-MgGraphRequest -Method POST -Uri "$graph/lists" -Body $body -ContentType "application/json")["id"]
    }
    $ids[$spec.name] = $listId

    $have = (Invoke-MgGraphRequest -Method GET -Uri "$graph/lists/$listId/columns").value
    foreach ($c in $spec.columns) {
        if (-not ($have | Where-Object { $_["name"] -eq $c.name })) {
            if ($WhatIf) { Write-Host "    WOULD ADD    $($c.name)" -ForegroundColor Cyan; continue }
            Invoke-MgGraphRequest -Method POST -Uri "$graph/lists/$listId/columns" `
                -Body ($c | ConvertTo-Json -Depth 6) -ContentType "application/json" | Out-Null
            Write-Host "    added        $($c.name)" -ForegroundColor Green
        }
    }

    # Title: renamed and indexed; the kits' must be unique (a pick finds a kit by name).
    $title = $have | Where-Object { $_["name"] -eq "Title" }
    $patch = @{ displayName = $spec.title; indexed = $true }
    if ($spec.titleUnique) { $patch.enforceUniqueValues = $true }
    if ($WhatIf) { Write-Host "    WOULD SET    Title -> '$($spec.title)', indexed$(if ($spec.titleUnique) { ', unique' })" -ForegroundColor Cyan }
    else {
        try {
            Invoke-MgGraphRequest -Method PATCH -Uri "$graph/lists/$listId/columns/$($title["id"])" `
                -Body ($patch | ConvertTo-Json) -ContentType "application/json" | Out-Null
            Write-Host "    Title shown as '$($spec.title)', indexed$(if ($spec.titleUnique) { ', unique' })" -ForegroundColor Green
        } catch {
            Write-Host "    Title: couldn't set everything ($($_.Exception.Message)) - set it in List settings" -ForegroundColor Yellow
        }
    }
}

if ($WhatIf) { Write-Host "`n-WhatIf - nothing was changed.`n" -ForegroundColor Yellow; exit 0 }

# --- write and read back ----------------------------------------------------
Write-Host "`n=== Write/read-back check ===" -ForegroundColor Cyan
$bad = @()
$long = ("x" * 400)

# Parts: every column, then a cleared number.
$partsId = $ids["Panel BOM Parts"]
$partFields = @{ Title = "9999-9999-99"; AltronicPartNumber = "ARC-VERIFY"; Description = "ARC-VERIFY (safe to delete)"
    Cluster = 7; Category = "ARC check"; Standard = $true; Preferred = $false; DoNotQuote = $true
    Datasheet = "verify.pdf"; QtyIfUsed = 2.5; Active = $true }
$row = Invoke-MgGraphRequest -Method POST -Uri "$graph/lists/$partsId/items" -ContentType "application/json" -Body (@{ fields = $partFields } | ConvertTo-Json -Depth 4)
try {
    $f = (Invoke-MgGraphRequest -Method GET -Uri "$graph/lists/$partsId/items/$($row.id)?`$expand=fields").fields
    foreach ($k in $partFields.Keys) {
        if ("$($f[$k])" -ne "$($partFields[$k])") { $bad += "Parts.$k = '$($f[$k])' (wrote '$($partFields[$k])')" }
    }
} finally { Invoke-MgGraphRequest -Method DELETE -Uri "$graph/lists/$partsId/items/$($row.id)" | Out-Null }

# Kits: a long Components value, written TWICE - the second must replace.
$kitsId = $ids["Panel BOM Kits"]
$first = "[{`"qty`":1,`"sap`":`"9999-9999-99`",`"mfg`":`"A`",`"desc`":`"$long`"}]"
$second = "[{`"qty`":2,`"sap`":`"`",`"mfg`":`"B`",`"desc`":`"second`"}]"
$row = Invoke-MgGraphRequest -Method POST -Uri "$graph/lists/$kitsId/items" -ContentType "application/json" `
    -Body (@{ fields = @{ Title = "KIT-ARC-VERIFY"; Components = $first; Active = $true } } | ConvertTo-Json -Depth 4)
try {
    $f = (Invoke-MgGraphRequest -Method GET -Uri "$graph/lists/$kitsId/items/$($row.id)?`$expand=fields(`$select=Components)").fields
    if ("$($f.Components)" -ne $first) { $bad += "Kits.Components didn't read back whole ($("$($f.Components)".Length) of $($first.Length) characters)" }
    Invoke-MgGraphRequest -Method PATCH -Uri "$graph/lists/$kitsId/items/$($row.id)/fields" -ContentType "application/json" `
        -Body (@{ Components = $second } | ConvertTo-Json) | Out-Null
    $f = (Invoke-MgGraphRequest -Method GET -Uri "$graph/lists/$kitsId/items/$($row.id)?`$expand=fields(`$select=Components)").fields
    if ("$($f.Components)" -ne $second) { $bad += "Kits.Components APPENDED instead of replacing - turn off 'Append Changes to Existing Text' in List settings" }
} finally { Invoke-MgGraphRequest -Method DELETE -Uri "$graph/lists/$kitsId/items/$($row.id)" | Out-Null }

# BOMs: the order lookup (bare integer, both halves) and a long Picks.
$bomsId = $ids["Panel BOMs"]
$order = (Invoke-MgGraphRequest -Method GET -Uri "$graph/lists/$PanelOrdersListId/items?`$select=id&`$top=1").value | Select-Object -First 1
$bomFields = @{ Title = "ARC-VERIFY (safe to delete)"; Picks = "{`"parts`":{`"9999-9999-99`":1},`"kits`":{},`"pad`":`"$long`"}"; BomLines = "{}" }
if ($order) { $bomFields.PanelOrderRefLookupId = [int]$order.id }
$row = Invoke-MgGraphRequest -Method POST -Uri "$graph/lists/$bomsId/items" -ContentType "application/json" -Body (@{ fields = $bomFields } | ConvertTo-Json -Depth 4)
try {
    $f = (Invoke-MgGraphRequest -Method GET -Uri "$graph/lists/$bomsId/items/$($row.id)?`$expand=fields(`$select=Title,Picks,PanelOrderRef,PanelOrderRefLookupId)").fields
    if ("$($f.Picks)" -ne $bomFields.Picks) { $bad += "BOMs.Picks didn't read back whole" }
    if ($order -and [int]"$($f.PanelOrderRefLookupId)" -ne [int]$order.id) { $bad += "BOMs.PanelOrderRefLookupId = '$($f.PanelOrderRefLookupId)' (wrote $($order.id))" }
    if (-not $order) { Write-Host "  No Panel Order exists yet, so the order link wasn't tested." -ForegroundColor Yellow }
    # Unlinking writes null.
    Invoke-MgGraphRequest -Method PATCH -Uri "$graph/lists/$bomsId/items/$($row.id)/fields" -ContentType "application/json" `
        -Body (@{ PanelOrderRefLookupId = $null } | ConvertTo-Json) | Out-Null
    $f = (Invoke-MgGraphRequest -Method GET -Uri "$graph/lists/$bomsId/items/$($row.id)?`$expand=fields(`$select=PanelOrderRefLookupId)").fields
    if ($f.PanelOrderRefLookupId) { $bad += "BOMs.PanelOrderRef did not clear" }
} finally { Invoke-MgGraphRequest -Method DELETE -Uri "$graph/lists/$bomsId/items/$($row.id)" | Out-Null }

if ($bad) {
    Write-Host "  These did NOT read back as written - fix before using ARC:" -ForegroundColor Red
    $bad | ForEach-Object { Write-Host "    $_" -ForegroundColor Red }
} else {
    Write-Host "  Every column wrote and read back correctly; the JSON columns replace, not append (test rows deleted)." -ForegroundColor Green
}

# --- manual steps + next ----------------------------------------------------
Write-Host "`nMANUAL STEPS - Graph cannot set these:" -ForegroundColor Yellow
Write-Host "  Site contents: $siteUrl/_layouts/15/viewlsts.aspx" -ForegroundColor Yellow
Write-Host "  For each of the three lists:" -ForegroundColor Yellow
Write-Host "    List settings -> Advanced settings -> Attachments to list items = Disabled" -ForegroundColor Yellow
Write-Host "    List settings -> List name, description and navigation -> Display this list on the Quick Launch = No" -ForegroundColor Yellow
Write-Host "  Do NOT hide the lists - a hidden list disappears from Site contents too." -ForegroundColor Yellow

Write-Host "`n=== Next ===" -ForegroundColor Cyan
foreach ($spec in $LISTS) { Write-Host "  $($spec.env) = $($ids[$spec.name])" -ForegroundColor Green }
Write-Host "  Add them to .env.local (restart npm run dev) and as repo variables, then redeploy." -ForegroundColor Gray
Write-Host "  Then load the parts and kits: scripts/prepare-panel-bom-load.mjs, then scripts/load-panel-bom-lists.ps1." -ForegroundColor Gray
