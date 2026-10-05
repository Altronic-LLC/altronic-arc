<#
.SYNOPSIS
    Swaps Rating B and Rating C on the 40 resistors entered voltage-first on
    the Altronic Component List — reporting only, unless -Apply is passed.

.DESCRIPTION
    BusinessIT#18. A resistor's Rating B is POWER and Rating C is WORKING
    VOLTAGE: that is how 872 of the 1,016 resistors on the live list were
    entered, and ARC's labels were corrected to match in v0.170.0. These 40
    were entered the other way round (volts in B, watts in C), most of them
    recently, following ARC's old labels. Agreed with Brandon Mirto
    (2026-10-05) to swap them.

    The 40 are listed below WITH the values they held when they were found
    (profiled live, 2026-10-05). A row is only touched while it still holds
    exactly those values, so a row somebody has already fixed by hand, or
    edited since, is skipped and reported rather than swapped back. Nothing
    outside the list is ever touched, and only RatingB / RatingC are written.

    Each write is read back to confirm it landed. A report CSV records every
    row's before/after.

    UNDO: run again with -Undo -Apply. That expects the swapped values and
    swaps them back, with the same "only if unchanged" check. SharePoint's
    version history on each item is the other way back.

    The Communication (approval history) column is NOT written: this is a
    data correction, not a review step, and version history already records
    who changed what. No emails are sent.

.PARAMETER Apply
    Write to SharePoint. Without it nothing is changed.

.PARAMETER Undo
    Put the 40 back the way they were found (voltage in B, power in C).

.PARAMETER ReportDir
    Where the report CSV goes. Defaults to a timestamped folder under %TEMP%.

.PARAMETER DeviceCode
    Sign in with a device code instead of the browser.

.EXAMPLE
    ./scripts/swap-resistor-rating-bc.ps1
.EXAMPLE
    ./scripts/swap-resistor-rating-bc.ps1 -Apply
.EXAMPLE
    ./scripts/swap-resistor-rating-bc.ps1 -Undo -Apply
#>
[CmdletBinding()]
param(
    [switch]$Apply,
    [switch]$Undo,
    [string]$ReportDir,
    [switch]$DeviceCode
)

$ErrorActionPreference = "Stop"

$SiteId = "coopermachineryservices.sharepoint.com,ddb5fc80-ea51-4d56-b008-ce6a82af49b0,aa6b9467-3f57-4213-bbd4-60b94403421a"
$ListId = "c48dc016-1f49-4595-809c-9239fb2baeb3"   # Altronic Component List

# As found on 2026-10-05: B holds the voltage, C the power.
$Rows = @(
    @{ Pn = '611307'; B = '350V'; C = '1/2W' }
    @{ Pn = '701020'; B = '200V'; C = '250mW' }
    @{ Pn = '701200'; B = '200V'; C = '250mW' }
    @{ Pn = '712351'; B = '500V'; C = '1W' }
    @{ Pn = '712681'; B = '75V'; C = '100mW' }
    @{ Pn = '712688'; B = '200V'; C = '1/2W' }
    @{ Pn = '712699'; B = '75V'; C = '6mW' }
    @{ Pn = '712705'; B = '50V'; C = '0.063W' }
    @{ Pn = '712707'; B = '50V'; C = '0.063W' }
    @{ Pn = '712708'; B = '50V'; C = '0.063W' }
    @{ Pn = '712709'; B = '50V'; C = '0.063W' }
    @{ Pn = '712742'; B = '500V'; C = '1.5W' }
    @{ Pn = '712750'; B = '75V'; C = '100mW' }
    @{ Pn = '712751'; B = '150V'; C = '100mW' }
    @{ Pn = '712760'; B = '50V'; C = '1/8W' }
    @{ Pn = '712761'; B = '75V'; C = '1/10W' }
    @{ Pn = '712762'; B = '50V'; C = '1/4W' }
    @{ Pn = '712763'; B = '75V'; C = '1/10W' }
    @{ Pn = '712772'; B = '50V'; C = '62.5mW' }
    @{ Pn = '712773'; B = '75V'; C = '50mW' }
    @{ Pn = '712779'; B = '50V'; C = '63mW' }
    @{ Pn = '712780'; B = '50V'; C = '63mW' }
    @{ Pn = '712783'; B = '200V'; C = '3/4W' }
    @{ Pn = '712797'; B = '200V'; C = '0.25W' }
    @{ Pn = '712806'; B = '75V'; C = '100 mW' }
    @{ Pn = '712817'; B = '250V'; C = '3W' }
    @{ Pn = '712825'; B = '50V'; C = '1/16W' }
    @{ Pn = '712834'; B = '50V'; C = '1/16W' }
    @{ Pn = '712835'; B = '50V'; C = '1/16W' }
    @{ Pn = '712836'; B = '75V'; C = '1/16W' }
    @{ Pn = '712837'; B = '75V'; C = '1/16W' }
    @{ Pn = '712838'; B = '75V'; C = '1/16W' }
    @{ Pn = '712839'; B = '75V'; C = '1/16W' }
    @{ Pn = '712840'; B = '75V'; C = '1/16W' }
    @{ Pn = '712841'; B = '75V'; C = '1/16W' }
    @{ Pn = '712842'; B = '75V'; C = '1/16W' }
    @{ Pn = '712843'; B = '75V'; C = '1/16W' }
    @{ Pn = '712845'; B = '75V'; C = '1/16W' }
    @{ Pn = '712846'; B = '50V'; C = '1/10W' }
    @{ Pn = '712848'; B = '75V'; C = '1/10W' }
)

if (-not $ReportDir) {
    $ReportDir = Join-Path $env:TEMP ("swap-resistor-rating-bc-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
}
New-Item -ItemType Directory -Force -Path $ReportDir | Out-Null

$scope = if ($Apply) { "Sites.ReadWrite.All" } else { "Sites.Read.All" }
$ctx = Get-MgContext
if (-not $ctx -or ($Apply -and $ctx.Scopes -notcontains $scope)) {
    if ($DeviceCode) { Connect-MgGraph -Scopes $scope -UseDeviceCode -NoWelcome }
    else             { Connect-MgGraph -Scopes $scope -NoWelcome }
}

function Invoke-Graph([string]$Method, [string]$Uri, $Body) {
    for ($attempt = 1; ; $attempt++) {
        try {
            if ($Body) { return Invoke-MgGraphRequest -Method $Method -Uri $Uri -Body ($Body | ConvertTo-Json -Compress) -ContentType "application/json" }
            return Invoke-MgGraphRequest -Method $Method -Uri $Uri
        } catch {
            $status = $_.Exception.Response.StatusCode.value__
            if (($status -eq 429 -or $status -eq 503) -and $attempt -lt 6) {
                $wait = 5 * $attempt
                $retry = $_.Exception.Response.Headers.RetryAfter
                if ($retry -and $retry.Delta) { $wait = [int]$retry.Delta.TotalSeconds + 1 }
                Write-Host "  throttled ($status), waiting ${wait}s…"
                Start-Sleep -Seconds $wait
                continue
            }
            throw
        }
    }
}

# Read the whole list once (~4 pages) rather than 40 filtered lookups.
Write-Host "Reading the Altronic Component List…"
$all = New-Object System.Collections.Generic.List[object]
$uri = "https://graph.microsoft.com/v1.0/sites/$SiteId/lists/$ListId/items?`$top=999&`$expand=fields(`$select=Title,Description,RatingA,RatingB,RatingC,SignOffStatus)"
while ($uri) {
    $page = Invoke-Graph GET $uri
    foreach ($i in $page.value) { $all.Add([pscustomobject]@{ Id = $i.id; F = $i.fields }) }
    $uri = $page.'@odata.nextLink'
}
Write-Host "  $($all.Count) rows."

function Str($v) { if ($null -eq $v) { "" } else { [string]$v } }

$report = foreach ($r in $Rows) {
    # What the row must hold right now for this run to touch it.
    $expectB = if ($Undo) { $r.C } else { $r.B }
    $expectC = if ($Undo) { $r.B } else { $r.C }

    $found = @($all | Where-Object { (Str $_.F.Title) -eq $r.Pn -and (Str $_.F.SignOffStatus) -ne "Deleted" })
    $row = [ordered]@{
        PartNumber = $r.Pn; ItemId = ""; Description = ""
        BeforeB = ""; BeforeC = ""; AfterB = $expectC; AfterC = $expectB; Result = ""
    }
    if ($found.Count -ne 1) {
        $row.Result = "skipped: $($found.Count) live rows with this part number"
        [pscustomobject]$row; continue
    }
    $m = $found[0]
    $row.ItemId = $m.Id
    $row.Description = Str $m.F.Description
    $row.BeforeB = Str $m.F.RatingB
    $row.BeforeC = Str $m.F.RatingC

    if ($row.BeforeB -eq $expectC -and $row.BeforeC -eq $expectB) {
        $row.Result = "skipped: already swapped"
        [pscustomobject]$row; continue
    }
    if ($row.BeforeB -ne $expectB -or $row.BeforeC -ne $expectC) {
        $row.Result = "skipped: changed since it was found (expected B='$expectB' C='$expectC')"
        [pscustomobject]$row; continue
    }
    if (-not $Apply) {
        $row.Result = "would swap"
        [pscustomobject]$row; continue
    }

    try {
        $fieldsUri = "https://graph.microsoft.com/v1.0/sites/$SiteId/lists/$ListId/items/$($m.Id)/fields"
        Invoke-Graph PATCH $fieldsUri @{ RatingB = $expectC; RatingC = $expectB } | Out-Null
        $back = Invoke-Graph GET "$fieldsUri`?`$select=RatingB,RatingC"
        if ((Str $back.RatingB) -eq $expectC -and (Str $back.RatingC) -eq $expectB) {
            $row.Result = "swapped"
        } else {
            $row.Result = "WRITE DID NOT LAND: read back B='$(Str $back.RatingB)' C='$(Str $back.RatingC)'"
        }
    } catch {
        $row.Result = "FAILED: $($_.Exception.Message)"
    }
    [pscustomobject]$row
}

$csv = Join-Path $ReportDir "report.csv"
$report | Export-Csv -NoTypeInformation -Encoding UTF8 $csv

$report | Format-Table PartNumber, BeforeB, BeforeC, AfterB, AfterC, Result -AutoSize | Out-String -Width 220 | Write-Host
$report | Group-Object Result | Sort-Object Count -Descending | ForEach-Object { Write-Host ("{0,4}  {1}" -f $_.Count, $_.Name) }
Write-Host ""
Write-Host "Report: $csv"
if (-not $Apply) { Write-Host "Nothing was changed. Run with -Apply to write." }
