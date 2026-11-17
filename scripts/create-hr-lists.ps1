<#
.SYNOPSIS
    Creates the two lists behind ARC's Human Resources department (HR Roles and
    New Hires) on the HR SharePoint site. Idempotent; -WhatIf reports.

.DESCRIPTION
    HR had no SharePoint site when ARC's HR department was built (2026-11-17),
    so ARC runs it on mock data until this is run. Before running it:

      1. IT creates the HR site.
      2. An admin grants ARC's app registration Sites.Selected (write) on it:
         POST https://graph.microsoft.com/v1.0/sites/{siteId}/permissions

    Then run this with -SiteId and -SiteUrl for that site. Two lists:

        HR Roles     Title = email; PersonName, Roles (lowercase CSV of
                     "new hire" / "new hire sap" / "new hire it" / "admin"),
                     Note. Not on the list = HR is hidden.
        New Hires    Title = display name. One row per person starting: the HR
                     spreadsheet's columns, the four kick-off steps (each a
                     When + a Who), Status (derived by ARC), and the
                     cancellation. Attachments OFF. Never deleted.

    THE INTERNAL NAMES ARE A CONTRACT with src/lib/newHireMapper.ts and
    src/api/hrRoles.ts. Do not rename a column here without changing it there.

    Rules this script follows (CLAUDE.md):
      - The name column on HR Roles is PersonName, NEVER DisplayName.
      - The manager and every "who" are TEXT ("Name <email>"), not person
        columns; the ticket link is TEXT, not a Hyperlink (Graph can't write one).
      - The email column is WorkEmail, so it can't be mistaken for anything
        SharePoint adds.
      - Choice columns don't allow fill-in values; the choices here must match
        src/types/hr.ts.
      - Every column is written and READ BACK on a throwaway New Hires row, then
        the row is deleted — a 2xx is not evidence a value landed.
      - Only missing columns are added. Nothing is ever deleted or recreated.

.PARAMETER SiteId
    The HR site's Graph id ("host,collectionGuid,webGuid"). Required.

.PARAMETER SiteUrl
    The HR site's URL — for the manual instructions.

.PARAMETER AdminEmail
    Optional. Seeds this person as an HR `admin` (only if they're not on the
    list yet), so somebody can manage HR Access from inside ARC on day one.

.PARAMETER AdminName
    Optional display name for -AdminEmail.

.EXAMPLE
    ./scripts/create-hr-lists.ps1 -SiteId "<id>" -SiteUrl "<url>" -WhatIf

.NOTES
    Needs Sites.Manage.All and Manage Lists on the site. RUN IN YOUR OWN
    TERMINAL — the sign-in is interactive. People's names go in through ARC's
    HR Access screen, never here and never in src/ — the repository is public.
#>
param(
    [Parameter(Mandatory)] [string]$SiteId,
    [string]$SiteUrl,
    [string]$AdminEmail,
    [string]$AdminName,
    [switch]$WhatIf,
    [switch]$DeviceCode
)

$ErrorActionPreference = "Stop"
Import-Module Microsoft.Graph.Authentication
$Graph = "https://graph.microsoft.com/v1.0/sites/$SiteId"

$ctx = Get-MgContext
if (-not $ctx -or $ctx.Scopes -notcontains "Sites.Manage.All") {
    if ($DeviceCode) { Connect-MgGraph -Scopes "Sites.Manage.All" -UseDeviceCode -NoWelcome }
    else             { Connect-MgGraph -Scopes "Sites.Manage.All" -NoWelcome }
}
if ($WhatIf) { Write-Host "*** -WhatIf: nothing will be created or changed ***" -ForegroundColor Magenta }

function Text($name, $display) { @{ name = $name; displayName = $display; text = @{ allowMultipleLines = $false } } }
function Note($name, $display) {
    @{ name = $name; displayName = $display; text = @{ allowMultipleLines = $true; textType = "plain"; appendChangesToExistingText = $false } }
}
function Choice($name, $display, [string[]]$Choices) {
    @{ name = $name; displayName = $display; choice = @{ choices = $Choices; displayAs = "dropDownMenu"; allowTextEntry = $false } }
}
function DateOnly($name, $display) { @{ name = $name; displayName = $display; dateTime = @{ format = "dateOnly"; displayAs = "standard" } } }
function DateAndTime($name, $display) { @{ name = $name; displayName = $display; dateTime = @{ format = "dateTime"; displayAs = "standard" } } }
function YesNo($name, $display) { @{ name = $name; displayName = $display; boolean = @{} } }

# Must match src/types/hr.ts.
$EmploymentTypes = @("Permanent", "Intern", "Contractor")
$Statuses = @("Submitted", "In progress", "Complete", "Cancelled")

$Lists = @(
    @{
        name = "HR Roles"; envVar = "VITE_SP_HR_ROLES_LIST_ID"; titleDisplay = "Email"
        description = "Who can see each Human Resources app in ARC. Title = email; Roles = lowercase CSV of new hire / new hire sap / new hire it / admin. Managed in ARC (HR Access)."
        columns = @((Text "PersonName" "Name"), (Text "Roles" "Roles"), (Note "Note" "Note"))
    },
    @{
        name = "New Hires"; envVar = "VITE_SP_NEW_HIRES_LIST_ID"; titleDisplay = "Display Name"
        description = "HR's new hire form in ARC — kicks off SAP and the IT ticket. Status is worked out by ARC from the steps."
        columns = @(
            (DateOnly "StartDate" "Start Date"),
            (Text "LegalFirstName" "Legal First Name"),
            (Text "PreferredFirstName" "Preferred First Name"),
            (Text "LastName" "Last Name"),
            (Text "WorkEmail" "Email"),
            (Text "JobTitle" "Job Title"),
            (Text "FabNumber" "FAB Number"),
            (Text "PersonalNumber" "Personal #"),
            (Text "EmpNumber" "EMP Number"),
            (Choice "EmploymentType" "Permanent/Intern/Contractor" $EmploymentTypes),
            (Text "Department" "Department"),
            (Text "Manager" "Manager"),
            (YesNo "NeedsComputer" "Computer Y/N"),
            (Text "DeskLocation" "Desk Location"),
            (Note "Notes" "Additional Notes"),
            (Text "ItTicketNumber" "Cooper IT Ticket #"),
            (Text "ItTicketLink" "Ticket Link"),
            (Choice "Status" "Status" $Statuses),
            (DateAndTime "AddedToSapAt" "Added to SAP"),
            (Text "AddedToSapBy" "Added to SAP By"),
            (DateAndTime "ItTicketRaisedAt" "IT Ticket Raised"),
            (Text "ItTicketRaisedBy" "IT Ticket Raised By"),
            (DateAndTime "ItAccountCreatedAt" "IT Account Created"),
            (Text "ItAccountCreatedBy" "IT Account Created By"),
            (DateAndTime "ComputerSetUpAt" "Computer Set Up"),
            (Text "ComputerSetUpBy" "Computer Set Up By"),
            (DateAndTime "CancelledAt" "Cancelled"),
            (Text "CancelledBy" "Cancelled By"),
            (Note "CancelReason" "Cancel Reason")
        )
    }
)

function Get-ExistingLists {
    $found = @{}
    $uri = "$Graph/lists?`$select=id,displayName&`$top=200"
    while ($uri) {
        $page = Invoke-MgGraphRequest -Method GET -Uri $uri
        foreach ($l in $page.value) { $found[$l.displayName] = $l.id }
        $uri = $page.'@odata.nextLink'
    }
    return $found
}

$existing = Get-ExistingLists
$listIds = @{}

foreach ($spec in $Lists) {
    Write-Host "`n$($spec.name)" -ForegroundColor Cyan
    if ($existing.ContainsKey($spec.name)) {
        $listId = $existing[$spec.name]
        Write-Host "  exists — id $listId" -ForegroundColor Yellow
    } elseif ($WhatIf) {
        Write-Host "  WOULD CREATE with columns: $(($spec.columns | ForEach-Object { $_.name }) -join ', ')" -ForegroundColor Yellow
        continue
    } else {
        $body = @{ displayName = $spec.name; description = $spec.description; list = @{ template = "genericList" }; columns = $spec.columns } |
            ConvertTo-Json -Depth 10
        $listId = (Invoke-MgGraphRequest -Method POST -Uri "$Graph/lists" -Body $body -ContentType "application/json").id
        Write-Host "  CREATED — id $listId" -ForegroundColor Green
    }
    $listIds[$spec.name] = $listId

    $cols = (Invoke-MgGraphRequest -Method GET -Uri "$Graph/lists/$listId/columns").value
    foreach ($col in $spec.columns) {
        if ($cols | Where-Object { $_.name -eq $col.name }) { Write-Host "    $($col.name) — already there"; continue }
        if ($WhatIf) { Write-Host "    $($col.name) — WOULD ADD" -ForegroundColor Yellow; continue }
        Invoke-MgGraphRequest -Method POST -Uri "$Graph/lists/$listId/columns" -Body ($col | ConvertTo-Json -Depth 10) -ContentType "application/json" | Out-Null
        Write-Host "    $($col.name) — added" -ForegroundColor Green
    }
    $title = $cols | Where-Object { $_.name -eq "Title" } | Select-Object -First 1
    if ($title -and $title.displayName -ne $spec.titleDisplay -and -not $WhatIf) {
        Invoke-MgGraphRequest -Method PATCH -Uri "$Graph/lists/$listId/columns/$($title.id)" `
            -Body (@{ displayName = $spec.titleDisplay } | ConvertTo-Json) -ContentType "application/json" | Out-Null
        Write-Host "    Title — shown as '$($spec.titleDisplay)'" -ForegroundColor Green
    }
    if (-not $WhatIf) {
        $after = (Invoke-MgGraphRequest -Method GET -Uri "$Graph/lists/$listId/columns").value
        foreach ($col in $spec.columns) {
            $c = $after | Where-Object { $_.name -eq $col.name } | Select-Object -First 1
            if ($col.text -and $col.text.allowMultipleLines -and $c.text.appendChangesToExistingText) {
                Write-Host "    $($col.name) — Graph reports 'Append Changes' ON. Turn it OFF in List settings." -ForegroundColor Red
            }
        }
    }
}

if ($WhatIf) { Write-Host "`n-WhatIf — nothing was created or changed.`n" -ForegroundColor Yellow; exit 0 }

# ---------------------------------------------------------------- write + read back every New Hires column

Write-Host "`nNew Hires — write and read back every column on a throwaway row" -ForegroundColor Cyan
$sample = @{
    Title = "ARC column check"; StartDate = "2030-01-15T12:00:00Z"; LegalFirstName = "Check"; PreferredFirstName = "Chk"
    LastName = "Column"; WorkEmail = "chk.column@example.com"; JobTitle = "Test"; FabNumber = "F-0"; PersonalNumber = "P-0"
    EmpNumber = "E-0"; EmploymentType = "Intern"; Department = "Test"; Manager = "Test Manager <manager@example.com>"
    NeedsComputer = $true; DeskLocation = "Nowhere"; Notes = "line 1`nline 2"; ItTicketNumber = "IT-0"
    ItTicketLink = "https://example.com/t/0"; Status = "In progress"
    AddedToSapAt = "2030-01-01T15:00:00Z"; AddedToSapBy = "Test Person <person@example.com>"
    ItTicketRaisedAt = "2030-01-02T15:00:00Z"; ItTicketRaisedBy = "Test Person <person@example.com>"
    ItAccountCreatedAt = "2030-01-03T15:00:00Z"; ItAccountCreatedBy = "Test Person <person@example.com>"
    ComputerSetUpAt = "2030-01-04T15:00:00Z"; ComputerSetUpBy = "Test Person <person@example.com>"
    CancelledAt = "2030-01-05T15:00:00Z"; CancelledBy = "Test Person <person@example.com>"; CancelReason = "Column check"
}
$hiresId = $listIds["New Hires"]
$item = Invoke-MgGraphRequest -Method POST -Uri "$Graph/lists/$hiresId/items" -Body (@{ fields = $sample } | ConvertTo-Json -Depth 5) -ContentType "application/json"
$back = (Invoke-MgGraphRequest -Method GET -Uri "$Graph/lists/$hiresId/items/$($item.id)?`$expand=fields").fields
$bad = @()
foreach ($k in $sample.Keys) {
    $want = $sample[$k]; $got = $back[$k]
    if ($k -like "*At" -or $k -eq "StartDate") { if (-not $got -or ([datetime]$got).ToUniversalTime() -ne ([datetime]$want).ToUniversalTime()) { $bad += $k } }
    elseif ("$got" -ne "$want") { $bad += $k }
}
Invoke-MgGraphRequest -Method DELETE -Uri "$Graph/lists/$hiresId/items/$($item.id)" | Out-Null
if ($bad.Count -eq 0) { Write-Host "  every column read back as written (row deleted)" -ForegroundColor Green }
else { Write-Host "  these did NOT read back as written: $($bad -join ', ') — check them before deploying (row deleted)" -ForegroundColor Red }

# ---------------------------------------------------------------- seed an admin

if ($AdminEmail) {
    $email = $AdminEmail.Trim().ToLowerInvariant()
    $name = if ($AdminName) { $AdminName } else { $email.Split("@")[0] }
    $rolesId = $listIds["HR Roles"]
    $rows = (Invoke-MgGraphRequest -Method GET -Uri "$Graph/lists/$rolesId/items?`$expand=fields(`$select=Title,Roles)&`$top=500").value
    if ($rows | Where-Object { "$($_.fields.Title)".Trim().ToLowerInvariant() -eq $email }) {
        Write-Host "`nHR Roles — $email is already on the list; left alone" -ForegroundColor Yellow
    } else {
        $new = Invoke-MgGraphRequest -Method POST -Uri "$Graph/lists/$rolesId/items" `
            -Body (@{ fields = @{ Title = $email; PersonName = $name; Roles = "new hire,admin" } } | ConvertTo-Json -Depth 5) -ContentType "application/json"
        $r = (Invoke-MgGraphRequest -Method GET -Uri "$Graph/lists/$rolesId/items/$($new.id)?`$expand=fields(`$select=PersonName,Roles)").fields
        if ($r.PersonName -eq $name -and $r.Roles -eq "new hire,admin") { Write-Host "`nHR Roles — added $email as HR admin (read back)" -ForegroundColor Green }
        else { Write-Host "`nHR Roles — added $email, but it read back PersonName='$($r.PersonName)' Roles='$($r.Roles)'" -ForegroundColor Red }
    }
}

# ---------------------------------------------------------------- the manual part

Write-Host "`nMANUAL — Graph can't do these:" -ForegroundColor Yellow
Write-Host "  New Hires: List settings → Advanced → Attachments = Disabled; both lists: not on the Quick Launch." -ForegroundColor Yellow
Write-Host "`nPERMISSIONS — the real boundary. Break inheritance on BOTH lists (they hold personal data):" -ForegroundColor Yellow
Write-Host "    New Hires   HR, and the SAP and IT people who set new hires up = Contribute. Nobody else." -ForegroundColor Yellow
Write-Host "    HR Roles    the same people = Read (ARC reads it to decide access); HR admins = Contribute." -ForegroundColor Yellow
Write-Host "  Grant at the LIST, never per item. Someone ARC shows HR to but SharePoint refuses sees a 'no access' notice." -ForegroundColor Yellow

Write-Host "`nIds — set as GitHub repo variables, then REDEPLOY (VITE_* values are baked in at build time):" -ForegroundColor Cyan
Write-Host "  VITE_SP_HR_SITE_ID=$SiteId" -ForegroundColor Green
foreach ($spec in $Lists) { Write-Host "  $($spec.envVar)=$($listIds[$spec.name])" -ForegroundColor Green }
if ($SiteUrl) { Write-Host "`nSite contents: $SiteUrl/_layouts/15/viewlsts.aspx" -ForegroundColor Cyan }
