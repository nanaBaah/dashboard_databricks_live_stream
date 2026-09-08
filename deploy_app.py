from databricks.sdk import WorkspaceClient
from databricks.sdk.service.apps import AppDeployment

w = WorkspaceClient(host='https://adb-2708830887471364.4.azuredatabricks.net')
print('Deploying...')
dep = w.apps.deploy_and_wait(
    app_name='telemetry-dashboard-appkit',
    app_deployment=AppDeployment(
        source_code_path='/Workspace/hysbap_live/telemetry-dashboard-appkit-source',
    )
)
print('State:', dep.status.state)
print('Message:', dep.status.message)
print('ID:', dep.deployment_id)

# Check final app status
app = w.apps.get('telemetry-dashboard-appkit')
print('App status:', app.app_status)



"""

import psycopg, databricks.sdk

sp = "4db66b1f-9a1b-422d-be16-c0ae9ce0f38f"

w = databricks.sdk.WorkspaceClient()

cred = w.database.generate_database_credential(
    endpoint="projects/hydro-telemetry-live-test/branches/production/endpoints/primary")

with psycopg.connect(
    host="ep-wild-shadow-e22jar0rp.database.westeurope.azuredatabricks.net",
    dbname="databricks_postgres", user=w.config.host.split("//")[1].rstrip("/"),
    password=cred.token, sslmode="require"
) as conn:
    conn.execute(f'GRANT USAGE ON SCHEMA public TO "{sp}"')
    conn.execute(f'GRANT SELECT ON TABLE public.trades_latest TO "{sp}"')
    conn.commit()


print("Done")

"""
