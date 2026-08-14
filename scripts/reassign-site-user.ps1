<#
.SYNOPSIS
    Re-point every person field that references one SharePoint site user at a
    different one. Built for the "assigned to my admin account" case.

.DESCRIPTION
    A person with both a normal and an admin M365 account shows up as TWO
    SharePoint site users, e.g. on Altronic_Engineering:

        246  Nicholas Sirianni       Nicholas.Sirianni@altronic-llc.com
        248  Nick Sirianni - Admin   admin.nick.sirianni@altronic-llc.com

    ARC treats those as different people — correctly, because they are — so
    work assigned to the admin account never appears under the person's real
    name, and they don't get notified. The fix is to move the assignments onto
    the normal account.

    This script finds every item whose person columns reference -FromUserId and
    rewrites them to -ToUserId.

    SCANS CLIENT-SIDE, ON PURPOSE. The obvious server-side filter
    (`$filter=Assigned/Id eq 248`) returns an EMPTY FEED rather than an error
    for multi-value person columns, so "no results" from it means nothing.
    This walks the items and inspects them locally instead.

    DRY RUN BY DEFAULT — it prints what it would change and writes nothing.
    Re-run with -Apply once the report looks right.

.PARAMETER FromUserId
    The site user id to move assignments OFF (e.g. 248, the admin account).

.PARAMETER ToUserId
    The site user id to move them ON TO (e.g. 246, the normal account).

.PARAMETER ListName
    Lists to scan, by display name. Defaults to the Project Task List.

.PARAMETER AllLists
    Scan every list on the site instead of -ListName. Slower; start with a dry
    run.

.PARAMETER Site
    Which ARC site. Defaults to engineering.

.PARAMETER Apply
    Actually write. Without this the script only reports.

.EXAMPLE
    # See what would change — writes nothing.
    ./scripts/reassign-site-user.ps1 -FromUserId 248 -ToUserId 246

.EXAMPLE
    # Same, across every list on the Engineering site.
    ./scripts/reassign-site-user.ps1 -FromUserId 248 -ToUserId 246 -AllLists

.EXAMPLE
    # Do it.
    ./scripts/reassign-site-user.ps1 -FromUserId 248 -ToUserId 246 -Apply

.NOTES
    Requires Microsoft.Graph.Authentication. A dry run needs Sites.Read.All;
    -Apply needs Sites.ReadWrite.All and will re-prompt for consent.

    Person columns are matched by LookupId, which is SharePoint's real identity
    for a user — display names and emails both drift, ids don't.

    Read-only columns (Created By / Modified By) are skipped: SharePoint owns
    them and Graph rejects writes to them.
#>

param(
    [Parameter(Mandatory = $true)]
    [int]$FromUserId,

    [Parameter(Mandatory = $true)]
    [int]$ToUserId,

    [string[]]$ListName = @("Project Task List"),

    [switch]$AllLists,

    [ValidateSet("engineering", "pmo", "panelTeam", "salesTeam", "salesOrderEntry")]
    [string]$Site = "engineering",

    [switch]$Apply
)

$ErrorActionPreference = "Stop"

# Mirrored from src/api/config.ts (SITES). Keep in sync if that file changes.
$sites = @{
    engineering     = "coopermachineryservices.sharepoint.com,ddb5fc80-ea51-4d56-b008-ce6a82af49b0,aa6b9467-3f57-4213-bbd4-60b94403421a"
    pmo             = "coopermachineryservices.sharepoint.com,915a6183-2b71-4dfd-a8b9-181126dfbe78,3eb6cb9c-6535-4c69-a8d7-e90b2f90a9eb"
    panelTeam       = "coopermachineryservices.sharepoint.com,fdf31131-2076-4618-923b-a1856e6b0f2a,3eb6cb9c-6535-4c69-a8d7-e90b2f90a9eb"
    salesTeam       = "coopermachineryservices.sharepoint.com,dd86bf69-a010-481a-9920-78b079c5ec1e,aa6b9467-3f57-4213-bbd4-60b94403421a"
    salesOrderEntry = "coopermachineryservices.sharepoint.com,dd86bf69-a010-481a-9920-78b079c5ec1e,583688a6-3238-4f79-aed5-8e2d8ce38c41"
}
$targetSite = $sites[$Site]

if (-not (Get-Module -ListAvailable -Name Microsoft.Graph.Authentication)) {
    Write-Host "Microsoft.Graph.Authentication module not found. Install it with:" -ForegroundColor Yellow
    Write-Host "  Install-Module Microsoft.Graph.Authentication -Scope CurrentUser" -ForegroundColor Yellow
    exit 1
}
Import-Module Microsoft.Graph.Authentication

$needScope = if ($Apply) { "Sites.ReadWrite.All" } else { "Sites.Read.All" }
if (-not (Get-MgContext)) { Connect-MgGraph -Scopes $needScope -NoWelcome }
elseif ($Apply -and (Get-MgContext).Scopes -notcontains "Sites.ReadWrite.All") {
    Write-Host "Re-consenting for write access..." -ForegroundColor Yellow
    Connect-MgGraph -Scopes $needScope -NoWelcome
}

if ($Apply) {
    Write-Host ""
    Write-Host "*** APPLY MODE — this will modify SharePoint items. ***" -ForegroundColor Red
    Write-Host "    Moving assignments from user $FromUserId to user $ToUserId on '$Site'." -ForegroundColor Red
    $answer = Read-Host "    Type YES to continue"
    if ($answer -ne "YES") { Write-Host "Aborted." -ForegroundColor Yellow; exit 0 }
} else {
    Write-Host ""
    Write-Host "DRY RUN — nothing will be written. Re-run with -Apply to commit." -ForegroundColor Cyan
}

# Sanity-check both users exist and show who they are, so a typo'd id can't
# quietly reassign work to a stranger.
foreach ($pair in @(@{ Label = "FROM"; Id = $FromUserId }, @{ Label = "TO  "; Id = $ToUserId })) {
    try {
        $u = Invoke-MgGraphRequest -Method GET `
            -Uri "https://graph.microsoft.com/v1.0/sites/$targetSite/lists/User%20Information%20List/items/$($pair.Id)?`$expand=fields"
        $f = $u["fields"]
        Write-Host ("  {0} {1,-5} {2}  <{3}>" -f $pair.Label, $pair.Id, $f["Title"], $f["EMail"]) -ForegroundColor Green
    } catch {
        Write-Host "  Couldn't read site user $($pair.Id) — check the id. $_" -ForegroundColor Yellow
    }
}

# ---------------------------------------------------------------------------
# Resolve which lists to scan.
# ---------------------------------------------------------------------------
$allSiteLists = @()
$next = "https://graph.microsoft.com/v1.0/sites/$targetSite/lists?`$top=200"
while ($next) {
    $page = Invoke-MgGraphRequest -Method GET -Uri $next
    $allSiteLists += $page.value
    $next = if ($page.ContainsKey('@odata.nextLink')) { $page['@odata.nextLink'] } else { $null }
}

$targets = if ($AllLists) {
    $allSiteLists
} else {
    $squash = { param($t) if ($t) { $t.Replace(" ", "").ToLower() } else { "" } }
    foreach ($n in $ListName) {
        $want = & $squash $n
        $hit = $allSiteLists | Where-Object { $_["displayName"] -eq $n }
        if (-not $hit) { $hit = $allSiteLists | Where-Object { (& $squash $_["displayName"]) -eq $want } }
        if (-not $hit) { $hit = $allSiteLists | Where-Object { (& $squash $_["name"]) -eq $want } }
        if ($hit -is [array]) { $hit = $hit[0] }
        if (-not $hit) { Write-Host "  No list matching '$n' on $Site — skipping." -ForegroundColor Yellow }
        else { $hit }
    }
}

$changes = @()
$failures = @()

foreach ($list in $targets) {
    $listId = $list["id"]
    $listLabel = $list["displayName"]

    # Which columns are person columns we're allowed to write?
    $cols = (Invoke-MgGraphRequest -Method GET `
        -Uri "https://graph.microsoft.com/v1.0/sites/$targetSite/lists/$listId/columns").value
    $personCols = @()
    foreach ($c in $cols) {
        if (-not ($c.ContainsKey("personOrGroup") -and $c["personOrGroup"])) { continue }
        if ($c["readOnly"]) { continue }   # Author / Editor — SharePoint owns these
        $personCols += [pscustomobject]@{
            Name  = $c["name"]
            Multi = [bool]$c["personOrGroup"]["allowMultipleSelection"]
        }
    }
    if ($personCols.Count -eq 0) { continue }

    Write-Host ""
    Write-Host "=== $listLabel ===" -ForegroundColor Cyan
    Write-Host "  person columns: $(($personCols | ForEach-Object { $_.Name }) -join ', ')"

    # Walk every item. Paged — a single $top call silently truncates.
    $items = @()
    $next = "https://graph.microsoft.com/v1.0/sites/$targetSite/lists/$listId/items?`$expand=fields&`$top=200"
    while ($next) {
        $page = Invoke-MgGraphRequest -Method GET -Uri $next
        $items += $page.value
        $next = if ($page.ContainsKey('@odata.nextLink')) { $page['@odata.nextLink'] } else { $null }
    }
    Write-Host "  $($items.Count) items scanned"

    foreach ($item in $items) {
        $fields = $item["fields"]
        if (-not $fields) { continue }

        foreach ($col in $personCols) {
            $raw = $fields[$col.Name]
            if (-not $raw) { continue }

            # Normalise single vs multi into a list of {LookupId, LookupValue}.
            $entries = if ($raw -is [array]) { $raw } else { @($raw) }
            $ids = @()
            foreach ($e in $entries) {
                if ($e -is [hashtable] -and $e.ContainsKey("LookupId")) { $ids += [int]$e["LookupId"] }
            }
            if ($ids -notcontains $FromUserId) { continue }

            # Swap, and drop a duplicate if the target is already on the item.
            $newIds = @()
            foreach ($id in $ids) {
                $mapped = if ($id -eq $FromUserId) { $ToUserId } else { $id }
                if ($newIds -notcontains $mapped) { $newIds += $mapped }
            }

            $title = if ($fields.ContainsKey("NumberedTitle") -and $fields["NumberedTitle"]) {
                $fields["NumberedTitle"]
            } elseif ($fields.ContainsKey("Title")) { $fields["Title"] } else { "(untitled)" }

            $changes += [pscustomobject]@{
                List   = $listLabel
                ItemId = $item["id"]
                Column = $col.Name
                Title  = $title
                Before = ($ids -join ",")
                After  = ($newIds -join ",")
            }

            if (-not $Apply) { continue }

            # Write shape mirrors src/lib/graphFields.ts: a multi-value person
            # column needs the annotated two-key form; a single one takes a
            # bare int on the LookupId-suffixed name.
            $idKey = "$($col.Name)LookupId"
            $body = @{}
            if ($col.Multi) {
                $body["$idKey@odata.type"] = "Collection(Edm.Int32)"
                $body[$idKey] = @($newIds)
            } else {
                $body[$idKey] = $newIds[0]
            }

            try {
                Invoke-MgGraphRequest -Method PATCH `
                    -Uri "https://graph.microsoft.com/v1.0/sites/$targetSite/lists/$listId/items/$($item['id'])/fields" `
                    -Body ($body | ConvertTo-Json -Depth 5) `
                    -ContentType "application/json" | Out-Null
                Write-Host "    updated $listLabel #$($item['id']) $($col.Name)" -ForegroundColor Green
            } catch {
                Write-Host "    FAILED $listLabel #$($item['id']) $($col.Name): $_" -ForegroundColor Red
                $failures += [pscustomobject]@{ List = $listLabel; ItemId = $item["id"]; Column = $col.Name; Error = "$_" }
            }
        }
    }
}

Write-Host ""
Write-Host "=== Summary ===" -ForegroundColor Cyan
if ($changes.Count -eq 0) {
    Write-Host "  No item on the scanned lists references site user $FromUserId." -ForegroundColor Green
    Write-Host "  Nothing to change." -ForegroundColor Green
} else {
    # Always write the CSV. In a dry run it's the plan to check with the person
    # whose work this is; in apply mode it's the only record of what the field
    # held before — SharePoint has no undo for this.
    $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $mode = if ($Apply) { "applied" } else { "dryrun" }
    $csvPath = Join-Path $PSScriptRoot "reassign-$FromUserId-to-$ToUserId-$mode-$stamp.csv"
    $changes | Export-Csv -NoTypeInformation -Encoding UTF8 -Path $csvPath

    $changes | Select-Object -First 25 | Format-Table List, ItemId, Column, Title -AutoSize
    if ($changes.Count -gt 25) {
        Write-Host "  … first 25 of $($changes.Count) shown. Full detail in the CSV." -ForegroundColor DarkGray
    }
    Write-Host ""
    Write-Host "  Before/after values: $csvPath" -ForegroundColor Cyan
    Write-Host "  $($changes.Count) field(s) on $(($changes | Select-Object -Unique ItemId).Count) item(s)."
    if ($Apply) {
        Write-Host "  Applied. Failures: $($failures.Count)" -ForegroundColor $(if ($failures.Count) { "Red" } else { "Green" })
        if ($failures.Count) { $failures | Format-Table -AutoSize }
    } else {
        Write-Host "  DRY RUN — nothing written. Re-run with -Apply to commit." -ForegroundColor Yellow
    }
}
