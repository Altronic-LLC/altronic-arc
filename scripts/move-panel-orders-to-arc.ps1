<#
.SYNOPSIS
    Moves panel orders from the old "Panel Job Dashboard" list into "Panel Order
    Headers", the list ARC's Panel Orders screen reads. Reports only unless
    -Apply is passed.

.DESCRIPTION
    Both lists are on the ALTRONICPANELTEAM site.

      FROM  Panel Job Dashboard  (7c74061d-2afe-46f3-b550-c751b185447a)  ~1,380 rows, 55 columns
      TO    Panel Order Headers  (8561acf4-b583-459b-aafd-2106803a70c7)  ARC's list

    Only what ARC's Panel Order Headers has a column for comes across - see
    $FieldMap below. Everything else (redlines, costing, waterjet, router,
    drawing dates, files...) stays on the old list, which is never changed.

    What comes across:
      Title                   <- Title                 ("5900C-013 / 1015-1252-00 / 20286049-100")
      Sales Order             <- Sales Order
      SAP #                   <- Part Number           (the SAP material number, ####-####-##)
      Purchase Order          <- Purchase Order
      Customer Reference      <- Unit No.
      Customer                <- Customer
      Status                  <- Status, mapped to ARC's six (see $StatusMap)
      Engineer Assigned       <- Engineer Assigned     (same site, so the person ids carry over as-is)
      Customer Contact Email  <- Customer Contact Email
      Order Notes             <- Order Notes, then Notes and "Quote Ref: ..." on their own lines
      Archived                <- Yes when the old Status is Shipped (a finished order)
      LegacySource            <- "PanelJobDashboard#<old item id>"
      LegacyCreated           <- the old item's Created date

    Not filled: Project Reference (the old list has none), Watchers,
    Communication.

    THREE COLUMNS ARE ADDED to Panel Order Headers (by -Apply or -ColumnsOnly):
      Archived       yes/no   ARC's Panel Orders list hides archived orders
                              unless "Archived" or "All" is picked
      LegacySource   text     indexed; how a re-run knows an order was moved
      LegacyCreated  date     Graph can't set Created, so ARC shows and sorts
                              by this instead
    ARC reads them and copes if they're missing (every order then reads as
    not archived), so running -ColumnsOnly before the deploy is tidy, not
    required.

    ADD-ONLY and safe to re-run. An order already moved (matched on
    LegacySource) is skipped and never rewritten, so orders edited in ARC
    since are left alone. While the old list stays in use, re-run with -Apply
    to bring over only the new ones. Nothing is ever deleted.

    Choice columns: Panel Order Headers' Status and Customer columns still hold
    SharePoint's "Choice 1 / Choice 2 / Choice 3" placeholders. With -Apply the
    script sets Status to ARC's six statuses and adds every customer it is about
    to write to Customer (placeholders removed). ARC's New Order form then offers
    those customers too. Changing a column needs Manage Lists on the site.

    Writes a plan to -OutDir every run: panel-orders-plan.csv (what would be /
    was written, row by row) and panel-orders-skipped.csv. They hold customer
    data, so -OutDir must be OUTSIDE the repo (it's public) - the script
    refuses a folder inside it.

.EXAMPLE
    $out = "C:\Working_Dir\ProcessImprovement\Arc\Panels"

    # Add the three columns and stop
    .\move-panel-orders-to-arc.ps1 -ColumnsOnly

    # Dry run - reads both lists, writes the plan CSV, changes nothing
    .\move-panel-orders-to-arc.ps1 -OutDir $out

    # Try five, then the rest
    .\move-panel-orders-to-arc.ps1 -OutDir $out -Apply -Limit 5
    .\move-panel-orders-to-arc.ps1 -OutDir $out -Apply

    Sign-in is the Microsoft Graph PowerShell module (interactive - run it in
    your own terminal; -DeviceCode if the sign-in window doesn't appear).
    -UseAzCli uses the Azure CLI's sign-in instead (az login).
#>

[CmdletBinding()]
param(
    [switch]$Apply,
    # Leave out orders the old list says have Shipped (about 1,180 of them).
    [switch]$SkipShipped,
    # Only orders created on or after this date in the old list, e.g. 2025-01-01.
    [datetime]$CreatedSince,
    # Stop after this many new orders (handy for a first -Apply of 5).
    [int]$Limit = 0,
    # Where the plan CSVs go - outside the repo. Not needed with -ColumnsOnly.
    [string]$OutDir,
    # Add the Archived / LegacySource / LegacyCreated columns and stop.
    [switch]$ColumnsOnly,
    [switch]$DeviceCode,
    [switch]$UseAzCli
)

$ErrorActionPreference = "Stop"

if (-not $ColumnsOnly) {
    if (-not $OutDir) { throw "Pass -OutDir: a folder OUTSIDE the repo for the plan CSVs (they hold customer data)." }
    $repoRoot = (Resolve-Path (Split-Path $PSScriptRoot -Parent)).Path.TrimEnd("\") + "\"
    $outFull = [IO.Path]::GetFullPath($OutDir).TrimEnd("\") + "\"
    if ($outFull.StartsWith($repoRoot, [StringComparison]::OrdinalIgnoreCase)) {
        throw "-OutDir is inside the repo ($OutDir). The plan holds customer data and the repo is public - pick a folder outside it."
    }
}

$SiteId = "coopermachineryservices.sharepoint.com,fdf31131-2076-4618-923b-a1856e6b0f2a,3eb6cb9c-6535-4c69-a8d7-e90b2f90a9eb"
$OldListId = "7c74061d-2afe-46f3-b550-c751b185447a"   # Panel Job Dashboard
$NewListId = "8561acf4-b583-459b-aafd-2106803a70c7"   # Panel Order Headers (ARC)
$Graph = "https://graph.microsoft.com/v1.0/sites/$SiteId"
$LegacyPrefix = "PanelJobDashboard#"   # lib/panelOrderArchive.ts reads this prefix

# ARC's statuses (PANEL_ORDER_STATUSES in src/types/task.ts) - keep in step.
$ArcStatuses = @("Submitted", "In Engineering", "In Production", "Testing", "Shipped", "On Hold")

# Old status -> ARC status. Anything not listed becomes "On Hold" and is
# flagged in the plan's Note column.
$StatusMap = @{
    "Waiting to be released"  = "Submitted"
    "Waiting on Engineering"  = "In Engineering"
    "Released for Pick Parts" = "In Production"
    "Assembly"                = "In Production"
    "Wiring"                  = "In Production"
    "QC"                      = "Testing"
    "Ready for Shipping"      = "Testing"
    "Shipped"                 = "Shipped"
    "On Hold"                 = "On Hold"
    "ISSUE/ QUESTION"         = "On Hold"
    "Needs Communicated"      = "On Hold"
    "Waiting on Router"       = "On Hold"
}

# New column <- old column, for the plain text columns. Delete a line to stop
# a field coming across.
$FieldMap = [ordered]@{
    Title                = "Title"
    SalesOrder           = "SalesOrder"
    SAPNumber            = "PartNumber"
    PurchaseOrder        = "PurchaseOrder"
    CustomerReference    = "UnitNo_x002e_"
    CustomerContactEmail = "CustomerContactEmail"
}

$OldSelect = @(
    "Title", "Status", "Customer", "PartNumber", "SalesOrder", "PurchaseOrder",
    "UnitNo_x002e_", "CustomerContactEmail", "EngineerAssignedLookupId",
    "OrderNotes", "Notes", "QuoteRef_x002e_"
) -join ","

# --- sign-in -------------------------------------------------------------------
$script:AzToken = $null
$script:AzTokenAt = [datetime]::MinValue
function Get-AzToken {
    if (-not $script:AzToken -or ((Get-Date) - $script:AzTokenAt).TotalMinutes -gt 40) {
        $t = az account get-access-token --resource https://graph.microsoft.com --query accessToken -o tsv
        if ($LASTEXITCODE -ne 0 -or -not $t) { throw "az account get-access-token failed - run 'az login' first." }
        $script:AzToken = $t.Trim()
        $script:AzTokenAt = Get-Date
    }
    return $script:AzToken
}

if (-not $UseAzCli) {
    Import-Module Microsoft.Graph.Authentication
    $ctx = Get-MgContext
    if (-not $ctx -or $ctx.Scopes -notcontains "Sites.ReadWrite.All") {
        if ($DeviceCode) { Connect-MgGraph -Scopes "Sites.ReadWrite.All" -UseDeviceCode -NoWelcome }
        else             { Connect-MgGraph -Scopes "Sites.ReadWrite.All" -NoWelcome }
    }
}

function Get-StatusCode($err) {
    $r = $err.Exception.Response
    if ($r -and $r.StatusCode) { return [int]$r.StatusCode }
    if ("$($err.Exception.Message)" -match "\b(429|503|504)\b") { return [int]$Matches[1] }
    return 0
}

# One Graph call, retried on throttling (429) and a busy service (503/504).
function Invoke-Graph {
    param([string]$Method, [string]$Uri, $Body)
    for ($attempt = 1; ; $attempt++) {
        try {
            $json = if ($null -ne $Body) { $Body | ConvertTo-Json -Depth 10 -Compress } else { $null }
            if ($UseAzCli) {
                $p = @{ Method = $Method; Uri = $Uri; Headers = @{ Authorization = "Bearer $(Get-AzToken)" } }
                if ($json) { $p.Body = [Text.Encoding]::UTF8.GetBytes($json); $p.ContentType = "application/json; charset=utf-8" }
                return Invoke-RestMethod @p
            }
            $p = @{ Method = $Method; Uri = $Uri }
            if ($json) { $p.Body = $json; $p.ContentType = "application/json" }
            return Invoke-MgGraphRequest @p
        } catch {
            $code = Get-StatusCode $_
            if ($code -in 429, 503, 504 -and $attempt -lt 6) {
                $wait = 10 * $attempt
                Write-Host "  Graph answered $code - waiting $wait s, then retrying" -ForegroundColor Yellow
                Start-Sleep -Seconds $wait
                continue
            }
            throw
        }
    }
}

function Get-AllItems($listId, $select) {
    $uri = "$Graph/lists/$listId/items?`$expand=fields(`$select=$select)&`$select=id,createdDateTime&`$top=999"
    $all = @()
    while ($uri) {
        $page = Invoke-Graph GET $uri
        $all += $page.value
        $uri = $page.'@odata.nextLink'
    }
    return $all
}

function Get-Columns($listId) {
    return (Invoke-Graph GET "$Graph/lists/$listId/columns?`$select=id,name,displayName,choice,text").value
}

# The three columns ARC reads for a moved order. Adds whichever are missing,
# then reads the list back to prove they're there.
function Ensure-MigrationColumns {
    $have = @(Get-Columns $NewListId | ForEach-Object { $_.name })
    $wanted = @(
        @{ name = "Archived"; displayName = "Archived"; boolean = @{}; defaultValue = @{ value = "0" } },
        @{ name = "LegacySource"; displayName = "LegacySource"; indexed = $true; text = @{ maxLength = 255 } },
        @{ name = "LegacyCreated"; displayName = "LegacyCreated"; dateTime = @{ format = "dateTime" } }
    )
    foreach ($c in $wanted) {
        if ($have -contains $c.name) { Write-Host "  $($c.name): already there" -ForegroundColor Gray; continue }
        Invoke-Graph POST "$Graph/lists/$NewListId/columns" $c | Out-Null
        Write-Host "  $($c.name): added" -ForegroundColor Green
    }
    $after = @(Get-Columns $NewListId | ForEach-Object { $_.name })
    $missing = @($wanted | Where-Object { $after -notcontains $_.name } | ForEach-Object { $_.name })
    if ($missing.Count) { throw "Columns still missing after adding them: $($missing -join ', ')" }
}

if ($ColumnsOnly) {
    Write-Host "Adding the migration columns to Panel Order Headers..." -ForegroundColor Cyan
    Ensure-MigrationColumns
    Write-Host "Done." -ForegroundColor Green
    return
}

function Clean($v) {
    if ($null -eq $v) { return "" }
    return ("$v").Trim()
}

# --- read both lists -----------------------------------------------------------
Write-Host "Reading Panel Job Dashboard (old)..." -ForegroundColor Cyan
$old = Get-AllItems $OldListId $OldSelect
Write-Host "  $($old.Count) orders" -ForegroundColor Gray

$newColumns = Get-Columns $NewListId
$hasLegacy = [bool]($newColumns | Where-Object { $_.name -eq "LegacySource" })

Write-Host "Reading Panel Order Headers (ARC)..." -ForegroundColor Cyan
$newSelect = if ($hasLegacy) { "Title,LegacySource" } else { "Title" }
$existing = Get-AllItems $NewListId $newSelect
$alreadyMoved = @{}
foreach ($e in $existing) {
    $src = Clean $e.fields.LegacySource
    if ($src) { $alreadyMoved[$src] = $e.id }
}
Write-Host "  $($existing.Count) orders, $($alreadyMoved.Count) of them moved here before" -ForegroundColor Gray

# --- plan ---------------------------------------------------------------------
$plan = New-Object System.Collections.Generic.List[object]
$skipped = New-Object System.Collections.Generic.List[object]

foreach ($item in ($old | Sort-Object { [int]$_.id })) {
    $f = $item.fields
    $source = "$LegacyPrefix$($item.id)"
    $oldStatus = Clean $f.Status

    $reason = $null
    if ($alreadyMoved.ContainsKey($source)) { $reason = "already moved (ARC item $($alreadyMoved[$source]))" }
    elseif ($SkipShipped -and $oldStatus -eq "Shipped") { $reason = "shipped (-SkipShipped)" }
    elseif ($CreatedSince -and ([datetime]$item.createdDateTime) -lt $CreatedSince) { $reason = "created before $($CreatedSince.ToString('yyyy-MM-dd'))" }
    elseif (-not (Clean $f.Title)) { $reason = "no Title" }
    if ($reason) {
        $skipped.Add([pscustomobject]@{ OldId = $item.id; Title = (Clean $f.Title); Reason = $reason })
        continue
    }

    $note = @()
    $fields = [ordered]@{}
    foreach ($to in $FieldMap.Keys) {
        $v = Clean $f.($FieldMap[$to])
        if (-not $v) { continue }
        if ($v.Length -gt 255) { $note += "$to cut to 255 characters"; $v = $v.Substring(0, 255) }
        $fields[$to] = $v
    }

    $status = $StatusMap[$oldStatus]
    if (-not $status) { $status = "On Hold"; $note += "unknown status '$oldStatus' -> On Hold" }
    $fields.Status = $status

    $customer = Clean $f.Customer
    if ($customer) { $fields.Customer = $customer }

    $engineer = Clean $f.EngineerAssignedLookupId
    if ($engineer) { $fields.EngineerAssignedLookupId = [int]$engineer }

    $notes = @()
    if (Clean $f.OrderNotes) { $notes += (Clean $f.OrderNotes) }
    if (Clean $f.Notes) { $notes += (Clean $f.Notes) }
    if (Clean $f.QuoteRef_x002e_) { $notes += "Quote Ref: $(Clean $f.QuoteRef_x002e_)" }
    if ($notes.Count) { $fields.OrderNotes = ($notes -join "`n`n") }

    # A shipped order is finished: archived, so ARC's list hides it by default.
    $fields.Archived = ($oldStatus -eq "Shipped")
    $fields.LegacySource = $source
    $fields.LegacyCreated = ([datetime]$item.createdDateTime).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")

    $plan.Add([pscustomobject]@{
        OldId      = $item.id
        OldCreated = ([datetime]$item.createdDateTime).ToString("yyyy-MM-dd")
        OldStatus  = $oldStatus
        Fields     = $fields
        Note       = ($note -join "; ")
    })
    if ($Limit -gt 0 -and $plan.Count -ge $Limit) { break }
}

# --- report -------------------------------------------------------------------
if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Path $OutDir | Out-Null }
$planCsv = Join-Path $OutDir "panel-orders-plan.csv"
$skipCsv = Join-Path $OutDir "panel-orders-skipped.csv"
$plan | ForEach-Object {
    $row = [ordered]@{ OldId = $_.OldId; OldCreated = $_.OldCreated; OldStatus = $_.OldStatus }
    foreach ($k in @("Title", "Status", "Archived", "Customer", "SalesOrder", "SAPNumber", "PurchaseOrder",
                     "CustomerReference", "CustomerContactEmail", "EngineerAssignedLookupId", "OrderNotes")) {
        $row[$k] = if ($_.Fields.Contains($k)) { $_.Fields[$k] } else { "" }
    }
    $row.Note = $_.Note
    [pscustomobject]$row
} | Export-Csv $planCsv -NoTypeInformation -Encoding utf8
$skipped | Export-Csv $skipCsv -NoTypeInformation -Encoding utf8

Write-Host ""
Write-Host "To move:  $($plan.Count)" -ForegroundColor Cyan
Write-Host "Skipped:  $($skipped.Count)" -ForegroundColor Gray
$plan | Group-Object { $_.Fields.Status } | Sort-Object Count -Descending |
    ForEach-Object { Write-Host ("  {0,-16} {1}" -f $_.Name, $_.Count) }
Write-Host "  ($(@($plan | Where-Object { $_.Fields.Archived }).Count) of them archived - the Shipped ones)" -ForegroundColor Gray
$flagged = @($plan | Where-Object { $_.Note })
if ($flagged.Count) { Write-Host "  $($flagged.Count) with a note - see the Note column" -ForegroundColor Yellow }
Write-Host "Plan:     $planCsv"
Write-Host "Skipped:  $skipCsv"

if (-not $Apply) {
    Write-Host ""
    Write-Host "Dry run - nothing was written. Check the plan, then run again with -Apply." -ForegroundColor Green
    return
}
if ($plan.Count -eq 0) { Write-Host "Nothing to move." -ForegroundColor Green; return }

# --- prepare the ARC list ------------------------------------------------------
Write-Host "Checking the migration columns..." -ForegroundColor Cyan
Ensure-MigrationColumns

function Set-Choices($columnName, [string[]]$wanted) {
    $col = $newColumns | Where-Object { $_.name -eq $columnName }
    if (-not $col) { throw "Panel Order Headers has no '$columnName' column." }
    $current = @($col.choice.choices | Where-Object { $_ -and $_ -notmatch '^Choice \d+$' })
    $merged = @($current)
    foreach ($w in $wanted) { if ($w -and $merged -notcontains $w) { $merged += $w } }
    $hadPlaceholders = @($col.choice.choices | Where-Object { $_ -match '^Choice \d+$' }).Count -gt 0
    if (-not $hadPlaceholders -and $merged.Count -eq $current.Count) { return }
    Write-Host "Setting $columnName choices ($($merged.Count))..." -ForegroundColor Cyan
    try {
        Invoke-Graph PATCH "$Graph/lists/$NewListId/columns/$($col.id)" @{
            choice = @{ choices = $merged; allowTextEntry = $false; displayAs = "dropDownMenu" }
        } | Out-Null
    } catch {
        throw "Couldn't change the $columnName column's choices ($($_.Exception.Message)). Changing a column needs Manage Lists on ALTRONICPANELTEAM - add the choices in List settings, or ask a site owner, then re-run."
    }
}
Set-Choices "Status" $ArcStatuses
$customers = @($plan | ForEach-Object { $_.Fields["Customer"] } | Where-Object { $_ } | Sort-Object -Unique)
Set-Choices "Customer" $customers

# --- write ---------------------------------------------------------------------
Write-Host "Writing $($plan.Count) orders..." -ForegroundColor Cyan
$done = 0
$failed = New-Object System.Collections.Generic.List[object]
foreach ($p in $plan) {
    try {
        Invoke-Graph POST "$Graph/lists/$NewListId/items" @{ fields = $p.Fields } | Out-Null
        $done++
        if ($done % 50 -eq 0) { Write-Host "  $done / $($plan.Count)" -ForegroundColor Gray }
    } catch {
        $failed.Add([pscustomobject]@{ OldId = $p.OldId; Title = $p.Fields.Title; Error = $_.Exception.Message })
        Write-Host "  old #$($p.OldId) failed: $($_.Exception.Message)" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "Moved:  $done" -ForegroundColor Green
if ($failed.Count) {
    $failCsv = Join-Path $OutDir "panel-orders-failed.csv"
    $failed | Export-Csv $failCsv -NoTypeInformation -Encoding utf8
    Write-Host "Failed: $($failed.Count) - see $failCsv. Re-running picks them up (moved orders are skipped)." -ForegroundColor Red
}
