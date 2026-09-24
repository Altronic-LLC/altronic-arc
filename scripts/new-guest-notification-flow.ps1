<#
.SYNOPSIS
    Generates an importable Power Automate package for the guest
    comment-notification flow.

.DESCRIPTION
    Builds ARC-GuestNotify-<list>.zip containing a fully-defined flow: the
    SharePoint trigger, the comment parsing, the guest check, the
    already-notified guard, the watcher loop and the email. Your site, list
    and internal domain are baked in, so there is nothing to type into the
    designer and nothing to mis-transcribe.

    WHY A PACKAGE AND NOT AN API CALL. Power Platform's flow-creation API
    takes the same JSON but is undocumented and unversioned by Microsoft —
    the same class of risk as the Supplier Logo column write (see CLAUDE.md).
    An import package goes through a supported, documented path, and the
    import screen makes you pick the connections explicitly rather than
    failing obscurely when they don't exist.

    WHAT THIS SCRIPT DOES NOT DO:
      - It does not create the SharePoint or Outlook CONNECTIONS. Those must
        already exist in the target environment; the import screen asks you
        to choose them.
      - It does not turn the flow on. Import leaves it off, which is correct:
        you want to read it before it starts emailing people.
      - It does not add the LastNotifiedComment column. Run
        add-task-last-notified-column.ps1 first, or the dedupe guard in the
        flow compares against a column that isn't there.

    RE-RUNNABLE FOR OTHER LISTS. Pass -ListName / -ListId / -TitleColumn to
    generate the same flow for EIRs, ECNs, Build Requests and so on. One flow
    per list is the cost of this approach.

    No network access and no sign-in — it only writes a file. Safe to run
    anywhere, including to inspect the JSON before importing anything.

.PARAMETER ListName
    SharePoint list display name. Default: Project Task List.

.PARAMETER ListId
    The list's GUID. Default: the Engineering Project Task List.

.PARAMETER TitleColumn
    Internal name of the column used to name the item in the email subject.
    Default NumberedTitle (e.g. "T3-0017-HUB V4 refresh").

.PARAMETER OutputPath
    Where to write the .zip. Default: the repo root.

.EXAMPLE
    ./scripts/new-guest-notification-flow.ps1
    Generates the Engineering Tasks package.

.EXAMPLE
    ./scripts/new-guest-notification-flow.ps1 -ListName "EIRs" `
        -ListId "8d00a762-288c-4678-afc4-cba2f24ac965" -TitleColumn "EIRNo"
    The same flow for the EIRs list.

.NOTES
    After importing: pick the two connections, open the flow and read it,
    then turn it on. Test plan is in
    docs/POWER-AUTOMATE-GUEST-NOTIFICATIONS.md.
#>

param(
    [string]$ListName    = "Project Task List",
    [string]$ListId      = "42fb8c19-5f33-4fdd-9ef7-df6f21433588",
    [string]$TitleColumn = "NumberedTitle",
    [string]$SiteUrl     = "https://coopermachineryservices.sharepoint.com/sites/Altronic_Engineering",
    # Anything NOT on this domain is treated as a guest. Must stay in step
    # with INTERNAL_EMAIL_DOMAINS in src/lib/guestIdentity.ts.
    [string]$InternalDomain = "altronic-llc.com",
    [string]$ArcBaseUrl  = "https://altronic-llc.github.io/altronic-arc",
    [string]$OutputPath  = (Join-Path $PSScriptRoot ".."),
    [switch]$KeepStaging
)

$ErrorActionPreference = "Stop"

# ---------------------------------------------------------------------------
# The record delimiter ARC uses inside the Communication column. Held in a
# variable because a literal "|||" inside a PowerShell here-string that also
# carries JSON is easy to mangle, and because it appears five times below.
# ---------------------------------------------------------------------------
$D = '|' + '|' + '|'

$flowName = "ARC - Guest comment notifications ($ListName)"
$safeName = ($ListName -replace '[^A-Za-z0-9]', '')
$zipName  = "ARC-GuestNotify-$safeName.zip"

Write-Host "Building flow package" -ForegroundColor Cyan
Write-Host "  list            : $ListName ($ListId)"
Write-Host "  title column    : $TitleColumn"
Write-Host "  internal domain : $InternalDomain"
Write-Host ""

# ---------------------------------------------------------------------------
# Flow definition.
#
# Built as a PowerShell hashtable and converted to JSON, rather than written
# as a JSON string: ConvertTo-Json escapes the expressions' quotes correctly,
# where a hand-written string would need every inner quote doubled and would
# silently break the first time somebody edited it.
#
# ORDER MATTERS. `runAfter` is what sequences actions — Power Automate ignores
# the order keys appear in. Each action below names the one before it.
# ---------------------------------------------------------------------------

$definition = [ordered]@{
    '$schema'      = 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#'
    contentVersion = '1.0.0.0'
    parameters     = [ordered]@{
        '$connections' = [ordered]@{ defaultValue = @{}; type = 'Object' }
        '$authentication' = [ordered]@{ defaultValue = @{}; type = 'SecureObject' }
    }
    triggers = [ordered]@{
        'When_an_item_is_created_or_modified' = [ordered]@{
            type       = 'OpenApiConnection'
            inputs     = [ordered]@{
                host = [ordered]@{
                    connectionName = 'shared_sharepointonline'
                    operationId    = 'GetOnUpdatedItems'
                    apiId          = '/providers/Microsoft.PowerApps/apis/shared_sharepointonline'
                }
                parameters = [ordered]@{
                    dataset = $SiteUrl
                    table   = $ListId
                }
                authentication = "@parameters('`$authentication')"
            }
            recurrence = [ordered]@{ frequency = 'Minute'; interval = 3 }
            metadata   = [ordered]@{ operationMetadataId = [guid]::NewGuid().ToString() }
        }
    }
    actions = [ordered]@{

        # --- 1. Isolate the newest comment record -------------------------
        # Communication holds the whole thread, records newline-separated.
        'LastRecord' = [ordered]@{
            type     = 'Compose'
            inputs   = "@last(split(triggerOutputs()?['body/Communication'], decodeUriComponent('%0A')))"
            runAfter = @{}
            metadata = [ordered]@{ operationMetadataId = [guid]::NewGuid().ToString() }
        }

        'Fields' = [ordered]@{
            type     = 'Compose'
            inputs   = "@split(outputs('LastRecord'), '$D')"
            runAfter = [ordered]@{ 'LastRecord' = @('Succeeded') }
            metadata = [ordered]@{ operationMetadataId = [guid]::NewGuid().ToString() }
        }

        # --- 2. Fields, taken from the FRONT ------------------------------
        # NEVER index backwards from the end: a comment body containing the
        # delimiter shifts every field, and the author email then reads as a
        # fragment of the body. Verified 2026-09-23.
        'CommentTimestamp' = [ordered]@{
            type     = 'Compose'
            inputs   = "@trim(outputs('Fields')[0])"
            runAfter = [ordered]@{ 'Fields' = @('Succeeded') }
            metadata = [ordered]@{ operationMetadataId = [guid]::NewGuid().ToString() }
        }
        'AuthorName' = [ordered]@{
            type     = 'Compose'
            inputs   = "@trim(outputs('Fields')[1])"
            runAfter = [ordered]@{ 'CommentTimestamp' = @('Succeeded') }
            metadata = [ordered]@{ operationMetadataId = [guid]::NewGuid().ToString() }
        }
        'AuthorEmail' = [ordered]@{
            type     = 'Compose'
            inputs   = "@trim(outputs('Fields')[2])"
            runAfter = [ordered]@{ 'AuthorName' = @('Succeeded') }
            metadata = [ordered]@{ operationMetadataId = [guid]::NewGuid().ToString() }
        }
        # Re-joined, so a body containing the delimiter survives intact.
        'CommentBody' = [ordered]@{
            type     = 'Compose'
            inputs   = "@join(skip(outputs('Fields'), 3), '$D')"
            runAfter = [ordered]@{ 'AuthorEmail' = @('Succeeded') }
            metadata = [ordered]@{ operationMetadataId = [guid]::NewGuid().ToString() }
        }

        # --- 3. Guests only, else every employee comment sends twice ------
        'Is_the_author_external' = [ordered]@{
            type       = 'If'
            expression = [ordered]@{
                and = @(
                    [ordered]@{
                        equals = @(
                            "@not(endsWith(toLower(outputs('AuthorEmail')), '@$InternalDomain'))",
                            $true
                        )
                    }
                )
            }
            runAfter = [ordered]@{ 'CommentBody' = @('Succeeded') }
            metadata = [ordered]@{ operationMetadataId = [guid]::NewGuid().ToString() }
            actions  = [ordered]@{

                # --- 4. Don't re-send. The trigger fires on EVERY column
                # change, so without this a status edit re-emails the last
                # comment.
                'Is_this_a_new_comment' = [ordered]@{
                    type       = 'If'
                    expression = [ordered]@{
                        and = @(
                            [ordered]@{
                                equals = @(
                                    "@not(equals(outputs('CommentTimestamp'), coalesce(triggerOutputs()?['body/LastNotifiedComment'], '')))",
                                    $true
                                )
                            }
                        )
                    }
                    runAfter = @{}
                    metadata = [ordered]@{ operationMetadataId = [guid]::NewGuid().ToString() }
                    actions  = [ordered]@{

                        # --- 5. One email per watcher, minus the author ----
                        'Each_watcher' = [ordered]@{
                            type     = 'Foreach'
                            foreach  = "@triggerOutputs()?['body/Watchers']"
                            runAfter = @{}
                            metadata = [ordered]@{ operationMetadataId = [guid]::NewGuid().ToString() }
                            actions  = [ordered]@{
                                'Not_the_author' = [ordered]@{
                                    type       = 'If'
                                    expression = [ordered]@{
                                        and = @(
                                            [ordered]@{
                                                equals = @(
                                                    "@not(equals(toLower(items('Each_watcher')?['Email']), toLower(outputs('AuthorEmail'))))",
                                                    $true
                                                )
                                            }
                                        )
                                    }
                                    runAfter = @{}
                                    metadata = [ordered]@{ operationMetadataId = [guid]::NewGuid().ToString() }
                                    actions  = [ordered]@{
                                        'Send_an_email' = [ordered]@{
                                            type   = 'OpenApiConnection'
                                            inputs = [ordered]@{
                                                host = [ordered]@{
                                                    connectionName = 'shared_office365'
                                                    operationId    = 'SendEmailV2'
                                                    apiId          = '/providers/Microsoft.PowerApps/apis/shared_office365'
                                                }
                                                parameters = [ordered]@{
                                                    'emailMessage/To'      = "@items('Each_watcher')?['Email']"
                                                    'emailMessage/Subject' = "@{outputs('AuthorName')} commented on @{triggerOutputs()?['body/$TitleColumn']}"
                                                    'emailMessage/Body'    = @"
<p><strong>@{outputs('AuthorName')}</strong> (external) commented on <strong>@{triggerOutputs()?['body/$TitleColumn']}</strong>:</p>
<blockquote>@{outputs('CommentBody')}</blockquote>
<p><a href="$ArcBaseUrl/task/@{triggerOutputs()?['body/ID']}">Open this in ARC</a></p>
<p style="color:#888888;font-size:12px">Sent by ARC on behalf of an external collaborator, who cannot send from the notifications mailbox.</p>
"@
                                                    'emailMessage/ReplyTo' = "@outputs('AuthorEmail')"
                                                    'emailMessage/Importance' = 'Normal'
                                                }
                                                authentication = "@parameters('`$authentication')"
                                            }
                                            runAfter = @{}
                                            metadata = [ordered]@{ operationMetadataId = [guid]::NewGuid().ToString() }
                                        }
                                    }
                                    else = [ordered]@{ actions = @{} }
                                }
                            }
                        }

                        # --- 6. Record it, OUTSIDE the loop ---------------
                        'Record_what_was_sent' = [ordered]@{
                            type   = 'OpenApiConnection'
                            inputs = [ordered]@{
                                host = [ordered]@{
                                    connectionName = 'shared_sharepointonline'
                                    operationId    = 'PatchItem'
                                    apiId          = '/providers/Microsoft.PowerApps/apis/shared_sharepointonline'
                                }
                                parameters = [ordered]@{
                                    dataset = $SiteUrl
                                    table   = $ListId
                                    id      = "@triggerOutputs()?['body/ID']"
                                    # Title is REQUIRED on the list, so PatchItem refuses the
                                    # whole action without it — "The API operation 'PatchItem'
                                    # is missing required property 'item/Title'" at SAVE time,
                                    # before the flow has ever run (reported 2026-09-24).
                                    #
                                    # Echoed back from the trigger UNCHANGED. It has to be sent,
                                    # but this action's only job is stamping LastNotifiedComment
                                    # — writing anything else here would overwrite a real value
                                    # every time a guest comments. Note Title is the task's own
                                    # short title, NOT NumberedTitle: they are two separate
                                    # columns and swapping them would rewrite every task's name.
                                    'item/Title'               = "@triggerOutputs()?['body/Title']"
                                    'item/LastNotifiedComment' = "@outputs('CommentTimestamp')"
                                }
                                authentication = "@parameters('`$authentication')"
                            }
                            runAfter = [ordered]@{ 'Each_watcher' = @('Succeeded') }
                            metadata = [ordered]@{ operationMetadataId = [guid]::NewGuid().ToString() }
                        }
                    }
                    else = [ordered]@{ actions = @{} }
                }
            }
            else = [ordered]@{ actions = @{} }
        }
    }
}

# ---------------------------------------------------------------------------
# Package scaffolding.
#
# THIS FORMAT IS COPIED FROM A REAL EXPORT, not inferred. The first version of
# this script wrote a plausible-looking package that Power Automate accepted
# with "All package resources were successfully imported" and imported
# NOTHING - the Review Package Content table was empty and no flow appeared
# (Ray, 2026-09-23, with a screenshot). Three separate things were wrong:
#
#   1. manifest.json's `resources` was {} - that map is what the import screen
#      reads, so an empty one means an empty package however many files the
#      zip holds. FIVE entries are needed: the flow, plus an `apis` and a
#      `connections` entry per connector, wired together by dependsOn.
#   2. definition.json must be WRAPPED - name/id/type/properties, with the
#      workflow at properties.definition - not the bare workflow.
#   3. Two files were missing entirely: Microsoft.Flow/flows/manifest.json
#      (the asset-path index) and the per-flow connectionsMap.json. apisMap
#      was also the wrong shape: connector name -> resource GUID, not an
#      object.
#
# Verified against FAITUpdatesNotifications_20260707130655.zip, an export of a
# real flow from this tenant. IF AN IMPORT EVER SILENTLY DOES NOTHING AGAIN,
# export any flow and diff its package against what this writes - that is how
# this was found, and it is faster than re-reading Microsoft's docs, which do
# not describe this format at all.
# ---------------------------------------------------------------------------

# Every resource in the manifest is addressed by its own GUID, and the flow
# depends on all four connector resources. Generated per run - they only have
# to be internally consistent, not stable.
$flowResourceId = [guid]::NewGuid().ToString()
$spApiId        = [guid]::NewGuid().ToString()
$spConnId       = [guid]::NewGuid().ToString()
$o365ApiId      = [guid]::NewGuid().ToString()
$o365ConnId     = [guid]::NewGuid().ToString()

# The flow's own workflow id, referenced by the definition wrapper.
$workflowId = [guid]::NewGuid().ToString()

$staging  = Join-Path ([System.IO.Path]::GetTempPath()) ("arcflow-" + [guid]::NewGuid().ToString('N'))
$flowsDir = Join-Path $staging "Microsoft.Flow\flows"
$flowDir  = Join-Path $flowsDir $flowResourceId
New-Item -ItemType Directory -Path $flowDir -Force | Out-Null

# --- definition.json: the WRAPPER, with the workflow nested inside ---------
$wrapper = [ordered]@{
    name       = $workflowId
    id         = "/providers/Microsoft.Flow/flows/$workflowId"
    type       = 'Microsoft.Flow/flows'
    properties = [ordered]@{
        apiId                = '/providers/Microsoft.PowerApps/apis/shared_logicflows'
        displayName          = $flowName
        definition           = $definition
        connectionReferences = [ordered]@{
            shared_sharepointonline = [ordered]@{
                connectionName = 'shared_sharepointonline'
                source         = 'Embedded'
                id             = '/providers/Microsoft.PowerApps/apis/shared_sharepointonline'
                tier           = 'NotSpecified'
                apiName        = 'sharepointonline'
            }
            shared_office365 = [ordered]@{
                connectionName = 'shared_office365'
                source         = 'Embedded'
                id             = '/providers/Microsoft.PowerApps/apis/shared_office365'
                tier           = 'NotSpecified'
                apiName        = 'office365'
            }
        }
        flowFailureAlertSubscribed = $false
        isManaged                  = $false
    }
}
$wrapper | ConvertTo-Json -Depth 40 -Compress |
    Set-Content -Path (Join-Path $flowDir "definition.json") -Encoding UTF8

# --- the two maps: connector name -> the manifest's resource GUID ----------
[ordered]@{
    shared_sharepointonline = $spApiId
    shared_office365        = $o365ApiId
} | ConvertTo-Json -Compress |
    Set-Content -Path (Join-Path $flowDir "apisMap.json") -Encoding UTF8

[ordered]@{
    shared_sharepointonline = $spConnId
    shared_office365        = $o365ConnId
} | ConvertTo-Json -Compress |
    Set-Content -Path (Join-Path $flowDir "connectionsMap.json") -Encoding UTF8

# --- the asset-path index this script originally omitted -------------------
[ordered]@{
    packageSchemaVersion = '1.0'
    flowAssets           = [ordered]@{ assetPaths = @($flowResourceId) }
} | ConvertTo-Json -Depth 5 -Compress |
    Set-Content -Path (Join-Path $flowsDir "manifest.json") -Encoding UTF8

# --- root manifest: the five resources the import screen actually reads ----
$manifest = [ordered]@{
    schema  = '1.0'
    details = [ordered]@{
        displayName        = $flowName
        description        = "Emails task watchers when an EXTERNAL user comments. Employees are already notified by ARC. Generated by scripts/new-guest-notification-flow.ps1."
        createdTime        = (Get-Date).ToUniversalTime().ToString("o")
        packageTelemetryId = [guid]::NewGuid().ToString()
        creator            = 'N/A'
        sourceEnvironment  = ''
    }
    resources = [ordered]@{}
}

$manifest.resources[$flowResourceId] = [ordered]@{
    type                  = 'Microsoft.Flow/flows'
    suggestedCreationType = 'New'
    creationType          = 'Existing, New, Update'
    details               = [ordered]@{ displayName = $flowName }
    configurableBy        = 'User'
    hierarchy             = 'Root'
    dependsOn             = @($spApiId, $spConnId, $o365ApiId, $o365ConnId)
}
$manifest.resources[$spApiId] = [ordered]@{
    id                    = '/providers/Microsoft.PowerApps/apis/shared_sharepointonline'
    name                  = 'shared_sharepointonline'
    type                  = 'Microsoft.PowerApps/apis'
    suggestedCreationType = 'Existing'
    details               = [ordered]@{ displayName = 'SharePoint' }
    configurableBy        = 'System'
    hierarchy             = 'Child'
    dependsOn             = @()
}
$manifest.resources[$spConnId] = [ordered]@{
    type                  = 'Microsoft.PowerApps/apis/connections'
    suggestedCreationType = 'Existing'
    creationType          = 'Existing'
    details               = [ordered]@{ displayName = 'SharePoint' }
    configurableBy        = 'User'
    hierarchy             = 'Child'
    dependsOn             = @($spApiId)
}
$manifest.resources[$o365ApiId] = [ordered]@{
    id                    = '/providers/Microsoft.PowerApps/apis/shared_office365'
    name                  = 'shared_office365'
    type                  = 'Microsoft.PowerApps/apis'
    suggestedCreationType = 'Existing'
    details               = [ordered]@{ displayName = 'Office 365 Outlook' }
    configurableBy        = 'System'
    hierarchy             = 'Child'
    dependsOn             = @()
}
$manifest.resources[$o365ConnId] = [ordered]@{
    type                  = 'Microsoft.PowerApps/apis/connections'
    suggestedCreationType = 'Existing'
    creationType          = 'Existing'
    details               = [ordered]@{ displayName = 'Office 365 Outlook' }
    configurableBy        = 'User'
    hierarchy             = 'Child'
    dependsOn             = @($o365ApiId)
}

$manifest | ConvertTo-Json -Depth 20 -Compress |
    Set-Content -Path (Join-Path $staging "manifest.json") -Encoding UTF8

# A human-readable copy of the WORKFLOW (not the wrapper) beside the package,
# so the flow can be reviewed and diffed between runs without unzipping.
$jsonSidecar = Join-Path $OutputPath ([System.IO.Path]::GetFileNameWithoutExtension($zipName) + ".definition.json")
$definition | ConvertTo-Json -Depth 40 | Set-Content -Path $jsonSidecar -Encoding UTF8

$zipPath = Join-Path $OutputPath $zipName
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
Compress-Archive -Path (Join-Path $staging '*') -DestinationPath $zipPath -Force

if (-not $KeepStaging) { Remove-Item $staging -Recurse -Force }
else { Write-Host "  staging kept: $staging" -ForegroundColor DarkGray }

Write-Host "Wrote:" -ForegroundColor Green
Write-Host "  $zipPath"
Write-Host "  $jsonSidecar  (readable copy - review this)"
Write-Host ""
Write-Host "Next:" -ForegroundColor Cyan
Write-Host "  1. Run add-task-last-notified-column.ps1 if you haven't"
Write-Host "  2. make.powerautomate.com -> My flows -> Import -> Import Package"
Write-Host "  3. The Review Package Content table MUST list the flow plus two"
Write-Host "     connections. If it says 'No items', the package is wrong -"
Write-Host "     stop and diff it against a real exported flow."
Write-Host "  4. Set both connections, Import, then OPEN the flow and read it"
Write-Host "     before turning it on"
Write-Host "  5. Test per docs/POWER-AUTOMATE-GUEST-NOTIFICATIONS.md"
