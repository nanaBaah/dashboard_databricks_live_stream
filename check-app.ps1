#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Show the current status of the telemetry-dashboard-appkit Databricks App.

.EXAMPLE
    .\check-app.ps1
#>

$ErrorActionPreference = "Stop"

$APP_NAME = "telemetry-dashboard-appkit"


# ─────────────────────────────────────────────────────────────────────────────
# Fetch all app info in one call and parse it from JSON into an object.
# ─────────────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "Checking: $APP_NAME" -ForegroundColor Cyan

$app = databricks apps get $APP_NAME --output=JSON | ConvertFrom-Json

if ($LASTEXITCODE -ne 0) {
    Write-Host "Could not reach the app. Is the Databricks CLI authenticated?" -ForegroundColor Red
    exit 1
}


# ─────────────────────────────────────────────────────────────────────────────
# App status — is the app process running and accepting requests?
# Compute status — is the underlying VM switched on?
# ─────────────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "App:       $($app.app_status.state)"       # RUNNING or UNAVAILABLE
Write-Host "           $($app.app_status.message)"
Write-Host "Compute:   $($app.compute_status.state)"   # ACTIVE or STOPPED
Write-Host "URL:       $($app.url)"
Write-Host "Principal: $($app.service_principal_name) ($($app.service_principal_client_id))"


# ─────────────────────────────────────────────────────────────────────────────
# Active deployment — which version of the code is the app currently running?
# SUCCEEDED means the app started cleanly from that upload.
# ─────────────────────────────────────────────────────────────────────────────
Write-Host ""

$active = $app.active_deployment

if ($active) {
    if ($active.status.state -eq "SUCCEEDED") {
        Write-Host "Active deployment:" -ForegroundColor Green
    } else {
        Write-Host "Active deployment:" -ForegroundColor Red
    }

    Write-Host "  Status:   $($active.status.state) — $($active.status.message)"
    Write-Host "  ID:       $($active.deployment_id)"
    Write-Host "  Deployed: $($active.update_time)"
    Write-Host "  Source:   $($active.source_code_path)"   # workspace folder that was synced

    if ($active.deployment_artifacts.source_code_path) {
        Write-Host "  Snapshot: $($active.deployment_artifacts.source_code_path)"   # immutable copy the app actually runs from
    }
} else {
    Write-Host "Active deployment: none — run deploy-dev.ps1 to deploy." -ForegroundColor Yellow
}


# ─────────────────────────────────────────────────────────────────────────────
# Deployment history — every deploy attempt, newest first.
# Green = ok, Red = failed, Yellow = still in progress or cancelled.
# ─────────────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "Deployment history:" -ForegroundColor Cyan

$history = databricks apps list-deployments $APP_NAME --output=JSON | ConvertFrom-Json

if ($LASTEXITCODE -ne 0 -or -not $history) {
    Write-Host "  (no history available)" -ForegroundColor DarkGray
} else {
    foreach ($item in $history) {
        if ($item.status.state -eq "SUCCEEDED") {
            $color = "Green"
        } elseif ($item.status.state -eq "FAILED") {
            $color = "Red"
        } else {
            $color = "Yellow"
        }

        Write-Host ("  [{0,-10}] {1}  {2}" -f $item.status.state, $item.update_time, $item.deployment_id) -ForegroundColor $color
    }
}

Write-Host ""
