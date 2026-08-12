# Architecture

`journal-bastion` is a small pnpm workspace with one organizing rule: shared types
live in `protocol/`, the runtime lives in `bastion/`, and thin client libraries
implement the service side. The Python client is standalone.

## Modules

### Shared protocol

- `protocol/` — the `@journal/bastion/protocol` package: pure Zod schemas and
  TypeScript types shared by the bastion and client libraries (Integration,
  ToolResult, Skill, message schemas, IntegrationProvider, BastionConfig, errors).

### Bastion: core pipeline

- `src/cli/connection.ts` — the WebSocket connection to the Journal service.
  Authenticates, sends `version_changed` after auth, answers pull requests
  (`get_versions`, `get_tools`, `get_skills`), routes tool calls, and handles
  ping/pong. Runs a single idempotent reconnect loop (`close()` drains it before a
  new `connect()`) with exponential backoff and jitter. Protocol version 2
  (pull-based).
- `src/cli/runtime.ts` — the `IntegrationProvider` implementation that owns the
  MCP clients and skills. Serves `getTools()`/`getSkills()`, tracks content-hash
  versions, and emits `versions_changed` when tools or skills change. Startup is
  resilient: an MCP server that fails to start is logged and skipped, never fatal,
  so the bastion still serves the healthy servers and skills. Supports config and
  `.env` hot-reload (see [Change detection](#change-detection)).
- `src/cli/mcp-client.ts` — one MCP server connection across three transports:
  `stdio` (subprocess), `sse`, and `streamable-http`, selected by a
  `createTransport()` factory. Cache-first: tools are fetched on `start()` and
  served synchronously from memory; a `notifications/tools/list_changed` refreshes
  the cache and emits `tools_changed`. A failed refresh keeps the last-known-good
  cache; an unexpected transport close clears the cache and removes that
  integration from the advertised catalog until it restarts.
- `src/cli/skill-client.ts` — loads skill files (raw Markdown) from a directory
  and watches it for `.md` changes, emitting `skills_changed`.

### Bastion: configuration & hot-reload

- `src/cli/config.ts` — parses operational env vars and loads the config file
  (`--config` or `JOURNAL_BASTION_CONFIG`), validating it with a Zod discriminated
  union on `transport`. Resolves `envVars` (stdio) and `headers` (HTTP), and
  defaults a `command`-only entry to `stdio` for backward compatibility. Exports
  `readConfigFile()`, `resolveConfigFile()`, and `resolveConfigFilePath()`.
- `src/cli/config-watcher.ts` — watches the config file and emits
  `config_changed` with the re-parsed config; parse errors keep the current config.
- `src/cli/env-file.ts` — loads and watches a `.env` file with `dotenv.parse()`
  (never mutating `process.env`) and emits `env_changed`.
- `src/cli/main.ts` — the CLI entry point. Handles `--help`/`--version`,
  auto-detects `.env` (overridable with `--env-file` or `JOURNAL_BASTION_ENV_FILE`),
  and wires the config and env file paths into the `Runtime`. Config errors print as
  readable per-field messages, not stack traces.

### Bastion: cross-cutting

- `src/cli/common/` — shared utilities (structured JSON logger).
- `src/cli/types.ts` — plain shared types (e.g. the `ToolCallOutcome` union).
  No runtime code or dependencies, keeping OTel and protocol types out of modules
  that don't need them.
- `src/cli/telemetry.ts` — optional OpenTelemetry tracing and metrics. All OTel
  span handling is contained here (`traceToolCall()`, `recordToolCall()`); no other
  module imports `@opentelemetry/*`. Propagates W3C trace context via
  `traceparent`/`tracestate`.
- `src/cli/audit.ts` — metadata-only audit log (no arguments, results, or
  secrets): tool call start/result/error, outbound message metadata, config/env
  reloads, and MCP process lifecycle.
- `src/cli/version-hash.ts` — computes stable content hashes over integration
  arrays for change detection.
- `src/cli/version.ts` — loads the package version.

## Bastion config file

MCP servers and skills are configured in a single JSON file with two top-level
fields: `mcpServers` (an array of server definitions) and `skillsDir` (a path, or
`null`). It is supplied via `--config <path>` or `JOURNAL_BASTION_CONFIG` (a file
path or inline JSON). Secrets stay in real env vars, never in the file.

Each entry in `mcpServers` is a discriminated union on `transport`:

- **`stdio`** (default): `command`, `args`, and `envVars`, where `envVars` maps
  `{ hostEnvVar: subprocessEnvVar }`.
- **`sse`**: `url` and `headers`, for legacy SSE-based MCP servers.
- **`streamable-http`**: `url` and `headers`, the current MCP spec recommendation.

For `sse` and `streamable-http`, `headers` maps `{ headerName: hostEnvVar }`. Both
mappings are resolved from the host environment at startup. An entry with a
`command` but no `transport` is treated as `stdio` for backward compatibility.

The JSON Schema lives at `spec/bastion-config.schema.json` (wire it up with
`$schema` for editor autocomplete); runnable samples are in `examples/`.

## Client libraries

- `src/hub/` — the `@journal/bastion/hub` subpath export. Implements the
  service side of the protocol: runs a WebSocket server, authenticates bastions,
  auto-pulls tools and skills on `version_changed`, and exposes `callTool()`,
  `getVersions()`, `getTools()`, and `getSkills()`.
- `hub/python/` — the `@journal/bastion` PyPI package. The same
  functionality, built on `websockets` and `asyncio`.
- `testing/integration/` — integration tests that run the real bastion against each
  client library and verify lifecycle, catalog pulls, version pulls, and disconnect
  handling.

The two clients must stay at parity: any hook or method added to one belongs in the
other. Both expose the same optional hooks — `getTraceContext`/`get_trace_context`
(W3C trace propagation onto `tool_call`) and `onSocketError`/`on_socket_error`
(surface socket-level failures) — and neither library writes to the console itself.

## IntegrationProvider interface

The `Runtime` implements this interface to supply capabilities to the connection:

- `getTools(): Integration[]` — cached MCP tool integrations (synchronous).
- `getSkills(): Skill[]` — skills held in memory (synchronous).
- `getVersions(): BastionVersions` — the `{ mcpVersion, skillsVersion }` content
  hashes (`null` when empty).
- `callTool(integrationId, toolName, args)` — executes a tool call (async).
- `start()` / `stop()` — lifecycle management.
- `on`/`off("versions_changed")` — optional event for proactive change
  notification.

## Change detection

The bastion watches for tool and skill changes at runtime and tells the service what
to re-pull:

- MCP tools change on a `notifications/tools/list_changed` and on server crashes.
- Skills change when a `.md` file in the skills directory changes.
- Config and `.env` changes are hot-reloaded: the `Runtime` diffs the new config
  against the running MCP servers by id and adds, removes, or restarts them.
  `skillsDir` changes are *not* hot-reloaded (a warning is logged).
- Every path is debounced, recomputes the content-hash versions, and emits
  `versions_changed` only when a hash actually changed.
- The connection turns that event into a lightweight `version_changed` push (the
  version hashes only, fire-and-forget), and the service decides what to pull.
