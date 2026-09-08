#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Build, upload, and deploy the Telemetry Dashboard app to hysbox.

.EXAMPLE
    # Full cycle (change code, then run this):
    .\deploy-dev.ps1

    # Already built — skip the build step:
    .\deploy-dev.ps1 -SkipBuild

    # databricks sync --watch is running elsewhere — skip sync too:
    .\deploy-dev.ps1 -SkipBuild -SkipSync

    # Force a full re-upload (when files seem out of sync):
    .\deploy-dev.ps1 -Full
#>
param(
    [switch]$SkipBuild,
    [switch]$SkipSync,
    [switch]$Full
)

$ErrorActionPreference = "Stop"

# Which app to deploy and where its source lives in the workspace.
$APP_NAME   = "telemetry-dashboard-appkit"
$APP_SOURCE = "/Workspace/hysbap_live/telemetry-dashboard-appkit-source"

# The app folder on disk (wherever this script lives).
$APP_DIR  = Split-Path -Parent $MyInvocation.MyCommand.Path

# The repo root — three levels up from the app folder.
$REPO_DIR = Resolve-Path (Join-Path $APP_DIR "..\..\..")


# ─────────────────────────────────────────────────────────────────────────────
# STEP 1: BUILD
# Compiles the React UI (src/client) and the Node server (src/server) into
# ready-to-run bundles (client_bundle/ and server_bundle/).
# The Databricks platform runs these bundles directly — it does NOT rebuild.
# Skip this step if you haven't changed any source files since the last build.
# ─────────────────────────────────────────────────────────────────────────────
if ($SkipBuild) {
    Write-Host ""
    Write-Host "Step 1/3: Build — SKIPPED" -ForegroundColor DarkGray
} else {
    Write-Host ""
    Write-Host "Step 1/3: Build" -ForegroundColor Cyan

    Set-Location $APP_DIR
    npm.cmd run build:app

    if ($LASTEXITCODE -ne 0) {
        Write-Host "Build failed. Fix the errors above and try again." -ForegroundColor Red
        exit 1
    }

    Set-Location $REPO_DIR
}


# ─────────────────────────────────────────────────────────────────────────────
# STEP 2: SYNC
# Uploads the app folder to the Databricks workspace.
# Only changed files are sent by default (incremental).
# Use -Full to re-upload everything if something looks out of sync.
# We exclude node_modules and other local-only folders to keep the upload small.
# ─────────────────────────────────────────────────────────────────────────────
if ($SkipSync) {
    Write-Host ""
    Write-Host "Step 2/3: Sync — SKIPPED" -ForegroundColor DarkGray
} else {
    Write-Host ""
    Write-Host "Step 2/3: Sync source to workspace" -ForegroundColor Cyan

    Set-Location $REPO_DIR

    if ($Full) {
        databricks sync apps/databricks_apps/telemetry_dashboard_appkit $APP_SOURCE --full `
            --exclude "node_modules/**" `
            --exclude ".databricks/**" `
            --exclude "dist/**" `
            --exclude "build/**" `
            --exclude "*.log" `
            --exclude ".env" `
            --exclude ".env.local" `
            --exclude ".appkit/**"
    } else {
        databricks sync apps/databricks_apps/telemetry_dashboard_appkit $APP_SOURCE `
            --exclude "node_modules/**" `
            --exclude ".databricks/**" `
            --exclude "dist/**" `
            --exclude "build/**" `
            --exclude "*.log" `
            --exclude ".env" `
            --exclude ".env.local" `
            --exclude ".appkit/**"
    }

    if ($LASTEXITCODE -ne 0) {
        Write-Host "Sync failed. Fix the errors above and try again." -ForegroundColor Red
        exit 1
    }
}


# ─────────────────────────────────────────────────────────────────────────────
# STEP 3: DEPLOY
# Tells the running app to load the new source and restart.
# Without this step the browser keeps serving the old version.
# ─────────────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "Step 3/3: Deploy" -ForegroundColor Cyan

databricks apps deploy $APP_NAME --source-code-path $APP_SOURCE

if ($LASTEXITCODE -ne 0) {
    Write-Host "Deploy failed. Fix the errors above and try again." -ForegroundColor Red
    exit 1
}


# ─────────────────────────────────────────────────────────────────────────────
# DONE — print the final state so you can see whether it worked
# ─────────────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "Done!" -ForegroundColor Green

$result = databricks apps get $APP_NAME --output=JSON | ConvertFrom-Json

Write-Host "App:     $($result.app_status.state)"
Write-Host "Compute: $($result.compute_status.state)"
Write-Host "Deploy:  $($result.active_deployment.status.state) — $($result.active_deployment.deployment_id)"
Write-Host ""
Write-Host "URL: $($result.url)" -ForegroundColor Green
