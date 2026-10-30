<#
.SYNOPSIS
    Creates the four lists behind ARC's Insourcing Quotes tool, on the
    Altronic_PMO site — and, on lists that already exist, adds any column
    they are missing.

.DESCRIPTION
    Four lists, created in dependency order (a lookup needs its target first):

        Quote Customers    Title = customer name; CustomerCode (indexed,
                           unique), CustomerNumber (SAP sold-to, TEXT so
                           leading zeros survive), Active, Note
        Quote Roles        Title = email; PersonName, Roles (lowercase CSV of
                           viewer / quoter / manager), Note
        Quotes             Title = quote number IQ-COO-0042-R1 (indexed,
                           unique); QuoteBase (indexed), Rev, CustomerRef,
                           Status, ValidityDays, ContactName, ContactEmail,
                           Budgetary, BudgetaryText, QuoteNotes,
                           CustomerReference, CustomerType (Cooper /
                           Arcline / External), ProjectContext, Alternates
                           (JSON), Communication,
                           Watchers, EngineeringTaskId, OperationsTaskId
                           (numbers — a task's item id), EngineeringProjectRef,
                           OperationsProjectRef (project titles)
        Quote Assemblies   One row per quote LINE. Title = the line's Altronic
                           part #; QuoteRef (indexed), LineNo, QuotedQty
                           (default 1), Cost (= MATERIAL, final), LaborCost,
                           MaterialOverheadPct (overhead as % of material),
                           SapPartNumber, CustomerPartNumber, Description,
                           PriceBreaks (JSON), TargetGM (the ONE margin on the
                           line), ManualPrice, TargetPrice (the customer's
                           target), EstimatedEAU, CustomerPrice

    COLUMNS ADDED IN v0.209.0 (Ray, 2026-10-29/30) — CustomerReference,
    CustomerType, ProjectContext, Alternates, EngineeringTaskId,
    OperationsTaskId and OperationsProjectRef on Quotes; LaborCost, TargetPrice
    and EstimatedEAU on Quote Assemblies. ARC selects them, and selecting a
    column a list hasn't got 400s the WHOLE read, so re-run this script
    against the live lists BEFORE that version deploys.

    RETIRED, never deleted: Quotes' EngineeringTaskLink / OperationsTaskLink
    (Hyperlink — Graph can't write one, so the links became number columns),
    Quote Assemblies' LineType, and the whole Quote Items list (the component
    breakdown — a line now carries its final cost). They are reported if
    present and left alone; this script never deletes anything.

    THE INTERNAL NAMES ARE A CONTRACT with the app code — see section 13.1 of
    docs/INSOURCING-QUOTING-DESIGN.md. Do not rename a column here without
    changing src/api/quote*.ts in the same commit.

    Rules this script follows, each learned elsewhere in ARC (CLAUDE.md):
      - The name column on Quote Roles is PersonName, NEVER DisplayName: Graph
        silently drops a listItem field called DisplayName.
      - The three lookups are SINGLE-value. ARC writes them as bare integers.
      - The Communication columns are plain text with "Append Changes to
        Existing Text" OFF. Graph has reported that flag as true however the
        column was created (FAIT 89), so it is READ BACK here and flagged; the
        list settings UI and a behavioural check are the authority.
      - Idempotent: an existing list is left alone and only missing columns
        (and missing choices) are added. Nothing is ever deleted or recreated.

    Attachments and Quick Launch: Graph cannot set either. A genericList is
    created with attachments ON, so Quotes needs nothing; Quote Customers,
    Quote Roles and Quote Assemblies must be turned OFF. With
    -PnPClientId (and PnP.PowerShell installed) the script does both through
    SharePoint REST and reads them back; otherwise it prints the manual steps.
    The lists are NOT made hidden — a hidden list vanishes from Site contents,
    which is the only place Ray wants them reachable from.

.PARAMETER WhatIf
    Report what would be created or changed; change nothing.

.PARAMETER SiteId
    Graph site id. Defaults to Altronic_PMO (SITES.pmo in src/api/config.ts).

.PARAMETER SiteUrl
    The same site's URL, used only for the SharePoint REST (PnP) step and the
    manual instructions.

.PARAMETER ManagerEmail
    Optional. Seeds this person as a `manager` on Quote Roles (only if no row
    for that email exists yet), so the feature is usable on day one.

.PARAMETER ManagerName
    Optional display name for -ManagerEmail (stored in PersonName). Defaults
    to the part of the address before the @.

.PARAMETER PnPClientId
    Optional. The Entra app (client) id to use with Connect-PnPOnline
    -Interactive. When given, attachments and Quick Launch are set through
    SharePoint REST and read back. Without it, manual steps are printed.

.EXAMPLE
    ./scripts/create-quote-lists.ps1 -WhatIf

.EXAMPLE
    ./scripts/create-quote-lists.ps1 -ManagerEmail ray.white@altronic-llc.com -ManagerName "Ray White"

.NOTES
    Needs Sites.Manage.All — creating a list is a write, and needs Manage
    Lists rights on the site (ARC's own Sites.Selected grant does not include
    that).
#>
param(
    [switch]$WhatIf,
    [string]$SiteId = "coopermachineryservices.sharepoint.com,915a6183-2b71-4dfd-a8b9-181126dfbe78,3eb6cb9c-6535-4c69-a8d7-e90b2f90a9eb",
    [string]$SiteUrl = "https://coopermachineryservices.sharepoint.com/sites/Altronic_PMO",
    [string]$ManagerEmail,
    [string]$ManagerName,
    [string]$PnPClientId
)

$ErrorActionPreference = "Stop"
$Graph = "https://graph.microsoft.com/v1.0/sites/$SiteId"

# ---------------------------------------------------------------- column builders

function Text($name, $display, [switch]$Indexed, [switch]$Unique) {
    $c = @{ name = $name; displayName = $display; text = @{ allowMultipleLines = $false } }
    if ($Indexed -or $Unique) { $c.indexed = $true }
    if ($Unique) { $c.enforceUniqueValues = $true }
    $c
}
# Multi-line PLAIN text. Never Enhanced rich text: PriceBreaks holds JSON, and
# the rich-text wrapper would corrupt it.
function Note($name, $display) {
    @{ name = $name; displayName = $display; text = @{ allowMultipleLines = $true; textType = "plain"; appendChangesToExistingText = $false } }
}
function Number($name, $display, [string]$Decimals = "automatic", $Default) {
    $c = @{ name = $name; displayName = $display; number = @{ decimalPlaces = $Decimals } }
    if ($null -ne $Default) { $c.defaultValue = @{ value = "$Default" } }
    $c
}
function Currency($name, $display) {
    @{ name = $name; displayName = $display; currency = @{ locale = "en-US" } }
}
function YesNo($name, $display, [bool]$Default) {
    @{ name = $name; displayName = $display; boolean = @{}; defaultValue = @{ value = $(if ($Default) { "1" } else { "0" }) } }
}
function People($name, $display) {
    @{ name = $name; displayName = $display; personOrGroup = @{ allowMultipleSelection = $true; chooseFromType = "peopleOnly" } }
}
# SINGLE-value lookup. The target list id is filled in at run time, once the
# target exists (lists are created in dependency order).
function Lookup($name, $display, $targetList, [switch]$Indexed) {
    $c = @{ name = $name; displayName = $display; lookupTarget = $targetList
            lookup = @{ columnName = "Title"; allowMultipleValues = $false } }
    if ($Indexed) { $c.indexed = $true }
    $c
}
# The comment thread. ARC rewrites the WHOLE value on each post, so append
# mode must be OFF — with it on, the thread doubles on every write (FAIT 89).
function Communication { Note "Communication" "Communication" }

# ---------------------------------------------------------------- the lists

$Lists = @(
    @{
        name         = "Quote Customers"
        envVar       = "VITE_SP_QUOTE_CUSTOMERS_LIST_ID"
        description  = "Customers for Insourcing Quotes. Title = customer name. CustomerCode is frozen at creation. Retire (Active = No), never delete. Managed in ARC."
        titleDisplay = "Customer Name"
        attachments  = $false
        columns      = @(
            (Text "CustomerCode" "Customer Code" -Unique),
            (Text "CustomerNumber" "Customer Number"),
            (YesNo "Active" "Active" $true),
            (Note "Note" "Note")
        )
    },
    @{
        name         = "Quote Roles"
        envVar       = "VITE_SP_QUOTE_ROLES_LIST_ID"
        description  = "Who can view, prepare and manage Insourcing Quotes. Title = email; Roles = lowercase CSV of viewer / quoter / manager. Managed in ARC."
        titleDisplay = "Email"
        attachments  = $false
        # PersonName, NOT DisplayName: Graph silently drops a listItem field
        # called DisplayName (write accepted, nothing stored).
        columns      = @(
            (Text "PersonName" "Name"),
            (Text "Roles" "Roles"),
            (Note "Note" "Note")
        )
    },
    @{
        name         = "Quotes"
        envVar       = "VITE_SP_QUOTES_LIST_ID"
        description  = "Insourcing Quotes (header). Title = quote number, e.g. IQ-COO-0042-R1. A rev is a new row sharing QuoteBase. Never deleted. Edit through ARC."
        titleDisplay = "Quote Number"
        titleUnique  = $true
        attachments  = $true
        columns      = @(
            (Text "QuoteBase" "Quote Base" -Indexed),
            (Number "Rev" "Rev" "none"),
            (Lookup "CustomerRef" "Customer" "Quote Customers"),
            @{
                name = "Status"; displayName = "Status"
                choice = @{ choices = @("Draft", "Sent", "Won", "Lost", "Expired"); displayAs = "dropDownMenu"; allowTextEntry = $false }
                defaultValue = @{ value = "Draft" }
            },
            (Number "ValidityDays" "Validity Days" "none" 30),
            (Text "ContactName" "Contact Name"),
            (Text "ContactEmail" "Contact Email"),
            (YesNo "Budgetary" "Budgetary" $false),
            (Note "BudgetaryText" "Budgetary Text"),
            (Note "QuoteNotes" "Quote Notes"),
            # Printed on the customer's quote.
            (Text "CustomerReference" "Customer Reference"),
            # Internal: who the customer is. A strict choice, Not set allowed.
            @{
                name = "CustomerType"; displayName = "Customer Type"
                choice = @{ choices = @("Cooper", "Arcline", "External"); displayAs = "dropDownMenu"; allowTextEntry = $false }
            },
            # Internal: background on the project, shown in the Target &
            # volume summary. Plain text, never rich.
            (Note "ProjectContext" "Project Context"),
            # JSON: the page-two Alternates table (three manufacturer options
            # + a reason per row). Plain text, never rich.
            (Note "Alternates" "Alternates"),
            (Communication),
            (People "Watchers" "Watchers"),
            # A task's ITEM ID. Number, not Hyperlink — Graph can't write a
            # Hyperlink column (the EIRReference finding, 2026-10-27).
            (Number "EngineeringTaskId" "Engineering Task ID" "none"),
            (Number "OperationsTaskId" "Operations Task ID" "none"),
            # TEXT holding a project TITLE — the Engineering Projects list is
            # on another site collection, so a lookup is impossible.
            (Text "EngineeringProjectRef" "Engineering Project"),
            (Text "OperationsProjectRef" "Operations Project")
        )
        retired      = @("EngineeringTaskLink", "OperationsTaskLink")
    },
    @{
        name         = "Quote Assemblies"
        envVar       = "VITE_SP_QUOTE_ASSEMBLIES_LIST_ID"
        description  = "Lines on an Insourcing Quote, one row each, with the part's final material, labor and overhead. Title = the line's part number. Edit through ARC."
        titleDisplay = "Part Number"
        attachments  = $false
        columns      = @(
            (Lookup "QuoteRef" "Quote" "Quotes" -Indexed),
            (Number "LineNo" "Line No" "none"),
            # How many the customer is quoted for — never blank, default 1.
            (Number "QuotedQty" "Quoted Qty" "none" 1),
            # The part's FINAL costs (Ray, 2026-10-29). Cost is MATERIAL — the
            # internal name predates labor and is kept so existing rows read.
            (Currency "Cost" "Material Cost"),
            (Currency "LaborCost" "Labor Cost"),
            # Overhead as a percent of MATERIAL (ARC offers 18% on a new line).
            (Number "MaterialOverheadPct" "Material Overhead %"),
            (Text "SapPartNumber" "SAP Part #"),
            (Text "CustomerPartNumber" "Customer Part #"),
            (Note "Description" "Description"),
            (Note "PriceBreaks" "Price Breaks"),
            # The ONE margin on the line (Ray, 2026-10-09) — never per component.
            (Number "TargetGM" "Target GM %"),
            (Currency "ManualPrice" "Manual Price"),
            # Internal (never printed): the customer's target price for one,
            # and their estimated annual usage — the Target & volume summary.
            (Currency "TargetPrice" "Target Price"),
            (Number "EstimatedEAU" "Estimated EAU" "none"),
            (Currency "CustomerPrice" "Customer Price")
        )
        retired      = @("LineType")
    }
)
# A whole list ARC no longer uses. Reported if present, never deleted.
$RetiredLists = @("Quote Items")

# ---------------------------------------------------------------- sign-in

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

function Get-ExistingLists {
    $found = @{}
    $uri = "$Graph/lists?`$select=id,displayName&`$top=200"
    while ($uri) {
        # /lists is PAGED — an unpaged call silently returns a subset.
        $page = Invoke-MgGraphRequest -Method GET -Uri $uri
        foreach ($l in $page.value) { $found[$l.displayName] = $l.id }
        $uri = $page.'@odata.nextLink'
    }
    return $found
}

# The column body Graph is sent: resolve a lookup's target, drop our helper key.
function Resolve-Column($col, $listIds) {
    $c = @{}
    foreach ($k in $col.Keys) { if ($k -ne "lookupTarget") { $c[$k] = $col[$k] } }
    if ($col.lookupTarget) {
        $target = $listIds[$col.lookupTarget]
        if (-not $target) { throw "Lookup $($col.name) points at '$($col.lookupTarget)', which does not exist yet." }
        $c.lookup = @{ listId = $target; columnName = $col.lookup.columnName; allowMultipleValues = $false }
    }
    return $c
}

$existing = Get-ExistingLists
$listIds = @{}
foreach ($spec in $Lists) { if ($existing.ContainsKey($spec.name)) { $listIds[$spec.name] = $existing[$spec.name] } }
foreach ($name in $RetiredLists) {
    if ($existing.ContainsKey($name)) {
        Write-Host "$name — exists but is UNUSED by ARC since v0.209.0. Left in place (never deleted)." -ForegroundColor Yellow
    }
}
$appendWarnings = @()
$createdLists = @()

foreach ($spec in $Lists) {
    Write-Host "`n$($spec.name)" -ForegroundColor Cyan

    if ($listIds.ContainsKey($spec.name)) {
        $listId = $listIds[$spec.name]
        Write-Host "  exists — id $listId" -ForegroundColor Yellow
    } elseif ($WhatIf) {
        Write-Host "  WOULD CREATE with columns: $(($spec.columns | ForEach-Object { $_.name }) -join ', ')" -ForegroundColor Yellow
        Write-Host "  and would rename Title to '$($spec.titleDisplay)'$(if ($spec.titleUnique) { ', indexed, unique' })" -ForegroundColor Yellow
        continue
    } else {
        $body = @{
            displayName = $spec.name
            description = $spec.description
            list        = @{ template = "genericList" }
            columns     = @($spec.columns | ForEach-Object { Resolve-Column $_ $listIds })
        } | ConvertTo-Json -Depth 10
        $created = Invoke-MgGraphRequest -Method POST -Uri "$Graph/lists" -Body $body -ContentType "application/json"
        $listId = $created.id
        $listIds[$spec.name] = $listId
        $createdLists += $spec.name
        Write-Host "  CREATED — id $listId" -ForegroundColor Green
    }

    $cols = (Invoke-MgGraphRequest -Method GET -Uri "$Graph/lists/$listId/columns").value
    foreach ($col in $spec.columns) {
        $current = $cols | Where-Object { $_.name -eq $col.name } | Select-Object -First 1
        if ($current) {
            # A choice column may be missing a choice added since — a value
            # the column doesn't declare is refused on every write.
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
                Invoke-MgGraphRequest -Method PATCH -Uri "$Graph/lists/$listId/columns/$($current.id)" `
                    -Body (@{ choice = @{ choices = $choices; displayAs = $current.choice.displayAs; allowTextEntry = [bool]$current.choice.allowTextEntry } } | ConvertTo-Json -Depth 5) `
                    -ContentType "application/json" | Out-Null
                $after = Invoke-MgGraphRequest -Method GET -Uri "$Graph/lists/$listId/columns/$($current.id)"
                $still = @($missing | Where-Object { $after.choice.choices -notcontains $_ })
                if ($still.Count -eq 0) {
                    Write-Host "    $($col.name) — added choice(s): $($missing -join ', ')" -ForegroundColor Green
                } else {
                    Write-Host "    $($col.name) — choice(s) NOT added: $($still -join ', '). Add them in List settings." -ForegroundColor Red
                }
            }
            # An existing column whose type is wrong cannot be fixed here
            # (changing a column's type is not supported) — say so loudly.
            $kinds = @("text", "number", "currency", "boolean", "choice", "lookup", "personOrGroup", "hyperlinkOrPicture")
            $want = $kinds | Where-Object { $col.ContainsKey($_) } | Select-Object -First 1
            if ($want -and -not $current.$want) {
                Write-Host "    $($col.name) — EXISTS BUT IS NOT A '$want' COLUMN. ARC's contract needs '$want'; fix by hand." -ForegroundColor Red
            }
        } elseif ($WhatIf) {
            Write-Host "    $($col.name) — WOULD ADD" -ForegroundColor Yellow
        } else {
            Invoke-MgGraphRequest -Method POST -Uri "$Graph/lists/$listId/columns" `
                -Body ((Resolve-Column $col $listIds) | ConvertTo-Json -Depth 10) -ContentType "application/json" | Out-Null
            Write-Host "    $($col.name) — added" -ForegroundColor Green
        }
    }

    # A column ARC has stopped using is left in place (never deleted), and said.
    foreach ($r in @($spec.retired)) {
        if (-not $r) { continue }
        if ($cols | Where-Object { $_.name -eq $r }) {
            Write-Host "    $r — exists but is UNUSED by ARC. Left in place." -ForegroundColor Yellow
        }
    }

    # Title: a readable display name, and on Quotes indexed + unique (the
    # quote number; two people creating at once must not share one).
    $title = $cols | Where-Object { $_.name -eq "Title" } | Select-Object -First 1
    if ($title) {
        $okName = $title.displayName -eq $spec.titleDisplay
        $okUnique = (-not $spec.titleUnique) -or ($title.indexed -and $title.enforceUniqueValues)
        if ($okName -and $okUnique) {
            Write-Host "    Title — already '$($spec.titleDisplay)'$(if ($spec.titleUnique) { ', indexed, unique' })"
        } elseif ($WhatIf) {
            Write-Host "    Title — WOULD set '$($spec.titleDisplay)'$(if ($spec.titleUnique) { ', indexed, unique' })" -ForegroundColor Yellow
        } else {
            $patch = @{ displayName = $spec.titleDisplay }
            if ($spec.titleUnique) { $patch.indexed = $true; $patch.enforceUniqueValues = $true }
            try {
                Invoke-MgGraphRequest -Method PATCH -Uri "$Graph/lists/$listId/columns/$($title.id)" `
                    -Body ($patch | ConvertTo-Json) -ContentType "application/json" | Out-Null
                $after = Invoke-MgGraphRequest -Method GET -Uri "$Graph/lists/$listId/columns/$($title.id)"
                if ($spec.titleUnique -and -not ($after.indexed -and $after.enforceUniqueValues)) {
                    Write-Host "    Title — renamed, but Graph does NOT report it indexed + unique." -ForegroundColor Red
                    Write-Host "      List settings → Title → 'Enforce unique values' = Yes (it indexes the column)." -ForegroundColor Red
                } else {
                    Write-Host "    Title — '$($spec.titleDisplay)'$(if ($spec.titleUnique) { ', indexed, unique' })" -ForegroundColor Green
                }
            } catch {
                Write-Host "    Title — could not update ($($_.Exception.Message))." -ForegroundColor Red
                Write-Host "      Do it in List settings: rename Title to '$($spec.titleDisplay)'$(if ($spec.titleUnique) { ' and set Enforce unique values = Yes' })." -ForegroundColor Red
            }
        }
    }

    if ($WhatIf) { continue }

    # Read back the index / uniqueness / append flags the app depends on.
    $cols = (Invoke-MgGraphRequest -Method GET -Uri "$Graph/lists/$listId/columns").value
    foreach ($col in $spec.columns) {
        $current = $cols | Where-Object { $_.name -eq $col.name } | Select-Object -First 1
        if (-not $current) { Write-Host "    $($col.name) — MISSING after create. Check the list." -ForegroundColor Red; continue }
        if ($col.indexed -and -not $current.indexed) {
            Write-Host "    $($col.name) — NOT indexed. List settings → Indexed columns → add it." -ForegroundColor Red
        }
        if ($col.enforceUniqueValues -and -not $current.enforceUniqueValues) {
            Write-Host "    $($col.name) — NOT enforcing unique values. List settings → $($col.displayName) → Enforce unique values = Yes." -ForegroundColor Red
        }
        if ($col.name -eq "Communication") {
            $append = $current.text.appendChangesToExistingText
            if ($append) {
                Write-Host "    Communication — Graph reports appendChangesToExistingText = TRUE." -ForegroundColor Red
                $appendWarnings += $spec.name
            } else {
                Write-Host "    Communication — Graph reports append changes OFF (still verify behaviourally)." -ForegroundColor Green
            }
        }
    }
}

# ---------------------------------------------------------------- seed a manager

if ($ManagerEmail) {
    $email = $ManagerEmail.Trim().ToLowerInvariant()
    $name = if ($ManagerName) { $ManagerName } else { $email.Split("@")[0] }
    Write-Host "`nQuote Roles — seed manager $email" -ForegroundColor Cyan
    $rolesId = $listIds["Quote Roles"]
    if (-not $rolesId) {
        Write-Host "  Quote Roles does not exist yet$(if ($WhatIf) { ' (-WhatIf)' }) — WOULD ADD $email as manager after creating it." -ForegroundColor Yellow
    } else {
        $rows = @()
        $uri = "$Graph/lists/$rolesId/items?`$expand=fields(`$select=Title,PersonName,Roles)&`$top=500"
        while ($uri) {
            $page = Invoke-MgGraphRequest -Method GET -Uri $uri
            $rows += $page.value
            $uri = $page.'@odata.nextLink'
        }
        $hit = $rows | Where-Object { "$($_.fields.Title)".Trim().ToLowerInvariant() -eq $email } | Select-Object -First 1
        if ($hit) {
            Write-Host "  already on the list (Roles: '$($hit.fields.Roles)') — left alone" -ForegroundColor Yellow
        } elseif ($WhatIf) {
            Write-Host "  WOULD ADD: Title=$email, PersonName=$name, Roles=manager" -ForegroundColor Yellow
        } else {
            $item = Invoke-MgGraphRequest -Method POST -Uri "$Graph/lists/$rolesId/items" `
                -Body (@{ fields = @{ Title = $email; PersonName = $name; Roles = "manager" } } | ConvertTo-Json -Depth 5) `
                -ContentType "application/json"
            # Read back: a 2xx is not proof a value landed (the DisplayName trap).
            $back = Invoke-MgGraphRequest -Method GET -Uri "$Graph/lists/$rolesId/items/$($item.id)?`$expand=fields(`$select=Title,PersonName,Roles)"
            if ($back.fields.PersonName -eq $name -and $back.fields.Roles -eq "manager") {
                Write-Host "  added, read back with PersonName and Roles" -ForegroundColor Green
            } else {
                Write-Host "  added, but read back PersonName='$($back.fields.PersonName)' Roles='$($back.fields.Roles)'. Check the list." -ForegroundColor Red
            }
        }
    }
}

if ($WhatIf) { Write-Host "`n-WhatIf — nothing was created or changed.`n" -ForegroundColor Yellow; exit 0 }

# ---------------------------------------------------------------- attachments + quick launch (SP REST)

$restDone = $false
if ($PnPClientId) {
    if (-not (Get-Module -ListAvailable -Name PnP.PowerShell)) {
        Write-Host "`n-PnPClientId given but PnP.PowerShell is not installed (Install-Module PnP.PowerShell). Falling back to manual steps." -ForegroundColor Yellow
    } else {
        Write-Host "`nSetting attachments and Quick Launch through SharePoint REST..." -ForegroundColor Cyan
        try {
            Import-Module PnP.PowerShell
            Connect-PnPOnline -Url $SiteUrl -Interactive -ClientId $PnPClientId
            $allOk = $true
            foreach ($spec in $Lists) {
                $id = $listIds[$spec.name]
                $url = "$SiteUrl/_api/web/lists(guid'$id')"
                $now = Invoke-PnPSPRestMethod -Method Get -Url "$url`?`$select=EnableAttachments,OnQuickLaunch,Hidden"
                $patch = @{}
                if ([bool]$now.EnableAttachments -ne $spec.attachments) { $patch.EnableAttachments = $spec.attachments }
                if ([bool]$now.OnQuickLaunch) { $patch.OnQuickLaunch = $false }
                if ($patch.Count -gt 0) {
                    Invoke-PnPSPRestMethod -Method Merge -Url $url -Content $patch | Out-Null
                }
                $after = Invoke-PnPSPRestMethod -Method Get -Url "$url`?`$select=EnableAttachments,OnQuickLaunch,Hidden"
                $ok = ([bool]$after.EnableAttachments -eq $spec.attachments) -and -not [bool]$after.OnQuickLaunch -and -not [bool]$after.Hidden
                if (-not $ok) { $allOk = $false }
                Write-Host ("  {0,-17} attachments={1} quickLaunch={2} hidden={3}  {4}" -f $spec.name, $after.EnableAttachments, $after.OnQuickLaunch, $after.Hidden, $(if ($ok) { "ok" } else { "NOT AS WANTED" })) `
                    -ForegroundColor $(if ($ok) { "Green" } else { "Red" })
            }
            $restDone = $allOk
        } catch {
            Write-Host "  SharePoint REST step failed: $($_.Exception.Message)" -ForegroundColor Red
        }
    }
}

if (-not $restDone) {
    Write-Host "`nMANUAL STEPS — Graph cannot set attachments or Quick Launch:" -ForegroundColor Yellow
    Write-Host "  Site contents: $SiteUrl/_layouts/15/viewlsts.aspx" -ForegroundColor Yellow
    foreach ($spec in $Lists) {
        $want = if ($spec.attachments) { "Enabled" } else { "Disabled" }
        Write-Host "  $($spec.name):" -ForegroundColor Yellow
        Write-Host "    List settings → Advanced settings → Attachments to list items = $want" -ForegroundColor Yellow
        Write-Host "    List settings → List name, description and navigation → Display this list on the Quick Launch = No" -ForegroundColor Yellow
    }
    Write-Host "  Do NOT hide the lists — a hidden list disappears from Site contents too." -ForegroundColor Yellow
    Write-Host "  (Graph-created lists start with attachments ON, so only Quote Customers, Quote Roles" -ForegroundColor Yellow
    Write-Host "   and Quote Assemblies need changing; check Quick Launch on all four.)" -ForegroundColor Yellow
}

# ---------------------------------------------------------------- the rest of the checklist

Write-Host "`nVERIFY THE COMMENT THREAD, BEHAVIOURALLY (Quotes):" -ForegroundColor $(if ($appendWarnings.Count) { "Red" } else { "Yellow" })
if ($appendWarnings.Count) {
    Write-Host "  Graph reports 'Append Changes to Existing Text' ON for: $($appendWarnings -join ', ')." -ForegroundColor Red
    Write-Host "  Turn it OFF in List settings → Communication. A Graph PATCH is accepted and changes nothing (FAIT 89)." -ForegroundColor Red
}
Write-Host "  Graph's answer alone proves nothing here. Post two comments on one quote in ARC;" -ForegroundColor Yellow
Write-Host "  the second must REPLACE the stored value, not double the thread." -ForegroundColor Yellow

Write-Host "`nWRITE / READ-BACK CHECK: a 2xx from a write is not proof a value landed (the DisplayName trap)." -ForegroundColor Yellow
Write-Host "  Before building on these lists, write one value into each column through Graph and read it back" -ForegroundColor Yellow
Write-Host "  — at minimum PersonName on Quote Roles, the lookups (bare integers), LaborCost, Alternates, the task ids, CustomerType, TargetPrice and EstimatedEAU." -ForegroundColor Yellow

Write-Host "`nList ids — add to .env.local, to the GitHub repo variables, and to deploy.yml's named list:" -ForegroundColor Cyan
foreach ($spec in $Lists) { Write-Host "  $($spec.envVar)=$($listIds[$spec.name])" -ForegroundColor Green }

Write-Host "`nRepo variables:" -ForegroundColor Cyan
foreach ($spec in $Lists) {
    Write-Host "  gh variable set $($spec.envVar) --repo Altronic-LLC/altronic-arc --body `"$($listIds[$spec.name])`"" -ForegroundColor Green
}

Write-Host "`nTHEN REDEPLOY. VITE_* values are baked in at build time; setting a repo variable does nothing" -ForegroundColor Yellow
Write-Host "until the next deploy." -ForegroundColor Yellow
Write-Host "`nPERMISSIONS: ARC's role gating is UI-only. Break inheritance and set UNIQUE PERMISSIONS on these" -ForegroundColor Yellow
Write-Host "four lists in SharePoint (cost and margin are readable by anyone who can read Quote Assemblies)." -ForegroundColor Yellow
if (-not $ManagerEmail) {
    Write-Host "`nNobody holds a quote role yet. Re-run with -ManagerEmail to seed a manager, or add a row to Quote Roles." -ForegroundColor Yellow
}
Write-Host ""
