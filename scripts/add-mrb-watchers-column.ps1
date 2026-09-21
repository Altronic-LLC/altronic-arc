<#
.SYNOPSIS
    Adds the Watchers column to the MRB Data list.

.DESCRIPTION
    ARC's watcher list needs a multi-person column the MRB Data list doesn't
    have. The Communications column was added by hand on 2026-09-21 and is
    already correct (multi-line, plain text, append-changes OFF), so this
    adds Watchers and nothing else — it does not touch data, existing
    columns, or any other list.

    Mirrors add-fait-columns.ps1, which did the same job for the FAIT list.

    Idempotent: a column that already exists is reported and skipped, so
    re-running after a partial failure is safe.

    Requires Sites.Manage.All, which is a bigger scope than the read-only
    discovery script uses, so it re-authenticates even if you are already
    connected for discovery.

    RUN THIS IN YOUR OWN TERMINAL. The sign-in is interactive, and a browser
    popup (or the device code) can't be surfaced from a background shell -
    it just times out after two minutes with the prompt trapped in a buffer.
    Pass -DeviceCode if the browser popup can't open.

    ARC WORKS BEFORE AND AFTER THIS RUNS. `listMrbEntries` asks for Watchers,
    and on the 400 that a missing column produces it retries without and
    remembers for the rest of the page session. So the register keeps working
    until this script is run; the watcher controls simply say they are
    unavailable. Nothing has to be deployed in step with it.

.NOTES
    Adding a column is reversible (delete it in list settings) and leaves
    existing rows untouched — they simply have no value for it.
#>

param(
    [switch]$WhatIf,
    # Use the code-and-URL flow instead of a browser popup.
    [switch]$DeviceCode
)

$ErrorActionPreference = "Stop"
Import-Module Microsoft.Graph.Authentication

$siteId = "coopermachineryservices.sharepoint.com,915a6183-2b71-4dfd-a8b9-181126dfbe78,3eb6cb9c-6535-4c69-a8d7-e90b2f90a9eb"
$listId = "1ca33f70-c98f-4481-b518-4b15fc8fbfff"   # MRB Data, Altronic_PMO

$wanted = @(
    @{
        name          = "Watchers"
        displayName   = "Watchers"
        description   = "People notified about comments on this MRB entry. Managed by ARC."
        personOrGroup = @{
            allowMultipleSelection = $true
            chooseFromType         = "peopleOnly"
        }
    }
)

$ctx = Get-MgContext
if (-not $ctx -or $ctx.Scopes -notcontains "Sites.Manage.All") {
    Write-Host "Signing in for write access (Sites.Manage.All)..." -ForegroundColor Cyan
    if ($DeviceCode) {
        Connect-MgGraph -Scopes "Sites.Manage.All" -UseDeviceCode -NoWelcome
    } else {
        Connect-MgGraph -Scopes "Sites.Manage.All" -NoWelcome
    }
}

Write-Host "Reading existing columns..." -ForegroundColor Cyan
$existing = (Invoke-MgGraphRequest -Method GET `
    -Uri "https://graph.microsoft.com/v1.0/sites/$siteId/lists/$listId/columns").value
$have = $existing | ForEach-Object { $_["name"] }
Write-Host "  $($have.Count) columns on the list"

foreach ($col in $wanted) {
    if ($have -contains $col.name) {
        Write-Host "SKIP   $($col.name) - already exists" -ForegroundColor Yellow
        continue
    }
    if ($WhatIf) {
        Write-Host "WOULD CREATE  $($col.name)" -ForegroundColor Cyan
        continue
    }
    Write-Host "CREATE $($col.name)..." -ForegroundColor Green
    $body = $col | ConvertTo-Json -Depth 6
    $created = Invoke-MgGraphRequest -Method POST `
        -Uri "https://graph.microsoft.com/v1.0/sites/$siteId/lists/$listId/columns" `
        -Body $body -ContentType "application/json"
    Write-Host "       created as internal name '$($created['name'])'" -ForegroundColor Green
}

# Read back, so the result is what the list says rather than what we hoped.
Write-Host ""
Write-Host "=== Verification ===" -ForegroundColor Cyan
$after = (Invoke-MgGraphRequest -Method GET `
    -Uri "https://graph.microsoft.com/v1.0/sites/$siteId/lists/$listId/columns").value

foreach ($col in $wanted) {
    $found = $after | Where-Object { $_["name"] -eq $col.name }
    if ($found) {
        Write-Host ("  OK      {0,-16} multi={1} from={2}" -f `
            $found["name"],
            $found["personOrGroup"]["allowMultipleSelection"],
            $found["personOrGroup"]["chooseFromType"]) -ForegroundColor Green
    } else {
        Write-Host ("  MISSING {0}" -f $col.name) -ForegroundColor Red
    }
}

# The Communications column was added by hand. Confirm it is still shaped the
# way the comment parser needs, because getting this wrong corrupts a thread
# rather than failing: FAIT 89's whole history was wiped by append-changes
# being on, and had to be recovered from version history.
Write-Host ""
Write-Host "=== Communications column (added by hand 2026-09-21) ===" -ForegroundColor Cyan
$comm = $after | Where-Object { $_["name"] -eq "Communications" }
if (-not $comm) {
    Write-Host "  MISSING - the comment thread cannot work without it." -ForegroundColor Red
} else {
    $t = $comm["text"]
    $multi  = $t["allowMultipleLines"]
    $append = $t["appendChangesToExistingText"]
    $type   = $t["textType"]
    Write-Host ("  multiline={0}  append={1}  type={2}" -f $multi, $append, $type)
    if (-not $multi)  { Write-Host "  WARN: single-line caps the thread at 255 characters." -ForegroundColor Red }
    if ($append)      { Write-Host "  WARN: append-changes is ON - this WILL corrupt the thread. Turn it off in list settings." -ForegroundColor Red }
    if ($type -ne "plain") { Write-Host "  WARN: not plain text - rich text wraps the records and breaks the parser." -ForegroundColor Red }
    if ($multi -and -not $append -and $type -eq "plain") {
        Write-Host "  Shape is correct." -ForegroundColor Green
        Write-Host "  Still verify BEHAVIOURALLY: post two comments on one entry and" -ForegroundColor Yellow
        Write-Host "  confirm the second REPLACES the stored value rather than doubling" -ForegroundColor Yellow
        Write-Host "  the thread. Graph has misreported this flag before (see FAIT)." -ForegroundColor Yellow
    }
}
