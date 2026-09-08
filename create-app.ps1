#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Print all setup commands for the telemetry-dashboard-appkit app.

.DESCRIPTION
    Prints the exact databricks CLI commands needed to create the app, attach
    the Lakebase resource, and apply all grants.  Copy and run them one by one.

    If the app already exists the script fetches its service principal ID and
    substitutes it into the grant commands so they are ready to paste.

.EXAMPLE
    .\create-app.ps1
#>

$APP_NAME          = "telemetry-dashboard-appkit"
$APP_DESCRIPTION   = "Real-time intraday public trades dashboard (AppKit)."
$APP_SOURCE        = "/Workspace/hysbap_live/telemetry-dashboard-appkit-source"
$WAREHOUSE_ID      = "2027c055b4ffee7c"
$LAKEBASE_PROJECT  = "hydro-telemetry-live-test"
$LAKEBASE_BRANCH     = "projects/hydro-telemetry-live-test/branches/production"
$LAKEBASE_DATABASE   = "projects/hydro-telemetry-live-test/branches/production/databases/databricks-postgres"
$LOGS_TABLE        = "dev_hysbox.telemetry.otel_logs"
$METRICS_TABLE     = "dev_hysbox.telemetry.otel_metrics"
$TRACES_TABLE      = "dev_hysbox.telemetry.otel_spans"

# Try to resolve the SP ID from an existing app so grant commands are pre-filled.
$sp = "<SP_CLIENT_ID>"
$appJson = databricks apps get $APP_NAME --output=JSON 2>$null
if ($LASTEXITCODE -eq 0 -and $appJson) {
    $resolved = ($appJson | ConvertFrom-Json).service_principal_client_id
    if ($resolved) { $sp = $resolved }
}

$SEP  = ""
$SEP2 = "# " + ("─" * 75)

Write-Host ""
Write-Host $SEP2 -ForegroundColor DarkGray
Write-Host "# STEP 1a — Create app (first time only)" -ForegroundColor Cyan
Write-Host $SEP2 -ForegroundColor DarkGray
Write-Host ""
Write-Host @"
databricks apps create --json '{
  "name": "$APP_NAME",
  "description": "$APP_DESCRIPTION",
  "default_source_code_path": "$APP_SOURCE",
  "resources": [
    { "name": "sql-warehouse", "sql_warehouse": { "id": "$WAREHOUSE_ID", "permission": "CAN_USE" } },
    { "name": "postgres", "postgres": { "branch": "$LAKEBASE_BRANCH", "database": "$LAKEBASE_DATABASE", "permission": "CAN_CONNECT_AND_CREATE" } }
  ],
  "telemetry_export_destinations": [
    { "unity_catalog": { "logs_table": "$LOGS_TABLE", "metrics_table": "$METRICS_TABLE", "traces_table": "$TRACES_TABLE" } }
  ]
}'
"@

Write-Host ""
Write-Host $SEP2 -ForegroundColor DarkGray
Write-Host "# STEP 1b — App already exists: add the postgres resource" -ForegroundColor Cyan
Write-Host $SEP2 -ForegroundColor DarkGray
Write-Host ""
Write-Host @"
databricks apps update $APP_NAME --json '{
  "resources": [
    { "name": "sql-warehouse", "sql_warehouse": { "id": "$WAREHOUSE_ID", "permission": "CAN_USE" } },
    { "name": "postgres", "postgres": { "project": "$LAKEBASE_PROJECT", "database": "$LAKEBASE_DATABASE" } }
  ]
}'
"@

Write-Host ""
Write-Host $SEP2 -ForegroundColor DarkGray
Write-Host "# STEP 2 — Wait ~2 min, then confirm compute is ACTIVE" -ForegroundColor Cyan
Write-Host $SEP2 -ForegroundColor DarkGray
Write-Host ""
Write-Host "databricks apps get $APP_NAME --output=JSON"

Write-Host ""
Write-Host $SEP2 -ForegroundColor DarkGray
Write-Host "# STEP 3 — Get the service principal ID (run after app is created)" -ForegroundColor Cyan
Write-Host $SEP2 -ForegroundColor DarkGray
Write-Host ""
Write-Host "databricks apps get $APP_NAME --output=JSON | python -c `"import sys,json; print(json.load(sys.stdin)['service_principal_client_id'])`""

if ($sp -ne "<SP_CLIENT_ID>") {
    Write-Host ""
    Write-Host "  → SP already resolved: $sp" -ForegroundColor Green
}

Write-Host ""
Write-Host $SEP2 -ForegroundColor DarkGray
Write-Host "# STEP 4 — Unity Catalog grants  (replace $sp if needed)" -ForegroundColor Cyan
Write-Host $SEP2 -ForegroundColor DarkGray
Write-Host ""
Write-Host "databricks grants update catalog dev_hysbox --json '{""changes"":[{""principal"":""$sp"",""add"":[""USE_CATALOG""]}]}'"
Write-Host "databricks grants update schema  dev_hysbox.telemetry --json '{""changes"":[{""principal"":""$sp"",""add"":[""USE_SCHEMA""]}]}'"
Write-Host "databricks grants update table   dev_hysbox.telemetry.kr_intraday_public_trades_live_test --json '{""changes"":[{""principal"":""$sp"",""add"":[""SELECT""]}]}'"

Write-Host ""
Write-Host $SEP2 -ForegroundColor DarkGray
Write-Host "# STEP 5 — Lakebase Postgres role + grants  (requires psql)" -ForegroundColor Cyan
Write-Host "#          winget install PostgreSQL.psql  (if not installed)" -ForegroundColor DarkGray
Write-Host "#          The Apps 'database' resource only works with Provisioned Lakebase." -ForegroundColor DarkGray
Write-Host "#          For Autoscaling projects, create the SP role and grant access manually." -ForegroundColor DarkGray
Write-Host $SEP2 -ForegroundColor DarkGray
Write-Host ""
Write-Host "# 5a — create a Postgres role for the service principal:"
Write-Host "databricks postgres create-role projects/$LAKEBASE_PROJECT/branches/production --json '{""spec"":{""identity_type"":""SERVICE_PRINCIPAL"",""postgres_role"":""$sp""}}'"
Write-Host ""
Write-Host "# 5b — grant access to trades_latest:"
Write-Host "databricks psql --project $LAKEBASE_PROJECT --branch production -- -c `"GRANT USAGE ON SCHEMA public TO \`"$sp\`";`" -c `"GRANT SELECT ON TABLE public.trades_latest TO \`"$sp\`";`""

Write-Host ""
Write-Host $SEP2 -ForegroundColor DarkGray
Write-Host "# STEP 6 — Deploy source code" -ForegroundColor Cyan
Write-Host $SEP2 -ForegroundColor DarkGray
Write-Host ""
Write-Host "cd apps/databricks_apps/telemetry_dashboard_appkit"
Write-Host "./deploy-dev.ps1"
Write-Host ""
