<#
.SYNOPSIS
    One-time backfill of promoted EIRs ⇄ their tasks: the link both ways, and
    each side's comments copied to the other. Reads only, unless -Apply.

.DESCRIPTION
    Ray, 2026-10-27. EIRs promoted by the old Power App (and a few by ARC
    before both halves of the link were written) don't read as linked in ARC,
    and their comments were never shared. From now on ARC mirrors comments
    between an EIR and its task as they are posted; this brings the old pairs
    up to the same state once.

    Three steps, so nothing is written that hasn't been looked at:

      1. -Export     reads both Engineering-site lists into -OutDir.
      2. node scripts/plan-eir-task-backfill.mjs <OutDir> [--links unlinked.csv]
                     decides every pair and write (src/lib/eirTaskBackfill.ts,
                     the same rules the tests pin) and writes report.md plus
                     the CSVs. Fill in TaskId on unlinked.csv and pass it back
                     with --links to link the ones it couldn't.
      3. -Check      re-reads every record the plan touches and reports what
                     -Apply would do. Writes nothing.
         -Apply      performs plan.json.

    What -Apply writes, per pair:
      - the EIR's Task Reference, only where it doesn't already name the task;
      - the EIR's "promoted to task" flag, where it was off;
      - comments APPENDED to each side's Communication — never a rewrite.

    The task's EIR link (EIRReference) is NOT written: it's a Hyperlink
    column, and Graph can't write one at all (400 invalidRequest, proven
    live 2026-10-27). ARC reads the old SharePoint form links already there
    and finds the EIR from its Task Reference when a task has none.

    Every comment write is refused for a record whose thread changed since
    the export (somebody commented), so nothing posted in between is lost or
    doubled: re-export, re-plan and run again — the plan skips what is
    already copied. Each write is read back.

    No emails are sent. Undo: SharePoint version history on each item;
    pairs.csv records every pair and its Task Reference before and after.

.PARAMETER Export
    Read the EIRs and the Project Task List into -OutDir.

.PARAMETER Check
    Dry run of the plan against the live lists. Writes nothing.

.PARAMETER Apply
    Perform plan.json.

.PARAMETER OutDir
    The working folder. Defaults to a dated folder under %TEMP% for -Export;
    required for -Check and -Apply.

.PARAMETER DeviceCode
    Sign in with a device code instead of the browser.

.EXAMPLE
    ./scripts/eir-task-backfill.ps1 -Export
.EXAMPLE
    ./scripts/eir-task-backfill.ps1 -Check -OutDir $env:TEMP\eir-task-backfill-20261027
.EXAMPLE
    ./scripts/eir-task-backfill.ps1 -Apply -OutDir $env:TEMP\eir-task-backfill-20261027
#>
[CmdletBinding()]
param(
    [switch]$Export,
    [switch]$Check,
    [switch]$Apply,
    [string]$OutDir,
    [switch]$DeviceCode
)

$ErrorActionPreference = "Stop"

$SiteId     = "coopermachineryservices.sharepoint.com,ddb5fc80-ea51-4d56-b008-ce6a82af49b0,aa6b9467-3f57-4213-bbd4-60b94403421a"
$EirsListId = "8d00a762-288c-4678-afc4-cba2f24ac965"
$TaskListId = "42fb8c19-5f33-4fdd-9ef7-df6f21433588"
$Graph      = "https://graph.microsoft.com/v1.0"

if (@($Export, $Check, $Apply).Where({ $_ }).Count -ne 1) {
    throw "Pass exactly one of -Export, -Check or -Apply."
}
if (-not $OutDir) {
    if (-not $Export) { throw "-OutDir is required for -Check and -Apply." }
    $OutDir = Join-Path $env:TEMP ("eir-task-backfill-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
}
New-Item -ItemType Directory -Force $OutDir | Out-Null

Import-Module Microsoft.Graph.Authentication
$scope = if ($Apply) { "Sites.ReadWrite.All" } else { "Sites.Read.All" }
if ($DeviceCode) { Connect-MgGraph -Scopes $scope -UseDeviceCode -NoWelcome }
else             { Connect-MgGraph -Scopes $scope -NoWelcome }

function Invoke-Graph([string]$Method, [string]$Uri, $Body) {
    for ($try = 0; ; $try++) {
        try {
            if ($null -ne $Body) {
                return Invoke-MgGraphRequest -Method $Method -Uri $Uri -Body ($Body | ConvertTo-Json -Depth 6 -Compress) -ContentType "application/json"
            }
            return Invoke-MgGraphRequest -Method $Method -Uri $Uri
        } catch {
            $status = $_.Exception.Response.StatusCode.value__
            if (($status -eq 429 -or $status -ge 500) -and $try -lt 5) {
                Start-Sleep -Seconds ([math]::Pow(2, $try + 1))
                continue
            }
            throw
        }
    }
}

function Get-AllItems([string]$ListId, [string]$Select) {
    $uri = "$Graph/sites/$SiteId/lists/$ListId/items?`$top=999&`$expand=fields(`$select=$Select)"
    $rows = [System.Collections.Generic.List[object]]::new()
    while ($uri) {
        $page = Invoke-Graph GET $uri
        foreach ($i in $page.value) { $rows.Add([ordered]@{ id = [int]$i.id; fields = $i.fields }) }
        $uri = $page.'@odata.nextLink'
    }
    , $rows
}

function Get-Sha256([string]$Text) {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes([string]$Text)
    ([System.Convert]::ToHexString([System.Security.Cryptography.SHA256]::HashData($bytes))).ToLowerInvariant()
}

function ListIdOf([string]$List) { if ($List -eq "task") { $TaskListId } else { $EirsListId } }

function Get-Fields([string]$List, [int]$Id, [string]$Select) {
    (Invoke-Graph GET "$Graph/sites/$SiteId/lists/$(ListIdOf $List)/items/$Id`?`$expand=fields(`$select=$Select)").fields
}

# -----------------------------------------------------------------------------
if ($Export) {
    $eirs  = Get-AllItems $EirsListId "Title,EIRNo,Resolution,Status,TaskPromotedFlag,TaskReference,Communication"
    $tasks = Get-AllItems $TaskListId "Title,NumberedTitle,Status,EIRReference,Communication"
    $eirs  | ConvertTo-Json -Depth 6 | Set-Content -Encoding utf8 (Join-Path $OutDir "eirs.json")
    $tasks | ConvertTo-Json -Depth 6 | Set-Content -Encoding utf8 (Join-Path $OutDir "tasks.json")
    Write-Host "Exported $($eirs.Count) EIRs and $($tasks.Count) tasks to $OutDir"
    Write-Host "Next: node scripts/plan-eir-task-backfill.mjs `"$OutDir`""
    return
}

# -----------------------------------------------------------------------------
$planPath = Join-Path $OutDir "plan.json"
if (-not (Test-Path $planPath)) { throw "No plan.json in $OutDir — run the planner first." }
$plan = Get-Content -Raw $planPath | ConvertFrom-Json -AsHashtable
$results = [System.Collections.Generic.List[object]]::new()
$changed = [System.Collections.Generic.HashSet[string]]::new()

foreach ($w in $plan.writes) {
    $key = "$($w.list):$($w.id)"
    $row = [ordered]@{ List = $w.list; Id = $w.id; What = $w.what; Count = $w.count; Result = ""; Detail = "" }
    try {
        if ($w.what -eq "comments") {
            $fresh = [string](Get-Fields $w.list $w.id "Communication").Communication
            if ((Get-Sha256 $fresh) -ne $w.expectedSha256) {
                [void]$changed.Add($key)
                $row.Result = "skipped"
                $row.Detail = "comments changed since the export — re-export, re-plan and run again"
            } elseif ($Check) {
                $row.Result = "would append"
            } else {
                $head = $fresh -replace '\s+$', ''
                $next = if ($head) { "$head`n$($w.append)" } else { $w.append }
                Invoke-Graph PATCH "$Graph/sites/$SiteId/lists/$(ListIdOf $w.list)/items/$($w.id)/fields" @{ Communication = $next } | Out-Null
                $back = [string](Get-Fields $w.list $w.id "Communication").Communication
                if ($back -ne $next) { throw "read-back didn't match what was written (is Append Changes on for Communication?)" }
                $row.Result = "appended"
            }
        } else {
            # A link is written even when the same record's comments were
            # skipped: the two are independent.
            if ($Check) {
                $row.Result = "would write"
                $row.Detail = ($w.fields.Keys -join ", ")
            } else {
                Invoke-Graph PATCH "$Graph/sites/$SiteId/lists/$(ListIdOf $w.list)/items/$($w.id)/fields" $w.fields | Out-Null
                $back = Get-Fields $w.list $w.id (($w.fields.Keys) -join ",")
                foreach ($k in $w.fields.Keys) {
                    $want = $w.fields[$k]; $got = $back[$k]
                    $ok = if ($want -is [System.Collections.IDictionary]) { $got -and $got.Url -eq $want.Url } else { "$got" -eq "$want" }
                    if (-not $ok) { throw "read-back of $k didn't match" }
                }
                $row.Result = "written"
                $row.Detail = ($w.fields.Keys -join ", ")
            }
        }
    } catch {
        $row.Result = "FAILED"
        $row.Detail = $_.Exception.Message
    }
    $results.Add([pscustomobject]$row)
    Write-Host ("{0,-5} {1,5}  {2,-8} {3}  {4}" -f $w.list, $w.id, $w.what, $row.Result, $row.Detail)
}

$name = if ($Apply) { "applied" } else { "check" }
$csv = Join-Path $OutDir ("$name-" + (Get-Date -Format "yyyyMMdd-HHmmss") + ".csv")
$results | Export-Csv -NoTypeInformation -Encoding utf8 $csv
$summary = $results | Group-Object Result | ForEach-Object { "$($_.Name): $($_.Count)" }
Write-Host ""
Write-Host ($summary -join "   ")
Write-Host "Results: $csv"
