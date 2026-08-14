<#
.SYNOPSIS
    Report every distinct person identity that appears in a list's person
    columns, exactly as Graph returns it. Read-only.

.DESCRIPTION
    ARC identifies a person by `email ?? displayName`, lowercased
    (`personKey` in src/lib/people.ts). So two item entries are the SAME person
    to the app only if their Email matches — and an entry with NO Email falls
    back to its display name, which makes it a separate identity that the
    Assigned filter can't reach from an email-keyed dropdown option.

    This dumps what's really on the items so those cases are visible instead of
    guessed at: for each distinct identity, the display name, email, lookup id,
    how many items carry it, and whether the app would key it by email or by
    name.

    Written while chasing a report that the Assigned filter didn't list tasks a
    user could see were assigned to them (2026-08-14).

.PARAMETER Match
    Only report identities whose display name or email contains this text.
    Omit to report everyone.

.PARAMETER ListName
    Lists to scan, by display name (or URL name). Defaults to the task list.

.PARAMETER Site
    Which ARC site. Defaults to engineering.

.EXAMPLE
    ./scripts/person-identities.ps1 -Match Sirianni `
        -ListName "Project Task List","EIREngineering Information Request"

.EXAMPLE
    # Everyone who appears on a task, and how the app keys them.
    ./scripts/person-identities.ps1

.NOTES
    Requires Microsoft.Graph.Authentication and Sites.Read.All. Reads only —
    no writes anywhere.
#>

param(
    [string]$Match,

    [string[]]$ListName = @("Project Task List"),

    [ValidateSet("engineering", "pmo", "panelTeam", "salesTeam", "salesOrderEntry")]
    [string]$Site = "engineering"
)

$ErrorActionPreference = "Stop"

# Mirrored from src/api/config.ts (SITES).
$sites = @{
    engineering     = "coopermachineryservices.sharepoint.com,ddb5fc80-ea51-4d56-b008-ce6a82af49b0,aa6b9467-3f57-4213-bbd4-60b94403421a"
    pmo             = "coopermachineryservices.sharepoint.com,915a6183-2b71-4dfd-a8b9-181126dfbe78,3eb6cb9c-6535-4c69-a8d7-e90b2f90a9eb"
    panelTeam       = "coopermachineryservices.sharepoint.com,fdf31131-2076-4618-923b-a1856e6b0f2a,3eb6cb9c-6535-4c69-a8d7-e90b2f90a9eb"
    salesTeam       = "coopermachineryservices.sharepoint.com,dd86bf69-a010-481a-9920-78b079c5ec1e,aa6b9467-3f57-4213-bbd4-60b94403421a"
    salesOrderEntry = "coopermachineryservices.sharepoint.com,dd86bf69-a010-481a-9920-78b079c5ec1e,583688a6-3238-4f79-aed5-8e2d8ce38c41"
}
$targetSite = $sites[$Site]

if (-not (Get-Module -ListAvailable -Name Microsoft.Graph.Authentication)) {
    Write-Host "Install-Module Microsoft.Graph.Authentication -Scope CurrentUser" -ForegroundColor Yellow
    exit 1
}
Import-Module Microsoft.Graph.Authentication
if (-not (Get-MgContext)) { Connect-MgGraph -Scopes "Sites.Read.All" -NoWelcome }

$allSiteLists = @()
$next = "https://graph.microsoft.com/v1.0/sites/$targetSite/lists?`$top=200"
while ($next) {
    $page = Invoke-MgGraphRequest -Method GET -Uri $next
    $allSiteLists += $page.value
    $next = if ($page.ContainsKey('@odata.nextLink')) { $page['@odata.nextLink'] } else { $null }
}

$squash = { param($t) if ($t) { $t.Replace(" ", "").ToLower() } else { "" } }
$targets = foreach ($n in $ListName) {
    $want = & $squash $n
    $hit = $allSiteLists | Where-Object { $_["displayName"] -eq $n }
    if (-not $hit) { $hit = $allSiteLists | Where-Object { (& $squash $_["displayName"]) -eq $want } }
    if (-not $hit) { $hit = $allSiteLists | Where-Object { (& $squash $_["name"]) -eq $want } }
    if ($hit -is [array]) { $hit = $hit[0] }
    if (-not $hit) { Write-Host "  No list matching '$n' — skipping." -ForegroundColor Yellow } else { $hit }
}

# key -> record. Key mirrors personKey(): lowercase email, else lowercase name.
$identities = @{}

foreach ($list in $targets) {
    $listId = $list["id"]
    $listLabel = $list["displayName"]

    $cols = (Invoke-MgGraphRequest -Method GET `
        -Uri "https://graph.microsoft.com/v1.0/sites/$targetSite/lists/$listId/columns").value
    $personCols = @()
    foreach ($c in $cols) {
        if ($c.ContainsKey("personOrGroup") -and $c["personOrGroup"] -and -not $c["readOnly"]) {
            $personCols += $c["name"]
        }
    }
    if ($personCols.Count -eq 0) { continue }

    Write-Host ""
    Write-Host "=== $listLabel ===" -ForegroundColor Cyan
    Write-Host "  person columns: $($personCols -join ', ')"

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
        foreach ($colName in $personCols) {
            $raw = $fields[$colName]
            if (-not $raw) { continue }
            $entries = if ($raw -is [array]) { $raw } else { @($raw) }
            foreach ($e in $entries) {
                if (-not ($e -is [hashtable])) { continue }
                $name = [string]$e["LookupValue"]
                $mail = [string]$e["Email"]
                $lid = $e["LookupId"]
                if (-not $name -and -not $mail) { continue }

                if ($Match) {
                    if (("$name $mail") -notmatch [regex]::Escape($Match)) { continue }
                }

                # How ARC would key this entry.
                $keyedBy = if ($mail) { "email" } else { "NAME (no email!)" }
                $key = if ($mail) { $mail.ToLower() } else { $name.ToLower() }

                if (-not $identities.ContainsKey($key)) {
                    $identities[$key] = [pscustomobject]@{
                        AppKey    = $key
                        KeyedBy   = $keyedBy
                        Names     = [System.Collections.Generic.HashSet[string]]::new()
                        Emails    = [System.Collections.Generic.HashSet[string]]::new()
                        LookupIds = [System.Collections.Generic.HashSet[string]]::new()
                        Count     = 0
                        Columns   = [System.Collections.Generic.HashSet[string]]::new()
                    }
                }
                $rec = $identities[$key]
                if ($name) { [void]$rec.Names.Add($name) }
                if ($mail) { [void]$rec.Emails.Add($mail) }
                if ($null -ne $lid) { [void]$rec.LookupIds.Add([string]$lid) }
                [void]$rec.Columns.Add("$listLabel.$colName")
                $rec.Count++
            }
        }
    }
}

Write-Host ""
Write-Host "=== Distinct identities$(if ($Match) { " matching '$Match'" }) ===" -ForegroundColor Cyan
if ($identities.Count -eq 0) {
    Write-Host "  None found." -ForegroundColor Yellow
} else {
    $identities.Values |
        Sort-Object -Property @{ Expression = { $_.Count }; Descending = $true } |
        ForEach-Object {
            [pscustomobject]@{
                AppKey    = $_.AppKey
                KeyedBy   = $_.KeyedBy
                Names     = ($_.Names -join " | ")
                Emails    = ($_.Emails -join " | ")
                LookupIds = ($_.LookupIds -join ",")
                Entries   = $_.Count
                SeenIn    = ($_.Columns -join ", ")
            }
        } | Format-List

    Write-Host "  $($identities.Count) distinct identity/identities." -ForegroundColor Cyan
    Write-Host "  MORE THAN ONE for the same human = the Assigned filter can only ever" -ForegroundColor Yellow
    Write-Host "  find the tasks under whichever one the dropdown option was built from." -ForegroundColor Yellow
}
