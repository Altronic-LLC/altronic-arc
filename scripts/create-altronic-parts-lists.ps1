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
            SignOffStatus           choice — Pending SAP / Approved (2-step),
                                    or Deleted (a deleted number, kept for reuse)
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
                                    Pending SAP / Approved (3-step), or Deleted

    Re-running on lists that already exist adds any column, AND any choice,
    they're missing — "Deleted" was added to SignOffStatus after both lists
    were created.
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

    Both parts lists also carry a Communication column — the approval history
    ARC writes (added 2026-09-28, with the write side).

    A third list, "Parts Roles", holds who may edit and approve parts (Title =
    email, Roles = a CSV of editor / hoc editor / reviewing engineer / sap
    admin). It is managed in ARC at Admin → Parts Roles. Until it exists and
    VITE_SP_PARTS_ROLES_LIST_ID points at it, the Parts List is read-only.

    Idempotent: an existing list is left alone and only missing columns are
    added — so re-running this on the lists created 2026-09-28 just adds
    Communication and creates Parts Roles. Load the data with
    load-altronic-parts-lists.ps1.

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
# The approval history ARC writes (who approved, when, with what comment).
# ARC rewrites the WHOLE value on each append, so "Append changes to existing
# text" must be OFF — with it on, the thread doubles on every write (FAIT 89).
# Graph has been seen to report the flag as true however the column was
# created, so VERIFY behaviourally after creating: approve two parts' steps and
# check the history doesn't repeat.
function Communication {
    @{
        name = "Communication"; displayName = "Communication"
        text = @{ allowMultipleLines = $true; textType = "plain"; appendChangesToExistingText = $false }
    }
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
            # "Deleted" marks a deleted part number, kept so it can be reused (ARC,
            # 2026-09-28) — see "Part numbers are deleted, then reused" in CLAUDE.md.
            (Choice "SignOffStatus" "Sign-off Status" @("Pending SAP", "Approved", "Deleted") -Indexed),
            (Text "LegacySource" "Legacy Source" -Indexed),
            (Communication)
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
            (Choice "SignOffStatus" "Sign-off Status" @("Pending Engineering Review", "Pending SAP", "Approved", "Deleted") -Indexed),
            (Text "LegacySource" "Legacy Source" -Indexed),
            (Communication)
        )
    },
    @{
        # Who may edit and approve parts (Tim, 2026-09-28). Title = the
        # person's email; Roles = a lowercase CSV of tags (editor, hoc editor,
        # reviewing engineer, sap admin) — the EIR Roles shape, deliberately a
        # TEXT column rather than a choice, so a new tag is a code change and
        # never a column change. Managed in ARC at /admin/parts-roles.
        name         = "Parts Roles"
        envVar       = "VITE_SP_PARTS_ROLES_LIST_ID"
        description  = "Who can add, edit and approve parts on the Altronic Part / Component Lists. Title = email. Managed in ARC (Admin → Parts Roles)."
        titleDisplay = "Email"
        titleIndexed = $false
        # PersonName, NOT DisplayName: Graph silently drops a listItem field
        # called DisplayName (write accepted, nothing stored — 2026-09-28).
        columns      = @(
            (Text "PersonName" "Name"),
            (Text "Roles" "Roles"),
            (Text "Note" "Note" -Multi)
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
        Write-Host "  and would rename Title to '$(if ($spec.titleDisplay) { $spec.titleDisplay } else { 'Altronic Part #' })'" -ForegroundColor Yellow
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
            # A choice column that exists may be missing a choice added since —
            # SignOffStatus gained "Deleted" after both lists were created, and
            # a value the column doesn't declare is refused on every write.
            $current = $cols | Where-Object { $_.name -eq $col.name } | Select-Object -First 1
            $missing = @()
            if ($col.choice -and $current.choice) {
                $missing = @($col.choice.choices | Where-Object { $current.choice.choices -notcontains $_ })
            }
            if ($missing.Count -eq 0) {
                Write-Host "    $($col.name) — already there"
            } elseif ($WhatIf) {
                Write-Host "    $($col.name) — WOULD ADD choice(s): $($missing -join ', ')" -ForegroundColor Yellow
            } else {
                $choices = @($current.choice.choices) + $missing
                Invoke-MgGraphRequest -Method PATCH `
                    -Uri "https://graph.microsoft.com/v1.0/sites/$EngineeringSite/lists/$listId/columns/$($current.id)" `
                    -Body (@{ choice = @{ choices = $choices; displayAs = $current.choice.displayAs; allowTextEntry = [bool]$current.choice.allowTextEntry } } | ConvertTo-Json -Depth 5) `
                    -ContentType "application/json" | Out-Null
                # Read it back: a column PATCH has been accepted before and changed
                # nothing (Communication's append setting).
                $after = Invoke-MgGraphRequest -Method GET `
                    -Uri "https://graph.microsoft.com/v1.0/sites/$EngineeringSite/lists/$listId/columns/$($current.id)"
                $still = @($missing | Where-Object { $after.choice.choices -notcontains $_ })
                if ($still.Count -eq 0) {
                    Write-Host "    $($col.name) — added choice(s): $($missing -join ', ')" -ForegroundColor Green
                } else {
                    Write-Host "    $($col.name) — choice(s) NOT added: $($still -join ', '). Add them in List settings." -ForegroundColor Red
                }
            }
        } elseif ($WhatIf) {
            Write-Host "    $($col.name) — WOULD ADD" -ForegroundColor Yellow
        } else {
            Invoke-MgGraphRequest -Method POST `
                -Uri "https://graph.microsoft.com/v1.0/sites/$EngineeringSite/lists/$listId/columns" `
                -Body ($col | ConvertTo-Json -Depth 10) -ContentType "application/json" | Out-Null
            Write-Host "    $($col.name) — added" -ForegroundColor Green
        }
    }

    # Title is the part number (the email, on Parts Roles): say so in
    # SharePoint's own views, and index it on the two big lists.
    $titleDisplay = if ($spec.titleDisplay) { $spec.titleDisplay } else { "Altronic Part #" }
    $titleIndexed = if ($spec.ContainsKey("titleIndexed")) { $spec.titleIndexed } else { $true }
    $title = $cols | Where-Object { $_.name -eq "Title" } | Select-Object -First 1
    if ($title) {
        if ($title.displayName -eq $titleDisplay -and ($title.indexed -or -not $titleIndexed)) {
            Write-Host "    Title — already '$titleDisplay'$(if ($titleIndexed) { ', indexed' })"
        } elseif ($WhatIf) {
            Write-Host "    Title — WOULD rename to '$titleDisplay'$(if ($titleIndexed) { ' and index' })" -ForegroundColor Yellow
        } else {
            try {
                $patch = @{ displayName = $titleDisplay }
                if ($titleIndexed) { $patch.indexed = $true }
                Invoke-MgGraphRequest -Method PATCH `
                    -Uri "https://graph.microsoft.com/v1.0/sites/$EngineeringSite/lists/$listId/columns/$($title.id)" `
                    -Body ($patch | ConvertTo-Json) `
                    -ContentType "application/json" | Out-Null
                Write-Host "    Title — renamed '$titleDisplay'$(if ($titleIndexed) { ', indexed' })" -ForegroundColor Green
            } catch {
                # Not fatal: ARC reads Title by its internal name either way. The
                # index is the part that matters past 5,000 rows, so say how to
                # do it by hand.
                Write-Host "    Title — could not update ($($_.Exception.Message))." -ForegroundColor Red
                Write-Host "      Do it in List settings: rename Title to '$titleDisplay'$(if ($titleIndexed) { ', and add it under Indexed columns' })." -ForegroundColor Red
            }
        }
    }
}

if ($WhatIf) { Write-Host "`n-WhatIf — nothing was created.`n" -ForegroundColor Yellow; exit 0 }

Write-Host "`nAdd these to .env.local (and to the GitHub Actions repo variables AND deploy.yml's named list):" -ForegroundColor Cyan
$envLines | ForEach-Object { Write-Host $_ -ForegroundColor Green }
Write-Host "`nNext: ./scripts/load-altronic-parts-lists.ps1   (report only), then with -Apply.`n" -ForegroundColor Cyan
