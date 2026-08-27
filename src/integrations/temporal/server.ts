import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { TemporalConfig } from "./config.js";
import {
  isReadonlyTemporalOperation,
  READONLY_OPERATIONS,
  READONLY_OPERATION_IDS,
} from "./operations.js";
import {
  readTemporalReference,
  TEMPORAL_REFERENCE_PATHS,
} from "./references.js";
import {
  runReadonlyTemporalOperation,
  type TemporalRunnerOptions,
} from "./runner.js";

export interface TemporalServerOptions extends TemporalRunnerOptions {
  referenceRoot?: string;
}

export const TEMPORAL_MCP_VERSION = "0.1.0";

export function createTemporalMcpServer(
  config: TemporalConfig,
  options: TemporalServerOptions = {}
): Server {
  const server = new Server(
    { name: "journal-temporal-mcp", version: TEMPORAL_MCP_VERSION },
    { capabilities: { tools: {} } }
  );

  const supportedOperationIds = READONLY_OPERATION_IDS.filter(
    (operation) =>
      config.authMode === "api-key" ||
      READONLY_OPERATIONS[operation].executable === "temporal"
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "inspect",
        description:
          "Run one fixed, read-only Temporal Cloud inspection operation against the configured Namespace",
        annotations: { readOnlyHint: true, destructiveHint: false },
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["operation"],
          properties: {
            operation: { type: "string", enum: supportedOperationIds },
            args: {
              type: "array",
              maxItems: 32,
              items: { type: "string" },
              default: [],
            },
          },
        },
      },
      {
        name: "read_reference",
        description:
          "Read curated Temporal Cloud diagnostic guidance bundled with this integration",
        annotations: { readOnlyHint: true, destructiveHint: false },
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["path"],
          properties: {
            path: { type: "string", enum: TEMPORAL_REFERENCE_PATHS },
          },
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      const args = request.params.arguments ?? {};
      if (request.params.name === "inspect") {
        const operation = args.operation;
        const suppliedArgs = args.args ?? [];
        if (
          typeof operation !== "string" ||
          !isReadonlyTemporalOperation(operation) ||
          !supportedOperationIds.includes(operation)
        ) {
          throw new Error("Unknown or non-read-only Temporal operation");
        }
        if (
          !Array.isArray(suppliedArgs) ||
          !suppliedArgs.every((entry) => typeof entry === "string")
        ) {
          throw new Error("args must be an array of strings");
        }

        const result = await runReadonlyTemporalOperation(
          operation,
          suppliedArgs,
          config,
          options
        );
        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
          isError: result.exitCode !== 0 || result.timedOut,
        };
      }

      if (request.params.name === "read_reference") {
        if (typeof args.path !== "string") {
          throw new Error("path must be a string");
        }
        const reference = await readTemporalReference(
          args.path,
          options.referenceRoot
        );
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                ...reference,
                upstream: {
                  version: "0.2.0",
                  commit: "c2f76025159e9580f9e89ff1be1bb5db2e2f428e",
                },
              }),
            },
          ],
        };
      }

      throw new Error("Unknown Temporal tool");
    } catch (error) {
      let message = error instanceof Error ? error.message : String(error);
      const secrets =
        config.authMode === "api-key"
          ? [config.apiKey]
          : [config.tlsCertData, config.tlsKeyData];
      for (const secret of secrets) {
        if (secret.length > 0) {
          message = message.split(secret).join("[REDACTED]");
        }
      }
      return {
        content: [
          {
            type: "text",
            text: message,
          },
        ],
        isError: true,
      };
    }
  });

  return server;
}
