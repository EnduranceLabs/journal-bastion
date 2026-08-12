# Contributing

## Development

Prerequisites: Node.js 22+, pnpm, Python 3.11+ (for Python client).

```bash
# Install dependencies
pnpm install

# Build protocol and bastion
pnpm build

# Build TypeScript client

# Type check protocol, bastion, and TypeScript client
pnpm typecheck

# Check lockfile policy
pnpm check:lockfiles

# Run bastion tests
pnpm test

# Run TypeScript client tests

# Run TypeScript integration tests
pnpm test:integration

# Run Python client tests (creates the venv on first run; set PYTHON=/path/to/python3.11 if needed)
pnpm test:python

# Run every root-script suite above
pnpm test:all

# Run Docker database end-to-end tests (requires Docker; not part of pnpm test:all)
testing/e2e/run-all.sh
```

If your default `python3` is older than 3.11, prefix Python-dependent commands
with `PYTHON=/path/to/python3.11`, for example
`PYTHON=/opt/homebrew/bin/python3.12 pnpm test:all`.

## Lockfile Policy

This repo uses one pnpm workspace lockfile: `pnpm-lock.yaml` at the repository
root. Do not commit package-local pnpm lockfiles such as
`bastion/pnpm-lock.yaml`; workspace installs, Docker builds, version bumps, and
publish scripts all use the root lockfile.

## Architecture

The bastion connects outbound to the Journal service over WebSocket. It manages
MCP server connections (`stdio`, `sse`, or `streamable-http`) and skill files,
routing tool calls from the service to the appropriate MCP server.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the module-by-module structure.

## Client Libraries

Agents that want to accept bastion connections and call tools through them can use the client libraries. They implement the **service side** of the protocol: run a WebSocket server, authenticate bastions, pull tools and skills, and provide a `callTool()` API.

The examples below print from application callbacks. The client libraries
themselves must not write to stdout/stderr; diagnostics are surfaced through
callbacks such as `onSocketError` / `on_socket_error`.

```
+-------------+        +------------------+        +-----------+
|   Bastion   |--wss-->|  Client Library   |<--API--|   Agent   |
| (this repo) |        |  (TS or Python)   |        |           |
+-------------+        +------------------+        +-----------+
```

### TypeScript (`@journal/journal-bastion`)

```typescript
import { BastionServer } from "@journal/journal-bastion/hub";

const server = new BastionServer({
  port: 8080,
  validateToken: async (token) =>
    token === "gw_expected" ? { organizationId: "org_1" } : null,
});

await server.start();

// Once a bastion connects and its initial catalog is pulled:
const result = await server.callTool("postgresql", "execute_sql", { sql: "SELECT 1" });
console.log(result.content);

await server.stop();
```

### Python (`@journal/journal-bastion`)

```python
from journal_bastion_hub import BastionServer, TokenValidationResult

async def validate(token):
    if token == "gw_expected":
        return TokenValidationResult(organization_id="org_1")
    return None

server = BastionServer(validate_token=validate, port=8080)
await server.start()

# Once a bastion connects and its initial catalog is pulled:
result = await server.call_tool("postgresql", "execute_sql", {"sql": "SELECT 1"})
print(result.content)

await server.stop()
```

## Protocol

The bastion communicates with Journal over WebSocket using a simple JSON protocol. See [spec/protocol.md](./spec/protocol.md) for the full specification.

## Telemetry and audit

- Telemetry bootstrapper: `src/cli/telemetry.ts` (minimal OTLP/HTTP exporters for traces and metrics; defaults to `service.name=journal-bastion`; no OTEL logs).
- Audit logger: `src/cli/audit.ts`, records metadata only (no arguments, results, or secrets). Events include tool call start/result/error, outbound message metadata, config/env reloads, and MCP process lifecycle.
- Instrumentation hooks live in `src/cli/connection.ts` (tool call spans/metrics + audit) and `src/cli/runtime.ts` (config/env apply events, MCP start/stop). Keep additions metadata-only; use ids/hashes instead of payloads.
- Env toggles: `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_SERVICE_NAME`, `TELEMETRY_DISABLED`, `AUDIT_LOG_FILE`, `AUDIT_MAX_BYTES`, `AUDIT_MAX_FILES`.

## Packaging

One publishable package, `@journal/journal-bastion`, carrying the CLI (`.`), the hub
library (`./hub`) and the wire schemas (`./protocol`) as subpath exports. Set the version
with `packaging/bump-version.sh` — never edit it by hand. See
[packaging/npm/README.md](./packaging/npm/README.md) for the release runbook.

```bash
# Bump every package to the same version
./packaging/bump-version.sh 0.8.0

# Build the Docker image locally
docker build -f packaging/docker/Dockerfile -t journal-bastion .
```

## Pre-PR checklist

- Run `pnpm build`, `pnpm build`, and `pnpm typecheck` before opening a PR or publishing. Use `pnpm -r build` when you need every TypeScript workspace package built.
- Run `pnpm check:lockfiles` before opening a PR.
