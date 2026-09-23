<#
.SYNOPSIS
    Restores FAIT 89's Communication field by MERGING every distinct comment
    found across ALL 21 stored versions, after toggling "Append Changes to
    Existing Text" off wiped the field.

.DESCRIPTION
    A first pass at this script picked the single richest surviving version
    (19.0, 6 comments from Ray/Alexandra) — WRONG. Ray caught it: version
    6.0 has a comment from Michael Colaneri, and version 10.0/12.0 have two
    from Beth Rober, and NONE of those ever coexisted with the Ray/Alexandra
    thread in the same field value. The field was wiped and restarted
    several separate times during testing:

      v6  Michael "I SUBMITTED THE FAIT TODAY (TEST FOUR)"
      (wiped)
      v10 Beth "complete"
      (wiped)
      v12 Beth "okay"
      (wiped)
      v14-19  Ray/Alexandra's 6-comment thread
      (wiped)
      v21 Alexandra "After testing approval notes, all comments disappeared"

    Picking any ONE version loses whichever comments belong to the other
    episodes. The correct recovery is every DISTINCT comment record (by
    timestamp + author + body) found in ANY version, merged and sorted —
    which is exactly what this script does, using the same TIMESTAMP_SPLIT_RE
    pattern src/lib/communicationParser.ts uses to split records.

    This is a ONE-TIME, HARD-CODED restore for FAIT 89 — not a general tool.
    It:
      1. Re-fetches ALL versions fresh.
      2. Splits every version's Communication value into individual comment
         records the same way ARC's own parser does.
      3. Dedupes by (timestamp, author email, body) — the same record
         appearing in several versions counts once.
      4. Sorts the merged, deduped records OLDEST FIRST (the storage
         convention communicationParser.ts expects — it sorts to
         newest-first for DISPLAY itself).
      5. Prints the full merged result and requires an explicit "yes"
         before writing anything.
      6. PATCHes FAIT 89's Communication field, then reads it back and
         reports how many comments ARC's own parser now sees.

.EXAMPLE
    ./scripts/restore-fait-89-communication.ps1 -WhatIf
    (prints the merged result and stops — no write)

.EXAMPLE
    ./scripts/restore-fait-89-communication.ps1
    (prints the merged result, asks to confirm, then writes)

.NOTES
    Needs Sites.Manage.All to write (Sites.Read.All is enough for -WhatIf).
    This is a WRITE script — read it before running it.
#>
param(
    [switch]$WhatIf
)

$ErrorActionPreference = "Stop"

$EngineeringSite = "coopermachineryservices.sharepoint.com,ddb5fc80-ea51-4d56-b008-ce6a82af49b0,aa6b9467-3f57-4213-bbd4-60b94403421a"
$FaitListId = "d655b5d6-ee28-45c4-85ab-128198569508"
$FaitId = 89

$ctx = Get-MgContext
$neededScope = if ($WhatIf) { "Sites.Read.All" } else { "Sites.Manage.All" }
if (-not $ctx -or $ctx.Scopes -notcontains $neededScope) {
    Write-Host "Signing in ($neededScope)..." -ForegroundColor Cyan
    try {
        Connect-MgGraph -Scopes $neededScope -NoWelcome
    } catch {
        Connect-MgGraph -Scopes $neededScope -UseDeviceCode -NoWelcome
    }
}

Write-Host "`nFetching ALL versions of FAIT $FaitId..." -ForegroundColor Cyan
$versions = Invoke-MgGraphRequest -Method GET `
    -Uri "https://graph.microsoft.com/v1.0/sites/$EngineeringSite/lists/$FaitListId/items/$FaitId/versions?`$expand=fields(`$select=Communication)"

if (-not $versions.value -or $versions.value.Count -eq 0) {
    Write-Host "No version history returned." -ForegroundColor Red
    exit 1
}

Write-Host "Found $($versions.value.Count) version(s). Extracting every comment record from each...`n" -ForegroundColor Cyan

# Same split pattern as communicationParser.ts's TIMESTAMP_SPLIT_RE — a
# positive lookahead on the timestamp prefix, so each match STARTS a record
# and the record runs to the next match (or end of string).
$splitPattern = '(?=\d{1,2}/\d{1,2}/\d{4}\s+\d{1,2}:\d{2}:\d{2}\s+(?:AM|PM)\|\|\|)'

# Key = "timestamp|||authorEmail|||body" (normalised a bit) -> the record text.
$merged = [ordered]@{}
$episodesSeen = 0

foreach ($v in $versions.value) {
    $raw = $v.fields.Communication
    if (-not $raw) { continue }
    $episodesSeen++

    $records = [regex]::Split($raw, $splitPattern) | Where-Object { $_.Trim().Length -gt 0 }
    foreach ($record in $records) {
        $parts = $record -split '\|\|\|', 4
        if ($parts.Count -lt 4) { continue }
        $ts = $parts[0].Trim()
        $author = $parts[1].Trim()
        $email = $parts[2].Trim()
        $body = $parts[3].Trim()

        # Dedupe key deliberately ignores author DISPLAY NAME (only email) —
        # in case a version stored a slightly different name string for the
        # same person — but keeps timestamp+email+body exact, since two
        # genuinely different comments could share a timestamp only if they
        # were also identical in every other way, which isn't a real comment
        # to lose.
        $key = "$ts|||$($email.ToLower())|||$body"
        if (-not $merged.Contains($key)) {
            $merged[$key] = [PSCustomObject]@{
                Timestamp = $ts
                Author    = $author
                Email     = $email
                Body      = $body
                Record    = "$ts|||$author|||$email|||$body"
            }
        }
    }
}

Write-Host "Scanned $episodesSeen non-empty version(s); found $($merged.Count) distinct comment record(s) total.`n" -ForegroundColor Cyan

if ($merged.Count -eq 0) {
    Write-Host "No comment records found anywhere in version history. Nothing to restore." -ForegroundColor Red
    exit 1
}

# Sort OLDEST FIRST for storage — communicationParser.ts sorts to
# newest-first for display regardless of storage order, but this matches
# the existing convention (appendComment always adds to the end).
$sorted = $merged.Values | Sort-Object { [DateTime]::ParseExact($_.Timestamp, "M/d/yyyy h:mm:ss tt", $null) }

Write-Host "=== Every distinct comment found, oldest first ===" -ForegroundColor Yellow
foreach ($r in $sorted) {
    Write-Host "  $($r.Timestamp) — $($r.Author) <$($r.Email)>" -ForegroundColor White
    Write-Host "    $($r.Body)" -ForegroundColor Gray
}
Write-Host ""

$restoreValue = ($sorted | ForEach-Object { $_.Record }) -join "`n"

Write-Host "=== Full value that would be written ($($restoreValue.Length) characters) ===" -ForegroundColor Yellow
Write-Host $restoreValue
Write-Host "=== end value ===`n" -ForegroundColor Yellow

if ($WhatIf) {
    Write-Host "-WhatIf: stopping here. Nothing was written." -ForegroundColor Yellow
    exit 0
}

$confirm = Read-Host "Type YES to write this MERGED value to FAIT $FaitId (anything else cancels)"
if ($confirm -ne "YES") {
    Write-Host "Cancelled — nothing was written." -ForegroundColor Yellow
    exit 0
}

Write-Host "`nWriting..." -ForegroundColor Cyan
Invoke-MgGraphRequest -Method PATCH `
    -Uri "https://graph.microsoft.com/v1.0/sites/$EngineeringSite/lists/$FaitListId/items/$FaitId/fields" `
    -Body (@{ Communication = $restoreValue } | ConvertTo-Json) `
    -ContentType "application/json" | Out-Null

Write-Host "Write sent. Reading the item back to confirm..." -ForegroundColor Cyan
$after = Invoke-MgGraphRequest -Method GET `
    -Uri "https://graph.microsoft.com/v1.0/sites/$EngineeringSite/lists/$FaitListId/items/$FaitId`?`$expand=fields(`$select=Communication)"
$afterRaw = $after.fields.Communication

if ($afterRaw -eq $restoreValue) {
    Write-Host "CONFIRMED: the field now reads back exactly the merged value that was written." -ForegroundColor Green
} else {
    Write-Host "WARNING: the field read back DIFFERENT from what was written." -ForegroundColor Red
    Write-Host "Length written: $($restoreValue.Length)  |  Length read back: $($afterRaw.Length)" -ForegroundColor Red
    Write-Host "If Append Changes is STILL on, this PATCH may have appended onto whatever" -ForegroundColor Red
    Write-Host "was there rather than replacing it. Re-run diagnose-fait-communication.ps1" -ForegroundColor Red
    Write-Host "to check the column setting again before doing anything else." -ForegroundColor Red
    exit 1
}

$matches = [regex]::Matches($afterRaw, '\d{1,2}/\d{1,2}/\d{4}\s+\d{1,2}:\d{2}:\d{2}\s+(AM|PM)\|\|\|')
Write-Host "`nARC's comment parser would now see $($matches.Count) comment record(s) on this FAIT." -ForegroundColor Green
Write-Host "Open the FAIT in ARC and confirm the comment thread has everyone's comments —" -ForegroundColor Green
Write-Host "Michael, Beth (x2), Ray, and Alexandra." -ForegroundColor Green
