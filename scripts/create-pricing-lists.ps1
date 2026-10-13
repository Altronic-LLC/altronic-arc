<#
.SYNOPSIS
    Creates the six lists behind ARC's Sales Pricing tool (BusinessIT#47), on
    the ALTRONICSALESTEAM site.

.DESCRIPTION
    Six lists, created in dependency order (a lookup needs its target first):

        Pricing Roles         Title = email; PersonName, Roles (lowercase CSV
                              of requester / manager / admin), Note
        Pricing Requests      Title = PR-YYYY-#### (indexed, unique). What the
                              requester asked for, its status, and the FINAL
                              price only — every requester can read this list,
                              so it holds NO cost and NO margin.
        Pricing History       Title = the same PR number (indexed, unique), one
                              row per request. How the price was reached: cost
                              and its source, distributor discount and its
                              source, target GM, base GM, the comparables
                              summary, and History (a JSON array, one entry per
                              pricing). MANAGERS AND ADMINS ONLY.
        New Product Pricing   Title = NP-YYYY-#### (indexed, unique). Products
                              not yet in SAP: overhead %, discount, target GM,
                              list price, quantity breaks (JSON), and History
                              (JSON, the totals of each revision). Its `Bom`
                              column predates sub-assemblies and is unused.
                              MANAGERS AND ADMINS ONLY.
        NP Sub-Assemblies     One row per sub-assembly PER REVISION of a
                              worksheet (WorksheetRef + Rev, both indexed). Lines
                              (JSON: part, description, qty, uploaded cost,
                              adjusted cost) from a CSV upload, its file name,
                              when and by whom. A new revision copies the rows
                              forward; earlier revisions are never rewritten.
                              MANAGERS AND ADMINS ONLY.
        Customer Quotes       Title = SQ-YYYY-####-R# (indexed, unique), one row
                              per quote revision. Customer (JSON), Lines (JSON),
                              status, validity, notes, comments, watchers.
                              MANAGERS AND ADMINS ONLY.

    THE INTERNAL NAMES ARE A CONTRACT with the app code (src/api/pricing*.ts,
    not yet written). Do not rename a column here without changing it there in
    the same commit.

    Why cost lives on separate lists: hiding a column in ARC is UI-only (the
    bundle is public and Graph returns every column the caller can read). The
    only real boundary is SharePoint's list permissions, so anything a
    requester must not see is on a list they cannot open.

    Rules this script follows, each learned elsewhere in ARC (CLAUDE.md):
      - The name column on Pricing Roles is PersonName, NEVER DisplayName: Graph
        silently drops a listItem field called DisplayName.
      - Lookups and single-person columns are SINGLE-value. ARC writes them as
        bare integers.
      - JSON and comment columns are multi-line PLAIN text with "Append Changes
        to Existing Text" OFF. Rich text would corrupt JSON; append mode
        doubles a value ARC rewrites whole. Graph has reported that flag as
        true however the column was created (FAIT 89), so it is READ BACK here
        and flagged; the list settings UI and a behavioural check are the
        authority.
      - Choice columns don't allow fill-in values, so a status ARC doesn't
        know can't creep in. A value ARC writes that a column doesn't declare
        is refused, so the choices here must match the app's constants.
      - Idempotent: an existing list is left alone and only missing columns
        (and missing choices) are added. Nothing is ever deleted or recreated.

    Attachments, Quick Launch and PERMISSIONS: Graph can set none of them. A
    genericList is created with attachments ON, so Pricing Requests and New
    Product Pricing need nothing; Pricing Roles and Pricing History must be
    turned OFF. With -PnPClientId (and PnP.PowerShell installed) the script
    sets attachments and Quick Launch through SharePoint REST and reads them
    back. Unique permissions are ALWAYS manual — the script prints the matrix.

.PARAMETER WhatIf
    Report what would be created or changed; change nothing.

.PARAMETER SiteId
    Graph site id. Defaults to ALTRONICSALESTEAM (SITES.salesTeam in
    src/api/config.ts).

.PARAMETER SiteUrl
    The same site's URL, used only for the SharePoint REST (PnP) step and the
    manual instructions.

.PARAMETER AdminEmail
    Optional. Seeds this person as a pricing `admin` on Pricing Roles (only if
    no row for that email exists yet), so somebody can manage the roles list
    from inside ARC on day one.

.PARAMETER AdminName
    Optional display name for -AdminEmail (stored in PersonName). Defaults to
    the part of the address before the @.

.PARAMETER PnPClientId
    Optional. The Entra app (client) id to use with Connect-PnPOnline
    -Interactive. When given, attachments and Quick Launch are set through
    SharePoint REST and read back. Without it, manual steps are printed.

.EXAMPLE
    ./scripts/create-pricing-lists.ps1 -WhatIf

.EXAMPLE
    ./scripts/create-pricing-lists.ps1 -AdminEmail ray.white@altronic-llc.com -AdminName "Ray White"

.NOTES
    Needs Sites.Manage.All — creating a list is a write, and needs Manage
    Lists rights on the site (ARC's own Sites.Selected grant does not include
    that).
#>
param(
    [switch]$WhatIf,
    [string]$SiteId = "coopermachineryservices.sharepoint.com,dd86bf69-a010-481a-9920-78b079c5ec1e,aa6b9467-3f57-4213-bbd4-60b94403421a",
    [string]$SiteUrl = "https://coopermachineryservices.sharepoint.com/sites/ALTRONICSALESTEAM",
    [string]$AdminEmail,
    [string]$AdminName,
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
# Multi-line PLAIN text. Never Enhanced rich text: History, Bom and
# PriceBreaks hold JSON, and the rich-text wrapper would corrupt it.
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
function Choice($name, $display, [string[]]$Choices, $Default, [switch]$Indexed) {
    $c = @{ name = $name; displayName = $display
            choice = @{ choices = $Choices; displayAs = "dropDownMenu"; allowTextEntry = $false } }
    if ($Default) { $c.defaultValue = @{ value = $Default } }
    if ($Indexed) { $c.indexed = $true }
    $c
}
function DateOnly($name, $display) {
    @{ name = $name; displayName = $display; dateTime = @{ format = "dateOnly"; displayAs = "standard" } }
}
# A moment, not a day — "when was this priced" needs the time.
function DateAndTime($name, $display) {
    @{ name = $name; displayName = $display; dateTime = @{ format = "dateTime"; displayAs = "standard" } }
}
function Person($name, $display) {
    @{ name = $name; displayName = $display; personOrGroup = @{ allowMultipleSelection = $false; chooseFromType = "peopleOnly" } }
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

# Where a figure came from. Saved beside the figure so a price can always be
# explained later ("the discount was typed in, not SAP's").
$CostSources = @("SAP", "Manual")
$DiscountSources = @("SAP", "Default", "Manual")

# ---------------------------------------------------------------- the lists

$Lists = @(
    @{
        name         = "Pricing Roles"
        envVar       = "VITE_SP_PRICING_ROLES_LIST_ID"
        description  = "Who can use the Sales Pricing tool. Title = email; Roles = lowercase CSV of requester / manager / admin. Not on the list = no access. Managed in ARC."
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
        name         = "Pricing Requests"
        envVar       = "VITE_SP_PRICING_REQUESTS_LIST_ID"
        description  = "Sales Pricing requests. Title = PR-YYYY-####. Readable by every requester, so it holds the final price only — never cost or margin. Cancelled, never deleted. Edit through ARC."
        titleDisplay = "Request Number"
        titleUnique  = $true
        attachments  = $true
        columns      = @(
            (Choice "Status" "Status" @("Awaiting SAP", "Submitted", "In Review", "Priced", "Cancelled") "Submitted" -Indexed),
            # The part. SapPartNumber may start blank — ARC fills it from
            # Fabric when SAP links one to the Altronic number.
            (Text "AltronicPartNumber" "Altronic Part #" -Indexed),
            (Text "SapPartNumber" "SAP Part #" -Indexed),
            # What the requester typed is kept; Description is overwritten
            # with SAP's once ARC finds the part, so the two are separate.
            (Note "RequestedDescription" "Requested Description"),
            (Note "Description" "Description"),
            (Text "Mpg" "Material Price Group"),
            (Person "RequestedBy" "Requested By"),
            (Note "RequestNotes" "Notes"),
            # The customer, from Fabric. TEXT, so SAP's leading zeros survive.
            (Text "CustomerSoldTo" "Customer Sold-To" -Indexed),
            (Text "CustomerName" "Customer Name"),
            (Text "CustomerGroup" "Customer Group"),
            # The OUTCOME only. Cost, GM and how the price was reached are on
            # Pricing History, which requesters cannot open.
            (Currency "ListPrice" "List Price"),
            (Number "CustomerDiscountPct" "Customer Discount %"),
            (Currency "CustomerPrice" "Customer Price"),
            (Person "PricedBy" "Priced By"),
            (DateAndTime "PricedAt" "Priced At"),
            (Person "AddedToSapBy" "Added to SAP By"),
            (DateAndTime "AddedToSapAt" "Added to SAP At"),
            (Note "CancelReason" "Cancel Reason"),
            (Communication),
            (People "Watchers" "Watchers")
        )
    },
    @{
        name         = "Pricing History"
        envVar       = "VITE_SP_PRICING_HISTORY_LIST_ID"
        description  = "How each Sales Pricing request was priced: cost, discount, margin, comparables, and a JSON history of every pricing. MANAGERS AND ADMINS ONLY. Edit through ARC."
        titleDisplay = "Request Number"
        titleUnique  = $true
        attachments  = $false
        columns      = @(
            (Lookup "RequestRef" "Request" "Pricing Requests" -Indexed),
            # The CURRENT pricing, as real columns so SharePoint's own views
            # can show and sort them. History holds every pricing, these the
            # latest — recomputed on each write from the same figures.
            (Currency "Cost" "Cost"),
            (Choice "CostSource" "Cost Source" $CostSources),
            (Number "DistributorDiscountPct" "Distributor Discount %"),
            (Choice "DiscountSource" "Discount Source" $DiscountSources),
            (Number "TargetGM" "Target GM %"),
            (Currency "ListPrice" "List Price"),
            (Number "BaseGM" "Base GM %"),
            (Number "CustomerGM" "Customer GM %"),
            # The comparables SUMMARY (Ray, 2026-10-13) — never every row.
            (Text "Mpg" "Material Price Group"),
            (Number "MpgAvgGM" "MPG Avg GM %"),
            (Number "MpgCount" "MPG Parts Counted" "none"),
            (Text "FamilyPrefix" "Family Prefix"),
            (Number "FamilyAvgGM" "Family Avg GM %"),
            (Number "FamilyCount" "Family Parts Counted" "none"),
            (Note "PricingNote" "Pricing Note"),
            # JSON array, one entry per pricing, appended — never rewritten.
            (Note "History" "History")
        )
    },
    @{
        name         = "New Product Pricing"
        envVar       = "VITE_SP_NEW_PRODUCT_PRICING_LIST_ID"
        description  = "Pricing worksheets for products not yet in SAP. Title = NP-YYYY-####. MANAGERS AND ADMINS ONLY. Cancelled, never deleted. Edit through ARC."
        titleDisplay = "Worksheet Number"
        titleUnique  = $true
        attachments  = $true
        columns      = @(
            (Choice "Status" "Status" @("Active", "Cancelled") "Active" -Indexed),
            (Number "Rev" "Rev" "none" 1),
            (Text "ProductName" "Product Name"),
            (Note "Description" "Description"),
            (Text "CustomerSoldTo" "Customer Sold-To"),
            (Text "CustomerName" "Customer Name"),
            (Number "ExpectedAnnualVolume" "Expected Annual Volume" "none"),
            # Optional: the request a manager started this worksheet from.
            (Lookup "RequestRef" "Request" "Pricing Requests"),
            # The CURRENT revision. Bom and PriceBreaks are JSON — the BOM is
            # edited as one piece and never commented on line by line, so a
            # list of BOM rows would be a second list to keep in step.
            (Note "Bom" "BOM"),
            (Number "OverheadPct" "Overhead %"),
            (Text "Mpg" "Material Price Group"),
            (Number "DistributorDiscountPct" "Distributor Discount %"),
            (Choice "DiscountSource" "Discount Source" $DiscountSources),
            (Number "TargetGM" "Target GM %"),
            (Currency "UnitCost" "Unit Cost"),
            (Currency "ListPrice" "List Price"),
            (Number "BaseGM" "Base GM %"),
            (Note "PriceBreaks" "Price Breaks"),
            # Compare to SAP — remembered once typed (Ray, 2026-10-13).
            (Text "AltronicPartNumber" "Altronic Part #"),
            (Text "SapPartNumber" "SAP Part #"),
            # JSON array, the totals of each revision; the lines live on
            # NP Sub-Assemblies, stamped by revision.
            (Note "History" "History")
        )
    },
    @{
        name         = "NP Sub-Assemblies"
        envVar       = "VITE_SP_NP_SUBASSEMBLIES_LIST_ID"
        description  = "The sub-assemblies of each New Product Pricing worksheet, one row per sub-assembly per revision. Lines are JSON from a CSV upload. MANAGERS AND ADMINS ONLY. Edit through ARC."
        titleDisplay = "Sub-Assembly"
        attachments  = $false
        columns      = @(
            (Lookup "WorksheetRef" "Worksheet" "New Product Pricing" -Indexed),
            (Number "Rev" "Rev" "none" 1),
            (Number "SortOrder" "Sort Order" "none"),
            (Number "QuantityPerProduct" "Qty per Product" "automatic" 1),
            # JSON: [{ partNumber, description, quantity, uploadedCost, adjustedCost }].
            # The uploaded cost is the sheet's and is never changed by ARC.
            (Note "Lines" "Lines"),
            (Text "FileName" "File Name"),
            (DateAndTime "UploadedAt" "Uploaded At"),
            (Text "UploadedByName" "Uploaded By"),
            (Text "UploadedByEmail" "Uploaded By Email")
        )
    },
    @{
        name         = "Customer Quotes"
        envVar       = "VITE_SP_CUSTOMER_QUOTES_LIST_ID"
        description  = "Customer quotes built from New Product Pricing worksheets, SAP parts, priced requests and free lines. Title = SQ-YYYY-####-R#. A revision is a new row sharing QuoteBase. Never deleted. MANAGERS AND ADMINS ONLY."
        titleDisplay = "Quote Number"
        titleUnique  = $true
        attachments  = $true
        columns      = @(
            (Text "QuoteBase" "Quote Base" -Indexed),
            (Number "Rev" "Rev" "none" 1),
            (Choice "Status" "Status" @("Draft", "Sent", "Won", "Lost", "Expired") "Draft" -Indexed),
            (Number "ValidityDays" "Validity Days" "none" 30),
            (Text "CustomerSoldTo" "Customer Sold-To" -Indexed),
            (Text "CustomerName" "Customer Name"),
            # JSON: { soldTo, name, customerGroup, contactName, contactEmail }.
            (Note "Customer" "Customer"),
            # JSON: the quote lines, each with its source and its customer prices.
            (Note "Lines" "Lines"),
            (Note "QuoteNotes" "Quote Notes"),
            (Communication),
            (People "Watchers" "Watchers")
        )
    }
)

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
$appendWarnings = @()

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
            $kinds = @("text", "number", "currency", "choice", "dateTime", "lookup", "personOrGroup")
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

    # Title: a readable display name, indexed + unique where it is the number
    # ARC generates (two people creating at once must not share one).
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
        # Every plain multi-line column ARC rewrites whole — the comment
        # thread AND the JSON columns. Append mode corrupts all of them.
        if ($col.text -and $col.text.allowMultipleLines) {
            if ($current.text.appendChangesToExistingText) {
                Write-Host "    $($col.name) — Graph reports appendChangesToExistingText = TRUE." -ForegroundColor Red
                $appendWarnings += "$($spec.name) → $($col.name)"
            }
        }
    }
}

# ---------------------------------------------------------------- seed an admin

if ($AdminEmail) {
    $email = $AdminEmail.Trim().ToLowerInvariant()
    $name = if ($AdminName) { $AdminName } else { $email.Split("@")[0] }
    Write-Host "`nPricing Roles — seed admin $email" -ForegroundColor Cyan
    $rolesId = $listIds["Pricing Roles"]
    if (-not $rolesId) {
        Write-Host "  Pricing Roles does not exist yet$(if ($WhatIf) { ' (-WhatIf)' }) — WOULD ADD $email as admin after creating it." -ForegroundColor Yellow
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
            Write-Host "  WOULD ADD: Title=$email, PersonName=$name, Roles=admin" -ForegroundColor Yellow
        } else {
            $item = Invoke-MgGraphRequest -Method POST -Uri "$Graph/lists/$rolesId/items" `
                -Body (@{ fields = @{ Title = $email; PersonName = $name; Roles = "admin" } } | ConvertTo-Json -Depth 5) `
                -ContentType "application/json"
            # Read back: a 2xx is not proof a value landed (the DisplayName trap).
            $back = Invoke-MgGraphRequest -Method GET -Uri "$Graph/lists/$rolesId/items/$($item.id)?`$expand=fields(`$select=Title,PersonName,Roles)"
            if ($back.fields.PersonName -eq $name -and $back.fields.Roles -eq "admin") {
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
                Write-Host ("  {0,-20} attachments={1} quickLaunch={2} hidden={3}  {4}" -f $spec.name, $after.EnableAttachments, $after.OnQuickLaunch, $after.Hidden, $(if ($ok) { "ok" } else { "NOT AS WANTED" })) `
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
}

# ---------------------------------------------------------------- permissions (always manual)

Write-Host "`nUNIQUE PERMISSIONS — the real boundary; ARC's role gating is UI-only." -ForegroundColor Yellow
Write-Host "  On each list: List settings → Permissions for this list → Stop Inheriting Permissions," -ForegroundColor Yellow
Write-Host "  then remove the inherited site groups and grant only:" -ForegroundColor Yellow
Write-Host "    Pricing Roles         every pricing user = Read (ARC reads it to decide access); pricing admins = Contribute" -ForegroundColor Yellow
Write-Host "    Pricing Requests      requesters, managers, admins = Contribute" -ForegroundColor Yellow
Write-Host "    Pricing History       managers, admins = Contribute.  NO requesters — this list holds cost and margin." -ForegroundColor Yellow
Write-Host "    New Product Pricing   managers, admins = Contribute.  NO requesters." -ForegroundColor Yellow
Write-Host "    NP Sub-Assemblies     managers, admins = Contribute.  NO requesters." -ForegroundColor Yellow
Write-Host "    Customer Quotes       managers, admins = Contribute.  NO requesters." -ForegroundColor Yellow
Write-Host "  Grant at the LIST, never per item: ARC reads a list returning no rows it reports holding as" -ForegroundColor Yellow
Write-Host "  'you can't read this' and locks the screen." -ForegroundColor Yellow
Write-Host "  Fabric: give only managers and admins 'Run Queries and Mutations' on the GraphQL API item, so a" -ForegroundColor Yellow
Write-Host "  requester can't pull cost from the warehouse either." -ForegroundColor Yellow

# ---------------------------------------------------------------- the rest of the checklist

Write-Host "`nVERIFY THE REWRITTEN COLUMNS, BEHAVIOURALLY:" -ForegroundColor $(if ($appendWarnings.Count) { "Red" } else { "Yellow" })
if ($appendWarnings.Count) {
    Write-Host "  Graph reports 'Append Changes to Existing Text' ON for: $($appendWarnings -join '; ')." -ForegroundColor Red
    Write-Host "  Turn it OFF in List settings → that column. A Graph PATCH is accepted and changes nothing (FAIT 89)." -ForegroundColor Red
}
Write-Host "  Graph's answer alone proves nothing. Post two comments on one request, and price one request twice;" -ForegroundColor Yellow
Write-Host "  the second write must REPLACE the stored Communication / History value, not double it." -ForegroundColor Yellow

Write-Host "`nWRITE / READ-BACK CHECK: a 2xx from a write is not proof a value landed (the DisplayName trap)." -ForegroundColor Yellow
Write-Host "  Before building on these lists, write one value into each column through Graph and read it back" -ForegroundColor Yellow
Write-Host "  — at minimum PersonName on Pricing Roles, the two RequestRef lookups (bare integers) and the" -ForegroundColor Yellow
Write-Host "  three single-person columns on Pricing Requests." -ForegroundColor Yellow

Write-Host "`nList ids — add to .env.local, to the GitHub repo variables, and to deploy.yml's named list:" -ForegroundColor Cyan
foreach ($spec in $Lists) { Write-Host "  $($spec.envVar)=$($listIds[$spec.name])" -ForegroundColor Green }

Write-Host "`nRepo variables:" -ForegroundColor Cyan
foreach ($spec in $Lists) {
    Write-Host "  gh variable set $($spec.envVar) --repo Altronic-LLC/altronic-arc --body `"$($listIds[$spec.name])`"" -ForegroundColor Green
}

Write-Host "`nTHEN REDEPLOY. VITE_* values are baked in at build time; setting a repo variable does nothing" -ForegroundColor Yellow
Write-Host "until the next deploy." -ForegroundColor Yellow
if (-not $AdminEmail) {
    Write-Host "`nNobody holds a pricing role yet. Re-run with -AdminEmail to seed an admin, or add a row to Pricing Roles." -ForegroundColor Yellow
}
Write-Host ""
