#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { parseTemporalConfig } from "./config.js";
import {
  createTemporalMcpServer,
  TEMPORAL_MCP_VERSION,
} from "./server.js";

const VERSION = TEMPORAL_MCP_VERSION;

async function main(): Promise<void> {
  if (process.argv.includes("--version")) {
    process.stdout.write(`${VERSION}\n`);
    return;
  }

  const config = parseTemporalConfig(process.env);
  const server = createTemporalMcpServer(config);
  await server.connect(new StdioServerTransport());
}

main().catch((error) => {
  const apiKey = process.env.TEMPORAL_API_KEY ?? "";
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(
    `${apiKey ? message.split(apiKey).join("[REDACTED]") : message}\n`
  );
  process.exitCode = 1;
});
