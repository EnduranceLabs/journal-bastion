import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { TemporalConfig } from "./config.js";
import {
  isReadonlyTemporalOperation,
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

export function createTemporalMcpServer(
  config: TemporalConfig,
  options: TemporalServerOptions = {}
): Server {
  const server = new Server(
    { name: "journal-temporal-mcp", version: "0.1.0" },
    { capabilities: { tools: {} } }
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
            operation: { type: "string", enum: READONLY_OPERATION_IDS },
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
          !isReadonlyTemporalOperation(operation)
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
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: "text",
            text: message.split(config.apiKey).join("[REDACTED]"),
          },
        ],
        isError: true,
      };
    }
  });

  return server;
}
