<#
.SYNOPSIS
    Creates the two lists behind ARC's Altronic Component List tool, on the
    Altronic_Engineering site.

.DESCRIPTION
    Replaces 175 legacy per-prefix lists (the "101" ... "915" lists, "610/615",
    and the HOC lists "Surface Mount Parts" / "Through Hole Parts" / "SIL Parts")
    with two:

        Altronic Part List        every part whose number does NOT start 601,
                                  611, 701, 711, 712 or 722
            Title                   Altronic Part # (the key — built-in column)
            Description             text
            DateAssigned            date only
            DrawingSize             text
            DateDrawing             date only
            Manufacturer            text
            MfgPartNumber           text
            Notes                   multi-line plain
            AssignedBy              text (initials or a name, as entered)
            PrototypeOrProduction   choice — Prototype / Production
            Purchased               choice — Purchased / Not Purchased
            SAPNumber               text
            ItemValue               text
            SignOffStatus           choice — Pending SAP / Approved (2-step)
            LegacySource            text — "<old list>#<old item id>"

        Altronic Component List   the HOC parts: 601/611 Through Hole,
                                  701/711/712 Surface Mount, 722 SIL
            Title                   Altronic Part #
            Category                choice — Surface Mount / Through Hole / SIL
            Description             text
            MfgName, MfgNumber      text
            RatingA, RatingB, RatingC, TempMin, TempMax, Tolerance, Footprint  text
            Notes                   multi-line plain
            HasDataSheet            yes/no
            SignOffStatus           choice — Pending Engineering Review /
                                    Pending SAP / Approved (3-step)
            LegacySource            text

    Why these are NEW lists rather than the "Master Part List" / "Component
    List" built from exports: a column's internal name is fixed when it is
    created, and those lists' columns are all field_1 ... field_15. Rebuilding
    is the only way to get names that mean something (see the ECNs and MRB
    lists in CLAUDE.md for what living with field_N costs).

    Blank SignOffStatus is deliberate on legacy rows — they predate the
    approval tracking, and loading them as "Approved" would record approvals
    nobody gave. There is no list default for the same reason: ARC sets the
    status explicitly on every part it creates.

    Title, LegacySource and SignOffStatus (and Category) are INDEXED. The Part
    List holds ~14,000 rows — past SharePoint's 5,000-item threshold, where a
    filter on an unindexed column is refused outright. Unique values are NOT
    enforced on Title: the legacy data carries 20 duplicated part numbers that
    a person has to resolve first.

    Idempotent: an existing list is left alone and only missing columns are
    added. Load the data with load-altronic-parts-lists.ps1.

.PARAMETER WhatIf
    Print what would be created without creating anything.

.EXAMPLE
    ./scripts/create-altronic-parts-lists.ps1 -WhatIf

.NOTES
    Needs Sites.Manage.All — creating a list is a write, and needs Manage Lists
    rights on the site (ARC's own Sites.Selected grant does not include that).
#>
param(
    [switch]$WhatIf
)

$ErrorActionPreference = "Stop"

# Mirrored from src/api/config.ts (SITES.engineering).
$EngineeringSite = "coopermachineryservices.sharepoint.com,ddb5fc80-ea51-4d56-b008-ce6a82af49b0,aa6b9467-3f57-4213-bbd4-60b94403421a"

function Text($name, $display, [switch]$Multi, [switch]$Indexed) {
    $c = @{ name = $name; displayName = $display; text = @{ allowMultipleLines = [bool]$Multi } }
    if ($Multi) { $c.text.textType = "plain" }
    if ($Indexed) { $c.indexed = $true }
    $c
}
function Choice($name, $display, [string[]]$choices, [switch]$Indexed) {
    $c = @{
        name = $name; displayName = $display
        choice = @{ choices = $choices; displayAs = "dropDownMenu"; allowTextEntry = $false }
    }
    if ($Indexed) { $c.indexed = $true }
    $c
}
function DateOnly($name, $display) {
    @{ name = $name; displayName = $display; dateTime = @{ format = "dateOnly"; displayAs = "standard" } }
}

$Lists = @(
    @{
        name        = "Altronic Part List"
        envVar      = "VITE_SP_ALTRONIC_PART_LIST_ID"
        description = "Every Altronic part number except the HOC components (601/611/701/711/712/722). Title = Altronic Part #."
        columns     = @(
            (Text "Description" "Description"),
            (DateOnly "DateAssigned" "Date Assigned"),
            (Text "DrawingSize" "Drawing Size"),
            (DateOnly "DateDrawing" "Date Drawing"),
            (Text "Manufacturer" "Manufacturer"),
            (Text "MfgPartNumber" "Mfg Part #"),
            (Text "Notes" "Notes" -Multi),
            (Text "AssignedBy" "Assigned By"),
            (Choice "PrototypeOrProduction" "Prototype or Production" @("Prototype", "Production")),
            (Choice "Purchased" "Purchased" @("Purchased", "Not Purchased")),
            (Text "SAPNumber" "SAP #"),
            (Text "ItemValue" "Item Value"),
            (Choice "SignOffStatus" "Sign-off Status" @("Pending SAP", "Approved") -Indexed),
            (Text "LegacySource" "Legacy Source" -Indexed)
        )
    },
    @{
        name        = "Altronic Component List"
        envVar      = "VITE_SP_ALTRONIC_COMPONENT_LIST_ID"
        description = "HOC electronic components: 601/611 Through Hole, 701/711/712 Surface Mount, 722 SIL. Title = Altronic Part #."
        columns     = @(
            (Choice "Category" "Category" @("Surface Mount", "Through Hole", "SIL") -Indexed),
            (Text "Description" "Description"),
            (Text "MfgName" "Mfg Name"),
            (Text "MfgNumber" "Mfg Number"),
            (Text "RatingA" "Rating A"),
            (Text "RatingB" "Rating B"),
            (Text "RatingC" "Rating C"),
            (Text "TempMin" "Temp Min"),
            (Text "TempMax" "Temp Max"),
            (Text "Tolerance" "Tolerance"),
            (Text "Footprint" "Footprint"),
            (Text "Notes" "Notes" -Multi),
            @{ name = "HasDataSheet"; displayName = "Has Data Sheet"; boolean = @{} },
            (Choice "SignOffStatus" "Sign-off Status" @("Pending Engineering Review", "Pending SAP", "Approved") -Indexed),
            (Text "LegacySource" "Legacy Source" -Indexed)
        )
    }
)

if (-not $WhatIf) {
    $ctx = Get-MgContext
    if (-not $ctx -or $ctx.Scopes -notcontains "Sites.Manage.All") {
        Write-Host "Signing in (Sites.Manage.All — creating a list is a write)..." -ForegroundColor Cyan
        try { Connect-MgGraph -Scopes "Sites.Manage.All" -NoWelcome }
        catch { Connect-MgGraph -Scopes "Sites.Manage.All" -UseDeviceCode -NoWelcome }
    }
} elseif (-not (Get-MgContext)) {
    Connect-MgGraph -Scopes "Sites.Read.All" -NoWelcome
}

function Get-ExistingLists([string]$Site) {
    $found = @{}
    $uri = "https://graph.microsoft.com/v1.0/sites/$Site/lists?`$select=id,displayName&`$top=200"
    while ($uri) {
        # /lists is PAGED — an unpaged call silently returns a subset.
        $page = Invoke-MgGraphRequest -Method GET -Uri $uri
        foreach ($l in $page.value) { $found[$l.displayName] = $l.id }
        $uri = $page.'@odata.nextLink'
    }
    return $found
}

$existing = Get-ExistingLists $EngineeringSite
$envLines = @()

foreach ($spec in $Lists) {
    Write-Host "`n$($spec.name)" -ForegroundColor Cyan

    if ($existing.ContainsKey($spec.name)) {
        $listId = $existing[$spec.name]
        Write-Host "  exists — id $listId" -ForegroundColor Yellow
    } elseif ($WhatIf) {
        Write-Host "  WOULD CREATE with columns: $(($spec.columns | ForEach-Object { $_.name }) -join ', ')" -ForegroundColor Yellow
        Write-Host "  and would rename Title to 'Altronic Part #' and index it" -ForegroundColor Yellow
        continue
    } else {
        $body = @{
            displayName = $spec.name
            description = $spec.description
            list        = @{ template = "genericList" }
            columns     = $spec.columns
        } | ConvertTo-Json -Depth 10
        $created = Invoke-MgGraphRequest -Method POST `
            -Uri "https://graph.microsoft.com/v1.0/sites/$EngineeringSite/lists" `
            -Body $body -ContentType "application/json"
        $listId = $created.id
        Write-Host "  CREATED — id $listId" -ForegroundColor Green
    }
    $envLines += "  $($spec.envVar)=$listId"

    $cols = (Invoke-MgGraphRequest -Method GET `
        -Uri "https://graph.microsoft.com/v1.0/sites/$EngineeringSite/lists/$listId/columns").value
    $have = @($cols | ForEach-Object { $_.name })

    foreach ($col in $spec.columns) {
        if ($have -contains $col.name) {
            Write-Host "    $($col.name) — already there"
        } elseif ($WhatIf) {
            Write-Host "    $($col.name) — WOULD ADD" -ForegroundColor Yellow
        } else {
            Invoke-MgGraphRequest -Method POST `
                -Uri "https://graph.microsoft.com/v1.0/sites/$EngineeringSite/lists/$listId/columns" `
                -Body ($col | ConvertTo-Json -Depth 10) -ContentType "application/json" | Out-Null
            Write-Host "    $($col.name) — added" -ForegroundColor Green
        }
    }

    # Title is the part number: say so in SharePoint's own views, and index it.
    $title = $cols | Where-Object { $_.name -eq "Title" } | Select-Object -First 1
    if ($title) {
        if ($title.displayName -eq "Altronic Part #" -and $title.indexed) {
            Write-Host "    Title — already 'Altronic Part #', indexed"
        } elseif ($WhatIf) {
            Write-Host "    Title — WOULD rename to 'Altronic Part #' and index" -ForegroundColor Yellow
        } else {
            try {
                Invoke-MgGraphRequest -Method PATCH `
                    -Uri "https://graph.microsoft.com/v1.0/sites/$EngineeringSite/lists/$listId/columns/$($title.id)" `
                    -Body (@{ displayName = "Altronic Part #"; indexed = $true } | ConvertTo-Json) `
                    -ContentType "application/json" | Out-Null
                Write-Host "    Title — renamed 'Altronic Part #', indexed" -ForegroundColor Green
            } catch {
                # Not fatal: ARC reads Title by its internal name either way. The
                # index is the part that matters past 5,000 rows, so say how to
                # do it by hand.
                Write-Host "    Title — could not update ($($_.Exception.Message))." -ForegroundColor Red
                Write-Host "      Do it in List settings: rename Title to 'Altronic Part #', and add it under Indexed columns." -ForegroundColor Red
            }
        }
    }
}

if ($WhatIf) { Write-Host "`n-WhatIf — nothing was created.`n" -ForegroundColor Yellow; exit 0 }

Write-Host "`nAdd these to .env.local (and to the GitHub Actions repo variables AND deploy.yml's named list):" -ForegroundColor Cyan
$envLines | ForEach-Object { Write-Host $_ -ForegroundColor Green }
Write-Host "`nNext: ./scripts/load-altronic-parts-lists.ps1   (report only), then with -Apply.`n" -ForegroundColor Cyan
