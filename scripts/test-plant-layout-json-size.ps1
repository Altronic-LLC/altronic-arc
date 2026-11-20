<#
.SYNOPSIS
    Tests how many characters the Plant Layouts list's LayoutJson column really
    holds. Writes a throwaway row, PATCHes LayoutJson with longer and longer
    values, reads each one back, and deletes the row.

.DESCRIPTION
    ARC refuses a layout over LAYOUT_JSON_MAX_CHARS (src/lib/plantLayoutDoc.ts).
    That was 63,000, the UI's documented limit for a multi-line column, which
    the Main Plant CAD extract (~162,000) was far over. Run on 2026-11-10,
    every size up to 1,000,000 read back identical, and the limit was raised
    to 1,000,000. Re-run it if the column is ever recreated.

    A size PASSES only if the value read back is IDENTICAL to what was written:
    the same length and the same characters. A 2xx from the PATCH proves
    nothing on its own; SharePoint can accept a value and store a truncated one.
    Because every size is written over the previous one on the same row, a
    pass also shows the column REPLACES its value (Append Changes is off).

    The values are layout-shaped JSON (items with uids, numbers, escaped quotes,
    < > and &), so escaping is exercised too, not just a run of one letter.
    ASCII only, so a PowerShell encoding quirk can't fail a size for the wrong
    reason.

    The test row is Status "Superseded", Building "ARC-VERIFY", so it doesn't
    look like a real layout if somebody opens ARC while the script runs. It is
    deleted at the end even if a step fails. Nothing else is changed.

    RUN IN YOUR OWN TERMINAL - the sign-in is interactive.

.PARAMETER Sizes
    The lengths to try, in order. Stops at the first one that fails.

.PARAMETER ListId
    The Plant Layouts list id. Found by name when left out.

.EXAMPLE
    .\test-plant-layout-json-size.ps1
    .\test-plant-layout-json-size.ps1 -Sizes 63000,64000,70000
#>

[CmdletBinding()]
param(
    [int[]]$Sizes = @(60000, 63000, 64000, 100000, 200000, 400000, 1000000),
    [string]$ListId,
    [switch]$DeviceCode
)

$ErrorActionPreference = "Stop"
Import-Module Microsoft.Graph.Authentication

$siteId = "coopermachineryservices.sharepoint.com,915a6183-2b71-4dfd-a8b9-181126dfbe78,3eb6cb9c-6535-4c69-a8d7-e90b2f90a9eb"
$graph = "https://graph.microsoft.com/v1.0/sites/$siteId"
$LAYOUTS_NAME = "Plant Layouts"

# --- auth -------------------------------------------------------------------
$ctx = Get-MgContext
if (-not $ctx -or ($ctx.Scopes -notcontains "Sites.Manage.All" -and $ctx.Scopes -notcontains "Sites.ReadWrite.All")) {
    Write-Host "Signing in (Sites.Manage.All)..." -ForegroundColor Cyan
    if ($DeviceCode) { Connect-MgGraph -Scopes "Sites.Manage.All" -UseDeviceCode -NoWelcome }
    else             { Connect-MgGraph -Scopes "Sites.Manage.All" -NoWelcome }
}

# --- find the list (paged: an unpaged call silently returns a subset) ---------
if (-not $ListId) {
    $uri = "$graph/lists?`$select=id,displayName&`$top=200"
    while ($uri -and -not $ListId) {
        $page = Invoke-MgGraphRequest -Method GET -Uri $uri
        $hit = $page.value | Where-Object { $_.displayName -eq $LAYOUTS_NAME } | Select-Object -First 1
        if ($hit) { $ListId = $hit.id }
        $uri = $page["@odata.nextLink"]
    }
    if (-not $ListId) { throw "No list called '$LAYOUTS_NAME' on Altronic_PMO. Pass -ListId." }
}
Write-Host "Plant Layouts list: $ListId" -ForegroundColor Gray

# --- what the column says about itself ----------------------------------------
$col = (Invoke-MgGraphRequest -Method GET -Uri "$graph/lists/$ListId/columns").value |
    Where-Object { $_.name -eq "LayoutJson" } | Select-Object -First 1
if (-not $col) { throw "The list has no LayoutJson column. Run create-plant-map-lists.ps1 first." }
$t = $col.text
Write-Host ("LayoutJson column: allowMultipleLines={0} textType={1} appendChangesToExistingText={2} maxLength={3}" -f `
    $t.allowMultipleLines, $t.textType, $t.appendChangesToExistingText, $t.maxLength) -ForegroundColor Gray
Write-Host "(Graph's answer about these settings has been wrong before - the read-back below is what counts.)`n" -ForegroundColor DarkGray

# --- a layout-shaped value of EXACTLY $n characters ---------------------------
function New-TestValue([int]$n) {
    $head = '{"schema":1,"units":"in","extent":{"w":3751,"h":3613},"areas":[],"items":['
    $sb = [System.Text.StringBuilder]::new($n + 400)
    [void]$sb.Append($head)
    $i = 0
    # Each item is ~170 characters; stop while there is room for the closing pad.
    while ($sb.Length -lt $n - 400) {
        if ($i -gt 0) { [void]$sb.Append(',') }
        [void]$sb.Append(('{{"uid":"i_{0:D5}","componentId":{1},"componentVersion":1,"x":{2}.5,"y":{3}.25,"w":30.5,"d":19.5,"rot":272,"label":"Bench \"{0}\" - 12 <in> & up","equipmentId":null,"locked":false}}' -f `
            $i, (100 + $i % 125), ($i * 7 % 3751), ($i * 13 % 3613)))
        $i++
    }
    [void]$sb.Append('],"pad":"')
    $close = '"}'
    $padLen = $n - $sb.Length - $close.Length
    if ($padLen -lt 0) { throw "Size $n is too small for the test value." }
    [void]$sb.Append('x' * $padLen)
    [void]$sb.Append($close)
    $value = $sb.ToString()
    if ($value.Length -ne $n) { throw "Built $($value.Length) characters, wanted $n." }
    return $value
}

function Get-MismatchNote([string]$wrote, [string]$got) {
    if ($null -eq $got) { return "read back EMPTY" }
    if ($got.Length -ne $wrote.Length) {
        $note = "read back $($got.Length) characters"
        if ($wrote.StartsWith($got)) { $note += " (TRUNCATED - the first $($got.Length) are right)" }
        elseif ($got.StartsWith($wrote)) { $note += " (LONGER - looks like Append Changes is ON)" }
        return $note
    }
    $at = 0
    while ($at -lt $wrote.Length -and $wrote[$at] -eq $got[$at]) { $at++ }
    return "same length, but differs at character $at"
}

# --- the test ------------------------------------------------------------------
$rowId = $null
$largestPass = 0
$failure = $null
try {
    $row = Invoke-MgGraphRequest -Method POST -Uri "$graph/lists/$ListId/items" -ContentType "application/json" -Body (@{
        fields = @{
            Title = "ARC-VERIFY column size test (safe to delete)"; Building = "ARC-VERIFY"; Area = "verify"
            LayoutKey = "arc-verify-size"; Status = "Superseded"; Version = 1; WallsFile = "VERIFY"
            LayoutJson = '{"schema":1,"units":"in","extent":{"w":100,"h":50},"items":[],"areas":[]}'
        }
    } | ConvertTo-Json -Depth 4)
    $rowId = $row.id
    Write-Host "Test row $rowId created.`n" -ForegroundColor Gray

    foreach ($n in $Sizes) {
        $value = New-TestValue $n
        Write-Host ("  {0,9:N0} chars ... " -f $n) -NoNewline
        try {
            Invoke-MgGraphRequest -Method PATCH -Uri "$graph/lists/$ListId/items/$rowId/fields" -ContentType "application/json; charset=utf-8" `
                -Body (@{ LayoutJson = $value } | ConvertTo-Json -Depth 2 -Compress) | Out-Null
        } catch {
            $failure = "$n characters: the write was REFUSED - $($_.Exception.Message)"
            Write-Host "REFUSED" -ForegroundColor Red
            break
        }
        $back = Invoke-MgGraphRequest -Method GET -Uri "$graph/lists/$ListId/items/$rowId/fields?`$select=LayoutJson"
        $got = $back["LayoutJson"]
        if ($got -ceq $value) {
            Write-Host "ok (read back identical)" -ForegroundColor Green
            $largestPass = $n
        } else {
            $failure = "$n characters: accepted, but $(Get-MismatchNote $value $got)"
            Write-Host "FAILED - $(Get-MismatchNote $value $got)" -ForegroundColor Red
            break
        }
    }
} finally {
    if ($rowId) {
        try {
            Invoke-MgGraphRequest -Method DELETE -Uri "$graph/lists/$ListId/items/$rowId" | Out-Null
            Write-Host "`nTest row $rowId deleted." -ForegroundColor Gray
        } catch {
            Write-Host "`nCOULDN'T DELETE test row $rowId - remove it from Plant Layouts by hand (Building ARC-VERIFY)." -ForegroundColor Red
        }
    }
}

# --- result --------------------------------------------------------------------
Write-Host ""
if ($largestPass -gt 0) {
    Write-Host ("Largest value stored intact: {0:N0} characters." -f $largestPass) -ForegroundColor Cyan
} else {
    Write-Host "No size stored intact." -ForegroundColor Red
}
if ($failure) { Write-Host "First failure: $failure" -ForegroundColor Yellow }
Write-Host "The Main Plant CAD layout needs about 162,000 characters (149,000 without the safety items)." -ForegroundColor Gray
