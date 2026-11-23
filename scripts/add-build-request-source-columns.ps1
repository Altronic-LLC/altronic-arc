<#
.SYNOPSIS
    BusinessIT #68 / #69 / #65 - adds the three "raised from" link columns to
    the Build Request Tracker list on Altronic_Engineering.

.DESCRIPTION
    ARC can now raise a build request FROM an EIR, a Gray Market request or a
    FAIT. The link is stored ONCE, on the build request; the other record's
    side is worked out from it. Three columns:

        EIRReference         single LOOKUP -> EIRs list (shows the EIR No)
        FAITReference        single LOOKUP -> FAIT list (shows the SAP Part Number)
        GrayMarketRequestId  NUMBER - the Gray Market request's item id. The
                             Gray Market list is on Altronic_PMO, another site
                             collection, which a lookup column can't reach.

    ARC reads the columns and, while they're missing, falls back to reading
    without them - so the order of this script and the deploy doesn't break
    anything. Until this has run, a request raised from an EIR / GMR / FAIT
    is created WITHOUT the link and ARC says so.

    Idempotent: a column that already exists is reported and skipped.
    -WhatIf reports what it would change and writes nothing.

    -WriteCheck also creates one throwaway build request row, writes all
    three columns, reads them back and deletes the row (to the recycle bin).
    Off by default because the list is live; the read check below always runs.

    RUN THIS IN YOUR OWN TERMINAL - the sign-in is interactive. Pass
    -DeviceCode if the browser popup can't open.
#>

param(
    [switch]$WhatIf,
    [switch]$WriteCheck,
    [switch]$DeviceCode
)

$ErrorActionPreference = "Stop"
Import-Module Microsoft.Graph.Authentication

$siteId    = "coopermachineryservices.sharepoint.com,ddb5fc80-ea51-4d56-b008-ce6a82af49b0,aa6b9467-3f57-4213-bbd4-60b94403421a"
$brListId  = "7e0f94cc-b3a3-4c89-8552-7fd97cfa46d9"   # Build Request Tracker
$eirListId = "8d00a762-288c-4678-afc4-cba2f24ac965"   # EIRs
$faitListId = "d655b5d6-ee28-45c4-85ab-128198569508"  # FAIT

# The internal names are the contract with src/api/buildRequests.ts and
# src/lib/buildRequestMapper.ts.
$columns = @(
    @{
        name        = "EIRReference"
        displayName = "EIR Reference"
        description = "The EIR this build request was raised from in ARC."
        lookup      = @{ listId = $eirListId; columnName = "EIRNo" }
    },
    @{
        name        = "FAITReference"
        displayName = "FAIT Reference"
        description = "The FAIT this build request was raised from in ARC."
        lookup      = @{ listId = $faitListId; columnName = "SAPPartNumber" }
    },
    @{
        name        = "GrayMarketRequestId"
        displayName = "Gray Market Request ID"
        description = "The item ID of the Gray Market request (Altronic_PMO) this build request was raised from in ARC."
        number      = @{ decimalPlaces = "none"; minimum = 1 }
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

$base = "https://graph.microsoft.com/v1.0/sites/$siteId/lists/$brListId"

function Get-Columns {
    (Invoke-MgGraphRequest -Method GET -Uri "$base/columns").value
}

Write-Host ""
Write-Host "=== Build Request Tracker: source link columns ===" -ForegroundColor Cyan
$have = Get-Columns | ForEach-Object { $_["name"] }
foreach ($c in $columns) {
    if ($have -contains $c.name) {
        Write-Host "SKIP   $($c.name) - already exists" -ForegroundColor Yellow
        continue
    }
    if ($WhatIf) {
        Write-Host "WOULD CREATE $($c.name) ('$($c.displayName)')" -ForegroundColor Cyan
        continue
    }
    $created = Invoke-MgGraphRequest -Method POST -Uri "$base/columns" `
        -Body ($c | ConvertTo-Json -Depth 6) -ContentType "application/json"
    if ($created["name"] -ne $c.name) {
        throw "Created '$($c.displayName)' but SharePoint named it '$($created["name"])', not '$($c.name)'. ARC reads '$($c.name)' - fix this before using the feature."
    }
    Write-Host "CREATE $($c.name) ('$($c.displayName)')" -ForegroundColor Green
}

if ($WhatIf) { Write-Host ""; Write-Host "WhatIf - nothing written."; return }

# ---------------------------------------------------------------------------
# Verify: the definitions, then a read that selects them the way ARC does
# (a missing column 400s that read).
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "=== Verification ===" -ForegroundColor Cyan
$cols = Get-Columns
$ok = $true
foreach ($c in $columns) {
    $col = $cols | Where-Object { $_["name"] -eq $c.name }
    if (-not $col) { Write-Host "  MISSING $($c.name)" -ForegroundColor Red; $ok = $false; continue }
    if ($c.lookup) {
        if ($col.ContainsKey("lookup") -and $col["lookup"]["listId"] -eq $c.lookup.listId -and -not $col["lookup"]["allowMultipleValues"]) {
            Write-Host ("  OK      {0,-22} single lookup -> {1}" -f $c.name, $c.lookup.listId) -ForegroundColor Green
        } else { Write-Host "  WRONG   $($c.name) is not a single lookup to $($c.lookup.listId)" -ForegroundColor Red; $ok = $false }
    } elseif ($col.ContainsKey("number")) {
        Write-Host ("  OK      {0,-22} number" -f $c.name) -ForegroundColor Green
    } else { Write-Host "  WRONG   $($c.name) is not a number column" -ForegroundColor Red; $ok = $false }
}
$select = "EIRReferenceLookupId,FAITReferenceLookupId,GrayMarketRequestId"
$probe = Invoke-MgGraphRequest -Method GET -Uri "$base/items?`$top=1&`$expand=fields(`$select=$select)"
Write-Host "  OK      a read selecting all three succeeds ($(@($probe.value).Count) row)" -ForegroundColor Green

if ($WriteCheck -and $ok) {
    Write-Host ""
    Write-Host "=== Write/read-back check (throwaway row) ===" -ForegroundColor Cyan
    $eirId  = (Invoke-MgGraphRequest -Method GET -Uri "https://graph.microsoft.com/v1.0/sites/$siteId/lists/$eirListId/items?`$top=1&`$select=id").value[0]["id"]
    $faitId = (Invoke-MgGraphRequest -Method GET -Uri "https://graph.microsoft.com/v1.0/sites/$siteId/lists/$faitListId/items?`$top=1&`$select=id").value[0]["id"]
    $fields = @{
        Title                 = "ARC column check - delete me"
        BRStatus              = "Pending Submission"
        EIRReferenceLookupId  = [int]$eirId
        FAITReferenceLookupId = [int]$faitId
        GrayMarketRequestId   = 12345
    }
    $row = Invoke-MgGraphRequest -Method POST -Uri "$base/items" `
        -Body (@{ fields = $fields } | ConvertTo-Json -Depth 4) -ContentType "application/json"
    try {
        $back = (Invoke-MgGraphRequest -Method GET -Uri "$base/items/$($row["id"])?`$expand=fields(`$select=$select)")["fields"]
        foreach ($k in @("EIRReferenceLookupId", "FAITReferenceLookupId", "GrayMarketRequestId")) {
            if ([string]$back[$k] -eq [string]$fields[$k]) {
                Write-Host ("  OK      {0,-22} {1}" -f $k, $back[$k]) -ForegroundColor Green
            } else {
                Write-Host ("  WRONG   {0,-22} wrote {1}, read {2}" -f $k, $fields[$k], $back[$k]) -ForegroundColor Red
                $ok = $false
            }
        }
    } finally {
        Invoke-MgGraphRequest -Method DELETE -Uri "$base/items/$($row["id"])" | Out-Null
        Write-Host "  Test row $($row["id"]) deleted (recycle bin)."
    }
}

if (-not $ok) { throw "Verification failed - see above." }
Write-Host ""
Write-Host "Done. Build requests raised from an EIR, Gray Market request or FAIT will now keep their link." -ForegroundColor Green
