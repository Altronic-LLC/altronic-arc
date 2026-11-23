<#
.SYNOPSIS
    Sets up the Quality Fixture Log (Quality Control) on Altronic_PMO: adds
    ARC's columns to the existing QFLOG list, creates "Quality Fixture Roles",
    and optionally brings QFLOG up to date from the latest paper log.
    Reports only; -Apply makes the changes.

.DESCRIPTION
    QFLOG is the "Quality Control Custom Equipment Log - calibration not
    required": one row per custom QC fixture (QF1, QF2, ... QF63A ...). It was
    loaded from the old list with three columns, which stay as they are:

      Title     the fixture number (shown "Fixture #")
      field_1   Description
      field_2   Comment

    This adds (the internal names are the contract with
    src/lib/qualityFixtures.ts):

      Active        Yes/No, default Yes. A fixture taken out of service is
                    RETIRED (No), never deleted: its number is never reused.
                    Every existing row with no value is set to Yes.
      Location      Where the fixture is kept.
      PartNumbers   Products / part numbers it tests (multi-line, plain).

    and creates Quality Fixture Roles (Title = email, PersonName, Roles =
    lowercase CSV of "editor" / "admin", Note). Unset or empty = nobody can
    change the log; everyone signed in can read it. The name column is
    PersonName, never DisplayName (Graph silently drops a field called that).

    -UpdateFrom <file> compares QFLOG with a "Fixture|Description" text file
    (one fixture per line, first line a header; the text after the FIRST "|"
    is the description, kept exactly). Rows are matched on the trimmed fixture
    number. It ADDS fixtures the list hasn't got, UPDATES a description that
    differs, TRIMS a fixture number carrying stray spaces, and only REPORTS a
    fixture the file doesn't list - nothing is ever deleted or retired by it.
    Keep the file OUTSIDE the repo.

    Every column is then written and read back with a throwaway row (deleted
    after), and every data write is read back. A 2xx is not evidence.

    RUN IN YOUR OWN TERMINAL - the sign-in is interactive. -AccessToken takes
    a Graph token instead (e.g. from `az account get-access-token`).

.EXAMPLE
    .\setup-quality-fixture-log.ps1 -UpdateFrom C:\temp\qflog-pdf.txt
    .\setup-quality-fixture-log.ps1 -UpdateFrom C:\temp\qflog-pdf.txt -Apply
#>

[CmdletBinding()]
param(
    [switch]$Apply,
    [string]$UpdateFrom,
    [switch]$DeviceCode,
    [string]$AccessToken
)

$ErrorActionPreference = "Stop"
Import-Module Microsoft.Graph.Authentication

$siteId = "coopermachineryservices.sharepoint.com,915a6183-2b71-4dfd-a8b9-181126dfbe78,3eb6cb9c-6535-4c69-a8d7-e90b2f90a9eb"
$graph = "https://graph.microsoft.com/v1.0/sites/$siteId"
$LOG_NAME = "QFLOG"
$ROLES_NAME = "Quality Fixture Roles"

$plainNote = @{ allowMultipleLines = $true; appendChangesToExistingText = $false; linesForEditing = 3; textType = "plain" }

$logColumns = @(
    @{ name = "Active"; displayName = "Active"; boolean = @{}; defaultValue = @{ value = "1" }
       description = "Untick to retire a fixture. A retired fixture stays on the log and its number is never reused." },
    @{ name = "Location"; displayName = "Location"; text = @{}
       description = "Where the fixture is kept." },
    @{ name = "PartNumbers"; displayName = "Products / Part Numbers"; text = $plainNote
       description = "The products or part numbers this fixture tests." }
)

$roleColumns = @(
    @{ name = "PersonName"; displayName = "Name"; text = @{} },
    @{ name = "Roles"; displayName = "Roles"; text = @{}
       description = "Lowercase, comma-separated: editor, admin." },
    @{ name = "Note"; displayName = "Note"; text = $plainNote }
)

# --- auth -------------------------------------------------------------------
if ($AccessToken) {
    Connect-MgGraph -AccessToken (ConvertTo-SecureString $AccessToken -AsPlainText -Force) -NoWelcome
} else {
    $ctx = Get-MgContext
    if (-not $ctx -or $ctx.Scopes -notcontains "Sites.Manage.All") {
        Write-Host "Signing in for write access (Sites.Manage.All)..." -ForegroundColor Cyan
        if ($DeviceCode) { Connect-MgGraph -Scopes "Sites.Manage.All" -UseDeviceCode -NoWelcome }
        else             { Connect-MgGraph -Scopes "Sites.Manage.All" -NoWelcome }
    }
}
if (-not $Apply) { Write-Host "`n*** Report only: nothing will be changed. Add -Apply to make the changes. ***" -ForegroundColor Magenta }

# --- find the lists (paged: an unpaged call silently returns a subset) ------
$found = @{}
$uri = "$graph/lists?`$select=id,displayName&`$top=200"
while ($uri) {
    $page = Invoke-MgGraphRequest -Method GET -Uri $uri
    foreach ($l in $page.value) { $found[$l.displayName] = $l.id }
    $uri = $page["@odata.nextLink"]
}

$logId = $found[$LOG_NAME]
if (-not $logId) { throw "There is no list called '$LOG_NAME' on Altronic_PMO." }
Write-Host "`n=== $LOG_NAME ($logId) ===" -ForegroundColor Cyan

function Ensure-Columns($listId, $label, $columns) {
    $have = (Invoke-MgGraphRequest -Method GET -Uri "$graph/lists/$listId/columns").value
    foreach ($c in $columns) {
        if ($have | Where-Object { $_["name"] -eq $c.name }) { Write-Host "    exists     $label / $($c.name)" -ForegroundColor DarkGray; continue }
        if (-not $Apply) { Write-Host "    WOULD ADD  $label / $($c.name)" -ForegroundColor Cyan; continue }
        Invoke-MgGraphRequest -Method POST -Uri "$graph/lists/$listId/columns" `
            -Body ($c | ConvertTo-Json -Depth 6) -ContentType "application/json" | Out-Null
        Write-Host "    added      $label / $($c.name)" -ForegroundColor Green
    }
}

function Set-TitleColumn($listId, $displayName) {
    $title = (Invoke-MgGraphRequest -Method GET -Uri "$graph/lists/$listId/columns").value |
        Where-Object { $_["name"] -eq "Title" }
    if ($title["displayName"] -eq $displayName) { return }
    if (-not $Apply) { Write-Host "    WOULD SHOW Title as '$displayName'" -ForegroundColor Cyan; return }
    Invoke-MgGraphRequest -Method PATCH -Uri "$graph/lists/$listId/columns/$($title["id"])" `
        -Body (@{ displayName = $displayName } | ConvertTo-Json) -ContentType "application/json" | Out-Null
    Write-Host "    Title shown as '$displayName'" -ForegroundColor Green
}

Ensure-Columns $logId $LOG_NAME $logColumns
Set-TitleColumn $logId "Fixture #"

Write-Host "`n=== $ROLES_NAME ===" -ForegroundColor Cyan
$rolesId = $found[$ROLES_NAME]
if ($rolesId) {
    Write-Host "  EXISTS  $ROLES_NAME ($rolesId)" -ForegroundColor Yellow
    Ensure-Columns $rolesId $ROLES_NAME $roleColumns
} elseif (-not $Apply) {
    Write-Host "  WOULD CREATE  $ROLES_NAME with $($roleColumns.Count) columns" -ForegroundColor Cyan
} else {
    $body = @{ displayName = $ROLES_NAME; list = @{ template = "genericList" }; columns = $roleColumns } | ConvertTo-Json -Depth 8
    $rolesId = (Invoke-MgGraphRequest -Method POST -Uri "$graph/lists" -Body $body -ContentType "application/json")["id"]
    Write-Host "  CREATED  $ROLES_NAME ($rolesId)" -ForegroundColor Green
}
if ($rolesId) { Set-TitleColumn $rolesId "Email" }

# --- read every QFLOG row ---------------------------------------------------
function Read-Log {
    $rows = @()
    $uri = "$graph/lists/$logId/items?`$expand=fields(`$select=Title,field_1,field_2,Active)&`$top=999"
    while ($uri) {
        $page = Invoke-MgGraphRequest -Method GET -Uri $uri
        $rows += $page.value
        $uri = $page["@odata.nextLink"]
    }
    return $rows
}

function Patch-Item($id, $fields) {
    Invoke-MgGraphRequest -Method PATCH -Uri "$graph/lists/$logId/items/$id/fields" `
        -Body ($fields | ConvertTo-Json) -ContentType "application/json" | Out-Null
    $back = (Invoke-MgGraphRequest -Method GET -Uri "$graph/lists/$logId/items/$id`?`$expand=fields").fields
    foreach ($k in $fields.Keys) {
        if ("$($back[$k])" -ne "$($fields[$k])") { throw "Item $id $k read back as '$($back[$k])', wrote '$($fields[$k])'." }
    }
}

$rows = Read-Log
Write-Host "`n  $($rows.Count) rows on $LOG_NAME" -ForegroundColor Gray

# --- bring the log up to date from the paper list ---------------------------
if ($UpdateFrom) {
    Write-Host "`n=== Update from $UpdateFrom ===" -ForegroundColor Cyan
    $lines = Get-Content -LiteralPath $UpdateFrom -Encoding UTF8 | Select-Object -Skip 1 | Where-Object { $_.Trim() }
    $wanted = [ordered]@{}
    foreach ($line in $lines) {
        $bar = $line.IndexOf("|")
        if ($bar -lt 1) { throw "Can't read this line (expected 'Fixture|Description'): $line" }
        $num = $line.Substring(0, $bar).Trim()
        if ($wanted.Contains($num)) { throw "$num is in the file twice." }
        $wanted[$num] = $line.Substring($bar + 1)
    }
    $byNumber = @{}
    foreach ($r in $rows) {
        $num = "$($r.fields["Title"])".Trim()
        if ($byNumber.ContainsKey($num)) { throw "$num is on the list twice - sort that out in SharePoint first." }
        $byNumber[$num] = $r
    }

    $changes = 0
    foreach ($num in $wanted.Keys) {
        $desc = $wanted[$num]
        $row = $byNumber[$num]
        if (-not $row) {
            Write-Host "  ADD     $num  $desc" -ForegroundColor Green
            $changes++
            if ($Apply) {
                $fields = @{ Title = $num; field_1 = $desc; Active = $true }
                $created = Invoke-MgGraphRequest -Method POST -Uri "$graph/lists/$logId/items" -ContentType "application/json" `
                    -Body (@{ fields = $fields } | ConvertTo-Json -Depth 4)
                $back = (Invoke-MgGraphRequest -Method GET -Uri "$graph/lists/$logId/items/$($created.id)?`$expand=fields").fields
                if ("$($back["Title"])" -ne $num -or "$($back["field_1"])" -ne $desc) { throw "$num didn't read back as written." }
            }
            continue
        }
        $patch = @{}
        if ("$($row.fields["Title"])" -ne $num) {
            Write-Host "  NUMBER  '$($row.fields["Title"])' -> '$num'" -ForegroundColor Yellow
            $patch.Title = $num
        }
        if ("$($row.fields["field_1"])" -ne $desc) {
            Write-Host "  DESC    $num  '$($row.fields["field_1"])'" -ForegroundColor Yellow
            Write-Host "                -> '$desc'" -ForegroundColor Yellow
            $patch.field_1 = $desc
        }
        if ($patch.Count -gt 0) {
            $changes++
            if ($Apply) { Patch-Item $row.id $patch }
        }
    }
    foreach ($num in $byNumber.Keys) {
        if (-not $wanted.Contains($num)) { Write-Host "  NOT ON THE PAPER LOG (left as it is)  $num" -ForegroundColor Magenta }
    }
    Write-Host "  $changes change(s)$(if ($Apply) { ' made and read back' } else { ' to make' })." -ForegroundColor Cyan
    if ($Apply) { $rows = Read-Log }
}

# --- every row with no Active value becomes Active = Yes --------------------
$blank = @($rows | Where-Object { $null -eq $_.fields["Active"] })
if ($blank.Count -gt 0) {
    $hasActive = (Invoke-MgGraphRequest -Method GET -Uri "$graph/lists/$logId/columns").value |
        Where-Object { $_["name"] -eq "Active" }
    if (-not $Apply -or -not $hasActive) {
        Write-Host "`n  WOULD SET Active = Yes on $($blank.Count) row(s) that have no value" -ForegroundColor Cyan
    } else {
        Write-Host "`n  Setting Active = Yes on $($blank.Count) row(s)..." -ForegroundColor Cyan
        foreach ($r in $blank) { Patch-Item $r.id @{ Active = $true } }
        Write-Host "  done, each read back." -ForegroundColor Green
    }
}

# --- write and read back every column ---------------------------------------
if ($Apply) {
    Write-Host "`n=== Write/read-back check ===" -ForegroundColor Cyan
    $bad = @()
    $fields = @{ Title = "ARC-VERIFY"; field_1 = "verify"; field_2 = "verify"; Active = $false; Location = "verify"; PartNumbers = "123456`n654321" }
    $row = Invoke-MgGraphRequest -Method POST -Uri "$graph/lists/$logId/items" -ContentType "application/json" `
        -Body (@{ fields = $fields } | ConvertTo-Json -Depth 4)
    $back = (Invoke-MgGraphRequest -Method GET -Uri "$graph/lists/$logId/items/$($row.id)?`$expand=fields").fields
    foreach ($k in $fields.Keys) {
        if ($fields[$k] -is [bool]) { if ([bool]$back[$k] -ne $fields[$k]) { $bad += "QFLOG $k = '$($back[$k])'" } }
        elseif ("$($back[$k])" -ne "$($fields[$k])") { $bad += "QFLOG $k = '$($back[$k])' (wrote '$($fields[$k])')" }
    }
    Invoke-MgGraphRequest -Method DELETE -Uri "$graph/lists/$logId/items/$($row.id)" | Out-Null
    if ($rolesId) {
        $roleFields = @{ Title = "verify@example.com"; PersonName = "Verify"; Roles = "editor,admin"; Note = "verify" }
        $rrow = Invoke-MgGraphRequest -Method POST -Uri "$graph/lists/$rolesId/items" -ContentType "application/json" `
            -Body (@{ fields = $roleFields } | ConvertTo-Json -Depth 4)
        $rback = (Invoke-MgGraphRequest -Method GET -Uri "$graph/lists/$rolesId/items/$($rrow.id)?`$expand=fields").fields
        foreach ($k in $roleFields.Keys) { if ("$($rback[$k])" -ne $roleFields[$k]) { $bad += "Roles $k = '$($rback[$k])'" } }
        Invoke-MgGraphRequest -Method DELETE -Uri "$graph/lists/$rolesId/items/$($rrow.id)" | Out-Null
    }
    if ($bad) {
        Write-Host "  These did NOT read back as written - fix before using ARC:" -ForegroundColor Red
        $bad | ForEach-Object { Write-Host "    $_" -ForegroundColor Red }
    } else {
        Write-Host "  Every column wrote and read back correctly (test rows deleted)." -ForegroundColor Green
    }
}

Write-Host "`n=== Next ===" -ForegroundColor Cyan
Write-Host "  VITE_SP_QUALITY_FIXTURES_LIST_ID = $logId" -ForegroundColor Green
if ($rolesId) { Write-Host "  VITE_SP_QUALITY_FIXTURE_ROLES_LIST_ID = $rolesId" -ForegroundColor Green }
Write-Host "  Then in ARC: Quality Control > Quality Fixture Log > Roles, add who may edit." -ForegroundColor Gray
