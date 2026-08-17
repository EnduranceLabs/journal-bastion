import { afterEach, describe, expect, it } from "vitest";
import type { Server as HttpServer } from "node:http";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { resolveAutomaticIntegrations } from "../auto-integrations.js";
import { resolveConfigFile } from "../config.js";
import { McpClient } from "../mcp-client.js";
import { Logger } from "../common/logger.js";

describe("automatic integration runtime contracts", () => {
  const servers: HttpServer[] = [];

  afterEach(async () => {
    await Promise.all(
      servers.splice(0).map(
        (server) =>
          new Promise<void>((resolve, reject) => {
            server.close((error) => (error ? reject(error) : resolve()));
          })
      )
    );
  });

  it("sends the enforced PostHog URL and secret-backed headers to a real MCP transport", async () => {
    const observed: Array<{
      url: string;
      authorization: string | undefined;
      projectId: string | undefined;
    }> = [];
    const app = createMcpExpressApp();

    app.post("/mcp", async (request, response) => {
      observed.push({
        url: request.originalUrl,
        authorization: request.headers.authorization,
        projectId: request.headers["x-posthog-project-id"] as
          | string
          | undefined,
      });

      const server = new Server(
        { name: "fake-posthog", version: "1.0.0" },
        { capabilities: { tools: {} } }
      );
      server.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: [
          {
            name: "exec",
            description: "Execute a read-only PostHog operation",
            inputSchema: { type: "object", properties: {} },
          },
        ],
      }));
      server.setRequestHandler(CallToolRequestSchema, async () => ({
        content: [{ type: "text", text: "posthog-ok" }],
      }));

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });
      await server.connect(transport);
      await transport.handleRequest(request, response, request.body);
      response.on("close", () => {
        void transport.close();
        void server.close();
      });
    });

    const httpServer = await new Promise<HttpServer>((resolve) => {
      const server = app.listen(0, "127.0.0.1", () => resolve(server));
    });
    servers.push(httpServer);
    const address = httpServer.address();
    if (!address || typeof address === "string") {
      throw new Error("Fake PostHog server did not bind a TCP port");
    }

    const sourceEnv = {
      POSTHOG_PERSONAL_API_KEY: "phx_runtime-secret",
      POSTHOG_PROJECT_ID: "98765",
      POSTHOG_FEATURES: "insights,error_tracking",
      POSTHOG_MCP_URL: `http://127.0.0.1:${address.port}/mcp`,
    };
    const automatic = resolveAutomaticIntegrations(sourceEnv, {
      allowInsecureUrls: true,
    });
    const resolved = resolveConfigFile(automatic.configFile, {
      ...sourceEnv,
      ...automatic.derivedEnv,
    });
    const definition = resolved.mcpServers[0];
    const client = new McpClient(
      definition,
      resolved.mcpEnvVars.get("posthog") ?? {},
      new Logger("error")
    );

    await client.start();
    expect(client.getTools().map((tool) => tool.name)).toEqual(["exec"]);
    await expect(client.callTool("exec", {})).resolves.toEqual({
      content: [{ type: "text", text: "posthog-ok" }],
      isError: undefined,
    });
    await client.stop();

    expect(observed.length).toBeGreaterThanOrEqual(3);
    for (const request of observed) {
      const url = new URL(request.url, "http://localhost");
      expect(request.authorization).toBe("Bearer phx_runtime-secret");
      expect(request.projectId).toBe("98765");
      expect(url.searchParams.get("mode")).toBe("cli");
      expect(url.searchParams.get("readonly")).toBe("true");
      expect(url.searchParams.get("features")).toBe(
        "insights,error_tracking"
      );
    }
  });
});
