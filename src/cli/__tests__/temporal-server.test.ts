import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { createTemporalMcpServer } from "../../integrations/temporal/server.js";

const config = {
  authMode: "api-key" as const,
  apiKey: "server-secret",
  namespace: "journal-test.a1b2c",
  address: "journal-test.a1b2c.tmprl.cloud:7233",
};
const mtlsConfig = {
  authMode: "mtls" as const,
  tlsCertData:
    "-----BEGIN CERTIFICATE-----\nfixture-certificate\n-----END CERTIFICATE-----",
  tlsKeyData:
    "-----BEGIN PRIVATE KEY-----\nfixture-private-key\n-----END PRIVATE KEY-----",
  namespace: "journal-test.a1b2c",
  address: "journal-test.a1b2c.tmprl.cloud:7233",
};

async function connectedClient(temporalConfig = config) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createTemporalMcpServer(temporalConfig);
  const client = new Client(
    { name: "temporal-test", version: "1.0.0" },
    { capabilities: {} }
  );
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  return { client, server };
}

describe("Temporal MCP server", () => {
  it("advertises exactly the two read-only tools", async () => {
    const { client, server } = await connectedClient();
    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toEqual([
      "inspect",
      "read_reference",
    ]);
    expect(tools.tools.every((tool) => tool.annotations?.readOnlyHint)).toBe(true);
    await client.close();
    await server.close();
  });

  it("advertises only data-plane operations with mTLS authentication", async () => {
    const { client, server } = await connectedClient(mtlsConfig);
    const tools = await client.listTools();
    const inspect = tools.tools.find((tool) => tool.name === "inspect");
    const operation = inspect?.inputSchema.properties?.operation as
      | { enum?: string[] }
      | undefined;
    expect(operation?.enum).toContain("workflow.list");
    expect(operation?.enum).toContain("cluster.health");
    expect(operation?.enum).not.toContain("namespace.get");
    await client.close();
    await server.close();
  });

  it("rejects control-plane operations with mTLS before process execution", async () => {
    const { client, server } = await connectedClient(mtlsConfig);
    const result = await client.callTool({
      name: "inspect",
      arguments: { operation: "namespace.get", args: [] },
    });
    expect(result.isError).toBe(true);
    await client.close();
    await server.close();
  });

  it("rejects unknown operations before process execution", async () => {
    const { client, server } = await connectedClient();
    const result = await client.callTool({
      name: "inspect",
      arguments: { operation: "workflow.terminate", args: [] },
    });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).not.toContain(config.apiKey);
    await client.close();
    await server.close();
  });

  it("serves curated reference content", async () => {
    const { client, server } = await connectedClient();
    const result = await client.callTool({
      name: "read_reference",
      arguments: { path: "authentication.md" },
    });
    expect(result.isError).not.toBe(true);
    expect(JSON.stringify(result)).toContain("Temporal Cloud authentication");
    await client.close();
    await server.close();
  });
});
