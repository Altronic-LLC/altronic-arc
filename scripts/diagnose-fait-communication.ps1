<#
.SYNOPSIS
    Diagnoses "not all FAIT comments appear" by checking the Communication
    column's append-mode setting and dumping one FAIT's raw stored value.

.DESCRIPTION
    CLAUDE.md has flagged this as an unverified risk since the Communication
    column was added to the FAIT list (2026-08-20): Graph reports
    `appendChangesToExistingText: true` on that column however it's created,
    and a PATCH explicitly setting it to false is silently accepted but
    changes nothing. ARC always sends the FULL rebuilt comment thread on
    every post (read-modify-write) — if the column is genuinely in append
    mode, SharePoint would concatenate that full value ONTO what's already
    stored instead of replacing it, so the raw Communication string grows a
    duplicated copy of the whole prior thread on every single comment.

    Reported by Ray, 2026-09-03: a FAIT with many comments shows only three
    in ARC. This script checks the actual column setting AND — if you pass
    -FaitId — prints the raw Communication string exactly as stored, so we
    can see directly whether it's duplicated/corrupted or something else
    (e.g. a rendering cap) is dropping records.

.PARAMETER FaitId
    The SharePoint item id of the FAIT to inspect (the numeric id in its
    ARC URL, e.g. /faits/482 -> 482). Optional — omit to only check the
    column setting.

.EXAMPLE
    ./scripts/diagnose-fait-communication.ps1

.EXAMPLE
    ./scripts/diagnose-fait-communication.ps1 -FaitId 482

.NOTES
    Read-only: GETs only, no writes. Requires the Microsoft.Graph.Authentication
    module; Connect-MgGraph prompts for sign-in the first time.
#>
param(
    [int]$FaitId
)

$ErrorActionPreference = "Stop"

# Mirrored from src/api/config.ts.
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

Write-Host "`n=== Communication column settings ===" -ForegroundColor Cyan
$columns = Invoke-MgGraphRequest -Method GET `
    -Uri "https://graph.microsoft.com/v1.0/sites/$EngineeringSite/lists/$FaitListId/columns"
$commCol = $columns.value | Where-Object { $_.name -eq "Communication" }

if (-not $commCol) {
    Write-Host "  Communication column not found on the FAIT list." -ForegroundColor Red
} else {
    $appendMode = $commCol.text.appendChangesToExistingText
    Write-Host "  appendChangesToExistingText : $appendMode" -ForegroundColor $(if ($appendMode) { "Red" } else { "Green" })
    if ($appendMode) {
        Write-Host "  THIS IS LIKELY THE BUG." -ForegroundColor Red
        Write-Host "  Every ARC comment post sends the FULL rebuilt thread as a PATCH." -ForegroundColor Red
        Write-Host "  If SharePoint is in append mode, it concatenates that full value" -ForegroundColor Red
        Write-Host "  onto what's already there instead of replacing it — so the raw" -ForegroundColor Red
        Write-Host "  stored string grows a duplicated copy of the whole prior thread" -ForegroundColor Red
        Write-Host "  on every single comment. Turning this OFF needs to be done in the" -ForegroundColor Red
        Write-Host "  SharePoint list settings UI directly — a Graph PATCH to this" -ForegroundColor Red
        Write-Host "  property is silently accepted but does not change it (confirmed" -ForegroundColor Red
        Write-Host "  behavior, see CLAUDE.md)." -ForegroundColor Red
    } else {
        Write-Host "  Append mode is off — this is NOT the cause. Something else is" -ForegroundColor Yellow
        Write-Host "  dropping comments (a parsing edge case, or a rendering cap)." -ForegroundColor Yellow
    }
    $commCol.text | ConvertTo-Json
}

if ($FaitId) {
    Write-Host "`n=== Raw Communication value for FAIT $FaitId ===" -ForegroundColor Cyan
    $item = Invoke-MgGraphRequest -Method GET `
        -Uri "https://graph.microsoft.com/v1.0/sites/$EngineeringSite/lists/$FaitListId/items/$FaitId`?`$expand=fields(`$select=Communication)"
    $raw = $item.fields.Communication
    if (-not $raw) {
        Write-Host "  (Communication is empty on this item)" -ForegroundColor Yellow
    } else {
        Write-Host "  Raw length: $($raw.Length) characters" -ForegroundColor White

        # Count how many timestamp-like record starts appear in the raw
        # string — mirrors communicationParser.ts's TIMESTAMP_SPLIT_RE.
        $matches = [regex]::Matches($raw, '\d{1,2}/\d{1,2}/\d{4}\s+\d{1,2}:\d{2}:\d{2}\s+(AM|PM)\|\|\|')
        Write-Host "  Timestamp-prefixed record starts found: $($matches.Count)" -ForegroundColor White

        # Look for a duplicated record — the same timestamp+author appearing
        # more than once is the fingerprint of append-mode corruption.
        $seen = @{}
        $dupes = 0
        foreach ($m in $matches) {
            $key = $m.Value
            if ($seen.ContainsKey($key)) { $dupes++ } else { $seen[$key] = $true }
        }
        if ($dupes -gt 0) {
            Write-Host "  DUPLICATE record starts: $dupes — strong evidence of append-mode corruption." -ForegroundColor Red
        } else {
            Write-Host "  No duplicate record starts found." -ForegroundColor Green
        }

        Write-Host "`n  --- raw value, verbatim --- " -ForegroundColor DarkGray
        Write-Host $raw
        Write-Host "  --- end raw value ---`n" -ForegroundColor DarkGray
    }
}

Write-Host "If append mode is ON: open the FAIT list in SharePoint -> List settings ->" -ForegroundColor Cyan
Write-Host "Communication column -> confirm/uncheck 'Append Changes to Existing Text'" -ForegroundColor Cyan
Write-Host "(worded as 'Yes/No: Append Changes...' near the bottom of the column's" -ForegroundColor Cyan
Write-Host "settings page). That is the only way to actually change it — a Graph PATCH" -ForegroundColor Cyan
Write-Host "does not work." -ForegroundColor Cyan
