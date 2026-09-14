# Imports chatbot/dialogflow/ into the Dialogflow ES agent for -ProjectId,
# then enables the webhook on all 5 custom intents. Idempotent — safe to
# re-run after editing training phrases.
#
# Prereqs:
#   terraform apply already run (creates the agent + fulfillment webhook
#   pointing at the deployed chatbot_fulfillment_url, and grants the
#   Dialogflow/Cloud Build/Firestore IAM roles this all depends on)
#   gcloud auth application-default login
#   gcloud auth application-default set-quota-project <ProjectId>
#     (Dialogflow ES's API requires an explicit quota project when
#     authenticating as a user rather than a service account — without this,
#     every call 403s with "requires a quota project")
#
# Usage:
#   ./import-agent.ps1 -ProjectId serverless-project-501905
#
# IMPORTANT: agent:import resets the fulfillment webhook URL to whatever
# placeholder is in agent.json (available: false, so it should be inert, but
# double check chatbot/dialogflow/agent.json before changing that). Always
# re-run `terraform apply -target=google_dialogflow_fulfillment.saws` after
# this script to make sure the real deployed URL is what's actually live.

param(
    [Parameter(Mandatory = $true)][string]$ProjectId
)

$ErrorActionPreference = "Stop"

$dialogflowDir = $PSScriptRoot
$zipPath = Join-Path $env:TEMP "dialogflow-export-$ProjectId.zip"

if (Test-Path $zipPath) { Remove-Item -LiteralPath $zipPath -Force }

# Built with System.IO.Compression directly (not Compress-Archive) because
# Compress-Archive writes backslash path separators on Windows, which
# Dialogflow's zip parser rejects outright ("No intents or entities found").
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::Open($zipPath, [System.IO.Compression.ZipArchiveMode]::Create)
Get-ChildItem -Path $dialogflowDir -Recurse -File | Where-Object { $_.Extension -eq ".json" } | ForEach-Object {
    $rel = $_.FullName.Substring($dialogflowDir.Length + 1) -replace [regex]::Escape([System.IO.Path]::DirectorySeparatorChar), '/'
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $_.FullName, $rel) | Out-Null
}
$zip.Dispose()
Write-Host "Built $zipPath"

$token = gcloud auth print-access-token
$headers = @{ Authorization = "Bearer $token"; "X-Goog-User-Project" = $ProjectId }

$bytes = [System.IO.File]::ReadAllBytes($zipPath)
$b64 = [Convert]::ToBase64String($bytes)
$body = @{ agentContent = $b64 } | ConvertTo-Json -Compress

Write-Host "Importing agent content into project $ProjectId..."
$importResult = Invoke-RestMethod -Method Post `
    -Uri "https://dialogflow.googleapis.com/v2/projects/$ProjectId/agent:import" `
    -Headers $headers -ContentType "application/json" -Body $body
if (-not $importResult.done) {
    throw "Import did not complete synchronously: $($importResult | ConvertTo-Json -Depth 10)"
}
Write-Host "Import complete."

Write-Host "Enabling webhook on the 5 custom intents..."
$intents = Invoke-RestMethod -Method Get `
    -Uri "https://dialogflow.googleapis.com/v2/projects/$ProjectId/agent/intents" `
    -Headers $headers
$webhookIntents = @("Navigation", "FAQ", "AppointmentLookup", "WellnessInquiry", "SubmitConcern")
foreach ($intent in $intents.intents) {
    if ($webhookIntents -contains $intent.displayName) {
        $patchBody = @{ webhookState = "WEBHOOK_STATE_ENABLED" } | ConvertTo-Json -Compress
        Invoke-RestMethod -Method Patch `
            -Uri "https://dialogflow.googleapis.com/v2/$($intent.name)?updateMask=webhookState" `
            -Headers $headers -ContentType "application/json" -Body $patchBody | Out-Null
        Write-Host "  $($intent.displayName): webhook enabled"
    }
}

Write-Host ""
Write-Host "Done. Now run, from infrastructure/gcp/terraform/:"
Write-Host "  terraform apply -target=google_dialogflow_fulfillment.saws"
Write-Host "to make sure the live webhook URL points at the real deployed function, not agent.json's placeholder."
