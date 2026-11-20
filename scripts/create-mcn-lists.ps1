<#
.SYNOPSIS
    Creates the three lists behind ARC's Manufacturing Change Notices
    (BusinessIT#38, Feature Request #24), on the Altronic_PMO site.

.DESCRIPTION
    Three lists, beside the Operations Task List and the CMMS lists:

        Manufacturing Change Notices   Title = MCNyy### (indexed, unique). One
                                       row per MCN: every box on MFGFRM-021 is
                                       a column, the scope lines are JSON, the
                                       final distribution list is plain text.
                                       Attachments ON. Never deleted.
        MCN Roles                      Title = email; PersonName, Roles
                                       (lowercase CSV of member / approver /
                                       admin), Note. Not on the list = can read
                                       MCNs, nothing more.
        MCN Distribution Groups        Title = the role on the form (the eight
                                       Distribution boxes); Members (one
                                       "Name <email>" per line), SortOrder.
                                       Seeded with the eight roles, no people.

    THE INTERNAL NAMES ARE A CONTRACT with src/lib/mcnFields.ts and
    src/api/mcns.ts. Do not rename a column here without changing it there in
    the same commit.

    Rules this script follows, each learned elsewhere in ARC (CLAUDE.md):
      - The name column on MCN Roles is PersonName, NEVER DisplayName: Graph
        silently drops a listItem field called DisplayName.
      - The person and lookup columns are SINGLE-value (Originated By,
        Assigned Engineer, Approved By, Operations Task). ARC writes them as
        bare integers and selects both halves on a read.
      - Distribution is the ONE multi-choice column (checkboxes). ARC writes it
        with the Collection(Edm.String) annotation.
      - JSON, list-of-people and comment columns are multi-line PLAIN text
        with "Append Changes to Existing Text" OFF. Graph has reported that
        flag as true however the column was created (FAIT 89), so it is READ
        BACK here and flagged; the list settings UI and a behavioural check
        are the authority.
      - Description is Enhanced rich text: it holds the formatted description
        and SharePoint's own views render it.
      - Choice columns don't allow fill-in values; the choices here must
        match the constants in src/types/mcn.ts.
      - Idempotent: an existing list is left alone and only missing columns
        (and missing choices) are added. The eight groups are seeded only into
        an EMPTY groups list. Nothing is ever deleted or recreated.

    Attachments, Quick Launch and PERMISSIONS: Graph can set none of them. A
    genericList is created with attachments ON, which the MCN list wants; MCN
    Roles and MCN Distribution Groups should have them OFF. With -PnPClientId
    (and PnP.PowerShell installed) the script sets attachments and Quick Launch
    through SharePoint REST. Permissions are ALWAYS manual.

.PARAMETER WhatIf
    Report what would be created or changed; change nothing.

.PARAMETER SiteId
    Graph site id. Defaults to Altronic_PMO (SITES.pmo in src/api/config.ts).

.PARAMETER SiteUrl
    The same site's URL, used only for the SharePoint REST (PnP) step and the
    manual instructions.

.PARAMETER AdminEmail
    Optional. Seeds this person as an MCN `admin` on MCN Roles (only if no row
    for that email exists yet), so somebody can manage the team from inside
    ARC on day one. ARC admins can manage it anyway.

.PARAMETER AdminName
    Optional display name for -AdminEmail (stored in PersonName).

.PARAMETER PnPClientId
    Optional. The Entra app (client) id to use with Connect-PnPOnline
    -Interactive.

.EXAMPLE
    ./scripts/create-mcn-lists.ps1 -WhatIf

.NOTES
    Needs Sites.Manage.All — creating a list is a write, and needs Manage
    Lists rights on the site (ARC's own Sites.Selected grant does not include
    that). The team's names go in through ARC's Settings screen, never here
    and never in src/ — the repository is public.
#>
param(
    [switch]$WhatIf,
    [string]$SiteId = "coopermachineryservices.sharepoint.com,915a6183-2b71-4dfd-a8b9-181126dfbe78,3eb6cb9c-6535-4c69-a8d7-e90b2f90a9eb",
    [string]$SiteUrl = "https://coopermachineryservices.sharepoint.com/sites/Altronic_PMO",
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
# Multi-line PLAIN text — JSON, people lists and the comment thread. ARC
# rewrites these whole, so append mode must be OFF.
function Note($name, $display) {
    @{ name = $name; displayName = $display; text = @{ allowMultipleLines = $true; textType = "plain"; appendChangesToExistingText = $false } }
}
# Enhanced rich text — the description, which ARC writes as HTML.
function RichNote($name, $display) {
    @{ name = $name; displayName = $display; text = @{ allowMultipleLines = $true; textType = "richText"; appendChangesToExistingText = $false } }
}
function Number($name, $display, [string]$Decimals = "automatic") {
    @{ name = $name; displayName = $display; number = @{ decimalPlaces = $Decimals } }
}
function Choice($name, $display, [string[]]$Choices, $Default, [switch]$Indexed) {
    $c = @{ name = $name; displayName = $display
            choice = @{ choices = $Choices; displayAs = "dropDownMenu"; allowTextEntry = $false } }
    if ($Default) { $c.defaultValue = @{ value = $Default } }
    if ($Indexed) { $c.indexed = $true }
    $c
}
# The ONE genuine multi-choice column. checkBoxes is what makes it multi —
# Graph reports type "choice" either way.
function MultiChoice($name, $display, [string[]]$Choices) {
    @{ name = $name; displayName = $display
       choice = @{ choices = $Choices; displayAs = "checkBoxes"; allowTextEntry = $false } }
}
function DateOnly($name, $display) {
    @{ name = $name; displayName = $display; dateTime = @{ format = "dateOnly"; displayAs = "standard" } }
}
function DateAndTime($name, $display) {
    @{ name = $name; displayName = $display; dateTime = @{ format = "dateTime"; displayAs = "standard" } }
}
function Person($name, $display) {
    @{ name = $name; displayName = $display; personOrGroup = @{ allowMultipleSelection = $false; chooseFromType = "peopleOnly" } }
}
function People($name, $display) {
    @{ name = $name; displayName = $display; personOrGroup = @{ allowMultipleSelection = $true; chooseFromType = "peopleOnly" } }
}
function Lookup($name, $display, $targetList) {
    @{ name = $name; displayName = $display; lookupTarget = $targetList
       lookup = @{ columnName = "Title"; allowMultipleValues = $false } }
}

# Must match src/types/mcn.ts.
$Statuses = @("Draft", "Submitted", "Approved", "Implemented", "Rejected")
$Priorities = @("Level 1", "Level 2", "Level 3")
$YesNo = @("Yes", "No")
$DistributionRoles = @(
    "Engineering", "VP Global Ops.", "Quality Manager", "Logistics Manager",
    "Test Eng. Manager", "Sales", "Purchasing Manager", "SHE Coordinator"
)

# The form's "Requires…" and "Incorporate into" lines: a Yes / No and a
# reference each (Notify Customer has no reference). Must match MCN_REQUIRES /
# MCN_INCORPORATE in src/lib/mcnFields.ts.
$Items = @(
    @{ key = "ReqBulkMaterial"; label = "Requires Bulk Material Review" },
    @{ key = "ReqWorkInstruction"; label = "Requires Work Instruction Change" },
    @{ key = "ReqRouter"; label = "Requires Router Change" },
    @{ key = "ReqShe"; label = "Requires SHE Update" },
    @{ key = "IncNewPcbs"; label = "Incorporate - New PCBs" },
    @{ key = "IncNewProduction"; label = "Incorporate - New Production" },
    @{ key = "IncNewAssemblies"; label = "Incorporate - New Assemblies" },
    @{ key = "IncNotifyCustomer"; label = "Incorporate - Notify Customer"; noRef = $true },
    @{ key = "IncOther1"; label = "Incorporate - Other 1" },
    @{ key = "IncOther2"; label = "Incorporate - Other 2" }
)
$ItemColumns = @()
foreach ($i in $Items) {
    $ItemColumns += (Choice $i.key $i.label $YesNo)
    if (-not $i.noRef) { $ItemColumns += (Text "$($i.key)Ref" "$($i.label) Ref") }
}

# ---------------------------------------------------------------- the lists

$Lists = @(
    @{
        name         = "MCN Roles"
        envVar       = "VITE_SP_MCN_ROLES_LIST_ID"
        description  = "Who can raise, approve and manage Manufacturing Change Notices. Title = email; Roles = lowercase CSV of member / approver / admin. Everyone signed in can read MCNs. Managed in ARC."
        titleDisplay = "Email"
        attachments  = $false
        columns      = @(
            (Text "PersonName" "Name"),
            (Text "Roles" "Roles"),
            (Note "Note" "Note")
        )
    },
    @{
        name         = "MCN Distribution Groups"
        envVar       = "VITE_SP_MCN_DISTRIBUTION_GROUPS_LIST_ID"
        description  = "The Distribution roles on MFGFRM-021 and who receives an approved MCN for each. Members = one 'Name <email>' per line. Managed in ARC."
        titleDisplay = "Distribution Role"
        attachments  = $false
        columns      = @(
            (Note "Members" "Members"),
            (Number "SortOrder" "Sort Order" "none")
        )
    },
    @{
        name         = "Manufacturing Change Notices"
        envVar       = "VITE_SP_MCNS_LIST_ID"
        description  = "Manufacturing Change Notices (MWI-762, MFGFRM-021). Title = MCNyy###. Approved and distributed in ARC; never deleted — a withdrawn change is Rejected. Edit through ARC."
        titleDisplay = "MCN Number"
        titleUnique  = $true
        attachments  = $true
        columns      = @(
            (DateOnly "McnDate" "Date"),
            (Text "Process" "Process"),
            (Choice "Priority" "Priority" $Priorities),
            (Choice "McnStatus" "Status" $Statuses "Draft" -Indexed),
            (Person "OriginatedBy" "Originated By"),
            (Person "AssignedEngineer" "Assigned Engineer"),
            (Person "ApprovedBy" "Approved By"),
            (DateAndTime "ApprovedDate" "Approved Date"),
            (RichNote "Description" "Description and Reason"),
            # JSON: [{ departmentId, department, process, equipment }].
            (Note "ScopeLines" "Scope"),
            (MultiChoice "Distribution" "Distribution" $DistributionRoles)
        ) + $ItemColumns + @(
            # Who the approved MCN was actually sent to — one "Name <email>"
            # per line — and when. The Implemented email goes to the same people.
            (Note "DistributedTo" "Distributed To"),
            (DateAndTime "DistributedAt" "Distributed At"),
            (DateOnly "DateImplemented" "Date Implemented"),
            (Note "AffectedCodes" "Date Codes / Serial Numbers Affected"),
            (Note "RejectionReason" "Rejection Reason"),
            (Lookup "OperationsTaskRef" "Operations Task" "Operations Task List"),
            # The import: which old record a row came from, and what to say about it.
            (Text "LegacySource" "Legacy Source" -Indexed),
            (Text "LegacyNote" "Legacy Note"),
            (Note "Communication" "Communication"),
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
    $script:AllLists = @()
    $uri = "$Graph/lists?`$select=id,displayName,name,webUrl,createdDateTime&`$top=200"
    while ($uri) {
        # /lists is PAGED — an unpaged call silently returns a subset.
        $page = Invoke-MgGraphRequest -Method GET -Uri $uri
        foreach ($l in $page.value) { $found[$l.displayName] = $l.id; $script:AllLists += $l }
        $uri = $page.'@odata.nextLink'
    }
    return $found
}

# A list whose display name differs but whose URL name is the one Graph would
# give a new list called $name. SharePoint fixes a list's URL at creation and
# keeps it through renames, so a renamed list still blocks the name with
# "409 nameAlreadyExists" — and matching on display name alone misses it.
function Find-NameConflict($name) {
    $squashed = ($name -replace "\s", "").ToLowerInvariant()
    foreach ($l in $script:AllLists) {
        $segment = [Uri]::UnescapeDataString(("$($l.webUrl)" -split "/")[-1])
        $candidates = @("$($l.name)", $segment) | ForEach-Object { ($_ -replace "\s", "").ToLowerInvariant() }
        if ($candidates -contains $squashed) { return $l }
    }
    return $null
}

function Resolve-Column($col, $listIds) {
    $c = @{}
    foreach ($k in $col.Keys) { if ($k -ne "lookupTarget") { $c[$k] = $col[$k] } }
    if ($col.lookupTarget) {
        $target = $listIds[$col.lookupTarget]
        if (-not $target) { throw "Lookup $($col.name) points at '$($col.lookupTarget)', which does not exist on this site." }
        $c.lookup = @{ listId = $target; columnName = $col.lookup.columnName; allowMultipleValues = $false }
    }
    return $c
}

$existing = Get-ExistingLists
$listIds = @{}
foreach ($spec in $Lists) { if ($existing.ContainsKey($spec.name)) { $listIds[$spec.name] = $existing[$spec.name] } }
# The Operations Task List already exists on PMO — the target of OperationsTaskRef.
if ($existing.ContainsKey("Operations Task List")) { $listIds["Operations Task List"] = $existing["Operations Task List"] }
else { Write-Host "Operations Task List not found on this site — OperationsTaskRef can't be created." -ForegroundColor Red }
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
        $conflict = Find-NameConflict $spec.name
        if ($conflict) {
            Write-Host "  NOT CREATED — the name '$($spec.name)' is already taken on this site by:" -ForegroundColor Red
            Write-Host "    display name '$($conflict.displayName)', id $($conflict.id), created $($conflict.createdDateTime)" -ForegroundColor Red
            Write-Host "    $($conflict.webUrl)" -ForegroundColor Red
            Write-Host "  Open it and decide: if it's an old or test list nobody needs, delete it (and empty it from the" -ForegroundColor Yellow
            Write-Host "  site recycle bin), then re-run. The script won't take over a list it didn't create." -ForegroundColor Yellow
            continue
        }
        $created = $null
        try {
            $created = Invoke-MgGraphRequest -Method POST -Uri "$Graph/lists" -Body $body -ContentType "application/json"
        } catch {
            $was409 = "$($_.Exception.Message) $($_.ErrorDetails.Message)" -match "nameAlreadyExists|409"
            # Creating a list with ~40 columns can be slow; the Graph module
            # RETRIES a slow or throttled request, and if the first attempt
            # landed, the retry gets 409 for the list it just made (seen
            # 2026-10-26). So look again before calling it a conflict.
            $recheck = if ($was409) { Get-ExistingLists } else { @{} }
            if ($recheck.ContainsKey($spec.name)) {
                $created = @{ id = $recheck[$spec.name] }
                Write-Host "  (the first request created it; Graph's retry was refused as a duplicate — carrying on with it)" -ForegroundColor Yellow
            } elseif ($was409) {
                Write-Host "  NOT CREATED — SharePoint says the name '$($spec.name)' is already taken, but no list on the site" -ForegroundColor Red
                Write-Host "  shows it. It's most likely a deleted list still in the recycle bin:" -ForegroundColor Red
                Write-Host "    $SiteUrl/_layouts/15/RecycleBin.aspx  (check the second-stage bin too)" -ForegroundColor Yellow
                Write-Host "  Delete it from there permanently, then re-run." -ForegroundColor Yellow
                continue
            } else {
                throw
            }
        }
        $listId = $created.id
        $listIds[$spec.name] = $listId
        Write-Host "  CREATED — id $listId" -ForegroundColor Green
    }

    $cols = (Invoke-MgGraphRequest -Method GET -Uri "$Graph/lists/$listId/columns").value
    foreach ($col in $spec.columns) {
        $current = $cols | Where-Object { $_.name -eq $col.name } | Select-Object -First 1
        if ($current) {
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
                Write-Host "    $($col.name) — added choice(s): $($missing -join ', ')" -ForegroundColor Green
            }
            $kinds = @("text", "number", "choice", "dateTime", "lookup", "personOrGroup")
            $want = $kinds | Where-Object { $col.ContainsKey($_) } | Select-Object -First 1
            if ($want -and -not $current.$want) {
                Write-Host "    $($col.name) — EXISTS BUT IS NOT A '$want' COLUMN. ARC's contract needs '$want'; fix by hand." -ForegroundColor Red
            }
            if ($col.choice -and $current.choice -and $current.choice.displayAs -ne $col.choice.displayAs) {
                Write-Host "    $($col.name) — displayAs is '$($current.choice.displayAs)', ARC expects '$($col.choice.displayAs)'. Fix by hand." -ForegroundColor Red
            }
        } elseif ($WhatIf) {
            Write-Host "    $($col.name) — WOULD ADD" -ForegroundColor Yellow
        } else {
            Invoke-MgGraphRequest -Method POST -Uri "$Graph/lists/$listId/columns" `
                -Body ((Resolve-Column $col $listIds) | ConvertTo-Json -Depth 10) -ContentType "application/json" | Out-Null
            Write-Host "    $($col.name) — added" -ForegroundColor Green
        }
    }

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
                Write-Host "    Title — '$($spec.titleDisplay)'$(if ($spec.titleUnique) { ', indexed, unique' })" -ForegroundColor Green
            } catch {
                Write-Host "    Title — could not update ($($_.Exception.Message)). Do it in List settings." -ForegroundColor Red
            }
        }
    }

    if ($WhatIf) { continue }

    $cols = (Invoke-MgGraphRequest -Method GET -Uri "$Graph/lists/$listId/columns").value
    foreach ($col in $spec.columns) {
        $current = $cols | Where-Object { $_.name -eq $col.name } | Select-Object -First 1
        if (-not $current) { Write-Host "    $($col.name) — MISSING after create. Check the list." -ForegroundColor Red; continue }
        if ($col.indexed -and -not $current.indexed) {
            Write-Host "    $($col.name) — NOT indexed. List settings → Indexed columns → add it." -ForegroundColor Red
        }
        if ($col.text -and $col.text.allowMultipleLines -and $current.text.appendChangesToExistingText) {
            Write-Host "    $($col.name) — Graph reports appendChangesToExistingText = TRUE." -ForegroundColor Red
            $appendWarnings += "$($spec.name) → $($col.name)"
        }
    }
}

# ---------------------------------------------------------------- seed the eight groups

Write-Host "`nMCN Distribution Groups — the eight roles on MFGFRM-021" -ForegroundColor Cyan
$groupsId = $listIds["MCN Distribution Groups"]
if (-not $groupsId) {
    Write-Host "  not created yet$(if ($WhatIf) { ' (-WhatIf)' }) — WOULD SEED: $($DistributionRoles -join ', ')" -ForegroundColor Yellow
} else {
    $rows = (Invoke-MgGraphRequest -Method GET -Uri "$Graph/lists/$groupsId/items?`$top=50").value
    if ($rows.Count -gt 0) {
        Write-Host "  already holds $($rows.Count) row(s) — left alone (the list is the source of truth now)" -ForegroundColor Yellow
    } elseif ($WhatIf) {
        Write-Host "  WOULD SEED: $($DistributionRoles -join ', ')" -ForegroundColor Yellow
    } else {
        $order = 1
        foreach ($role in $DistributionRoles) {
            Invoke-MgGraphRequest -Method POST -Uri "$Graph/lists/$groupsId/items" `
                -Body (@{ fields = @{ Title = $role; SortOrder = $order; Members = "" } } | ConvertTo-Json -Depth 5) `
                -ContentType "application/json" | Out-Null
            $order++
        }
        Write-Host "  seeded $($DistributionRoles.Count) roles, no members — add them in ARC's MCN Settings" -ForegroundColor Green
    }
}

# ---------------------------------------------------------------- seed an admin

if ($AdminEmail) {
    $email = $AdminEmail.Trim().ToLowerInvariant()
    $name = if ($AdminName) { $AdminName } else { $email.Split("@")[0] }
    Write-Host "`nMCN Roles — seed admin $email" -ForegroundColor Cyan
    $rolesId = $listIds["MCN Roles"]
    if (-not $rolesId) {
        Write-Host "  MCN Roles does not exist yet$(if ($WhatIf) { ' (-WhatIf)' }) — WOULD ADD $email as admin." -ForegroundColor Yellow
    } else {
        $rows = (Invoke-MgGraphRequest -Method GET -Uri "$Graph/lists/$rolesId/items?`$expand=fields(`$select=Title,Roles)&`$top=500").value
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
if ($PnPClientId -and (Get-Module -ListAvailable -Name PnP.PowerShell)) {
    Write-Host "`nSetting attachments and Quick Launch through SharePoint REST..." -ForegroundColor Cyan
    try {
        Import-Module PnP.PowerShell
        Connect-PnPOnline -Url $SiteUrl -Interactive -ClientId $PnPClientId
        $allOk = $true
        foreach ($spec in $Lists) {
            $url = "$SiteUrl/_api/web/lists(guid'$($listIds[$spec.name])')"
            $now = Invoke-PnPSPRestMethod -Method Get -Url "$url`?`$select=EnableAttachments,OnQuickLaunch"
            $patch = @{}
            if ([bool]$now.EnableAttachments -ne $spec.attachments) { $patch.EnableAttachments = $spec.attachments }
            if ([bool]$now.OnQuickLaunch) { $patch.OnQuickLaunch = $false }
            if ($patch.Count -gt 0) { Invoke-PnPSPRestMethod -Method Merge -Url $url -Content $patch | Out-Null }
            $after = Invoke-PnPSPRestMethod -Method Get -Url "$url`?`$select=EnableAttachments,OnQuickLaunch"
            $ok = ([bool]$after.EnableAttachments -eq $spec.attachments) -and -not [bool]$after.OnQuickLaunch
            if (-not $ok) { $allOk = $false }
            Write-Host ("  {0,-30} attachments={1} quickLaunch={2}  {3}" -f $spec.name, $after.EnableAttachments, $after.OnQuickLaunch, $(if ($ok) { "ok" } else { "NOT AS WANTED" })) `
                -ForegroundColor $(if ($ok) { "Green" } else { "Red" })
        }
        $restDone = $allOk
    } catch {
        Write-Host "  SharePoint REST step failed: $($_.Exception.Message)" -ForegroundColor Red
    }
}

if (-not $restDone) {
    Write-Host "`nMANUAL STEPS — Graph cannot set attachments or Quick Launch:" -ForegroundColor Yellow
    Write-Host "  Site contents: $SiteUrl/_layouts/15/viewlsts.aspx" -ForegroundColor Yellow
    foreach ($spec in $Lists) {
        $want = if ($spec.attachments) { "Enabled" } else { "Disabled" }
        Write-Host "  $($spec.name): Attachments = $want; Display on the Quick Launch = No" -ForegroundColor Yellow
    }
}

# ---------------------------------------------------------------- permissions (always manual)

Write-Host "`nPERMISSIONS — the real boundary; ARC's role gating only decides which buttons show." -ForegroundColor Yellow
Write-Host "    Manufacturing Change Notices   everyone = Read (and Contribute, if non-members are to comment);" -ForegroundColor Yellow
Write-Host "                                   Manufacturing Team + approvers = Contribute" -ForegroundColor Yellow
Write-Host "    MCN Roles                      everyone = Read (ARC reads it to decide access); MCN admins = Contribute" -ForegroundColor Yellow
Write-Host "    MCN Distribution Groups        everyone = Read; MCN admins = Contribute" -ForegroundColor Yellow
Write-Host "  Grant at the LIST, never per item." -ForegroundColor Yellow

Write-Host "`nVERIFY BEHAVIOURALLY:" -ForegroundColor $(if ($appendWarnings.Count) { "Red" } else { "Yellow" })
if ($appendWarnings.Count) {
    Write-Host "  Graph reports 'Append Changes to Existing Text' ON for: $($appendWarnings -join '; '). Turn it OFF in List settings." -ForegroundColor Red
}
Write-Host "  Post two comments on one MCN — the second must REPLACE the stored Communication value, not double it." -ForegroundColor Yellow
Write-Host "  Write and read back one value per column: PersonName, the three single-person columns (bare integers)," -ForegroundColor Yellow
Write-Host "  OperationsTaskRef, Distribution (annotated array) and ScopeLines." -ForegroundColor Yellow

Write-Host "`nList ids — add to .env.local, and set them as GitHub repo variables (this script does NOT run the commands below — run them yourself):" -ForegroundColor Cyan
foreach ($spec in $Lists) { Write-Host "  $($spec.envVar)=$($listIds[$spec.name])" -ForegroundColor Green }
foreach ($spec in $Lists) {
    Write-Host "  gh variable set $($spec.envVar) --repo Altronic-LLC/altronic-arc --body `"$($listIds[$spec.name])`"" -ForegroundColor Green
}
Write-Host "`nTHEN REDEPLOY. VITE_* values are baked in at build time.`n" -ForegroundColor Yellow
