<#
.SYNOPSIS
    Checks that every SharePoint column the CMMS module reads actually exists,
    with the right type and the right lookup target.

.DESCRIPTION
    ARC asks SharePoint for a fixed list of columns. Ask for one that does not
    exist and Graph rejects the WHOLE read with a 400 - so one missing column
    does not degrade a screen, it empties it. That failure looks like "the list
    is broken" rather than "somebody forgot to run a script", which is why this
    exists.

    The expected columns below are taken from what the code actually selects:
      src/lib/maintenanceTaskMapper.ts       MAINTENANCE_TASK_SELECT
      src/lib/scheduledMaintenanceMapper.ts  SCHEDULED_MAINTENANCE_SELECT
      src/lib/equipmentMapper.ts             EQUIPMENT_SELECT
      src/api/maintenanceRoles.ts            the roles list

    If you change one of those, change this too - a verifier that lags the code
    is worse than none, because it reports green while the app 400s.

    READ-ONLY. GETs only.

    EXIT CODE is 1 if anything is missing or the wrong shape, 0 if clean - so
    it can gate a deploy or be run after every schema change.

.PARAMETER RolesListId
    The "Maintenance Roles" list id, if you have created it. Optional: without
    it that list is reported as "not configured" rather than failed, because an
    unconfigured roles list is a legitimate state (gating stays off).

.PARAMETER DepartmentsListId
.PARAMETER LocationsListId
    The two reference lists from create-maintenance-reference-lists.ps1. Also
    optional - they only exist once the choice-to-lookup migration has run.

.EXAMPLE
    .\Verify-CmmsSchema.ps1

.EXAMPLE
    .\Verify-CmmsSchema.ps1 -RolesListId "aaaaaaaa-..." -DepartmentsListId "bbbb-..."

.NOTES
    A `<Name>LookupId` sibling is NOT a real column - Graph synthesises it for
    any lookup or person column. This script checks the REAL column and says so,
    rather than reporting a phantom missing field.
#>

[CmdletBinding()]
param(
    [string]$RolesListId,
    [string]$DepartmentsListId,
    [string]$LocationsListId,
    [switch]$DeviceCode
)

$ErrorActionPreference = "Stop"
Import-Module Microsoft.Graph.Authentication

$siteId = "coopermachineryservices.sharepoint.com,915a6183-2b71-4dfd-a8b9-181126dfbe78,3eb6cb9c-6535-4c69-a8d7-e90b2f90a9eb"

$LIST_EQUIPMENT  = "6f2fb6e1-3b41-40de-b78b-2c43c3c3d068"
$LIST_MAINTTASKS = "ff9d837f-227f-4a9b-b534-5fc722ff8c3b"
$LIST_SCHEDULED  = "9179e16d-5cc8-41bd-b085-eccd39293f98"
$LIST_OPSTASKS   = "298ac5c5-6c53-4262-95e7-e1cfca06978b"
$LIST_OPSPROJ    = "6734ddec-95e0-4cc7-93af-7fd20bf7ac22"

# kind: text | choice | number | dateTime | boolean | person | lookup | any
# target: for a lookup, the list it must point at.
$expected = @(
    @{
        Label = "Altronic Equipment List"; Id = $LIST_EQUIPMENT
        Cols = @(
            @{ n = "Title";           k = "text" }
            @{ n = "Description";     k = "text" }
            @{ n = "SerialNo";        k = "text" }
            @{ n = "EquipmentType";   k = "choice" }
            @{ n = "Department";      k = "choice" }
            @{ n = "Location";        k = "choice" }
            @{ n = "Criticality";     k = "choice" }
            @{ n = "AssetStatus";     k = "choice" }
            @{ n = "ParentAsset";     k = "lookup"; target = $LIST_EQUIPMENT }
            @{ n = "InstallDate";     k = "dateTime" }
            @{ n = "WarrantyExpiry";  k = "dateTime" }
            @{ n = "ResponsibleTech"; k = "person" }
            @{ n = "Manufacturer";    k = "text" }
            @{ n = "ModelNumber";     k = "text" }
            @{ n = "AssetTag";        k = "text";   optional = $true }
            @{ n = "CurrentMachineHours"; k = "number"; optional = $true }
        )
    },
    @{
        Label = "Altronic Maintenance Tasks"; Id = $LIST_MAINTTASKS
        Cols = @(
            @{ n = "Title";        k = "text" }
            @{ n = "Description";  k = "text" }
            @{ n = "Status";       k = "choice" }
            @{ n = "Priority";     k = "choice" }
            @{ n = "Category";     k = "choice" }
            @{ n = "TaskType";     k = "choice" }
            @{ n = "DueStatus";    k = "choice" }
            @{ n = "StartDate";    k = "dateTime" }
            @{ n = "DueDate";      k = "dateTime" }
            @{ n = "CompletedDate"; k = "dateTime" }
            @{ n = "WONumber";     k = "text" }
            @{ n = "TechNotes";    k = "text" }
            @{ n = "FailureCause"; k = "text" }
            @{ n = "Resolution";   k = "text" }
            @{ n = "PartsUsed";    k = "text" }
            @{ n = "LaborHours";   k = "number" }
            @{ n = "DowntimeHours"; k = "number" }
            @{ n = "EquipmentRef"; k = "lookup"; target = $LIST_EQUIPMENT }
            @{ n = "ScheduledMaintenanceRef"; k = "lookup"; target = $LIST_SCHEDULED }
            @{ n = "OperationsTaskReference"; k = "lookup"; target = $LIST_OPSTASKS }
            @{ n = "OperationsProjectRef";    k = "lookup"; target = $LIST_OPSPROJ }
            @{ n = "Department";   k = "choice" }
            @{ n = "Location";     k = "choice" }
            @{ n = "Assigned";     k = "person" }
            @{ n = "ReportedBy";   k = "person" }
            @{ n = "CompletedBy";  k = "person" }
            @{ n = "Watchers";     k = "person" }
            @{ n = "Communication"; k = "text" }
        )
    },
    @{
        Label = "Scheduled Maintenance"; Id = $LIST_SCHEDULED
        Cols = @(
            @{ n = "Title";        k = "text" }
            @{ n = "Instructions"; k = "text" }
            @{ n = "Category";     k = "choice" }
            @{ n = "Priority";     k = "choice" }
            @{ n = "FrequencyInterval"; k = "number" }
            @{ n = "FrequencyUnit";     k = "choice" }
            @{ n = "ScheduleBasis";     k = "choice" }
            @{ n = "FirstDueDate";  k = "dateTime" }
            @{ n = "NextDueDate";   k = "dateTime" }
            @{ n = "LastCompleted"; k = "dateTime" }
            @{ n = "TimeNeeded";    k = "number" }
            @{ n = "GraceDays";     k = "number" }
            @{ n = "LeadTimeDays";  k = "number" }
            @{ n = "Active";           k = "boolean" }
            @{ n = "RequiresShutdown"; k = "boolean" }
            @{ n = "LOTORequired";     k = "boolean" }
            @{ n = "EquipmentRef";        k = "lookup"; target = $LIST_EQUIPMENT }
            @{ n = "OperationsProjectRef"; k = "lookup"; target = $LIST_OPSPROJ }
            @{ n = "Department";      k = "choice" }
            @{ n = "Location";        k = "choice" }
            @{ n = "AssignedTo";      k = "person" }
            @{ n = "LastCompletedBy"; k = "person" }
            @{ n = "Watchers";        k = "person" }
            # Only needed once Hourmeter schedules are used for real.
            @{ n = "LastCompletedHours"; k = "number"; optional = $true }
            @{ n = "NextDueHours";       k = "number"; optional = $true }
        )
    }
)

if ($RolesListId) {
    $expected += @{
        Label = "Maintenance Roles"; Id = $RolesListId
        Cols = @(
            @{ n = "Title";       k = "text" }
            @{ n = "DisplayName"; k = "text" }
            # Named Role, SINGULAR, and a single-value choice (Tech | Admin).
            # ARC still tolerates the plural/array shapes on read.
            @{ n = "Role";        k = "choice" }
            @{ n = "Note";        k = "text"; optional = $true }
        )
    }
}
foreach ($ref in @(
    @{ Id = $DepartmentsListId; Label = "Maintenance Departments" },
    @{ Id = $LocationsListId;   Label = "Maintenance Locations" }
)) {
    if (-not $ref.Id) { continue }
    $expected += @{
        Label = $ref.Label; Id = $ref.Id
        Cols = @(
            @{ n = "Title";  k = "text" }
            @{ n = "Active"; k = "boolean" }
            @{ n = "Note";   k = "text"; optional = $true }
        )
    }
}

# --- auth -------------------------------------------------------------------
$ctx = Get-MgContext
if (-not $ctx) {
    Write-Host "Signing in (read-only, Sites.Read.All)..." -ForegroundColor Cyan
    if ($DeviceCode) { Connect-MgGraph -Scopes "Sites.Read.All" -UseDeviceCode -NoWelcome }
    else             { Connect-MgGraph -Scopes "Sites.Read.All" -NoWelcome }
}

function Get-Kind($c) {
    if ($c.ContainsKey("lookup") -and $c["lookup"]["listId"]) { return "lookup" }
    foreach ($k in @("text", "choice", "number", "dateTime", "boolean", "personOrGroup")) {
        if ($c.ContainsKey($k)) { if ($k -eq "personOrGroup") { return "person" } else { return $k } }
    }
    return "unknown"
}

$problems = 0
$warnings = 0

foreach ($list in $expected) {
    Write-Host ""
    Write-Host ("=== {0} ===" -f $list.Label) -ForegroundColor Cyan
    try {
        $cols = (Invoke-MgGraphRequest -Method GET `
            -Uri "https://graph.microsoft.com/v1.0/sites/$siteId/lists/$($list.Id)/columns").value
    } catch {
        Write-Host ("  CANNOT READ THE LIST: {0}" -f $_.Exception.Message) -ForegroundColor Red
        $problems++
        continue
    }
    $byName = @{}
    foreach ($c in $cols) { $byName[$c["name"]] = $c }

    foreach ($want in $list.Cols) {
        $c = $byName[$want.n]
        if (-not $c) {
            if ($want.optional) {
                Write-Host ("  ..      {0,-26} not present (optional)" -f $want.n) -ForegroundColor DarkGray
                $warnings++
            } else {
                Write-Host ("  MISSING {0,-26} ARC selects this - the whole read 400s without it" -f $want.n) -ForegroundColor Red
                $problems++
            }
            continue
        }
        $kind = Get-Kind $c
        if ($want.k -ne "any" -and $kind -ne $want.k) {
            Write-Host ("  TYPE    {0,-26} expected {1}, found {2}" -f $want.n, $want.k, $kind) -ForegroundColor Red
            $problems++
            continue
        }
        if ($want.k -eq "lookup" -and $want.target) {
            $actual = $c["lookup"]["listId"]
            if ($actual -ne $want.target) {
                Write-Host ("  TARGET  {0,-26} points at {1}, expected {2}" -f $want.n, $actual, $want.target) -ForegroundColor Red
                $problems++
                continue
            }
        }
        Write-Host ("  OK      {0,-26} {1}" -f $want.n, $kind) -ForegroundColor Green
    }

    # A second writable lookup into the Equipment List alongside EquipmentRef
    # lets one row name two different assets. Flag it wherever it appears.
    if ($list.Label -ne "Altronic Equipment List") {
        $extraEquipLookups = $cols | Where-Object {
            $_["name"] -ne "EquipmentRef" -and -not $_["readOnly"] -and
            $_.ContainsKey("lookup") -and $_["lookup"]["listId"] -eq $LIST_EQUIPMENT
        }
        foreach ($x in $extraEquipLookups) {
            Write-Host ("  WARN    {0,-26} a SECOND writable lookup into the Equipment List, alongside EquipmentRef" -f $x["name"]) -ForegroundColor Yellow
            Write-Host ("          Nothing stops the two naming different assets. Remove it and read the value off EquipmentRef.") -ForegroundColor Yellow
            $warnings++
        }
    }
}

if (-not $RolesListId) {
    Write-Host ""
    Write-Host "  Maintenance Roles: not checked (-RolesListId not given)." -ForegroundColor DarkGray
    Write-Host "  That is a legitimate state - gating stays OFF until the id is configured." -ForegroundColor DarkGray
}
if (-not $DepartmentsListId -or -not $LocationsListId) {
    Write-Host "  Department / Location reference lists: not checked." -ForegroundColor DarkGray
    Write-Host "  They only exist after create-maintenance-reference-lists.ps1 has run." -ForegroundColor DarkGray
}

Write-Host ""
Write-Host "=======================================================================" -ForegroundColor Cyan
if ($problems -eq 0) {
    Write-Host (" CLEAN - every column ARC reads is present and the right shape. ({0} note(s))" -f $warnings) -ForegroundColor Green
    exit 0
} else {
    Write-Host (" {0} PROBLEM(S), {1} note(s). ARC will 400 on a list with a missing column." -f $problems, $warnings) -ForegroundColor Red
    Write-Host " Fix with Add-CMMSColumns.ps1 / Add-MeterScheduleColumns.ps1, then re-run." -ForegroundColor Red
    exit 1
}
