<#
.SYNOPSIS
    Sets up ECN distribution (BusinessIT#57) on the Altronic_Engineering site:
    the ECN Distribution Groups list, and three columns on the ECN list.

.DESCRIPTION
    1. ECN Distribution Groups (new list)
         Title     = the role on the ECN form's DISTRIBUTION block (shown
                     "Distribution Role")
         Members   = one "Name <email>" per line (multi-line PLAIN text)
         SortOrder = the form's order
       Seeded with the ten roles, no people, ONLY while the list is empty —
       after that it is the source of truth, and a re-run never puts back a
       row somebody removed. People are added in ARC, by an ARC admin, at
       /engineering/ecns/distribution — never here, and never in src/ (the
       repository is public).

    2. Three columns on the ECN list (ECN NEW, id below)
         Distribution   MULTI-choice (checkboxes) of the ten roles. ARC writes
                        it with the Collection(Edm.String) annotation.
         DistributedTo  multi-line plain text — who the ECN was emailed to
         DistributedAt  date and time — when

    THE INTERNAL NAMES AND THE CHOICES ARE A CONTRACT with
    src/lib/ecnDistribution.ts (ECN_DISTRIBUTION_ROLES) and src/api/ecns.ts.
    Change them there in the same commit.

    Run it BEFORE the deploy that ships ECN distribution. ARC falls back to
    reading ECNs without the three columns if they are missing (so the list
    never goes blank), but nothing can be ticked or sent until they exist.

    Idempotent: an existing list or column is left alone; only what is missing
    is added (including missing choices on Distribution). Nothing is deleted.

    Verified by WRITE AND READ BACK on the groups list (a 2xx is not proof a
    value landed — the DisplayName trap). The ECN list's columns are checked
    by their definitions only: writing a test value to a real ECN is not worth
    the risk. The first ECN signed off in ARC is the behavioural check.

    Permissions: Graph can't set them. ECN Distribution Groups should be
    readable by everyone who uses ECNs (whoever signs an ECN off reads it to
    send); ARC admins need Contribute.

.PARAMETER WhatIf
    Report what would be created or changed; change nothing.

.EXAMPLE
    ./scripts/create-ecn-distribution.ps1 -WhatIf
    ./scripts/create-ecn-distribution.ps1

.NOTES
    Needs Sites.Manage.All. Run it in your own terminal: the Graph module signs
    in through a Windows account window a background process hasn't got.
#>
param(
    [switch]$WhatIf,
    [string]$SiteId = "coopermachineryservices.sharepoint.com,ddb5fc80-ea51-4d56-b008-ce6a82af49b0,aa6b9467-3f57-4213-bbd4-60b94403421a",
    [string]$EcnListId = "f6917bf4-bdd1-4ff9-ba71-0a17b22b1ecc"
)

$ErrorActionPreference = "Stop"
$Graph = "https://graph.microsoft.com/v1.0/sites/$SiteId"

# Must match ECN_DISTRIBUTION_ROLES in src/lib/ecnDistribution.ts, in order.
$Roles = @(
    "CAD Department", "VP Operations Eng.", "Quality Manager", "Logistics Manager",
    "Production Director", "Sales", "Op. Program Manager", "Purchasing Manager",
    "SHE Coordinator", "Panel Plant"
)
$GroupsListName = "ECN Distribution Groups"

$EcnColumns = @(
    @{ name = "Distribution"; displayName = "Distribution"
       choice = @{ choices = $Roles; displayAs = "checkBoxes"; allowTextEntry = $false } },
    @{ name = "DistributedTo"; displayName = "Distributed To"
       text = @{ allowMultipleLines = $true; textType = "plain"; appendChangesToExistingText = $false } },
    @{ name = "DistributedAt"; displayName = "Distributed At"
       dateTime = @{ format = "dateTime"; displayAs = "standard" } }
)
$GroupColumns = @(
    @{ name = "Members"; displayName = "Members"
       text = @{ allowMultipleLines = $true; textType = "plain"; appendChangesToExistingText = $false } },
    @{ name = "SortOrder"; displayName = "Sort Order"; number = @{ decimalPlaces = "none" } }
)

# ---------------------------------------------------------------- sign-in

if (-not $WhatIf) {
    $ctx = Get-MgContext
    if (-not $ctx -or $ctx.Scopes -notcontains "Sites.Manage.All") {
        Write-Host "Signing in (Sites.Manage.All — creating a list is a write)..." -ForegroundColor Cyan
        try { Connect-MgGraph -Scopes "Sites.Manage.All" -NoWelcome }
        catch { Connect-MgGraph -Scopes "Sites.Manage.All" -UseDeviceCode -NoWelcome }
    }
} elseif (-not (Get-MgContext)) {
    Connect-MgGraph -Scopes "Sites.Read.All" -NoWelcome
}

function Get-ListId($name) {
    # /lists is PAGED — an unpaged call silently returns a subset.
    $uri = "$Graph/lists?`$select=id,displayName&`$top=200"
    while ($uri) {
        $page = Invoke-MgGraphRequest -Method GET -Uri $uri
        $hit = $page.value | Where-Object { $_.displayName -eq $name } | Select-Object -First 1
        if ($hit) { return $hit.id }
        $uri = $page.'@odata.nextLink'
    }
    return $null
}

# Add any missing column (and any missing choice); report a column of the wrong kind.
function Sync-Columns($listId, $columns) {
    $current = (Invoke-MgGraphRequest -Method GET -Uri "$Graph/lists/$listId/columns").value
    foreach ($col in $columns) {
        $have = $current | Where-Object { $_.name -eq $col.name } | Select-Object -First 1
        if (-not $have) {
            if ($WhatIf) { Write-Host "    $($col.name) — WOULD ADD" -ForegroundColor Yellow; continue }
            Invoke-MgGraphRequest -Method POST -Uri "$Graph/lists/$listId/columns" `
                -Body ($col | ConvertTo-Json -Depth 10) -ContentType "application/json" | Out-Null
            Write-Host "    $($col.name) — added" -ForegroundColor Green
            continue
        }
        $kinds = @("text", "number", "choice", "dateTime")
        $want = $kinds | Where-Object { $col.ContainsKey($_) } | Select-Object -First 1
        if ($want -and -not $have.$want) {
            Write-Host "    $($col.name) — EXISTS BUT IS NOT A '$want' COLUMN. ARC needs '$want'; fix by hand." -ForegroundColor Red
            continue
        }
        if ($col.choice) {
            if ($have.choice.displayAs -ne "checkBoxes") {
                Write-Host "    $($col.name) — displayAs is '$($have.choice.displayAs)'; ARC needs checkBoxes (multi-choice). Fix by hand." -ForegroundColor Red
            }
            $missing = @($col.choice.choices | Where-Object { $have.choice.choices -notcontains $_ })
            if ($missing.Count -gt 0) {
                if ($WhatIf) { Write-Host "    $($col.name) — WOULD ADD choice(s): $($missing -join ', ')" -ForegroundColor Yellow; continue }
                $choices = @($have.choice.choices) + $missing
                Invoke-MgGraphRequest -Method PATCH -Uri "$Graph/lists/$listId/columns/$($have.id)" `
                    -Body (@{ choice = @{ choices = $choices; displayAs = $have.choice.displayAs; allowTextEntry = $false } } | ConvertTo-Json -Depth 5) `
                    -ContentType "application/json" | Out-Null
                Write-Host "    $($col.name) — added choice(s): $($missing -join ', ')" -ForegroundColor Green
                continue
            }
        }
        if ($col.text -and $have.text.appendChangesToExistingText) {
            Write-Host "    $($col.name) — Graph reports appendChangesToExistingText = TRUE. Turn it off in List settings." -ForegroundColor Red
            continue
        }
        Write-Host "    $($col.name) — already there"
    }
}

# ---------------------------------------------------------------- 1. the groups list

Write-Host "`n$GroupsListName" -ForegroundColor Cyan
$groupsId = Get-ListId $GroupsListName
if ($groupsId) {
    Write-Host "  exists — id $groupsId" -ForegroundColor Yellow
} elseif ($WhatIf) {
    Write-Host "  WOULD CREATE with Members, SortOrder; Title shown 'Distribution Role'" -ForegroundColor Yellow
} else {
    $body = @{
        displayName = $GroupsListName
        description = "Who receives an ECN for each role on its DISTRIBUTION block (BusinessIT#57). Members = one 'Name <email>' per line. Managed by ARC admins in ARC."
        list        = @{ template = "genericList" }
        columns     = $GroupColumns
    } | ConvertTo-Json -Depth 10
    $created = Invoke-MgGraphRequest -Method POST -Uri "$Graph/lists" -Body $body -ContentType "application/json"
    $groupsId = $created.id
    Write-Host "  CREATED — id $groupsId" -ForegroundColor Green
}

if ($groupsId) {
    Sync-Columns $groupsId $GroupColumns
    $title = (Invoke-MgGraphRequest -Method GET -Uri "$Graph/lists/$groupsId/columns").value |
        Where-Object { $_.name -eq "Title" } | Select-Object -First 1
    if ($title -and $title.displayName -ne "Distribution Role" -and -not $WhatIf) {
        Invoke-MgGraphRequest -Method PATCH -Uri "$Graph/lists/$groupsId/columns/$($title.id)" `
            -Body (@{ displayName = "Distribution Role" } | ConvertTo-Json) -ContentType "application/json" | Out-Null
        Write-Host "    Title — shown 'Distribution Role'" -ForegroundColor Green
    }

    $rows = (Invoke-MgGraphRequest -Method GET -Uri "$Graph/lists/$groupsId/items?`$top=50").value
    if ($rows.Count -gt 0) {
        Write-Host "  holds $($rows.Count) row(s) — not seeded (the list is the source of truth now)" -ForegroundColor Yellow
    } elseif ($WhatIf) {
        Write-Host "  WOULD SEED: $($Roles -join ', ')" -ForegroundColor Yellow
    } else {
        $order = 1
        foreach ($role in $Roles) {
            Invoke-MgGraphRequest -Method POST -Uri "$Graph/lists/$groupsId/items" `
                -Body (@{ fields = @{ Title = $role; SortOrder = $order; Members = "" } } | ConvertTo-Json -Depth 5) `
                -ContentType "application/json" | Out-Null
            $order++
        }
        Write-Host "  seeded $($Roles.Count) roles, no members" -ForegroundColor Green

        # Write and read back on one seeded row, then put it back.
        $first = (Invoke-MgGraphRequest -Method GET -Uri "$Graph/lists/$groupsId/items?`$expand=fields(`$select=Title,SortOrder,Members)&`$top=50").value |
            Where-Object { $_.fields.Title -eq $Roles[0] } | Select-Object -First 1
        $probe = "Write Check <write.check@example.com>"
        Invoke-MgGraphRequest -Method PATCH -Uri "$Graph/lists/$groupsId/items/$($first.id)/fields" `
            -Body (@{ Members = $probe } | ConvertTo-Json) -ContentType "application/json" | Out-Null
        $back = Invoke-MgGraphRequest -Method GET -Uri "$Graph/lists/$groupsId/items/$($first.id)?`$expand=fields(`$select=Title,SortOrder,Members)"
        Invoke-MgGraphRequest -Method PATCH -Uri "$Graph/lists/$groupsId/items/$($first.id)/fields" `
            -Body (@{ Members = "" } | ConvertTo-Json) -ContentType "application/json" | Out-Null
        if ($back.fields.Members -eq $probe -and [int]$back.fields.SortOrder -eq 1) {
            Write-Host "  write/read-back OK (Members, SortOrder)" -ForegroundColor Green
        } else {
            Write-Host "  write/read-back FAILED: Members='$($back.fields.Members)' SortOrder='$($back.fields.SortOrder)'. Check the list." -ForegroundColor Red
        }
    }
}

# ---------------------------------------------------------------- 2. the ECN list's columns

Write-Host "`nECN list ($EcnListId) — Distribution, DistributedTo, DistributedAt" -ForegroundColor Cyan
Sync-Columns $EcnListId $EcnColumns

if ($WhatIf) { Write-Host "`n-WhatIf — nothing was created or changed.`n" -ForegroundColor Yellow; exit 0 }

Write-Host "`nNext:" -ForegroundColor Cyan
Write-Host "  1. Set the repo variable  VITE_SP_ECN_DISTRIBUTION_GROUPS_LIST_ID = $groupsId" -ForegroundColor Yellow
Write-Host "     (gh variable set VITE_SP_ECN_DISTRIBUTION_GROUPS_LIST_ID --body $groupsId)" -ForegroundColor Yellow
Write-Host "     and the same line in .env.local; restart npm run dev." -ForegroundColor Yellow
Write-Host "  2. Permissions on '$GroupsListName': everyone who uses ECNs = Read; ARC admins = Contribute." -ForegroundColor Yellow
Write-Host "  3. Add the people for each role in ARC: /engineering/ecns/distribution (ARC admins)." -ForegroundColor Yellow
Write-Host "  4. Behavioural check: sign off one ECN in ARC and confirm Distributed To / At read back." -ForegroundColor Yellow
