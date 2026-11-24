<#
.SYNOPSIS
    Creates the "Supplier Cold Call Log" list on Altronic_PMO (BusinessIT#79).
    Idempotent; -WhatIf reports only.

.DESCRIPTION
    The SRM tool's log of suppliers we don't do business with yet. The internal
    names are the contract with src/lib/supplierColdCalls.ts:

      Title         (shown "Company")        text, required
      Website                                text
      Commodity                              text  - free text, not a choice
      ContactName   (shown "Contact Name")   text
      ContactEmail  (shown "Contact Email")  text
      ContactPhone  (shown "Contact Phone")  text
      Notes                                  multiple lines, PLAIN text

    The contact is a person at another company, so it is plain text, never a
    person column. Anyone signed in to ARC adds, edits and removes entries, so
    the list inherits the PMO site's permissions - nothing to break.

    The script writes a test row, reads every column back, and deletes it.

    RUN IN YOUR OWN TERMINAL - the sign-in is interactive. If the Windows
    account window never appears (it can open behind VS Code), use -DeviceCode.

.EXAMPLE
    .\create-supplier-cold-call-list.ps1 -WhatIf
    .\create-supplier-cold-call-list.ps1
#>

[CmdletBinding()]
param(
    [switch]$WhatIf,
    [switch]$DeviceCode
)

$ErrorActionPreference = "Stop"
Import-Module Microsoft.Graph.Authentication

$siteId = "coopermachineryservices.sharepoint.com,915a6183-2b71-4dfd-a8b9-181126dfbe78,3eb6cb9c-6535-4c69-a8d7-e90b2f90a9eb"
$siteUrl = "https://coopermachineryservices.sharepoint.com/sites/Altronic_PMO"
$graph = "https://graph.microsoft.com/v1.0/sites/$siteId"
$LIST_NAME = "Supplier Cold Call Log"

$columns = @(
    @{ name = "Website"; displayName = "Website"; text = @{} },
    @{ name = "Commodity"; displayName = "Commodity"; text = @{}
       description = "What they make or sell. Free text." },
    @{ name = "ContactName"; displayName = "Contact Name"; text = @{} },
    @{ name = "ContactEmail"; displayName = "Contact Email"; text = @{} },
    @{ name = "ContactPhone"; displayName = "Contact Phone"; text = @{} },
    @{ name = "Notes"; displayName = "Notes"
       text = @{ allowMultipleLines = $true; textType = "plain"; linesForEditing = 6; appendChangesToExistingText = $false } }
)

# --- auth -------------------------------------------------------------------
$ctx = Get-MgContext
if (-not $ctx -or $ctx.Scopes -notcontains "Sites.Manage.All") {
    Write-Host "Signing in for write access (Sites.Manage.All)..." -ForegroundColor Cyan
    if ($DeviceCode) { Connect-MgGraph -Scopes "Sites.Manage.All" -UseDeviceCode -NoWelcome }
    else             { Connect-MgGraph -Scopes "Sites.Manage.All" -NoWelcome }
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
    Write-Host "  WOULD CREATE  $LIST_NAME with $($columns.Count) columns, Title shown as 'Company'" -ForegroundColor Cyan
    Write-Host "`n-WhatIf - nothing was changed.`n" -ForegroundColor Yellow
    exit 0
} else {
    Write-Host "  CREATE  $LIST_NAME..." -ForegroundColor Green
    $body = @{ displayName = $LIST_NAME; list = @{ template = "genericList" }; columns = $columns } | ConvertTo-Json -Depth 8
    $listId = (Invoke-MgGraphRequest -Method POST -Uri "$graph/lists" -Body $body -ContentType "application/json")["id"]
}

# --- columns: add what's missing --------------------------------------------
$have = (Invoke-MgGraphRequest -Method GET -Uri "$graph/lists/$listId/columns").value
foreach ($c in $columns) {
    if ($have | Where-Object { $_["name"] -eq $c.name }) { continue }
    if ($WhatIf) { Write-Host "    WOULD ADD    $($c.name)" -ForegroundColor Cyan; continue }
    Invoke-MgGraphRequest -Method POST -Uri "$graph/lists/$listId/columns" `
        -Body ($c | ConvertTo-Json -Depth 6) -ContentType "application/json" | Out-Null
    Write-Host "    added        $($c.name)" -ForegroundColor Green
}

$title = $have | Where-Object { $_["name"] -eq "Title" }
if ($WhatIf) {
    Write-Host "    WOULD SET    Title -> 'Company'" -ForegroundColor Cyan
    Write-Host "`n-WhatIf - nothing was changed.`n" -ForegroundColor Yellow
    exit 0
}
Invoke-MgGraphRequest -Method PATCH -Uri "$graph/lists/$listId/columns/$($title["id"])" `
    -Body (@{ displayName = "Company" } | ConvertTo-Json) -ContentType "application/json" | Out-Null
Write-Host "    Title shown as 'Company'" -ForegroundColor Green

# --- write and read back ----------------------------------------------------
# A 2xx from a write is not evidence the value landed (a column called
# DisplayName is silently dropped by Graph), so every column is read back.
Write-Host "`n=== Write/read-back check ===" -ForegroundColor Cyan
$fields = [ordered]@{
    Title        = "ARC-VERIFY (safe to delete)"
    Website      = "example.com"
    Commodity    = "Test commodity"
    ContactName  = "Test Contact"
    ContactEmail = "test.contact@example.com"
    ContactPhone = "(555) 010-0000"
    Notes        = "Line one`nLine two"
}
$bad = @()
$row = Invoke-MgGraphRequest -Method POST -Uri "$graph/lists/$listId/items" -ContentType "application/json" `
    -Body (@{ fields = $fields } | ConvertTo-Json -Depth 4)
try {
    $select = ($fields.Keys -join ",")
    $back = (Invoke-MgGraphRequest -Method GET -Uri "$graph/lists/$listId/items/$($row.id)?`$expand=fields(`$select=$select)").fields
    foreach ($k in $fields.Keys) {
        $got = "$($back[$k])" -replace "`r`n", "`n"
        if ($got -ne $fields[$k]) { $bad += "$k = '$got' (wrote '$($fields[$k])')" }
    }
    # A second write must REPLACE Notes, not append to it.
    Invoke-MgGraphRequest -Method PATCH -Uri "$graph/lists/$listId/items/$($row.id)/fields" -ContentType "application/json" `
        -Body (@{ Notes = "Replaced" } | ConvertTo-Json) | Out-Null
    $notes = (Invoke-MgGraphRequest -Method GET -Uri "$graph/lists/$listId/items/$($row.id)?`$expand=fields(`$select=Notes)").fields.Notes
    if ("$notes" -ne "Replaced") { $bad += "Notes after a second write = '$notes' (Append Changes to Existing Text must be OFF)" }
} finally {
    Invoke-MgGraphRequest -Method DELETE -Uri "$graph/lists/$listId/items/$($row.id)" | Out-Null
}

if ($bad) {
    Write-Host "  These did NOT read back as written - fix before using ARC:" -ForegroundColor Red
    $bad | ForEach-Object { Write-Host "    $_" -ForegroundColor Red }
} else {
    Write-Host "  Every column wrote and read back correctly (test row deleted)." -ForegroundColor Green
}

# --- manual steps + next ----------------------------------------------------
Write-Host "`nMANUAL STEPS - Graph cannot set these:" -ForegroundColor Yellow
Write-Host "  Site contents: $siteUrl/_layouts/15/viewlsts.aspx" -ForegroundColor Yellow
Write-Host "  ${LIST_NAME}:" -ForegroundColor Yellow
Write-Host "    List settings -> Advanced settings -> Attachments to list items = Disabled" -ForegroundColor Yellow
Write-Host "    List settings -> List name, description and navigation -> Display this list on the Quick Launch = No" -ForegroundColor Yellow
Write-Host "  Do NOT hide the list - a hidden list disappears from Site contents too." -ForegroundColor Yellow

Write-Host "`n=== Next ===" -ForegroundColor Cyan
Write-Host "  VITE_SP_SUPPLIER_COLD_CALLS_LIST_ID = $listId" -ForegroundColor Green
Write-Host "  Add it to .env.local (restart npm run dev) and as a repo variable, then redeploy." -ForegroundColor Gray
