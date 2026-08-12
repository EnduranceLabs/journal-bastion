# journal-bastion-hub

[![PyPI](https://img.shields.io/pypi/v/journal-bastion-hub)](https://pypi.org/project/journal-bastion-hub/)

Python service-side library for the Journal Bastion protocol. Use this package
in the service that accepts bastion WebSocket connections, validates bastion
tokens, receives tool and skill catalogs, and calls tools on connected bastions.

If you want to run the customer-side bastion process, install the npm package
`journal-bastion` instead.

## Install

Requires Python 3.11 or newer.

```bash
pip install journal-bastion-hub
```

## Quick Start

```python
import asyncio
import os

from journal_bastion_hub import BastionServer, TokenValidationResult


async def validate_token(token: str) -> TokenValidationResult | None:
    if token == os.environ["JOURNAL_BASTION_TOKEN"]:
        return TokenValidationResult(organization_id="org_123")
    return None


async def main() -> None:
    server = BastionServer(validate_token=validate_token, port=8080)

    server.on_bastion_connected = lambda bastion: print(
        "bastion connected", bastion.id, bastion.organization_id
    )
    server.on_bastion_updated = lambda bastion: print(
        "bastion catalog updated", bastion.id
    )
    server.on_bastion_disconnected = lambda bastion: print(
        "bastion disconnected", bastion.id
    )

    await server.start()

    # After a bastion for org_123 connects and publishes the postgresql integration:
    result = await server.call_tool_for_org(
        "org_123",
        "postgresql",
        "execute_sql",
        {"sql": "SELECT 1"},
    )
    print(result.content)

    await server.stop()


asyncio.run(main())
```

The library never prints to stdout by itself. Route callbacks into your own
logger, metrics, and tracing stack. If `on_socket_error` is not provided,
unexpected connection errors go to the `journal_bastion_hub` logger, which is
silent by default unless your application configures logging.

## Key APIs

- `start()` / `stop()`: start or stop the WebSocket server.
- `call_tool(integration_id, tool_name, arguments, timeout=60.0)`: call a tool
  on any connected bastion that exposes the integration.
- `call_tool_for_org(organization_id, integration_id, tool_name, arguments,
  timeout=90.0)`: call a tool for one organization, with candidate bastion
  selection and retry on connection-level failure.
- `get_tools_for_org(organization_id)`: list deduplicated tools for an
  organization.
- `get_versions(bastion_id)`, `get_tools(bastion_id)`, `get_skills(bastion_id)`:
  explicitly pull catalog data from a specific bastion.
- `connected_bastions`: inspect currently connected bastions.

## Callbacks

Set these attributes on the server instance:

- `on_bastion_connected(bastion)`: fired after authentication and initial
  catalog pull.
- `on_bastion_updated(bastion)`: fired when MCP tools or skills change.
- `on_bastion_disconnected(bastion)`: fired after a connected bastion
  disconnects.

Constructor callbacks:

- `get_trace_context`: returns W3C trace context for each tool call.
- `on_socket_error(error, bastion | None)`: receives socket-level failures and
  unexpected connection-handler failures.

## Trace Propagation

```python
from opentelemetry import propagate


def get_trace_context() -> dict[str, str] | None:
    carrier: dict[str, str] = {}
    propagate.inject(carrier)
    if "traceparent" not in carrier:
        return None
    return {
        "traceparent": carrier["traceparent"],
        "tracestate": carrier.get("tracestate"),
    }


def on_socket_error(error: Exception, bastion) -> None:
    logger.error(
        "bastion socket error",
        exc_info=error,
        extra={"bastion_id": bastion.id if bastion else None},
    )


server = BastionServer(
    validate_token=validate_token,
    port=8080,
    get_trace_context=get_trace_context,
    on_socket_error=on_socket_error,
)
```

`get_trace_context` is called for each tool call. The returned W3C trace context
is sent to the bastion and used as the parent for remote tool execution spans.

## Version Compatibility

Journal Bastion packages release in lockstep. Use matching versions of:

- npm `journal-bastion`
- npm `journal-bastion-hub` for TypeScript services
- 
- the unpublished Python client in `clients/python`

## More Documentation

- [Full README](https://github.com/EnduranceLabs/journal-bastion#readme)
- [Protocol spec](https://github.com/EnduranceLabs/journal-bastion/blob/main/spec/protocol.md)
- [Bastion npm package](https://www.npmjs.com/package/journal-bastion)

## License

MIT
