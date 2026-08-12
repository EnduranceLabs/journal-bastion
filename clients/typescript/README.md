# journal-bastion-client

TypeScript service-side library for the Journal Bastion protocol. Use this
package in the service that accepts bastion WebSocket connections, validates
bastion tokens, receives tool and skill catalogs, and calls tools on connected
bastions.

If you want to run the customer-side bastion process, install
`journal-bastion` instead.

## Install

Requires Node.js 22 or newer.

```bash
npm install journal-bastion-client
```

## Quick Start

```ts
import { BastionServer } from "journal-bastion-client";

const server = new BastionServer({
  port: 8080,
  validateToken: async (token) => {
    if (token === process.env.JOURNAL_BASTION_TOKEN) {
      return { organizationId: "org_123" };
    }
    return null;
  },
});

server.onBastionConnected = (bastion) => {
  console.info("bastion connected", {
    bastionId: bastion.id,
    organizationId: bastion.organizationId,
    integrations: bastion.integrations.length,
  });
};

server.onBastionUpdated = (bastion) => {
  console.info("bastion catalog updated", { bastionId: bastion.id });
};

server.onBastionDisconnected = (bastion, closeCode, closeReason) => {
  console.info("bastion disconnected", {
    bastionId: bastion.id,
    closeCode,
    closeReason,
  });
};

await server.start();

// After a bastion for org_123 connects and publishes the postgresql integration:
const result = await server.callToolForOrg(
  "org_123",
  "postgresql",
  "execute_sql",
  { sql: "SELECT 1" },
);
```

The library never writes logs or metrics by itself. Route callbacks into your
own logger, metrics, and tracing stack.

## Key APIs

- `start()` / `stop()`: start or stop the built-in WebSocket server.
- `startHeartbeat()` / `handleConnection(ws)`: use your own HTTP/WebSocket
  server and pass accepted sockets to the client library.
- `callTool(integrationId, toolName, args, timeoutMs?)`: call a tool on any
  connected bastion that exposes the integration.
- `callToolForOrg(orgId, integrationId, toolName, args, timeoutMs?)`: call a
  tool for one organization, with candidate bastion selection and retry on
  connection-level failure.
- `getToolsForOrg(orgId)`: list deduplicated tools for an organization.
- `getVersions(bastionId)`, `getTools(bastionId)`, `getSkills(bastionId)`:
  explicitly pull catalog data from a specific bastion.
- `connectedBastions`: inspect currently connected bastions.

## Callbacks

- `onBastionConnected(bastion)`: fired after authentication and initial catalog
  pull.
- `onBastionUpdated(bastion)`: fired when MCP tools or skills change.
- `onBastionDisconnected(bastion, closeCode?, closeReason?)`: fired after a
  connected bastion disconnects.
- `onSocketError(error, bastion | null)`: optional constructor callback for
  socket-level errors and unexpected connection-handler failures.

## Trace Propagation

Pass `getTraceContext` when you want Journal Bastion tool execution to attach to
your active distributed trace:

```ts
import { context, propagation } from "@opentelemetry/api";

const server = new BastionServer({
  validateToken,
  getTraceContext: () => {
    const carrier: Record<string, string> = {};
    propagation.inject(context.active(), carrier);
    return carrier.traceparent
      ? { traceparent: carrier.traceparent, tracestate: carrier.tracestate }
      : null;
  },
  onSocketError: (error, bastion) => {
    logger.error({ error, bastionId: bastion?.id }, "bastion connection error");
  },
});
```

`getTraceContext` is called for each tool call. The returned W3C trace context is
sent to the bastion and used as the parent for remote tool execution spans.

## More Documentation

- [Full README](https://github.com/EnduranceLabs/journal-bastion#readme)
- [Protocol spec](https://github.com/EnduranceLabs/journal-bastion/blob/main/spec/protocol.md)
- [Bastion package](https://www.npmjs.com/package/journal-bastion)

## License

MIT
