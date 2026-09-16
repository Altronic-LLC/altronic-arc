<#
.SYNOPSIS
    Creates the ECN Checklists list on the Altronic_Engineering site.

.DESCRIPTION
    Backs the Cross-Functional ECN Checklist (Form# MFGFRM-038) on each ECN's
    detail page — ONE ROW PER ECN, tied to the ECNs list by a lookup.

        ECN Checklists
            Title             the ECN's Log# — app-derived, so the row is
                               identifiable in SharePoint's own views
            EcnRef            LOOKUP into the ECNs list (single). The link
                               between a checklist and its ECN.
            Status            choice — Not Started / In Progress / Complete.
                               Derived from the answers and written with them,
                               so it can never disagree with what it summarises
            TemplateRevision  text — which revision of MFGFRM-038 the answers
                               were given against ("0" today)
            Answers           multi-line PLAIN text — all 84 per-item answers
                               as JSON (see below)
            ItemsTotal        number — rollups, so a SharePoint view can answer
            ItemsComplete             "which checklists are outstanding"
            ItemsNa                   without parsing the JSON
            ItemsFlagged
            CompletedBy       single person — who signed the checklist off
            CompletedDate     date — when
            Communication     the comment thread, the same pipe-delimited shape
                               every other comment-carrying list in ARC uses
            Watchers          multi-person — creator plus anyone mentioned

    WHY THE ANSWERS ARE ONE JSON COLUMN, not 84 columns or 84 rows:

      - 84 rows per ECN x 1,800+ ECNs is 150,000+ list items, far past
        SharePoint's 5,000-item threshold, and 84 writes to create one
        checklist. One row per ECN is ~1,800 rows and one write.
      - 84 pairs of real columns is 168 columns on one list, and the form WILL
        be revised (this is Rev 0) — each revision then being a SharePoint
        migration rather than a code change.

    The trade-off, stated plainly: individual answers are NOT queryable from
    SharePoint's own views. That is what the four rollup columns are for. If
    per-item cross-ECN reporting is ever needed IN SharePoint, this is the
    decision to revisit.

    The checklist TEMPLATE (the item text, and the form's "On ECN" and
    "requires review" flags) is NOT stored here — it is identical on every ECN
    and lives in src/lib/ecnChecklistTemplate.ts. Nor is the RACI matrix, which
    is static reference material shown in a modal
    (src/lib/ecnChecklistRaci.ts).

    Idempotent: a list that already exists is left alone and missing columns
    are added.

.PARAMETER WhatIf
    Print what would be created without creating anything.

.PARAMETER EcnsListId
    The ECNs list the EcnRef lookup points at. Defaults to the id in
    src/api/config.ts; pass it only to override.

.EXAMPLE
    ./scripts/create-ecn-checklist-list.ps1 -WhatIf

.EXAMPLE
    ./scripts/create-ecn-checklist-list.ps1

.NOTES
    Needs Sites.Manage.All — creating a list is a write. Connect-MgGraph will
    prompt for consent the first time.

    AFTERWARDS, VERIFY "APPEND CHANGES TO EXISTING TEXT" IS OFF on the
    Communication column. Graph reports that flag as true on a newly created
    multi-line column however the request asks, and a PATCH correcting it is
    accepted and changes nothing (see CLAUDE.md, the FAIT note). If it is
    genuinely on, the comment thread CORRUPTS — ARC rewrites the whole value
    each post and append mode concatenates instead. This script prints the
    check to run; the list settings UI is the authority.
#>
param(
    [switch]$WhatIf,
    [string]$EcnsListId = "f6917bf4-bdd1-4ff9-ba71-0a17b22b1ecc"
)

$ErrorActionPreference = "Stop"

# Mirrored from src/api/config.ts (SITES.engineering).
$EngineeringSite = "coopermachineryservices.sharepoint.com,ddb5fc80-ea51-4d56-b008-ce6a82af49b0,aa6b9467-3f57-4213-bbd4-60b94403421a"

# Mirrors EcnChecklist["status"] in src/types/task.ts. ARC derives this from
# the answers on every write — it is a choice column so SharePoint's own views
# can group and filter on it.
$Statuses = @("Not Started", "In Progress", "Complete")

$ListName    = "ECN Checklists"
$EnvVar      = "VITE_SP_ECN_CHECKLISTS_LIST_ID"
$Description = "Cross-Functional ECN Checklist (Form# MFGFRM-038), one row per ECN. Title = the ECN's Log#. Answers holds all 84 item answers as JSON — edit through ARC, not by hand."

$Columns = @(
    @{
        name        = "EcnRef"
        displayName = "ECN"
        lookup      = @{
            listId     = $EcnsListId
            columnName = "Title"
            # SINGLE-value: ARC writes it as a bare integer
            # (EcnRefLookupId: 1412). The Collection(Edm.Int32) shape is for
            # MULTI-value lookups and 400s here.
            allowMultipleValues = $false
        }
    },
    @{
        name        = "Status"
        displayName = "Status"
        choice      = @{
            choices        = $Statuses
            displayAs      = "dropDownMenu"
            allowTextEntry = $false
        }
        defaultValue = @{ value = "Not Started" }
    },
    @{ name = "TemplateRevision"; displayName = "Template Revision"; text = @{ allowMultipleLines = $false } },
    # PLAIN text, NOT "Enhanced rich text" — this holds JSON, and SharePoint's
    # rich-text wrapper would corrupt it into unparseable markup.
    @{ name = "Answers"; displayName = "Answers"; text = @{ allowMultipleLines = $true; textType = "plain" } },
    @{ name = "ItemsTotal";    displayName = "Items Total";    number = @{ decimalPlaces = "none" } },
    @{ name = "ItemsComplete"; displayName = "Items Complete"; number = @{ decimalPlaces = "none" } },
    @{ name = "ItemsNa";       displayName = "Items N/A";      number = @{ decimalPlaces = "none" } },
    @{ name = "ItemsFlagged";  displayName = "Items Flagged";  number = @{ decimalPlaces = "none" } },
    @{ name = "CompletedBy";   displayName = "Completed By";   personOrGroup = @{ allowMultipleSelection = $false } },
    @{ name = "CompletedDate"; displayName = "Completed Date"; dateTime = @{ displayAs = "standard"; format = "dateOnly" } },
    # The comment thread — pipe-delimited records, the same shape ARC already
    # parses everywhere else (src/lib/communicationParser.ts). Plain text, NOT
    # Enhanced rich text: the EIR long-text columns ARE rich text and need HTML
    # written into them, but every Communication column in ARC is plain.
    @{ name = "Communication"; displayName = "Communication"; text = @{ allowMultipleLines = $true; textType = "plain" } },
    @{ name = "Watchers"; displayName = "Watchers"; personOrGroup = @{ allowMultipleSelection = $true } }
)

$ctx = Get-MgContext
if (-not $ctx -or $ctx.Scopes -notcontains "Sites.Manage.All") {
    Write-Host "Signing in (Sites.Manage.All — creating a list is a write)..." -ForegroundColor Cyan
    try {
        Connect-MgGraph -Scopes "Sites.Manage.All" -NoWelcome
    } catch {
        Connect-MgGraph -Scopes "Sites.Manage.All" -UseDeviceCode -NoWelcome
    }
}

function Get-ExistingLists([string]$Site) {
    $found = @{}
    $uri = "https://graph.microsoft.com/v1.0/sites/$Site/lists?`$select=id,displayName&`$top=200"
    while ($uri) {
        # /lists is PAGED, and an unpaged call silently returns a subset — that
        # is how CAD's drawing log looked missing for a day. Follow nextLink.
        $page = Invoke-MgGraphRequest -Method GET -Uri $uri
        foreach ($l in $page.value) { $found[$l.displayName] = $l.id }
        $uri = $page.'@odata.nextLink'
    }
    return $found
}

Write-Host "`n$ListName" -ForegroundColor Cyan

# Refuse rather than create a lookup pointing at a list that isn't there — a
# dangling lookup reads as "attached to no ECN" on every row, silently.
Write-Host "  Checking the ECNs list the lookup will point at..." -ForegroundColor Cyan
try {
    $ecnList = Invoke-MgGraphRequest -Method GET `
        -Uri "https://graph.microsoft.com/v1.0/sites/$EngineeringSite/lists/$EcnsListId`?`$select=id,displayName"
    Write-Host "    $($ecnList.displayName) — ok" -ForegroundColor Green
} catch {
    Write-Host "    NOT FOUND: $EcnsListId" -ForegroundColor Red
    Write-Host "    Pass the right one with -EcnsListId, or check VITE_SP_ECNS_LIST_ID." -ForegroundColor Red
    exit 1
}

$existing = Get-ExistingLists $EngineeringSite

if ($existing.ContainsKey($ListName)) {
    $listId = $existing[$ListName]
    Write-Host "  exists — id $listId" -ForegroundColor Yellow
} elseif ($WhatIf) {
    Write-Host "  WOULD CREATE with columns: $(($Columns | ForEach-Object { $_.name }) -join ', ')" -ForegroundColor Yellow
    Write-Host "`n-WhatIf — nothing was created.`n" -ForegroundColor Yellow
    exit 0
} else {
    $body = @{
        displayName = $ListName
        description = $Description
        list        = @{ template = "genericList" }
        columns     = $Columns
    } | ConvertTo-Json -Depth 10
    $created = Invoke-MgGraphRequest -Method POST `
        -Uri "https://graph.microsoft.com/v1.0/sites/$EngineeringSite/lists" `
        -Body $body -ContentType "application/json"
    $listId = $created.id
    Write-Host "  CREATED — id $listId" -ForegroundColor Green
}

# Add any column the list is missing (covers a list created by hand, or one
# created before a column was added here).
if (-not $WhatIf) {
    $existingCols = (Invoke-MgGraphRequest -Method GET `
        -Uri "https://graph.microsoft.com/v1.0/sites/$EngineeringSite/lists/$listId/columns").value
    $have = @($existingCols | ForEach-Object { $_.name })

    foreach ($col in $Columns) {
        if (-not ($have -contains $col.name)) {
            Invoke-MgGraphRequest -Method POST `
                -Uri "https://graph.microsoft.com/v1.0/sites/$EngineeringSite/lists/$listId/columns" `
                -Body ($col | ConvertTo-Json -Depth 10) -ContentType "application/json" | Out-Null
            Write-Host "    $($col.name) — added" -ForegroundColor Green
        } else {
            Write-Host "    $($col.name) — already there"
        }
    }

    # Attachments, so a checklist can carry a marked-up drawing or an MSDS.
    try {
        Invoke-MgGraphRequest -Method PATCH `
            -Uri "https://graph.microsoft.com/v1.0/sites/$EngineeringSite/lists/$listId" `
            -Body (@{ list = @{ allowAttachments = $true } } | ConvertTo-Json -Depth 5) `
            -ContentType "application/json" | Out-Null
        Write-Host "    attachments — enabled" -ForegroundColor Green
    } catch {
        Write-Host "    attachments — could not set; enable them in list settings" -ForegroundColor Yellow
    }
}

Write-Host "`nAdd this to .env.local (and to the GitHub Actions repo variables):" -ForegroundColor Cyan
Write-Host "  $EnvVar=$listId" -ForegroundColor Green
Write-Host ""
Write-Host "THEN REDEPLOY. VITE_* variables are baked into the bundle when it is" -ForegroundColor Yellow
Write-Host "built, so setting a repo variable does nothing until the next deploy" -ForegroundColor Yellow
Write-Host "runs. Until then the checklist card on an ECN reports itself as not" -ForegroundColor Yellow
Write-Host "configured, the same way an unconfigured list works everywhere else" -ForegroundColor Yellow
Write-Host "in ARC." -ForegroundColor Yellow
Write-Host ""
Write-Host "THEN VERIFY THE COMMENT THREAD, BEHAVIOURALLY:" -ForegroundColor Yellow
Write-Host "  Open the Communication column in list settings and confirm" -ForegroundColor Yellow
Write-Host "  'Append Changes to Existing Text' is NO. Graph reports that flag" -ForegroundColor Yellow
Write-Host "  as true on a new multi-line column whatever the request asked" -ForegroundColor Yellow
Write-Host "  for, and a PATCH correcting it is accepted and does nothing — so" -ForegroundColor Yellow
Write-Host "  the settings UI is the only authority. If it is genuinely on, the" -ForegroundColor Yellow
Write-Host "  comment thread corrupts (ARC rewrites the whole value each post)." -ForegroundColor Yellow
Write-Host ""
