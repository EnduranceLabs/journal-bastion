# Journal Bastion

Connect your data sources to [Journal](https://journal.one). The bastion runs
inside your network and connects outbound to Journal. Credentials stay in your
infrastructure, and no inbound ports are required.

## How It Works

```
+-------------------------------------+
|           Your Network              |
|                                     |
|  +--------------+  +-------------+  |
|  | Data sources |<-+   Bastion   |  |
|  +--------------+  +------+------+  |
|                           |         |
+---------------------------+---------+
                            | secure outbound
                     +------v------+
                     |   Journal   |
                     +-------------+
```

## Quick Start

### npm

```bash
npm install -g @journal-labs/bastion

JOURNAL_BASTION_TOKEN=gw_your_token journal-bastion --config bastion.json
```

### Docker

The Docker image automatically enables supported integrations when their
complete environment-variable set is present. No config file or inbound port is
needed for the built-in integrations:

```bash
docker run --rm \
  --env-file /etc/journal/bastion.env \
  ghcr.io/endurancelabs/journal-bastion:latest
```

```dotenv
JOURNAL_BASTION_TOKEN=gw_your_token

# Datadog API/application-key mode
DD_SITE=datadoghq.com
DD_API_KEY=...
DD_APP_KEY=...

# PostHog hosted MCP
POSTHOG_PERSONAL_API_KEY=phx_...
POSTHOG_PROJECT_ID=12345

# MongoDB official MCP server
MDB_MCP_CONNECTION_STRING=mongodb+srv://readonly-user:...@cluster.example.net/app

# Temporal Cloud (API key or PEM-encoded mTLS client certificate and key)
# TEMPORAL_API_KEY=...
TEMPORAL_TLS_CERT_DATA="-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----"
TEMPORAL_TLS_KEY_DATA="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
TEMPORAL_NAMESPACE=your-namespace.a1b2c
TEMPORAL_ADDRESS=your-namespace.a1b2c.tmprl.cloud:7233
```

Alternatively, set `DATADOG_ACCESS_TOKEN` to use a Datadog personal or service
access token. The image adds the `Bearer` prefix internally. The image defaults
to Datadog's `core` toolset; set `DATADOG_MCP_TOOLSETS` or
`DATADOG_MCP_OMIT_TOOLS` to narrow the catalog. Use a dedicated Datadog identity
with `mcp_read` and only the underlying product read permissions.

PostHog uses its hosted MCP endpoint in project-pinned, read-only CLI mode. Use
a personal API key created with PostHog's `MCP Server` preset; project ingestion
keys beginning with `phc_` are rejected.

The image includes the official `mongodb-mcp-server` at version `2.1.0` and
runs it locally over stdio. Automatic mode forces its read-only mode, disables
telemetry and Atlas administration, and removes connect, disconnect, and export
tools. This tool filter is not the database security boundary: use a dedicated
MongoDB user whose database roles allow reads only from the intended databases
and collections.

The image also includes Temporal CLI `1.8.2`, `tcld` `0.55.0`, and a curated
edition of Temporal's operations skill. The Temporal integration is permanently
read-only: it exposes only a fixed inspection manifest, fixes every data-plane
request to `TEMPORAL_NAMESPACE` and its exact matching endpoint, and accepts no
caller-selected credentials, target, profile, or config file. Authenticate with
either a dedicated Namespace-scoped Temporal Cloud Service Account API key or a
PEM-encoded mTLS client certificate/private-key pair supplied through environment
variables. API-key mode also exposes the
allowlisted `tcld` Cloud control-plane reads; mTLS mode exposes only Namespace
data-plane reads supported by `temporal`. Allow outbound TCP access to the
Namespace endpoint on port `7233` and, for API-key control-plane reads, Temporal
Cloud APIs on port `443`.

For mTLS in an orchestrator such as AWS ECS, inject both PEM values directly
from the secrets manager into the container environment. For a local Docker
run, the shell can read existing files into those environment variables:

```bash
TEMPORAL_TLS_CERT_DATA="$(< /etc/temporal/client.pem)" \
TEMPORAL_TLS_KEY_DATA="$(< /etc/temporal/client.key)" \
docker run --rm \
  -e TEMPORAL_TLS_CERT_DATA \
  -e TEMPORAL_TLS_KEY_DATA \
  -e TEMPORAL_NAMESPACE \
  -e TEMPORAL_ADDRESS \
  -e JOURNAL_BASTION_TOKEN \
  ghcr.io/endurancelabs/journal-bastion:latest
```

An integration is disabled when none of its recognized variables are present.
A complete set enables it. A partial set exits before connecting and names the
missing variables without printing values. Explicit `--config` or
`JOURNAL_BASTION_CONFIG` is a full replacement and disables automatic discovery.

The npm CLI does not enable automatic discovery unless
`JOURNAL_BASTION_AUTO_INTEGRATIONS=true` is set explicitly.

### Docker with explicit config

To validate the Docker image locally, create a `.env` file next to
`bastion.json` that contains `JOURNAL_BASTION_TOKEN=gw_your_token`, then run:

```bash
docker run --rm \
  -v "$(pwd)/bastion.json:/etc/journal/bastion.json:ro" \
  --env-file .env \
  ghcr.io/endurancelabs/journal-bastion:latest --config /etc/journal/bastion.json
```

For a long-lived container, mount a persistent config file and env file:

```bash
docker run -d --name journal-bastion --restart unless-stopped \
  -v /etc/journal/bastion.json:/etc/journal/bastion.json:ro \
  --env-file /etc/journal/bastion.env \
  ghcr.io/endurancelabs/journal-bastion:latest --config /etc/journal/bastion.json
```

The image `ENTRYPOINT` is the bastion binary. Pass bastion flags such as
`--config`, `--env-file`, and `--version` after the image name. Provide secrets
with `--env-file` or `-e`; tokens and integration credentials should not be
included in the image. Config hot-reload over a bind mount is reliable on Linux
hosts. On Docker Desktop for macOS or Windows, restart the container after
editing the config file.

### Example config file (`bastion.json`)

```json
{
  "mcpServers": [
    {
      "id": "postgresql",
      "command": "npx",
      "args": ["-y", "@toolbox-sdk/server", "--prebuilt", "postgres", "--stdio"],
      "name": "PostgreSQL",
      "description": "Query a PostgreSQL database",
      "envVars": {
        "POSTGRES_HOST": "POSTGRES_HOST",
        "POSTGRES_PORT": "POSTGRES_PORT",
        "POSTGRES_DATABASE": "POSTGRES_DATABASE",
        "POSTGRES_USER": "POSTGRES_USER",
        "POSTGRES_PASSWORD": "POSTGRES_PASSWORD"
      }
    },
    {
      "id": "remote-api",
      "transport": "streamable-http",
      "url": "https://mcp.example.com/mcp",
      "name": "Remote API",
      "description": "Remote MCP server",
      "headers": { "Authorization": "REMOTE_MCP_AUTHORIZATION" }
    }
  ],
  "skillsDir": "/opt/journal/skills"
}
```

MCP server packages in examples are external runtime commands. They are resolved
by `npx` when the bastion starts and are not bundled with, or installed by,
`journal-bastion`.

Set every host environment variable referenced by an `envVars` key or a
`headers` value before starting the bastion. For the config above, that means
`POSTGRES_*` and `REMOTE_MCP_AUTHORIZATION` in addition to
`JOURNAL_BASTION_TOKEN`.

Runnable examples (this config plus minimal TS and Python client servers) live in
[`examples/`](./examples). Database and enterprise integration examples live in
[`examples/integrations/`](./examples/integrations). Add a `"$schema"` field pointing at
[`spec/bastion-config.schema.json`](./spec/bastion-config.schema.json) for editor
autocomplete and validation:

```json
{
  "$schema": "https://raw.githubusercontent.com/EnduranceLabs/journal-bastion/main/spec/bastion-config.schema.json",
  "mcpServers": []
}
```

Run `journal-bastion --help` for the full list of flags and environment variables.

## Configuration

### Environment variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `JOURNAL_BASTION_TOKEN` | yes | — | Auth token from Journal (starts with `gw_`) |
| `JOURNAL_BASTION_URL` | no | `wss://bastion.journal.one` | Journal endpoint. Set this only to reach a different service; an explicit path is sent as given. |
| `JOURNAL_BASTION_CONFIG` | no | — | Path to config file, or inline JSON (detected by leading `{`) |
| `JOURNAL_BASTION_ENV_FILE` | no | — | Path to `.env` file (auto-detects `.env` in cwd if not set) |
| `JOURNAL_BASTION_AUTO_INTEGRATIONS` | no | `false` in npm, `true` in the Docker image | Generate built-in integrations from environment variables when no explicit config is supplied |
| `LOG_LEVEL` | no | `info` | Log level: `debug`, `info`, `warn`, `error` |

#### Automatic Datadog integration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATADOG_ACCESS_TOKEN` | alternative A | — | Personal or service access token; mutually exclusive with the key pair |
| `DATADOG_API_KEY` / `DD_API_KEY` | alternative B | — | Datadog API key; requires an application key |
| `DATADOG_APP_KEY` / `DD_APP_KEY` / `DD_APPLICATION_KEY` | alternative B | — | Datadog application key |
| `DATADOG_SITE` / `DD_SITE` | no | `datadoghq.com` | Datadog site used to select the regional MCP endpoint |
| `DATADOG_MCP_TOOLSETS` | no | `core` | Comma-separated Datadog MCP toolsets |
| `DATADOG_MCP_OMIT_TOOLS` | no | — | Comma-separated tool names removed from the selected toolsets |
| `DATADOG_MCP_URL` | no | regional endpoint | Advanced HTTPS endpoint override |

#### Automatic PostHog integration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `POSTHOG_PERSONAL_API_KEY` | yes | — | Personal API key created with PostHog's `MCP Server` preset |
| `POSTHOG_PROJECT_ID` | yes | — | Project id used to pin the MCP session and remove project switching |
| `POSTHOG_FEATURES` | no | — | Comma-separated PostHog feature categories exposed through CLI mode |
| `POSTHOG_TOOLS` | no | — | Comma-separated exact tool names, unioned with `POSTHOG_FEATURES` |
| `POSTHOG_MCP_URL` | no | `https://mcp.posthog.com/mcp` | Advanced HTTPS endpoint override; `mode=cli` and `readonly=true` are enforced |

#### Automatic MongoDB integration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `MDB_MCP_CONNECTION_STRING` | yes | — | MongoDB or MongoDB SRV URL for a database-enforced read-only user |

MongoDB automatic mode is available in the Docker image, which contains the
official server executable. npm CLI users can still use MongoDB through explicit
configuration when `mongodb-mcp-server` is installed separately.

#### Automatic Temporal Cloud integration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `TEMPORAL_API_KEY` | alternative A | — | API key for a dedicated read-only Temporal Cloud Service Account |
| `TEMPORAL_TLS_CERT_DATA` | alternative B | — | PEM-encoded mTLS client certificate supplied directly in the environment; requires `TEMPORAL_TLS_KEY_DATA` |
| `TEMPORAL_TLS_KEY_DATA` | alternative B | — | PEM-encoded mTLS private key supplied directly in the environment; requires `TEMPORAL_TLS_CERT_DATA` |
| `TEMPORAL_NAMESPACE` | yes | — | Full Namespace ID in `<namespace>.<account_id>` form |
| `TEMPORAL_ADDRESS` | yes | — | Exact matching `<namespace>.<account_id>.tmprl.cloud:7233` gRPC endpoint |

Temporal automatic mode is supported by the Docker image. It exposes only the
`inspect` and `read_reference` MCP tools and bundles the `temporal-ops` skill.
The command target and credential are injected by the integration and cannot be
overridden through tool arguments. Set exactly one authentication method. mTLS
mode advertises only data-plane operations because Temporal Cloud's `tcld`
control-plane API requires API-key authentication.

### Config file

The config file describes what the bastion offers. Point to it with either:

1. **`--config /path/to/bastion.json`** — CLI argument (highest precedence)
2. **`JOURNAL_BASTION_CONFIG`** — env var containing a file path or inline JSON

Both `mcpServers` and `skillsDir` are optional. An empty `{}` is valid; the
bastion will connect without exposing tools or skills.

Use `--env-file /path/to/.env` to load environment variables from a `.env`
file. If neither `--env-file` nor `JOURNAL_BASTION_ENV_FILE` is set, the
bastion auto-detects a `.env` file in the current directory. Values from `.env`
are used only when the variable is not already set in the process environment.

#### Config file schema

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `mcpServers` | array | `[]` | MCP server definitions (see below) |
| `skillsDir` | `string \| null` | `null` | Path to directory containing skill Markdown files |

#### MCP servers

[MCP (Model Context Protocol)](https://modelcontextprotocol.io/) is a standard for connecting AI agents to external tools. The bastion connects to MCP servers via three transports, making their tools available to Journal.

Each entry in `mcpServers` has a `transport` field that determines the connection type. Configs without a `transport` field that have a `command` are treated as `stdio` for backward compatibility.

**Common fields (all transports):**

| Field | Required | Description |
|-------|----------|-------------|
| `id` | yes | Unique name for this server |
| `transport` | no | `"stdio"` (default), `"sse"`, or `"streamable-http"` |
| `name` | no | Display name (defaults to `id`) |
| `description` | no | Server description |

**`stdio` — local subprocess (default):**

| Field | Required | Description |
|-------|----------|-------------|
| `command` | yes | Command to run (e.g. `npx`, `python`) |
| `args` | no | Command-line arguments |
| `envVars` | no | Map of `{ hostEnvVar: subprocessEnvVar }` resolved before starting the subprocess |

**`sse` — SSE client (legacy remote servers):**

| Field | Required | Description |
|-------|----------|-------------|
| `url` | yes | SSE endpoint URL |
| `headers` | no | Map of `{ headerName: hostEnvVar }` — values resolved from host environment |

**`streamable-http` — Streamable HTTP client (recommended for remote servers):**

| Field | Required | Description |
|-------|----------|-------------|
| `url` | yes | HTTP endpoint URL |
| `headers` | no | Map of `{ headerName: hostEnvVar }` — values resolved from host environment |

#### Skills

Skills are instructions that teach Journal how to perform specific tasks in your environment. Place Markdown files in a directory and set `skillsDir` in the config file. Each `.md` file becomes a skill — the filename is used as the skill name.

## Protocol

The bastion communicates with Journal over a WebSocket using a simple JSON protocol (version 2). The full specification is in [spec/protocol.md](./spec/protocol.md); this section covers the key ideas.

### Connection flow

The bastion connects **outbound** to the Journal service — no inbound ports are needed. After authenticating with a token, it sends a **`version_changed`** message announcing its current version hashes. The connection is then ready — no registration handshake needed. The service decides when to fetch tools and skills by sending pull requests (`get_tools`, `get_skills`).

### Change detection

Tools and skills can change while the bastion is running. An MCP server might restart with different tools, or a skill file might be added to disk. The bastion detects these changes automatically and sends a lightweight **`version_changed`** message with updated version hashes. The service can then pull the specific data it needs.

The bastion also watches the config file and `.env` file for changes. When you add, remove, or modify an MCP server in the config file, the bastion automatically starts, stops, or restarts the affected servers — no bastion restart required. Similarly, when an environment variable in the `.env` file changes, any MCP servers that depend on it are automatically restarted. Note that `skillsDir` changes are not hot-reloaded and require a bastion restart.

Version hashes (`mcpVersion` and `skillsVersion`) are content-based (SHA-256,
16 hex chars). The same content produces the same hash across restarts, so the
service can distinguish real catalog changes from bastion restarts.

An MCP server that fails to start, for example because of an invalid command or
unreachable URL, is logged and skipped. The bastion still connects and serves
healthy servers and skills, so one misconfigured server does not make the
bastion unavailable.

### What clients should do

Services using the client libraries (TypeScript or Python) receive `onBastionConnected` after the initial pull completes (integrations are already populated). When the bastion sends `version_changed`, the client auto-pulls what changed and fires `onBastionUpdated`.

Services can also explicitly pull at any time using `getVersions()`, `getTools()`, or `getSkills()` on a specific bastion. Both client libraries expose the same optional hooks for observability: `getTraceContext` / `get_trace_context` propagates a W3C trace context onto each tool call, and `onSocketError` / `on_socket_error` surfaces socket-level and unexpected connection-handler failures (the libraries never write to the console themselves).

## Telemetry & Audit

The bastion can emit OpenTelemetry traces and metrics to a customer-controlled OTLP/HTTP endpoint. It also records audit metadata for transparency: tool calls (integration, tool, request id, outcome, duration), outbound messages to Journal (message type and request id), config/env reloads, and MCP process start/stop. No secrets, tool arguments, or payload bodies are recorded.

### Enabling telemetry

Telemetry is off unless an OTLP endpoint is provided.

| Variable | Default | Description |
|----------|---------|-------------|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | — | OTLP/HTTP endpoint (e.g., `https://otel.example.com`) to enable traces/metrics |
| `OTEL_SERVICE_NAME` | `journal-bastion` | Service name reported in telemetry |
| `TELEMETRY_DISABLED` | `false` | Set to `true` to force-disable telemetry |
| `AUDIT_LOG_FILE` | — | Path to a local JSONL audit file (metadata only) |
| `AUDIT_MAX_BYTES` | — | Rotate audit file when it exceeds this size (bytes) |
| `AUDIT_MAX_FILES` | — | Number of rotated audit files to keep |

Example:

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=https://otel.example.com \
OTEL_SERVICE_NAME=journal-bastion-prod \
AUDIT_LOG_FILE=/var/log/journal-bastion-audit.log \
JOURNAL_BASTION_TOKEN=gw_your_token \
JOURNAL_BASTION_CONFIG=/etc/journal/bastion.json \
journal-bastion --config /etc/journal/bastion.json
```

## License

MIT
