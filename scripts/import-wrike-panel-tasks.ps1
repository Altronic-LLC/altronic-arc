#Requires -Version 7
<#
.SYNOPSIS
    Pulls Panel Engineering's tasks from Wrike into ARC's Panel Tasks list.
    Re-runnable: run it during testing, then once more right before go-live.
    Three steps, so nothing is written unseen.

.DESCRIPTION
    -Export  Reads the Wrike space (default "Altronic Panels"): its folder and
             project tree, every task (descendants and subtasks, with
             responsibleIds / effortAllocation / description / parentIds /
             superParentIds), contacts, workflows (custom statuses) and each
             task's comments. Raw JSON pages land in -OutDir. Writes NOTHING
             anywhere else.

    -Plan    Reads the export, plus Panel Tasks, Panel Project Reference and
             the panel site's User Information List live from Graph, and the
             -MapFile (status map, project overrides, people overrides,
             folders to skip). Writes plan.json, report.md and CSVs:
               create.csv              Wrike tasks with no ARC row yet
               update.csv              Wrike changed, ARC row untouched since
                                       the last import: the fields to change
               conflicts.csv           ARC row edited in ARC since the last
                                       import - NEVER overwritten, listed
               comments.csv            comments to append
               unmatched-people.csv    responsibles the panel site can't resolve
               unmatched-projects.csv  Wrike projects with no Panel Project Reference
               arc-projects.csv        every Panel Project Reference row, to map them to
               new-projects.csv        a Panel Project Reference to CREATE for each
                                       Wrike project that matches none - review it
               flexible-effort.csv     Flexible effort flattened to a total
             Writes NOTHING to SharePoint. A re-run with no Wrike changes
             plans zero writes. With no -MapFile it writes map-template.json
             and stops.

    -Apply   Performs plan.json and nothing else. Creates (with LegacySource
             and ImportHash), updates (only the planned fields), appends
             comments. Refuses any row whose live values changed since the
             plan (re-plan). Never deletes. Every write is read back.

    How a re-run tells a Wrike change from an ARC edit - ImportHash holds two
    SHA-256 hashes, "src=<hex>;arc=<hex>":
      src  the values the import mapped from Wrike last time
      arc  the same fields as SharePoint STORED them, read back after the write
    So: live != arc   -> someone edited it in ARC        -> conflict, left alone
        mapped == src -> Wrike hasn't changed             -> no-op
        otherwise     -> update the fields that differ.
    "arc" is taken from the read-back, not from what was sent, so a field
    SharePoint stores slightly differently can't read as an ARC edit for ever.
    Communication is NOT hashed: comments are append-only and deduped.

    Fields written (Panel Tasks internal names):
      Title, Status, WorkType and Priority (the space's "Work Type" and
      "Priority" custom fields), SAPNumber (the "SAP#" custom field, as text),
      ProjectReferenceLookupId (single lookup, bare integer),
      AssignedLookupId and Watchers (both multi-person, the two-key
      Collection(Edm.Int32) shape - every resolved Wrike responsible is
      assigned, Tim 2026-10-29), Description (plain text + the Wrike
      permalink), StartDate / DueDate (date only, midday UTC),
      EstimatedHours (effortAllocation.totalEffort minutes / 60),
      LegacySource ("wrike:<task id>"), ImportHash, Communication.
    TaskType is not written - Wrike has no equivalent.

    A person the panel site can't resolve is LEFT OFF and listed - never
    written as null. Graph can't call SharePoint's "ensure user", so somebody
    the site has never seen must open the site once (or be added to a Panel
    list in ARC), then re-plan.

    NOT RUN LIVE FROM HERE. The Wrike field names and paging are from the v4
    docs, and Graph sign-in can't run from Claude's shell, so the first run is
    Tim's, in his own terminal. Read report.md before -Apply, every time.

    THE TOKEN: a Wrike permanent token (Apps & Integrations -> API), read from
    $env:WRIKE_TOKEN only. It is never a parameter and never written to disk.
    Set it without putting the token in your history:
      $env:WRIKE_TOKEN = [Net.NetworkCredential]::new('', (Read-Host -AsSecureString 'Wrike token')).Password

    -OutDir must be OUTSIDE the repo: the export is company data, and the
    repo is public.

    NEW PANEL PROJECT REFERENCES: a Wrike project that matches no Panel
    Project Reference (by projectMap, or by the same title) is PROPOSED as a
    new one in new-projects.csv: Title "<TYPE>-<Wrike title>" (the existing
    PRD-1234-ABC12-V1-001 shape), ProjectType guessed from the name, DWG No
    from a leading drawing number. Copy the CSV, correct it (set Create to No
    to leave a project off), and pass it back with -ProjectsFile on the next
    -Plan. -Apply creates them FIRST, add-only: a Title that exists by then is
    reused, never renamed. A task whose project couldn't be created is refused.

    -Blueprints  Reads Wrike's BLUEPRINTS (project and task templates) and the
             space's custom fields into -OutDir, read-only, and writes
             blueprints.md: each blueprint's tasks, subtasks, durations and
             effort, for deciding what ARC needs (a "create from template").
             Request forms and automation rules have NO public API - those
             are compared from screenshots. Writes nothing to SharePoint.

.EXAMPLE
    .\import-wrike-panel-tasks.ps1 -Export -OutDir C:\WrikeImport\2026-11-03
    .\import-wrike-panel-tasks.ps1 -Plan   -OutDir C:\WrikeImport\2026-11-03 -MapFile C:\WrikeImport\map.json
    .\import-wrike-panel-tasks.ps1 -Plan   -OutDir C:\WrikeImport\2026-11-03 -MapFile C:\WrikeImport\map.json -ProjectsFile C:\WrikeImport\projects.csv
    .\import-wrike-panel-tasks.ps1 -Apply  -OutDir C:\WrikeImport\2026-11-03
    .\import-wrike-panel-tasks.ps1 -Blueprints -OutDir C:\WrikeImport\blueprints
#>

[CmdletBinding()]
param(
    [switch]$Export,
    [switch]$Plan,
    [switch]$Apply,
    [switch]$Blueprints,
    [Parameter(Mandatory)][string]$OutDir,
    [string]$MapFile,
    [string]$ProjectsFile,
    [string]$SpaceTitle = "Altronic Panels",
    [string]$WrikeHost = "www.wrike.com",
    [switch]$DeviceCode
)

$ErrorActionPreference = "Stop"

if ((@($Export, $Plan, $Apply, $Blueprints) | Where-Object { $_ }).Count -ne 1) {
    throw "Pick exactly one of -Export, -Plan, -Apply, -Blueprints."
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$OutDir = [IO.Path]::GetFullPath($OutDir)
if ($OutDir.StartsWith($repoRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw "-OutDir is inside the repo ($repoRoot). The export is company data and the repo is public - put it somewhere else."
}
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

$siteId = "coopermachineryservices.sharepoint.com,fdf31131-2076-4618-923b-a1856e6b0f2a,3eb6cb9c-6535-4c69-a8d7-e90b2f90a9eb"
$graph = "https://graph.microsoft.com/v1.0/sites/$siteId"
$TASKS_LIST = "17a33ee1-c4aa-439b-9dc0-6269a8e04767"     # Panel Tasks
$PROJECTS_LIST = "7b2927fb-468e-4305-8d97-7415e70ae986"  # Panel Project Reference
# Panel Tasks' statuses = the panel team's Wrike "Panel Workflow" (PANEL_TASK_STATUSES
# in src/types/task.ts; scripts/set-panel-task-statuses.ps1 sets the column).
$ARC_STATUSES = @("New", "Pending Scheduling", "Ready", "In Progress", "Revision Needed", "Awaiting Pre-Req",
    "Possible Support", "Completed", "On Hold - Approval", "On Hold - Internal", "Canceled")
# Panel Project Reference's ProjectType choices (PANEL_PROJECT_TYPES in src/types/task.ts).
$PROJECT_TYPES = @("PRD-Production Order", "FS-Field Support", "IS-Internal Support", "DEV-Product Development", "PRG-Programming", "MSC-Misc")
$IMPORT_TAG = "<p><em>&mdash; imported from Wrike</em></p>"
$inv = [Globalization.CultureInfo]::InvariantCulture

# ============================================================================ helpers

function Read-JsonFile($path) {
    $raw = Get-Content -Raw -Path $path
    # PowerShell turns ISO strings into [datetime]s unless told otherwise
    # (-DateKind arrived in 7.5); the date helpers below accept both.
    if ((Get-Command ConvertFrom-Json).Parameters.ContainsKey("DateKind")) {
        return $raw | ConvertFrom-Json -AsHashtable -DateKind String
    }
    return $raw | ConvertFrom-Json -AsHashtable
}

function Write-JsonFile($path, $value) {
    $value | ConvertTo-Json -Depth 30 | Set-Content -Path $path -Encoding utf8
}

function Get-Sha256($text) {
    $bytes = [Text.Encoding]::UTF8.GetBytes($text)
    return ([Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($bytes))).ToLowerInvariant()
}

# A Wrike planned date ("2026-10-27T09:00:00", no zone) -> "2026-10-27".
function Get-WrikeDay($v) {
    if ($null -eq $v -or "$v" -eq "") { return "" }
    if ($v -is [datetime]) { return $v.ToString("yyyy-MM-dd", $inv) }
    return "$v".Substring(0, 10)
}

# A SharePoint date-only value -> "yyyy-MM-dd" through ARC's midday pivot
# (src/lib/spDates.ts): a stored time after 12:00 UTC is the NEXT day.
function Get-SpDay($v) {
    if ($null -eq $v -or "$v" -eq "") { return "" }
    $d = if ($v -is [datetime]) { $v.ToUniversalTime() }
         else { [datetime]::Parse("$v", $inv, [Globalization.DateTimeStyles]::AdjustToUniversal -bor [Globalization.DateTimeStyles]::AssumeUniversal) }
    if ($d.Hour -gt 12) { $d = $d.AddDays(1) }
    return $d.ToString("yyyy-MM-dd", $inv)
}

function Get-Utc($v) {
    if ($v -is [datetime]) { return $v.ToUniversalTime() }
    return [datetime]::Parse("$v", $inv, [Globalization.DateTimeStyles]::AdjustToUniversal -bor [Globalization.DateTimeStyles]::AssumeUniversal)
}

# Communication timestamps are written in US Eastern, whoever writes them
# (COMMENT_TIMEZONE in src/lib/communicationParser.ts).
$eastern = try { [TimeZoneInfo]::FindSystemTimeZoneById("America/New_York") } catch { [TimeZoneInfo]::FindSystemTimeZoneById("Eastern Standard Time") }
function Format-SpTimestamp([datetime]$utc) {
    $local = [TimeZoneInfo]::ConvertTimeFromUtc([datetime]::SpecifyKind($utc, [DateTimeKind]::Utc), $eastern)
    return $local.ToString("MM/dd/yyyy h:mm:ss tt", $inv)
}

function ConvertTo-PlainText($html) {
    if (-not $html) { return "" }
    $t = "$html" -replace "(?i)<br\s*/?>", "`n" -replace "(?i)</(p|div|h\d|tr)>", "`n" -replace "(?i)<li[^>]*>", "- "
    $t = $t -replace "(?i)</li>", "`n" -replace "<[^>]+>", ""
    $t = [Net.WebUtility]::HtmlDecode($t) -replace "`r", "" -replace "[ \t]+`n", "`n" -replace "`n{3,}", "`n`n"
    return $t.Trim()
}

# The backfill's commentKey rule: same author, same words (not time).
function Get-CommentKey($email, $name, $html) {
    $who = "$(if ($email) { $email } else { $name })".Trim().ToLowerInvariant()
    $words = (ConvertTo-PlainText ("$html" -replace [regex]::Escape($IMPORT_TAG), "")) -replace "\s+", " "
    return "$who|$($words.Trim().ToLowerInvariant())"
}

$recordSplit = '(?<![\d/])(?=\d{1,2}/\d{1,2}/\d{4}\s+\d{1,2}:\d{2}:\d{2}\s+(?:AM|PM)\|\|\|)'
function Get-CommentKeys($communication) {
    $keys = [Collections.Generic.HashSet[string]]::new()
    if (-not $communication) { return , $keys }
    foreach ($rec in [regex]::Split("$communication", $recordSplit)) {
        $parts = $rec -split "\|\|\|"
        if ($parts.Count -lt 4) { continue }
        [void]$keys.Add((Get-CommentKey $parts[2] $parts[1] (($parts[3..($parts.Count - 1)]) -join "|||")))
    }
    return , $keys
}

# The hashed field set, in a fixed order, as strings.
function Get-Normal($v) {
    $hours = if ($null -eq $v.EstimatedHours -or "$($v.EstimatedHours)" -eq "") { "" } else { ([double]$v.EstimatedHours).ToString("0.00", $inv) }
    $watchers = (@($v.Watchers) | Where-Object { $_ } | ForEach-Object { [int]$_ } | Sort-Object -Unique) -join ","
    $desc = "$($v.Description)" -replace "`r", ""
    return [ordered]@{
        Title = "$($v.Title)".Trim()
        Status = "$($v.Status)"
        WorkType = "$($v.WorkType)"
        Priority = "$($v.Priority)"
        SAPNumber = "$($v.SAPNumber)".Trim()
        Project = "$(if ("$($v.Project)" -like 'new:*') { $v.Project } elseif ($v.Project) { [int]$v.Project })"
        Assigned = (@($v.Assigned) | Where-Object { $_ } | ForEach-Object { [int]$_ } | Sort-Object -Unique) -join ","
        Watchers = $watchers
        Description = $desc.TrimEnd()
        StartDate = "$($v.StartDate)"
        DueDate = "$($v.DueDate)"
        EstimatedHours = $hours
    }
}
function Get-NormalHash($normal) { return Get-Sha256 (($normal.GetEnumerator() | ForEach-Object { "$($_.Key)=$($_.Value)" }) -join "`n") }

# A live Panel Tasks row -> the same shape as a mapped Wrike task.
function Get-LiveValues($f) {
    $watchers = @($f.Watchers) | Where-Object { $_ } | ForEach-Object { $_.LookupId }
    # Assigned is multi-person now; a row saved while it was single still reads.
    $assigned = @(@($f.Assigned) | Where-Object { $_ } | ForEach-Object { $_.LookupId }) +
        @(@($f.AssignedLookupId) | Where-Object { $_ })
    return @{
        Title = $f.Title; Status = $f.Status; WorkType = $f.WorkType; Priority = $f.Priority
        SAPNumber = $f.SAPNumber
        Project = $f.ProjectReferenceLookupId; Assigned = $assigned
        Watchers = $watchers; Description = $f.Description
        StartDate = Get-SpDay $f.StartDate; DueDate = Get-SpDay $f.DueDate
        EstimatedHours = $f.EstimatedHours
    }
}

# Mapped values -> the Graph fields to send. $only limits it to some keys.
function Get-GraphFields($v, $only) {
    $out = [ordered]@{}
    $keys = if ($only) { $only } else { @("Title", "Status", "WorkType", "Priority", "SAPNumber", "Project", "Assigned", "Watchers", "Description", "StartDate", "DueDate", "EstimatedHours") }
    foreach ($k in $keys) {
        switch ($k) {
            "Title"          { $out.Title = $v.Title }
            "Status"         { $out.Status = $v.Status }
            "WorkType"       { $out.WorkType = if ($v.WorkType) { $v.WorkType } else { $null } }
            "Priority"       { $out.Priority = if ($v.Priority) { $v.Priority } else { $null } }
            "SAPNumber"      { $out.SAPNumber = if ("$($v.SAPNumber)".Trim()) { "$($v.SAPNumber)".Trim() } else { $null } }
            "Project"        { $out.ProjectReferenceLookupId = if ($v.Project) { [int]$v.Project } else { $null } }
            "Assigned"       { $out["AssignedLookupId@odata.type"] = "Collection(Edm.Int32)"; $out.AssignedLookupId = [int[]]@($v.Assigned | Where-Object { $_ }) }
            "Watchers"       { $out["WatchersLookupId@odata.type"] = "Collection(Edm.Int32)"; $out.WatchersLookupId = [int[]]@($v.Watchers | Where-Object { $_ }) }
            "Description"    { $out.Description = $v.Description }
            "StartDate"      { $out.StartDate = if ($v.StartDate) { "$($v.StartDate)T12:00:00Z" } else { $null } }
            "DueDate"        { $out.DueDate = if ($v.DueDate) { "$($v.DueDate)T12:00:00Z" } else { $null } }
            "EstimatedHours" { $out.EstimatedHours = if ("$($v.EstimatedHours)" -ne "") { [double]$v.EstimatedHours } else { $null } }
        }
    }
    return $out
}

function Connect-Graph {
    Import-Module Microsoft.Graph.Authentication
    $ctx = Get-MgContext
    if (-not $ctx -or $ctx.Scopes -notcontains "Sites.ReadWrite.All") {
        Write-Host "Signing in to Graph (Sites.ReadWrite.All)..." -ForegroundColor Cyan
        if ($DeviceCode) { Connect-MgGraph -Scopes "Sites.ReadWrite.All" -UseDeviceCode -NoWelcome }
        else             { Connect-MgGraph -Scopes "Sites.ReadWrite.All" -NoWelcome }
    }
}

function Get-GraphAll($uri) {
    $all = @()
    while ($uri) {
        $page = Invoke-MgGraphRequest -Method GET -Uri $uri
        $all += $page.value
        $uri = $page["@odata.nextLink"]
    }
    return $all
}

$TASK_SELECT = "Title,Status,WorkType,Priority,SAPNumber,ProjectReferenceLookupId,Assigned,AssignedLookupId,Watchers,Description,StartDate,DueDate,EstimatedHours,LegacySource,ImportHash,Communication"
function Get-LiveTasks {
    $byLegacy = @{}
    foreach ($it in (Get-GraphAll "$graph/lists/$TASKS_LIST/items?`$expand=fields(`$select=$TASK_SELECT)&`$top=500")) {
        $src = "$($it.fields.LegacySource)"
        if (-not $src.StartsWith("wrike:")) { continue }
        if (-not $byLegacy.ContainsKey($src)) { $byLegacy[$src] = @() }
        $byLegacy[$src] += , $it
    }
    return $byLegacy
}

function Get-LiveTask($id) {
    return Invoke-MgGraphRequest -Method GET -Uri "$graph/lists/$TASKS_LIST/items/$($id)?`$expand=fields(`$select=$TASK_SELECT)"
}

# ============================================================================ -Export

if ($Export -or $Blueprints) {
    $token = $env:WRIKE_TOKEN
    if (-not $token) {
        throw "Set `$env:WRIKE_TOKEN first (see the help: Get-Help .\import-wrike-panel-tasks.ps1 -Full). It is never a parameter."
    }
    $base = "https://$WrikeHost/api/v4"
    $headers = @{ Authorization = "bearer $token" }

    function Invoke-Wrike($path) {
        for ($try = 1; ; $try++) {
            try {
                return Invoke-WebRequest -Uri "$base$path" -Headers $headers -Method GET
            } catch {
                $code = [int]($_.Exception.Response.StatusCode)
                if (($code -eq 429 -or $code -ge 500) -and $try -lt 6) {
                    Write-Host "    Wrike answered $code - waiting $(10 * $try)s" -ForegroundColor Yellow
                    Start-Sleep -Seconds (10 * $try)
                    continue
                }
                throw
            }
        }
    }

    # Saves each page RAW (prefix-001.json, ...) and returns the data rows.
    function Save-WrikePages($path, $prefix) {
        $rows = @(); $n = 0; $next = $null
        do {
            $sep = if ($path.Contains("?")) { "&" } else { "?" }
            if ($next) {
                # The token must be escaped: it can hold + / = (the task export
                # got lucky; task_blueprints' tokens didn't). If an endpoint
                # refuses it beside the original filters, ask with the token alone.
                $tok = [uri]::EscapeDataString($next)
                try {
                    $page = Invoke-Wrike "$path$($sep)nextPageToken=$tok"
                } catch {
                    if ("$($_.ErrorDetails.Message)$($_.Exception.Message)" -notmatch 'invalid_parameter|nextPageToken') { throw }
                    $page = Invoke-Wrike "$(($path -split '\?')[0])?nextPageToken=$tok"
                }
            } else {
                $page = Invoke-Wrike $path
            }
            $n++
            Set-Content -Path (Join-Path $OutDir ("{0}-{1:000}.json" -f $prefix, $n)) -Value $page.Content -Encoding utf8
            $json = $page.Content | ConvertFrom-Json -AsHashtable
            $rows += $json.data
            $next = $json.nextPageToken
            # Wrike can hand back a token with an EMPTY page (task_blueprints
            # does), and asking for that "next" page is refused - so an empty
            # page ends it.
        } while ($next -and @($json.data).Count -gt 0)
        return $rows
    }

    if ($Blueprints) {
        # ---------------------------------------------------------------- -Blueprints
        # Read-only. NOT RUN LIVE when written (2026-10-28): the endpoints are
        # from the v4 docs and Wrike's community, and the blueprint fields are
        # read defensively - anything missing is left blank, never guessed.
        Write-Host "`n=== Blueprints from Wrike ($WrikeHost) to $OutDir ===" -ForegroundColor Cyan
        Get-ChildItem -Path $OutDir -Filter "*.json" -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -match '^(spaces|folder-blueprints|task-blueprints|space-folder-blueprints|space-task-blueprints|customfields|contacts|workflows|space-workflows)-\d+\.json$' } | Remove-Item

        # A space's blueprints live under the SPACE, not the account (found on
        # the first run: the account lists held only an empty "Blueprint
        # Root"). Both are read and merged by id.
        $space = (Save-WrikePages "/spaces" "spaces") | Where-Object { $_.title -eq $SpaceTitle } | Select-Object -First 1
        if (-not $space) { throw "No Wrike space called '$SpaceTitle' is visible to this token's user." }
        $byId = [ordered]@{}
        foreach ($fb in @(Save-WrikePages "/folder_blueprints" "folder-blueprints") + @(Save-WrikePages "/spaces/$($space.id)/folder_blueprints" "space-folder-blueprints")) {
            if ($fb -and $fb.scope -ne "BpRoot") { $byId[$fb.id] = $fb }
        }
        $folderBps = @($byId.Values)
        Write-Host "  folder blueprints $($folderBps.Count)" -ForegroundColor Green
        $tById = [ordered]@{}
        foreach ($t in @(Save-WrikePages "/task_blueprints?pageSize=1000" "task-blueprints") + @(Save-WrikePages "/spaces/$($space.id)/task_blueprints?pageSize=1000" "space-task-blueprints")) {
            if ($t) { $tById[$t.id] = $t }
        }
        $taskBps = @($tById.Values)
        Write-Host "  task blueprints   $($taskBps.Count)" -ForegroundColor Green
        # Per folder blueprint too: the flat list can't be filtered by its
        # folder blueprint (a known gap), so ask each one. A 404 here just
        # means the endpoint isn't there - the flat list still stands.
        $tasksByFolder = @{}
        foreach ($fb in $folderBps) {
            try {
                $page = Invoke-Wrike "/folder_blueprints/$($fb.id)/task_blueprints?descendants=true&pageSize=1000"
                $tasksByFolder[$fb.id] = @(($page.Content | ConvertFrom-Json -AsHashtable).data)
            } catch {
                Write-Host "    (no task list for '$($fb.title)': $($_.Exception.Message))" -ForegroundColor DarkYellow
            }
        }
        $wfs = @(Save-WrikePages "/workflows" "workflows")
        try { $wfs += @(Save-WrikePages "/spaces/$($space.id)/workflows" "space-workflows") }
        catch { Write-Host "  space workflows: refused ($($_.Exception.Message))" -ForegroundColor Yellow }
        $customFields = @(Save-WrikePages "/customfields" "customfields")
        $contacts = @(Save-WrikePages "/contacts" "contacts")
        $nameOf = @{}
        foreach ($c in $contacts) { $nameOf[$c.id] = ("$($c.firstName) $($c.lastName)").Trim() }
        Write-JsonFile (Join-Path $OutDir "folder-blueprint-tasks.json") $tasksByFolder

        $taskById = @{}
        foreach ($t in $taskBps) { $taskById[$t.id] = $t }
        foreach ($list in $tasksByFolder.Values) { foreach ($t in $list) { $taskById[$t.id] = $t } }

        function Format-BpTask($t, $depth) {
            $bits = @()
            if ($t.dates -and $t.dates.duration) { $bits += "$([Math]::Round([double]$t.dates.duration / 480, 1)) day(s)" }
            if ($t.effortAllocation -and $null -ne $t.effortAllocation.totalEffort) {
                $bits += "$([Math]::Round([double]$t.effortAllocation.totalEffort / 60, 2))h effort"
            }
            $who = @($t.responsibleIds | Where-Object { $_ } | ForEach-Object { if ($nameOf[$_]) { $nameOf[$_] } else { $_ } })
            if ($who.Count) { $bits += "assigned: $($who -join ', ')" }
            $line = "$('  ' * $depth)- $($t.title)$(if ($bits.Count) { " ($($bits -join '; '))" })"
            $out = @($line)
            foreach ($sid in @($t.subTaskIds)) {
                if ($sid -and $taskById[$sid]) { $out += Format-BpTask $taskById[$sid] ($depth + 1) }
            }
            return $out
        }

        $md = @("# Wrike blueprints - $SpaceTitle", "", "Read $((Get-Date).ToString('yyyy-MM-dd HH:mm')) from $WrikeHost. Raw JSON is beside this file.", "")
        foreach ($fb in ($folderBps | Sort-Object { $_.title })) {
            $md += "## $($fb.title)$(if ($fb.project) { ' (project blueprint)' })", ""
            # @($null) is one item in PowerShell, so a missing list is checked first.
            $own = if ($tasksByFolder.ContainsKey($fb.id)) { @($tasksByFolder[$fb.id] | Where-Object { $_ }) } else { @() }
            # Only the top of each task tree; subtasks print under their parent.
            $subIds = @{}
            foreach ($t in $own) { foreach ($sid in @($t.subTaskIds)) { if ($sid) { $subIds[$sid] = $true } } }
            $top = @($own | Where-Object { -not $subIds.ContainsKey($_.id) })
            if ($top.Count) { foreach ($t in $top) { $md += Format-BpTask $t 0 } }
            else { $md += "_No tasks read for this blueprint - see task-blueprints-*.json._" }
            $md += ""
        }
        $orphans = @($taskBps | Where-Object { -not ($_.superTaskIds | Where-Object { $_ }) })
        if ($orphans.Count) {
            $md += "## Task blueprints (account list)", ""
            foreach ($t in $orphans) { $md += Format-BpTask $t 0 }
            $md += ""
        }
        foreach ($wf in $wfs) {
            if (-not $wf) { continue }
            $md += "## Workflow: $($wf.name)$(if ($wf.hidden) { ' (hidden)' })", ""
            foreach ($st in @($wf.customStatuses)) { if ($st) { $md += "- $($st.name) ($($st.group))$(if ($st.hidden) { ' - hidden' })" } }
            $md += ""
        }
        if ($customFields.Count) {
            $md += "## Custom fields", ""
            foreach ($cf in $customFields) { $md += "- $($cf.title) ($($cf.type))" }
            $md += ""
        }
        $md += "Request forms and automation rules aren't in Wrike's public API - compare those from screenshots."
        Set-Content -Path (Join-Path $OutDir "blueprints.md") -Value $md -Encoding utf8
        Write-Host "`nWrote blueprints.md and the raw JSON to $OutDir. Nothing was written anywhere else." -ForegroundColor Cyan
        exit 0
    }

    Write-Host "`n=== Export from Wrike ($WrikeHost) to $OutDir ===" -ForegroundColor Cyan
    Get-ChildItem -Path $OutDir -Filter "*.json" -ErrorAction SilentlyContinue | Where-Object { $_.Name -match '^(spaces|folders|tasks|contacts|workflows|space-workflows|customfields)-\d+\.json$' } | Remove-Item
    if (Test-Path (Join-Path $OutDir "comments")) { Remove-Item -Recurse -Force (Join-Path $OutDir "comments") }

    $space = (Save-WrikePages "/spaces" "spaces") | Where-Object { $_.title -eq $SpaceTitle } | Select-Object -First 1
    if (-not $space) { throw "No Wrike space called '$SpaceTitle' is visible to this token's user." }
    Write-Host "  space    $($space.title) ($($space.id))" -ForegroundColor Green

    $folders = Save-WrikePages "/spaces/$($space.id)/folders" "folders"
    Write-Host "  folders  $($folders.Count)" -ForegroundColor Green

    # customFields: the space's own Work Type / Priority / SAP# / Project/Job
    # (the first export left them out). Saved raw; -Plan doesn't map them yet.
    $fields = [uri]::EscapeDataString('["responsibleIds","effortAllocation","description","parentIds","superParentIds","customFields"]')
    $tasks = Save-WrikePages "/spaces/$($space.id)/tasks?descendants=true&subTasks=true&pageSize=1000&fields=$fields" "tasks"
    Write-Host "  tasks    $($tasks.Count)" -ForegroundColor Green

    $contacts = Save-WrikePages "/contacts" "contacts"
    Write-Host "  contacts $($contacts.Count)" -ForegroundColor Green
    # The custom field definitions, so -Plan can find "Work Type" by NAME
    # rather than by an id that changes if the field is ever recreated.
    $customFieldDefs = @(Save-WrikePages "/customfields" "customfields")
    Write-Host "  custom fields $($customFieldDefs.Count)" -ForegroundColor Green
    [void](Save-WrikePages "/workflows" "workflows")
    # A workflow made INSIDE a space isn't in /workflows (account-wide only) -
    # and on 2026-10-28, 251 of the 252 Panels tasks used one. Its status names
    # are what the MapFile maps, so ask the space too. Unverified endpoint:
    # if Wrike refuses it, say so - the plan then falls back to status groups.
    try {
        $spaceWf = @(Save-WrikePages "/spaces/$($space.id)/workflows" "space-workflows")
        Write-Host "  space workflows $($spaceWf.Count): $(($spaceWf | ForEach-Object { $_.name }) -join ', ')" -ForegroundColor Green
    } catch {
        Write-Host "  space workflows: Wrike refused /spaces/$($space.id)/workflows ($($_.Exception.Message)) - statuses will map by group only" -ForegroundColor Yellow
    }

    $commentDir = New-Item -ItemType Directory -Force -Path (Join-Path $OutDir "comments")
    $i = 0; $withComments = 0
    foreach ($t in $tasks) {
        $i++
        if ($i % 50 -eq 0) { Write-Host "  comments $i / $($tasks.Count)..." -ForegroundColor Gray }
        $page = Invoke-Wrike "/tasks/$($t.id)/comments"
        $data = ($page.Content | ConvertFrom-Json -AsHashtable).data
        if ($data.Count -gt 0) {
            Set-Content -Path (Join-Path $commentDir "$($t.id).json") -Value $page.Content -Encoding utf8
            $withComments++
        }
    }
    Write-Host "  comments on $withComments task(s)" -ForegroundColor Green

    Write-JsonFile (Join-Path $OutDir "manifest.json") ([ordered]@{
        exportedAt = (Get-Date).ToUniversalTime().ToString("o"); wrikeHost = $WrikeHost
        spaceTitle = $space.title; spaceId = $space.id
        folders = $folders.Count; tasks = $tasks.Count; contacts = $contacts.Count; tasksWithComments = $withComments
    })
    Write-Host "`nExported. Next: -Plan -OutDir `"$OutDir`" -MapFile <map.json>" -ForegroundColor Cyan
    exit 0
}

# ============================================================================ -Plan

if ($Plan) {
    if (-not (Test-Path (Join-Path $OutDir "manifest.json"))) { throw "No export in $OutDir - run -Export first." }
    $manifest = Read-JsonFile (Join-Path $OutDir "manifest.json")
    function Read-Pages($prefix) { Get-ChildItem -Path $OutDir -Filter "$prefix-*.json" | Sort-Object Name | ForEach-Object { (Read-JsonFile $_.FullName).data } }
    $folders = @(Read-Pages "folders")
    $tasks = @(Read-Pages "tasks")
    $contacts = @(Read-Pages "contacts")
    $workflows = @(Read-Pages "workflows") + @(Read-Pages "space-workflows")
    # Work Type and Priority: the space's dropdown custom fields, found by
    # title. Values ARC doesn't know (PANEL_TASK_WORK_TYPES / _PRIORITIES) are
    # left blank and noted.
    $customFieldDefs = @(Read-Pages "customfields")
    $dropdowns = @(
        @{ Key = "WorkType"; Title = "Work Type"; Values = @("Production Order", "Non-Production", "Improvement / Internal") },
        @{ Key = "Priority"; Title = "Priority"; Values = @("High", "Medium", "Low") }
    )
    foreach ($d in $dropdowns) {
        $d.Field = $customFieldDefs | Where-Object { $_.title -eq $d.Title } | Select-Object -First 1
        if (-not $d.Field) { Write-Host "  no '$($d.Title)' custom field in the export - re-run -Export to bring it over" -ForegroundColor Yellow }
    }
    # SAP#: a text custom field, copied as it is (Tim, 2026-10-30: it lives on
    # the task AND the order; Wrike only has it on the task).
    $sapField = $customFieldDefs | Where-Object { $_.title -eq "SAP#" } | Select-Object -First 1
    if (-not $sapField) { Write-Host "  no 'SAP#' custom field in the export - re-run -Export to bring it over" -ForegroundColor Yellow }

    $statusById = @{}
    foreach ($wf in $workflows) { foreach ($s in $wf.customStatuses) { $statusById[$s.id] = $s } }
    $folderById = @{}; $parentOf = @{}
    foreach ($f in $folders) { $folderById[$f.id] = $f }
    foreach ($f in $folders) { foreach ($c in @($f.childIds)) { if ($c) { $parentOf[$c] = $f.id } } }

    # Folder titles from the top down, and the nearest PROJECT above a task.
    function Get-Ancestry($folderId) {
        $chain = @(); $id = $folderId; $guard = 0
        while ($id -and $folderById.ContainsKey($id) -and $guard++ -lt 50) { $chain += $folderById[$id]; $id = $parentOf[$id] }
        return $chain
    }
    function Get-TaskPlace($t) {
        foreach ($parentId in @($t.parentIds)) {
            $chain = @(Get-Ancestry $parentId)
            if ($chain.Count -eq 0) { continue }
            $project = $chain | Where-Object { $_.project } | Select-Object -First 1
            return @{ chain = $chain; project = $project; path = (($chain | ForEach-Object { $_.title })[($chain.Count - 1)..0] -join " / ") }
        }
        return @{ chain = @(); project = $null; path = "" }
    }

    # --- the map file (or a template to fill in) -------------------------------
    if (-not $MapFile -or -not (Test-Path $MapFile)) {
        # A status ARC has by name maps to itself (the Panel Workflow is 1-to-1);
        # anything else by its Wrike group. The bare group names are there too,
        # for a task whose status the export couldn't name.
        $statusDefaults = @{ Active = "New"; Deferred = "On Hold - Internal"; Completed = "Completed"; Cancelled = "Canceled" }
        $statusMap = [ordered]@{}
        foreach ($s in ($statusById.Values | Sort-Object { $_.name })) {
            $statusMap[$s.name] = if ($ARC_STATUSES -contains $s.name) { $s.name } elseif ($s.name -eq "Cancelled") { "Canceled" } else { $statusDefaults["$($s.group)"] }
        }
        foreach ($g in $statusDefaults.Keys) { if (-not $statusMap.Contains($g)) { $statusMap[$g] = $statusDefaults[$g] } }
        $projectTitles = [ordered]@{}
        foreach ($f in ($folders | Where-Object { $_.project } | Sort-Object { $_.title })) { $projectTitles[$f.title] = "" }
        $template = [ordered]@{
            _readme = "statusMap: Wrike status name -> Pending | In Process | On Hold | Complete (defaults by Wrike's status group - CHECK them). " +
                      "projectMap: Wrike project title -> Panel Project Reference title; blank = match by the same title. " +
                      "peopleMap: Wrike email -> panel-site email, for people whose addresses differ. " +
                      "excludeFolders: folder/project titles whose tasks are skipped. skipStatusGroups: Wrike groups never imported."
            statusMap = $statusMap
            projectMap = $projectTitles
            peopleMap = [ordered]@{}
            excludeFolders = @("99. Archived")
            skipStatusGroups = @("Cancelled")
        }
        $tpl = Join-Path $OutDir "map-template.json"
        Write-JsonFile $tpl $template
        Write-Host "No -MapFile. Wrote $tpl - fill it in (and keep it OUTSIDE the repo), then re-run -Plan -MapFile <it>." -ForegroundColor Yellow
        exit 0
    }
    $map = Read-JsonFile $MapFile
    $statusMap = if ($map.statusMap) { $map.statusMap } else { @{} }
    $projectMap = if ($map.projectMap) { $map.projectMap } else { @{} }
    $peopleMap = @{}
    if ($map.peopleMap) { foreach ($k in $map.peopleMap.Keys) { $peopleMap[$k.ToLowerInvariant()] = "$($map.peopleMap[$k])".ToLowerInvariant() } }
    $excludeFolders = @($map.excludeFolders)
    $skipGroups = @($map.skipStatusGroups)
    foreach ($k in $statusMap.Keys) {
        if ($ARC_STATUSES -notcontains $statusMap[$k]) { throw "MapFile statusMap['$k'] = '$($statusMap[$k])' - must be one of $($ARC_STATUSES -join ', ')." }
    }

    # --- live SharePoint ---------------------------------------------------------
    Connect-Graph
    Write-Host "`nReading Panel Tasks, Panel Project Reference and the panel site's users..." -ForegroundColor Cyan
    $liveByLegacy = Get-LiveTasks
    $projectByTitle = @{}
    # Kept whole as well, for arc-projects.csv: the list to pick projectMap targets from.
    $arcProjects = @(Get-GraphAll "$graph/lists/$PROJECTS_LIST/items?`$expand=fields(`$select=Title,ProjectDescription,DWGNO,Customer)&`$top=500")
    foreach ($p in $arcProjects) {
        $t = "$($p.fields.Title)".Trim().ToLowerInvariant()
        if ($t -and -not $projectByTitle.ContainsKey($t)) { $projectByTitle[$t] = [int]$p.id }
    }
    # --- proposed new Panel Project References ----------------------------------
    # A leading drawing number ("DWG# " ignored): 1234-ABC12-V1-002, 1000-111,
    # 0900-013. An SAP number later in the title (1027-0390-00) isn't one.
    function Get-ProjectTypeGuess($clean, $dwg) {
        if ($dwg) { return "PRD-Production Order" }
        if ($clean -match '(?i)commission|support|field|telemetry') { return "FS-Field Support" }
        if ($clean -match '(?i)script|program|logic|plc') { return "PRG-Programming" }
        if ($clean -match '(?i)standards|base updates|configuration|autocad') { return "IS-Internal Support" }
        return "MSC-Misc"
    }
    function New-ProjectProposal($wrikeTitle) {
        $clean = ("$wrikeTitle" -replace '^\s*DWG#\s*', '').Trim()
        $m = [regex]::Match($clean, '^(\d{4}-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*)')
        $dwg = if ($m.Success) { $m.Groups[1].Value } else { "" }
        $type = Get-ProjectTypeGuess $clean $dwg
        $desc = if ($dwg) { ($clean.Substring($dwg.Length) -replace '^[\s\-\u2013+]+', '').Trim() } else { $clean }
        return [ordered]@{
            WrikeProject = "$wrikeTitle"; Create = "Yes"; Title = "$(($type -split '-')[0])-$clean"
            ProjectType = $type; DwgNo = $dwg; Description = $desc; Tasks = 0
        }
    }
    $overrides = @{}
    if ($ProjectsFile) {
        if (-not (Test-Path $ProjectsFile)) { throw "-ProjectsFile $ProjectsFile not found." }
        foreach ($r in (Import-Csv -Path $ProjectsFile)) {
            if (-not $r.WrikeProject) { continue }
            if ($r.ProjectType -and $PROJECT_TYPES -notcontains $r.ProjectType) {
                throw "ProjectsFile: '$($r.WrikeProject)' has ProjectType '$($r.ProjectType)' - must be one of $($PROJECT_TYPES -join ', '), or blank."
            }
            if ($r.Create -match '^(?i)y' -and -not "$($r.Title)".Trim()) { throw "ProjectsFile: '$($r.WrikeProject)' has Create = Yes and no Title." }
            $overrides[$r.WrikeProject] = $r
        }
    }
    $newProjects = [ordered]@{}
    # Wrike project title -> "new:<Title>", an existing project id, or $null (left off).
    function Resolve-NewProject($wrikeTitle) {
        if (-not $newProjects.Contains($wrikeTitle)) {
            $p = New-ProjectProposal $wrikeTitle
            $o = $overrides[$wrikeTitle]
            if ($o) {
                $p.Create = if ($o.Create -match '^(?i)y') { "Yes" } else { "No" }
                $p.Title = "$($o.Title)".Trim(); $p.ProjectType = "$($o.ProjectType)"
                $p.DwgNo = "$($o.DwgNo)".Trim(); $p.Description = "$($o.Description)".Trim()
            }
            if ($p.Title.Length -gt 255) { $p.Title = $p.Title.Substring(0, 255) }
            $newProjects[$wrikeTitle] = $p
        }
        $p = $newProjects[$wrikeTitle]
        $p.Tasks++
        if ($p.Create -ne "Yes") { return $null }
        # A title that already exists is reused, not created twice.
        $existing = $projectByTitle[$p.Title.ToLowerInvariant()]
        if ($existing) { return $existing }
        return "new:$($p.Title)"
    }

    $userByEmail = @{}
    foreach ($u in (Get-GraphAll "$graph/lists/User%20Information%20List/items?`$expand=fields(`$select=Title,EMail)&`$top=500")) {
        $e = "$($u.fields.EMail)".Trim().ToLowerInvariant()
        if ($e -and -not $userByEmail.ContainsKey($e)) { $userByEmail[$e] = @{ id = [int]$u.id; name = "$($u.fields.Title)" } }
    }
    $contactById = @{}
    foreach ($c in $contacts) {
        $email = (@($c.profiles) | Where-Object { $_.email } | Select-Object -First 1).email
        $contactById[$c.id] = @{ name = ("$($c.firstName) $($c.lastName)").Trim(); email = "$email".ToLowerInvariant() }
    }
    function Resolve-Contact($wrikeId) {
        $c = $contactById[$wrikeId]
        if (-not $c) { return @{ ok = $false; name = "Wrike contact $wrikeId"; email = "" } }
        $email = if ($peopleMap.ContainsKey($c.email)) { $peopleMap[$c.email] } else { $c.email }
        $u = $userByEmail[$email]
        if ($u) { return @{ ok = $true; id = $u.id; name = $c.name; email = $email } }
        return @{ ok = $false; name = $c.name; email = $email }
    }

    # --- map every task ----------------------------------------------------------
    $items = @(); $unmatchedPeople = @{}; $unmatchedProjects = @{}; $flexible = @(); $skipped = @{}; $unmappedStatuses = @{}
    foreach ($t in $tasks) {
        $place = Get-TaskPlace $t
        $excludedBy = $place.chain | Where-Object { $excludeFolders -contains $_.title } | Select-Object -First 1
        if ($excludedBy) { $skipped["folder: $($excludedBy.title)"]++; continue }
        $st = $statusById[$t.customStatusId]
        if ($st -and $skipGroups -contains $st.group) { $skipped["status group: $($st.group)"]++; continue }
        $statusName = if ($st) { $st.name } else { "$($t.status)" }
        if (-not $statusMap.Contains($statusName)) { $unmappedStatuses[$statusName]++; continue }

        $notes = @()
        # Project: projectMap override, else the same title.
        $projectId = $null
        if ($place.project) {
            $wanted = if ($projectMap.Contains($place.project.title) -and $projectMap[$place.project.title]) { $projectMap[$place.project.title] } else { $place.project.title }
            $projectId = $projectByTitle["$wanted".Trim().ToLowerInvariant()]
            if (-not $projectId) { $projectId = Resolve-NewProject $place.project.title }
            if (-not $projectId) { $unmatchedProjects[$place.project.title]++; $notes += "project '$($place.project.title)' not matched" }
            elseif ("$projectId" -like 'new:*') { $notes += "project '$("$projectId".Substring(4))' will be created" }
        }
        # People: every RESOLVED responsible is assigned, and watches.
        $resolved = @()
        foreach ($rid in @($t.responsibleIds)) {
            if (-not $rid) { continue }
            $r = Resolve-Contact $rid
            if ($r.ok) { $resolved += $r }
            else {
                $key = "$($r.name)|$($r.email)"
                $unmatchedPeople[$key]++
                $notes += "responsible $($r.name) <$($r.email)> not on the panel site - left off"
            }
        }
        $assigned = @($resolved | ForEach-Object { $_.id })

        # Effort: total minutes / 60. Flexible is flattened to its total.
        $hours = $null
        $ea = $t.effortAllocation
        if ($ea -and $ea.mode -and $ea.mode -ne "None" -and $null -ne $ea.totalEffort) {
            $hours = [Math]::Round([double]$ea.totalEffort / 60, 2)
            if ($ea.mode -ne "Basic") {
                $flexible += [pscustomobject]@{ WrikeId = $t.id; Title = $t.title; Mode = $ea.mode; TotalHours = $hours; Permalink = $t.permalink }
                $notes += "effort mode $($ea.mode) flattened to $hours h"
            }
        }

        $custom = @{ WorkType = ""; Priority = ""; SAPNumber = "" }
        if ($sapField) {
            $sv = @($t.customFields) | Where-Object { $_.id -eq $sapField.id } | Select-Object -First 1
            if ($sv -and "$($sv.value)".Trim()) { $custom.SAPNumber = "$($sv.value)".Trim() }
        }
        foreach ($d in $dropdowns) {
            if (-not $d.Field) { continue }
            $cfv = @($t.customFields) | Where-Object { $_.id -eq $d.Field.id } | Select-Object -First 1
            if ($cfv -and "$($cfv.value)") {
                if ($d.Values -contains "$($cfv.value)") { $custom[$d.Key] = "$($cfv.value)" }
                else { $notes += "$($d.Title) '$($cfv.value)' isn't one ARC knows - left blank" }
            }
        }

        $isBacklog = "$($t.dates.type)" -eq "Backlog"
        $desc = ConvertTo-PlainText $t.description
        $desc = ("$desc`n`nImported from Wrike: $($t.permalink)").Trim()
        $mapped = @{
            Title = "$($t.title)".Trim(); Status = $statusMap[$statusName]; WorkType = $custom.WorkType; Priority = $custom.Priority
            SAPNumber = $custom.SAPNumber
            Project = $projectId; Assigned = $assigned
            Watchers = @($resolved | ForEach-Object { $_.id })
            Description = $desc
            StartDate = if ($isBacklog) { "" } else { Get-WrikeDay $t.dates.start }
            DueDate = if ($isBacklog) { "" } else { Get-WrikeDay $t.dates.due }
            EstimatedHours = $hours
        }
        if ($mapped.Title.Length -gt 255) { $mapped.Title = $mapped.Title.Substring(0, 255); $notes += "title cut to 255 characters" }
        $normal = Get-Normal $mapped
        $srcHash = Get-NormalHash $normal
        $legacy = "wrike:$($t.id)"

        # Comments, oldest first, minus any already on the ARC row.
        $wrikeComments = @()
        $cfile = Join-Path $OutDir "comments/$($t.id).json"
        if (Test-Path $cfile) { $wrikeComments = @((Read-JsonFile $cfile).data) }

        $rows = if ($liveByLegacy.ContainsKey($legacy)) { @($liveByLegacy[$legacy]) } else { @() }
        $live = if ($rows.Count -eq 1) { $rows[0] } else { $null }
        $present = Get-CommentKeys $(if ($live) { $live.fields.Communication } else { "" })
        $records = @()
        foreach ($c in ($wrikeComments | Sort-Object { Get-Utc $_.createdDate })) {
            $author = $contactById[$c.authorId]
            $aName = if ($author -and $author.name) { $author.name } else { "Wrike user" }
            $aEmail = if ($author) { $author.email } else { "" }
            $key = Get-CommentKey $aEmail $aName $c.text
            if ($present.Contains($key)) { continue }
            [void]$present.Add($key)
            $records += [ordered]@{ key = $key; author = $aName; record = "$(Format-SpTimestamp (Get-Utc $c.createdDate))|||$aName|||$aEmail|||$($c.text)$IMPORT_TAG" }
        }

        $item = [ordered]@{
            wrikeId = $t.id; legacySource = $legacy; title = $mapped.Title; wrikePath = $place.path; permalink = $t.permalink
            action = ""; itemId = $null; reason = ""; srcHash = $srcHash; planLiveHash = $null
            mapped = $mapped; changed = @(); comments = $records; notes = $notes
        }
        if ($rows.Count -gt 1) {
            $item.action = "conflict"; $item.reason = "$($rows.Count) ARC rows carry $legacy"
        } elseif (-not $live) {
            $item.action = "create"
        } else {
            $item.itemId = [int]$live.id
            $liveNormal = Get-Normal (Get-LiveValues $live.fields)
            $liveHash = Get-NormalHash $liveNormal
            $item.planLiveHash = $liveHash
            $m = [regex]::Match("$($live.fields.ImportHash)", '^src=([0-9a-f]{64});arc=([0-9a-f]{64})$')
            $diff = @($normal.Keys | Where-Object { $normal[$_] -ne $liveNormal[$_] })
            if (-not $m.Success) {
                $item.action = "conflict"; $item.reason = "ImportHash missing or unreadable - not written by this import"
            } elseif ($liveHash -ne $m.Groups[2].Value) {
                $item.action = "conflict"; $item.reason = "edited in ARC since the last import"
                $item.changed = $diff
            } elseif ($srcHash -eq $m.Groups[1].Value) {
                $item.action = "noop"
            } else {
                $item.action = "update"; $item.changed = $diff
                if ($diff.Count -eq 0) { $item.action = "rehash"; $item.reason = "Wrike changed nothing ARC stores; only ImportHash moves" }
            }
        }
        $items += $item
    }

    if ($unmappedStatuses.Count) {
        Write-Host "These Wrike statuses aren't in the MapFile's statusMap - add them and re-plan:" -ForegroundColor Red
        $unmappedStatuses.GetEnumerator() | ForEach-Object { Write-Host "  '$($_.Key)'  ($($_.Value) task(s))" -ForegroundColor Red }
        exit 1
    }

    $toCreate = @($newProjects.Values | Where-Object { $_.Create -eq "Yes" -and -not $projectByTitle.ContainsKey($_.Title.ToLowerInvariant()) })
    $dupes = @($toCreate | Group-Object { $_.Title.ToLowerInvariant() } | Where-Object { $_.Count -gt 1 })
    if ($dupes.Count) {
        Write-Host "Two Wrike projects would create the same Panel Project Reference title - give them different Titles in -ProjectsFile:" -ForegroundColor Red
        $dupes | ForEach-Object { Write-Host "  '$($_.Group[0].Title)': $(($_.Group | ForEach-Object { $_.WrikeProject }) -join ' | ')" -ForegroundColor Red }
        exit 1
    }

    # --- outputs -----------------------------------------------------------------
    $planPath = Join-Path $OutDir "plan.json"
    Write-JsonFile $planPath ([ordered]@{
        plannedAt = (Get-Date).ToUniversalTime().ToString("o"); export = $manifest; mapFile = (Resolve-Path $MapFile).Path
        newProjects = @($toCreate | ForEach-Object { [ordered]@{ title = $_.Title; projectType = $_.ProjectType; dwgNo = $_.DwgNo; description = $_.Description } })
        items = $items
    })
    # An empty CSV is still written, so a stale one from an earlier plan can't be read as current.
    $csv = { param($name, $rows)
        $path = Join-Path $OutDir $name
        if (@($rows | Where-Object { $_ }).Count) { $rows | Export-Csv -Path $path -NoTypeInformation -Encoding utf8 }
        else { Set-Content -Path $path -Value "" -Encoding utf8 } }
    & $csv "create.csv" ($items | Where-Object { $_.action -eq "create" } | ForEach-Object {
        [pscustomobject]@{ WrikeId = $_.wrikeId; Title = $_.title; WrikePath = $_.wrikePath; Status = $_.mapped.Status
            Start = $_.mapped.StartDate; Due = $_.mapped.DueDate; Hours = $_.mapped.EstimatedHours; Comments = $_.comments.Count; Notes = ($_.notes -join "; ") } })
    & $csv "update.csv" ($items | Where-Object { $_.action -in "update", "rehash" } | ForEach-Object {
        [pscustomobject]@{ WrikeId = $_.wrikeId; ArcId = $_.itemId; Title = $_.title; Fields = ($_.changed -join ", "); Notes = ($_.notes -join "; ") } })
    & $csv "conflicts.csv" ($items | Where-Object { $_.action -eq "conflict" } | ForEach-Object {
        [pscustomobject]@{ WrikeId = $_.wrikeId; ArcId = $_.itemId; Title = $_.title; Reason = $_.reason; FieldsThatDifferFromWrike = ($_.changed -join ", ") } })
    & $csv "comments.csv" ($items | Where-Object { $_.comments.Count } | ForEach-Object { $it = $_; $it.comments | ForEach-Object {
        [pscustomobject]@{ WrikeId = $it.wrikeId; ArcId = $it.itemId; Task = $it.title; Author = $_.author } } })
    & $csv "unmatched-people.csv" ($unmatchedPeople.GetEnumerator() | ForEach-Object {
        $p = $_.Key -split "\|"; [pscustomobject]@{ Name = $p[0]; Email = $p[1]; Tasks = $_.Value } })
    & $csv "unmatched-projects.csv" ($unmatchedProjects.GetEnumerator() | ForEach-Object { [pscustomobject]@{ WrikeProject = $_.Key; Tasks = $_.Value } })
    & $csv "flexible-effort.csv" $flexible
    # Every Panel Project Reference row, so an unmatched Wrike project can be
    # pointed at the right one in the MapFile's projectMap.
    & $csv "new-projects.csv" ($newProjects.Values | ForEach-Object { [pscustomobject]$_ })
    & $csv "arc-projects.csv" ($arcProjects | ForEach-Object {
        [pscustomobject]@{ Title = $_.fields.Title; Description = $_.fields.ProjectDescription; DwgNo = $_.fields.DWGNO; Customer = $_.fields.Customer } })

    $count = { param($a) @($items | Where-Object { $_.action -eq $a }).Count }
    $commentCount = ($items | ForEach-Object { $_.comments.Count } | Measure-Object -Sum).Sum
    $report = @(
        "# Wrike -> ARC Panel Tasks: plan", "",
        "Planned $((Get-Date).ToString('yyyy-MM-dd HH:mm')) from the export of $($manifest.exportedAt) (space '$($manifest.spaceTitle)').", "",
        "| | Count |", "|---|---|",
        "| Create | $(& $count 'create') |", "| Update | $(& $count 'update') |", "| ImportHash only | $(& $count 'rehash') |",
        "| Unchanged (no write) | $(& $count 'noop') |", "| **Conflicts - left alone** | $(& $count 'conflict') |",
        "| Comments to append | $([int]$commentCount) |",
        "| People not on the panel site | $($unmatchedPeople.Count) |",
        "| Panel Project References to create | $($toCreate.Count) |", "| Wrike projects left with no Panel Project Reference | $($unmatchedProjects.Count) |",
        "| Flexible effort flattened | $($flexible.Count) |", "",
        "Skipped: $(if ($skipped.Count) { ($skipped.GetEnumerator() | ForEach-Object { "$($_.Key) ($($_.Value))" }) -join ', ' } else { 'none' })", "",
        "Read new-projects.csv, conflicts.csv, unmatched-people.csv and unmatched-projects.csv before -Apply.",
        "A person or project fixed now needs a fresh -Plan; -Apply performs plan.json exactly."
    )
    Set-Content -Path (Join-Path $OutDir "report.md") -Value $report -Encoding utf8
    $report | Select-Object -Skip 2 | ForEach-Object { Write-Host $_ }
    Write-Host "`nWrote plan.json, report.md and the CSVs to $OutDir. Nothing was written to SharePoint." -ForegroundColor Cyan
    exit 0
}

# ============================================================================ -Apply

if ($Apply) {
    $planPath = Join-Path $OutDir "plan.json"
    if (-not (Test-Path $planPath)) { throw "No plan.json in $OutDir - run -Plan first." }
    $planDoc = Read-JsonFile $planPath
    Connect-Graph
    $log = @()

    function Write-ImportHash($itemId, $srcHash) {
        $back = Get-LiveTask $itemId
        $arcHash = Get-NormalHash (Get-Normal (Get-LiveValues $back.fields))
        $value = "src=$srcHash;arc=$arcHash"
        Invoke-MgGraphRequest -Method PATCH -Uri "$graph/lists/$TASKS_LIST/items/$itemId/fields" -ContentType "application/json" `
            -Body (@{ ImportHash = $value } | ConvertTo-Json) | Out-Null
        $check = Invoke-MgGraphRequest -Method GET -Uri "$graph/lists/$TASKS_LIST/items/$($itemId)?`$expand=fields(`$select=ImportHash)"
        if ("$($check.fields.ImportHash)" -ne $value) { throw "ImportHash did not read back on item $itemId" }
        return $back
    }

    # Which written fields SharePoint stores differently from what was sent.
    function Get-StoredDifferently($mapped, $back, $keys) {
        $want = Get-Normal $mapped; $got = Get-Normal (Get-LiveValues $back.fields)
        return @($keys | Where-Object { $want[$_] -ne $got[$_] })
    }

    # New Panel Project References first, add-only: a Title that exists by now
    # (an earlier run, or somebody in ARC) is reused, never renamed.
    $newProjectIds = @{}
    foreach ($np in @($planDoc.newProjects)) {
        if (-not $np) { continue }
        $entry = [ordered]@{ WrikeId = ""; ArcId = $null; Title = $np.title; Action = "create project"; Result = ""; Warning = "" }
        try {
            $q = "$($np.title)" -replace "'", "''"
            $filter = [uri]::EscapeDataString("fields/Title eq '$q'")
            $found = @(Get-GraphAll "$graph/lists/$PROJECTS_LIST/items?`$expand=fields(`$select=Title)&`$filter=$filter&`$top=5")
            if ($found.Count) {
                $newProjectIds[$np.title] = [int]$found[0].id; $entry.ArcId = [int]$found[0].id; $entry.Result = "already there - reused"
            } else {
                $pf = [ordered]@{ Title = $np.title }
                if ($np.projectType) { $pf.ProjectType = $np.projectType }
                if ($np.dwgNo) { $pf.DWGNO = $np.dwgNo }
                if ($np.description) { $pf.ProjectDescription = $np.description }
                $made = Invoke-MgGraphRequest -Method POST -Uri "$graph/lists/$PROJECTS_LIST/items" -ContentType "application/json" `
                    -Body (@{ fields = $pf } | ConvertTo-Json -Depth 4)
                $back = Invoke-MgGraphRequest -Method GET -Uri "$graph/lists/$PROJECTS_LIST/items/$($made.id)?`$expand=fields(`$select=Title,ProjectType,DWGNO)"
                if ("$($back.fields.Title)" -ne $np.title) { throw "Title did not read back" }
                if ($np.projectType -and "$($back.fields.ProjectType)" -ne $np.projectType) { $entry.Warning = "ProjectType read back as '$($back.fields.ProjectType)'" }
                $newProjectIds[$np.title] = [int]$made.id; $entry.ArcId = [int]$made.id; $entry.Result = "created"
            }
            Write-Host "  ok    project  $($np.title)  $($entry.Result)" -ForegroundColor Green
        } catch {
            $entry.Result = "REFUSED: $($_.Exception.Message)"
            Write-Host "  FAIL  project  $($np.title)  $($_.Exception.Message)" -ForegroundColor Red
        }
        $log += [pscustomobject]$entry
    }

    $todo = @($planDoc.items | Where-Object { $_.action -in "create", "update", "rehash" -or $_.comments.Count })
    Write-Host "`nApplying $($todo.Count) planned item(s)..." -ForegroundColor Cyan
    foreach ($it in $todo) {
        $entry = [ordered]@{ WrikeId = $it.wrikeId; ArcId = $it.itemId; Title = $it.title; Action = $it.action; Result = ""; Warning = "" }
        try {
            $itemId = $it.itemId
            # A project created above: swap the placeholder for its id, and hash
            # what is actually written so a re-run reads as unchanged.
            if ("$($it.mapped.Project)" -like 'new:*') {
                $pt = "$($it.mapped.Project)".Substring(4)
                if (-not $newProjectIds.ContainsKey($pt)) { throw "its project '$pt' wasn't created - fix that and re-plan" }
                $it.mapped.Project = $newProjectIds[$pt]
                $it.srcHash = Get-NormalHash (Get-Normal $it.mapped)
            }
            if ($it.action -eq "create") {
                $filter = [uri]::EscapeDataString("fields/LegacySource eq '$($it.legacySource)'")
                $exists = Get-GraphAll "$graph/lists/$TASKS_LIST/items?`$expand=fields(`$select=LegacySource)&`$filter=$filter&`$top=5"
                if ($exists.Count) { throw "an ARC row with $($it.legacySource) exists now - re-plan" }
                $fields = Get-GraphFields $it.mapped $null
                foreach ($k in @($fields.Keys)) { if ($null -eq $fields[$k]) { $fields.Remove($k) } }
                if ($fields.WatchersLookupId.Count -eq 0) { $fields.Remove("WatchersLookupId"); $fields.Remove("WatchersLookupId@odata.type") }
                $fields.LegacySource = $it.legacySource
                $created = Invoke-MgGraphRequest -Method POST -Uri "$graph/lists/$TASKS_LIST/items" -ContentType "application/json" `
                    -Body (@{ fields = $fields } | ConvertTo-Json -Depth 6)
                $itemId = [int]$created.id; $entry.ArcId = $itemId
                $back = Write-ImportHash $itemId $it.srcHash
                if ("$($back.fields.LegacySource)" -ne $it.legacySource) { throw "LegacySource did not read back" }
                $odd = Get-StoredDifferently $it.mapped $back @("Title", "Status", "WorkType", "Priority", "SAPNumber", "Project", "Assigned", "Watchers", "Description", "StartDate", "DueDate", "EstimatedHours")
                if ($odd.Count) { $entry.Warning = "stored differently: $($odd -join ', ')" }
                $entry.Result = "created"
            } elseif ($it.action -in "update", "rehash") {
                $live = Get-LiveTask $itemId
                $liveHash = Get-NormalHash (Get-Normal (Get-LiveValues $live.fields))
                if ($liveHash -ne $it.planLiveHash) { throw "changed since the plan - re-plan" }
                if ($it.action -eq "update") {
                    $fields = Get-GraphFields $it.mapped @($it.changed)
                    Invoke-MgGraphRequest -Method PATCH -Uri "$graph/lists/$TASKS_LIST/items/$itemId/fields" -ContentType "application/json" `
                        -Body ($fields | ConvertTo-Json -Depth 6) | Out-Null
                }
                $back = Write-ImportHash $itemId $it.srcHash
                if ($it.action -eq "update") {
                    $odd = Get-StoredDifferently $it.mapped $back @($it.changed)
                    if ($odd.Count) { $entry.Warning = "stored differently: $($odd -join ', ')" }
                }
                $entry.Result = if ($it.action -eq "update") { "updated: $($it.changed -join ', ')" } else { "ImportHash updated" }
            }

            # Comments: re-read, append only what still isn't there, read back.
            if ($it.comments.Count -and $itemId) {
                $live = Get-LiveTask $itemId
                $present = Get-CommentKeys $live.fields.Communication
                $add = @($it.comments | Where-Object { -not $present.Contains($_.key) })
                if ($add.Count) {
                    $existing = "$($live.fields.Communication)" -replace "\s+$", ""
                    $new = ($add | ForEach-Object { $_.record }) -join "`n"
                    $value = if ($existing) { "$existing`n$new" } else { $new }
                    Invoke-MgGraphRequest -Method PATCH -Uri "$graph/lists/$TASKS_LIST/items/$itemId/fields" -ContentType "application/json" `
                        -Body (@{ Communication = $value } | ConvertTo-Json) | Out-Null
                    $after = Get-CommentKeys (Get-LiveTask $itemId).fields.Communication
                    $missing = @($add | Where-Object { -not $after.Contains($_.key) })
                    if ($missing.Count) { throw "$($missing.Count) comment(s) did not read back" }
                    if ($after.Count -lt $present.Count + $add.Count) { throw "the thread lost comments on write - check 'Append Changes to Existing Text' is OFF" }
                }
                $entry.Result = (@($entry.Result, "$($add.Count) comment(s)") | Where-Object { $_ }) -join "; "
            }
            Write-Host "  ok    $($it.wrikeId)  $($entry.Result)" -ForegroundColor Green
        } catch {
            $entry.Result = "REFUSED: $($_.Exception.Message)"
            Write-Host "  FAIL  $($it.wrikeId)  $($_.Exception.Message)" -ForegroundColor Red
        }
        $log += [pscustomobject]$entry
    }
    $logPath = Join-Path $OutDir ("applied-{0}.csv" -f (Get-Date).ToString("yyyyMMdd-HHmmss"))
    $log | Export-Csv -Path $logPath -NoTypeInformation -Encoding utf8
    $failed = @($log | Where-Object { "$($_.Result)" -like "REFUSED*" }).Count
    Write-Host "`nDone: $($log.Count - $failed) ok, $failed refused. Log: $logPath" -ForegroundColor $(if ($failed) { "Yellow" } else { "Cyan" })
    Write-Host "Re-run -Plan now: it should plan zero writes for everything that applied." -ForegroundColor Gray
}
