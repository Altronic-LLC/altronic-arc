<#
.SYNOPSIS
    Recovers a FAIT's Communication field from SharePoint version history,
    after toggling "Append Changes to Existing Text" off cleared it.

.DESCRIPTION
    Turning OFF Append Changes on a multi-line text column is treated by
    SharePoint as a column type change, and it CLEARS the column's stored
    value on every item — this is expected (if painful) SharePoint behavior,
    not something ARC did. The text itself is very likely still recoverable:
    SharePoint list items keep VERSION HISTORY on every field edit (unless
    versioning was disabled on this list), so the last version BEFORE the
    toggle should still hold the real Communication value — duplicated by
    the append-mode bug, but recoverable and worth cleaning up rather than
    losing outright.

    This script is READ-ONLY. It does not write anything back. It:
      1. Lists every version of the FAIT item, newest first.
      2. Prints each version's Communication value length and a preview.
      3. Flags the LAST version where Communication was non-empty — almost
         certainly the one to recover from.

    Once you've identified the right version, tell Claude the version
    number (or number of comments/preview text) and we'll write a SEPARATE,
    reviewed script to actually restore it — deliberately not combined with
    this one, so nothing gets written back before you've looked at what's
    being restored.

.PARAMETER FaitId
    The SharePoint item id of the FAIT to inspect (the numeric id in its
    ARC URL, e.g. /faits/482 -> 482).

.EXAMPLE
    ./scripts/recover-fait-communication.ps1 -FaitId 482

.NOTES
    Requires the Microsoft.Graph.Authentication module. Read-only: GETs
    only, no writes. If this list has versioning turned OFF entirely, there
    will be no history to recover from — that will be obvious from the
    output (a single version, or an error from the /versions endpoint).
#>
param(
    [Parameter(Mandatory = $true)]
    [int]$FaitId
)

$ErrorActionPreference = "Stop"

$EngineeringSite = "coopermachineryservices.sharepoint.com,ddb5fc80-ea51-4d56-b008-ce6a82af49b0,aa6b9467-3f57-4213-bbd4-60b94403421a"
$FaitListId = "d655b5d6-ee28-45c4-85ab-128198569508"

$ctx = Get-MgContext
if (-not $ctx) {
    Write-Host "Signing in..." -ForegroundColor Cyan
    try {
        Connect-MgGraph -Scopes "Sites.Read.All" -NoWelcome
    } catch {
        Connect-MgGraph -Scopes "Sites.Read.All" -UseDeviceCode -NoWelcome
    }
}

Write-Host "`nFetching version history for FAIT $FaitId..." -ForegroundColor Cyan

try {
    $versions = Invoke-MgGraphRequest -Method GET `
        -Uri "https://graph.microsoft.com/v1.0/sites/$EngineeringSite/lists/$FaitListId/items/$FaitId/versions?`$expand=fields(`$select=Communication)"
} catch {
    Write-Host "Could not read version history: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "This can mean versioning is disabled on this list, or the item id is wrong." -ForegroundColor Red
    exit 1
}

if (-not $versions.value -or $versions.value.Count -eq 0) {
    Write-Host "No version history returned — versioning may be off on this list." -ForegroundColor Red
    exit 1
}

Write-Host "Found $($versions.value.Count) version(s). Newest first:`n" -ForegroundColor Cyan

$lastGoodVersion = $null

foreach ($v in $versions.value) {
    $raw = $v.fields.Communication
    $len = if ($raw) { $raw.Length } else { 0 }
    $modified = $v.lastModifiedDateTime

    Write-Host "--- Version $($v.id) — modified $modified — Communication length: $len ---" -ForegroundColor White

    if ($len -gt 0) {
        # Count record starts the same way communicationParser.ts's
        # TIMESTAMP_SPLIT_RE does, so we know roughly how many comments this
        # version actually holds — and whether it looks duplicated already.
        $matches = [regex]::Matches($raw, '\d{1,2}/\d{1,2}/\d{4}\s+\d{1,2}:\d{2}:\d{2}\s+(AM|PM)\|\|\|')
        $seen = @{}
        $dupes = 0
        foreach ($m in $matches) {
            if ($seen.ContainsKey($m.Value)) { $dupes++ } else { $seen[$m.Value] = $true }
        }
        Write-Host "  Distinct comment records: $($seen.Count)  |  Duplicate record starts: $dupes" -ForegroundColor $(if ($dupes -gt 0) { "Yellow" } else { "Green" })
        Write-Host "  Preview (first 300 chars):" -ForegroundColor DarkGray
        Write-Host "  $($raw.Substring(0, [Math]::Min(300, $raw.Length)))" -ForegroundColor DarkGray

        if (-not $lastGoodVersion) {
            $lastGoodVersion = $v
        }
    } else {
        Write-Host "  (empty)" -ForegroundColor DarkGray
    }
    Write-Host ""
}

if ($lastGoodVersion) {
    Write-Host "=== RECOMMENDATION ===" -ForegroundColor Green
    Write-Host "Version $($lastGoodVersion.id) (modified $($lastGoodVersion.lastModifiedDateTime)) is the" -ForegroundColor Green
    Write-Host "newest version with a non-empty Communication value — this is very likely" -ForegroundColor Green
    Write-Host "the one to recover. It may still contain duplicated records from the" -ForegroundColor Green
    Write-Host "append-mode bug (see the duplicate count above) — that's fixable by" -ForegroundColor Green
    Write-Host "de-duplicating before writing it back, not a reason to discard it." -ForegroundColor Green
    Write-Host "`nDon't write anything back yet. Share this output and we'll write a" -ForegroundColor Cyan
    Write-Host "separate, reviewed restore script targeting version $($lastGoodVersion.id)." -ForegroundColor Cyan
} else {
    Write-Host "No version had a non-empty Communication value. If this list has" -ForegroundColor Red
    Write-Host "versioning enabled and this still comes up empty, the history may not" -ForegroundColor Red
    Write-Host "go back far enough, or Communication may not have been captured by" -ForegroundColor Red
    Write-Host "versioning for some other reason." -ForegroundColor Red
}
