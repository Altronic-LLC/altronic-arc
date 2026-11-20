<#
.SYNOPSIS
    Creates the "Panel Time Off" list on ALTRONICPANELTEAM (BusinessIT#42).
    Idempotent; -WhatIf reports only.

.DESCRIPTION
    The panel team's own "Where am I?": who is out, when, and for how much of
    the day. Unlike Engineering's Where am I? list it has a PERSON column, so
    ARC can take the time off out of that person's capacity on the Panel
    Engineering Capacity view. The internal names are the contract with
    src/api/panelTimeOff.ts:

      Title         (shown "Reason")      text            "Vacation", "Training"
      TeamMember    (shown "Team Member") single person   required
      StartDate     (shown "Start Date")  date only       required, INDEXED
      EndDate       (shown "End Date")    date only       required
      HoursPerDay   (shown "Hours Per Day") number 0-24   blank = the whole day

    Four things are load-bearing:

    - TeamMember is a SINGLE person column. Graph hands it back as a bare
      TeamMemberLookupId, so ARC selects both halves and writes a bare integer.
      The check below writes the signed-in user and reads both halves back.
    - StartDate is INDEXED, so ARC can read a date window once the list passes
      5,000 rows.
    - Dates are written at midday UTC (ARC's date-only rule) and read back
      through the same midday pivot.
    - Graph cannot turn attachments off or take a list off the Quick Launch.
      Those are printed as manual steps at the end.

    RUN IN YOUR OWN TERMINAL - the sign-in is interactive. If the Windows
    account window never appears (it can open behind VS Code), use -DeviceCode.

.EXAMPLE
    .\create-panel-time-off-list.ps1 -WhatIf
    .\create-panel-time-off-list.ps1
#>

[CmdletBinding()]
param(
    [switch]$WhatIf,
    [switch]$DeviceCode
)

$ErrorActionPreference = "Stop"
Import-Module Microsoft.Graph.Authentication

$siteId = "coopermachineryservices.sharepoint.com,fdf31131-2076-4618-923b-a1856e6b0f2a,3eb6cb9c-6535-4c69-a8d7-e90b2f90a9eb"
$siteUrl = "https://coopermachineryservices.sharepoint.com/sites/ALTRONICPANELTEAM"
$graph = "https://graph.microsoft.com/v1.0/sites/$siteId"
$LIST_NAME = "Panel Time Off"

$dateOnly = @{ format = "dateOnly"; displayAs = "standard" }
$columns = @(
    @{ name = "TeamMember"; displayName = "Team Member"; required = $true
       personOrGroup = @{ allowMultipleSelection = $false; chooseFromType = "peopleOnly" } },
    @{ name = "StartDate"; displayName = "Start Date"; required = $true; indexed = $true; dateTime = $dateOnly },
    @{ name = "EndDate"; displayName = "End Date"; required = $true; dateTime = $dateOnly
       description = "Last day off. The same as Start Date for a single day." },
    @{ name = "HoursPerDay"; displayName = "Hours Per Day"
       number = @{ decimalPlaces = "two"; minimum = 0; maximum = 24 }
       description = "Hours off on each day. Leave blank for the whole day." }
)

# --- auth -------------------------------------------------------------------
# User.Read as well: the read-back check writes the signed-in user into
# TeamMember, so it needs to know who that is.
$ctx = Get-MgContext
if (-not $ctx -or $ctx.Scopes -notcontains "Sites.Manage.All" -or $ctx.Scopes -notcontains "User.Read") {
    Write-Host "Signing in for write access (Sites.Manage.All, User.Read)..." -ForegroundColor Cyan
    if ($DeviceCode) { Connect-MgGraph -Scopes "Sites.Manage.All", "User.Read" -UseDeviceCode -NoWelcome }
    else             { Connect-MgGraph -Scopes "Sites.Manage.All", "User.Read" -NoWelcome }
}
if ($WhatIf) { Write-Host "`n*** -WhatIf: nothing will be changed ***" -ForegroundColor Magenta }

# --- find the list (paged: an unpaged call silently returns a subset) -------
$listId = $null
$uri = "$graph/lists?`$select=id,displayName&`$top=200"
while ($uri) {
    $page = Invoke-MgGraphRequest -Method GET -Uri $uri
    foreach ($l in $page.value) { if ($l.displayName -eq $LIST_NAME) { $listId = $l.id } }
    $uri = $page["@odata.nextLink"]
}

Write-Host "`n=== $LIST_NAME ===" -ForegroundColor Cyan
if ($listId) {
    Write-Host "  EXISTS  $LIST_NAME ($listId)" -ForegroundColor Yellow
} elseif ($WhatIf) {
    Write-Host "  WOULD CREATE  $LIST_NAME with $($columns.Count) columns, StartDate indexed, Title shown as 'Reason'" -ForegroundColor Cyan
    Write-Host "`n-WhatIf - nothing was changed.`n" -ForegroundColor Yellow
    exit 0
} else {
    Write-Host "  CREATE  $LIST_NAME..." -ForegroundColor Green
    $body = @{ displayName = $LIST_NAME; list = @{ template = "genericList" }; columns = $columns } | ConvertTo-Json -Depth 8
    $listId = (Invoke-MgGraphRequest -Method POST -Uri "$graph/lists" -Body $body -ContentType "application/json")["id"]
}

# --- columns: add what's missing, index what should be ----------------------
$have = (Invoke-MgGraphRequest -Method GET -Uri "$graph/lists/$listId/columns").value
foreach ($c in $columns) {
    $existing = $have | Where-Object { $_["name"] -eq $c.name }
    if (-not $existing) {
        if ($WhatIf) { Write-Host "    WOULD ADD    $($c.name)" -ForegroundColor Cyan; continue }
        Invoke-MgGraphRequest -Method POST -Uri "$graph/lists/$listId/columns" `
            -Body ($c | ConvertTo-Json -Depth 6) -ContentType "application/json" | Out-Null
        Write-Host "    added        $($c.name)" -ForegroundColor Green
    } elseif ($c.indexed -and -not $existing["indexed"]) {
        if ($WhatIf) { Write-Host "    WOULD INDEX  $($c.name)" -ForegroundColor Cyan; continue }
        Invoke-MgGraphRequest -Method PATCH -Uri "$graph/lists/$listId/columns/$($existing["id"])" `
            -Body (@{ indexed = $true } | ConvertTo-Json) -ContentType "application/json" | Out-Null
        Write-Host "    indexed      $($c.name)" -ForegroundColor Green
    }
}

# Title becomes "Reason". Not required: a day off needs no explanation, and ARC
# shows "Time off" for a blank one. If SharePoint refuses to make Title
# optional, it stays required and ARC always sends a value.
$title = $have | Where-Object { $_["name"] -eq "Title" }
if ($WhatIf) {
    Write-Host "    WOULD SET    Title -> 'Reason', not required" -ForegroundColor Cyan
} else {
    try {
        Invoke-MgGraphRequest -Method PATCH -Uri "$graph/lists/$listId/columns/$($title["id"])" `
            -Body (@{ displayName = "Reason"; required = $false } | ConvertTo-Json) -ContentType "application/json" | Out-Null
        Write-Host "    Title shown as 'Reason', not required" -ForegroundColor Green
    } catch {
        Invoke-MgGraphRequest -Method PATCH -Uri "$graph/lists/$listId/columns/$($title["id"])" `
            -Body (@{ displayName = "Reason" } | ConvertTo-Json) -ContentType "application/json" | Out-Null
        Write-Host "    Title shown as 'Reason' - SharePoint kept it REQUIRED ($($_.Exception.Message))" -ForegroundColor Yellow
    }
}

if ($WhatIf) { Write-Host "`n-WhatIf - nothing was changed.`n" -ForegroundColor Yellow; exit 0 }

# --- write and read back ----------------------------------------------------
function Get-DateKey($value) {
    if ($null -eq $value -or "$value" -eq "") { return "" }
    $d = if ($value -is [datetime]) { $value.ToUniversalTime() } else { ([datetime]::Parse("$value")).ToUniversalTime() }
    if ($d.Hour -gt 12) { $d = $d.AddDays(1) }
    return $d.ToString("yyyy-MM-dd")
}

Write-Host "`n=== Write/read-back check ===" -ForegroundColor Cyan
# A person column takes the person's lookupId on THIS site, from the site's
# own User Information List. Use the signed-in user if the site knows them.
$me = Invoke-MgGraphRequest -Method GET -Uri "https://graph.microsoft.com/v1.0/me?`$select=mail,userPrincipalName"
$myAddresses = @($me.mail, $me.userPrincipalName) | Where-Object { $_ } | ForEach-Object { $_.ToLowerInvariant() }
$lookupId = $null
$who = $null
$uri = "$graph/lists/User%20Information%20List/items?`$expand=fields(`$select=Title,EMail)&`$top=500"
while ($uri -and -not $lookupId) {
    $page = Invoke-MgGraphRequest -Method GET -Uri $uri
    foreach ($u in $page.value) {
        $email = "$($u.fields.EMail)".ToLowerInvariant()
        if ($email -and $myAddresses -contains $email) { $lookupId = [int]$u.id; $who = $u.fields.Title; break }
    }
    $uri = $page["@odata.nextLink"]
}

$bad = @()
if (-not $lookupId) {
    Write-Host "  You aren't on this site's User Information List yet, so TeamMember can't be tested." -ForegroundColor Yellow
    Write-Host "  Open $siteUrl in a browser once and re-run this script." -ForegroundColor Yellow
    $bad += "TeamMember not tested"
} else {
    $fields = @{
        Title = "ARC-VERIFY (safe to delete)"
        TeamMemberLookupId = $lookupId
        StartDate = "2026-01-13T12:00:00Z"
        EndDate = "2026-01-16T12:00:00Z"
        HoursPerDay = 4.5
    }
    $row = Invoke-MgGraphRequest -Method POST -Uri "$graph/lists/$listId/items" -ContentType "application/json" `
        -Body (@{ fields = $fields } | ConvertTo-Json -Depth 4)
    try {
        $back = Invoke-MgGraphRequest -Method GET `
            -Uri "$graph/lists/$listId/items/$($row.id)?`$expand=fields(`$select=Title,TeamMember,TeamMemberLookupId,StartDate,EndDate,HoursPerDay)"
        $f = $back.fields
        if ("$($f.Title)" -ne $fields.Title) { $bad += "Title = '$($f.Title)'" }
        if ([int]"$($f.TeamMemberLookupId)" -ne $lookupId) { $bad += "TeamMemberLookupId = '$($f.TeamMemberLookupId)' (wrote $lookupId, $who)" }
        if ((Get-DateKey $f.StartDate) -ne "2026-01-13") { $bad += "StartDate = '$($f.StartDate)' (wrote 2026-01-13)" }
        if ((Get-DateKey $f.EndDate) -ne "2026-01-16") { $bad += "EndDate = '$($f.EndDate)' (wrote 2026-01-16)" }
        if ($null -eq $f.HoursPerDay -or [Math]::Abs([double]$f.HoursPerDay - 4.5) -gt 1e-9) { $bad += "HoursPerDay = '$($f.HoursPerDay)' (wrote 4.5)" }

        # Blank hours means the whole day - clearing must work.
        Invoke-MgGraphRequest -Method PATCH -Uri "$graph/lists/$listId/items/$($row.id)/fields" -ContentType "application/json" `
            -Body (@{ HoursPerDay = $null } | ConvertTo-Json) | Out-Null
        $cleared = Invoke-MgGraphRequest -Method GET -Uri "$graph/lists/$listId/items/$($row.id)?`$expand=fields(`$select=HoursPerDay)"
        if ($null -ne $cleared.fields.HoursPerDay) { $bad += "HoursPerDay did not clear (still '$($cleared.fields.HoursPerDay)')" }
    } finally {
        Invoke-MgGraphRequest -Method DELETE -Uri "$graph/lists/$listId/items/$($row.id)" | Out-Null
    }
}

if ($bad) {
    Write-Host "  These did NOT read back as written - fix before using ARC:" -ForegroundColor Red
    $bad | ForEach-Object { Write-Host "    $_" -ForegroundColor Red }
} else {
    Write-Host "  Every column wrote and read back correctly, TeamMember as $who (test row deleted)." -ForegroundColor Green
}

# --- manual steps + next ----------------------------------------------------
Write-Host "`nMANUAL STEPS - Graph cannot set these:" -ForegroundColor Yellow
Write-Host "  Site contents: $siteUrl/_layouts/15/viewlsts.aspx" -ForegroundColor Yellow
Write-Host "  ${LIST_NAME}:" -ForegroundColor Yellow
Write-Host "    List settings -> Advanced settings -> Attachments to list items = Disabled" -ForegroundColor Yellow
Write-Host "    List settings -> List name, description and navigation -> Display this list on the Quick Launch = No" -ForegroundColor Yellow
Write-Host "  Do NOT hide the list - a hidden list disappears from Site contents too." -ForegroundColor Yellow

Write-Host "`n=== Next ===" -ForegroundColor Cyan
Write-Host "  VITE_SP_PANEL_TIME_OFF_LIST_ID = $listId" -ForegroundColor Green
Write-Host "  Add it to .env.local (restart npm run dev) and as a repo variable, then redeploy." -ForegroundColor Gray
