# End-to-End Tests

These tests exercise the **real** Journal Bastion stack against **real**
databases — no mocks:

```
client library (service side)  <—ws—>  journal-bastion  <—stdio—>  Toolbox MCP server  <—>  Postgres / MySQL (Docker)
```

They validate the database integration examples under
[`examples/integrations/`](../../examples/integrations) plus the bastion's
config hot-reload.

## What is covered

| Test | What it proves |
|------|----------------|
| `driver.mjs` (postgres) | Bastion starts the Toolbox Postgres MCP server over stdio, publishes `execute_sql` (+28 tools) to the client, read queries return rows, writes are rejected by the read-only role. |
| `driver.mjs` (mysql) | Same, for MySQL (writes rejected with `ERROR 1142 command denied`). |
| `hotreload.mjs` | Adding an MCP server to the config file on disk at runtime republishes tools with no restart, and the new server is immediately callable. |
| `grafana-driver.mjs` | The **automatic** integration path (no config file) resolves `GRAFANA_MCP_URL`/`GRAFANA_MCP_TOKEN` into a `streamable-http` server, publishes its catalog, and returns real data from a read-only tool. Not part of `run-all.sh`: it needs a reachable Grafana MCP server and a real credential. |
| `sql/*-setup.sql` | The exact read-only role recipes from [`examples/integrations/database/README.md`](../../examples/integrations/database/README.md): reads succeed, writes fail. |

The env-var names in `configs/*.json` are the ones the Toolbox prebuilt configs
actually read (`POSTGRES_*`, `MYSQL_*`), so a green run also confirms the docs'
env-var tables are correct.

## Prerequisites

- Docker (Compose v2)
- Node.js >= 22
- Workspace dependencies installed and packages built (the drivers import the
  bastion and client `dist/` output):
  ```bash
  pnpm install
  pnpm -r build
  ```
  `run-all.sh` runs `pnpm -r build` for you; the build step above is only needed
  for the "Run pieces manually" commands below.

## Run everything

```bash
testing/e2e/run-all.sh            # brings up DBs, runs all e2e tests, leaves DBs up
KEEP_UP=0 testing/e2e/run-all.sh  # ...and tears the DBs down at the end
```

## Run pieces manually

```bash
docker compose -f testing/e2e/docker-compose.yml up -d

# Postgres
node testing/e2e/driver.mjs \
  testing/e2e/configs/postgres.json testing/e2e/env/postgres.env postgres \
  "SELECT name, count(*) n FROM reporting.events GROUP BY name ORDER BY name" \
  "INSERT INTO reporting.events (name, amount) VALUES ('hack', 1)" \
  '{"purchase":1,"signup":2}'

# Config hot-reload
node testing/e2e/hotreload.mjs

# Grafana (automatic integration). Start a Grafana MCP server first, e.g.
#   docker run -d --name mcp-grafana -p 8000:8000 \
#     -e GRAFANA_URL=https://<stack>.grafana.net \
#     -e GRAFANA_SERVICE_ACCOUNT_TOKEN=<viewer token> \
#     -e MCP_GRAFANA_SERVER_TOKEN=<caller token> \
#     grafana/mcp-grafana \
#     -t streamable-http --address 0.0.0.0:8000 --allowed-hosts '*' --disable-write
# Credentials come from the environment, never from a file under env/ — those
# are tracked in git.
GRAFANA_MCP_URL=http://127.0.0.1:8000/mcp \
GRAFANA_MCP_TOKEN=<caller token> \
  node testing/e2e/grafana-driver.mjs

docker compose -f testing/e2e/docker-compose.yml down -v
```

## Shipped example scripts

The shipped `examples/hub-server.ts` / `examples/hub_server.py` +
`examples/bastion.json` were also run by hand against this Postgres. To repeat:

```bash
# make the workspace client resolvable to the TS example (mimics `npm install`)
mkdir -p examples/node_modules
ln -sfn ../../hub/typescript examples/node_modules/@journal-labs/bastion

# TS (node 22 strips the types; no tsx needed)
( cd examples && node --experimental-strip-types hub-server.ts ) &
JOURNAL_BASTION_TOKEN=gw_demo node dist/cli/main.js \
  --env-file testing/e2e/env/examples-postgres.env --config examples/bastion.json
```

The `remote-api` entry in `bastion.json` points at a non-existent host on
purpose — it demonstrates the bastion's resilient startup (the failed server is
logged and skipped, the healthy ones still serve).

## Files

```
docker-compose.yml     Postgres (host :5433) + MySQL (host :3307)
sql/postgres-setup.sql Fixture data + read-only role (from the docs)
sql/mysql-setup.sql    Fixture data + read-only user (from the docs)
configs/*.json         Bastion configs (Toolbox stdio) for each DB
env/*.env              Host env vars the bastion maps into the MCP subprocess
driver.mjs             DB integration driver (asserts read ok / write rejected)
hotreload.mjs          Config hot-reload driver
run-all.sh             One-shot runner
```
