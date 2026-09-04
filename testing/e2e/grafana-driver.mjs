// End-to-end driver for the automatic Grafana integration.
//
// Unlike the database drivers, this one exercises the *automatic* integration
// path (no --config file), because that is how the Docker image runs and how
// customers configure Grafana. It:
//
//   1. starts a BastionServer (the Journal "service" side) on ws://127.0.0.1:<port>
//   2. spawns the real bastion with JOURNAL_BASTION_AUTO_INTEGRATIONS=true
//   3. waits for the "grafana" integration and its tool catalog to publish
//   4. calls a read-only tool and asserts real data comes back
//
// Credentials are read from this process's environment and forwarded to the
// bastion — deliberately NOT from a file under testing/e2e/env/, because those
// files are tracked in git.
//
// Usage:
//   GRAFANA_MCP_URL=http://127.0.0.1:8000/mcp \
//   GRAFANA_MCP_TOKEN=<caller token> \
//   node testing/e2e/grafana-driver.mjs
//
// NODE_ENV=test is set by this driver so a plain-http local endpoint is
// accepted; production keeps requiring https.

import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { BastionServer } from "../../dist/hub/server.js";

const emptyEnvFile = join(mkdtempSync(join(tmpdir(), "grafana-e2e-")), ".env");
writeFileSync(emptyEnvFile, "");

const HERE = fileURLToPath(new URL(".", import.meta.url));
const BASTION_BIN = `${HERE}../../dist/cli/main.js`;
const PORT = Number(process.env.E2E_PORT ?? 8081);
const TOKEN = "gw_e2e_grafana";
const TOOL = process.env.GRAFANA_E2E_TOOL ?? "list_datasources";

const log = (m) => console.log(`[grafana-driver] ${m}`);
const fail = (m) => {
  console.error(`[grafana-driver] FAIL: ${m}`);
  process.exitCode = 1;
};

const url = process.env.GRAFANA_MCP_URL;
const token = process.env.GRAFANA_MCP_TOKEN;
if (!url || !token) {
  console.error(
    "[grafana-driver] FAIL: set GRAFANA_MCP_URL and GRAFANA_MCP_TOKEN"
  );
  process.exit(1);
}

function deadline(ms, label) {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`timeout waiting for ${label}`)), ms)
  );
}

async function waitFor(fn, ms, label) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const v = fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`timeout waiting for ${label}`);
}

const server = new BastionServer({
  port: PORT,
  pingIntervalMs: 0,
  validateToken: async (t) =>
    t === TOKEN ? { organizationId: "org_e2e_grafana" } : null,
});

let bastionProc;
async function cleanup() {
  try {
    bastionProc?.kill("SIGTERM");
  } catch {}
  try {
    await server.stop();
  } catch {}
}

try {
  await server.start();
  log(`service listening on ${server.url}`);

  const connected = new Promise((resolve) => {
    server.onBastionConnected = (gw) => resolve(gw);
  });

  bastionProc = spawn("node", [BASTION_BIN], {
    env: {
      ...process.env,
      NODE_ENV: "test",
      LOG_LEVEL: "info",
      JOURNAL_BASTION_AUTO_INTEGRATIONS: "true",
      JOURNAL_BASTION_TOKEN: TOKEN,
      JOURNAL_BASTION_URL: `ws://127.0.0.1:${PORT}`,
      // A real empty file, not /dev/null: the env-file watcher spins on a
      // character device and floods the log with reload attempts.
      JOURNAL_BASTION_ENV_FILE: emptyEnvFile,
      GRAFANA_MCP_URL: url,
      GRAFANA_MCP_TOKEN: token,
    },
    stdio: "inherit",
  });
  bastionProc.on("exit", (code) =>
    log(`bastion process exited with code ${code}`)
  );

  const gw = await Promise.race([connected, deadline(60_000, "bastion connect")]);
  log(`bastion connected: id=${gw.id}`);

  const withTools = await waitFor(
    () => {
      const g = server.connectedBastions.find((c) => c.id === gw.id);
      return g && g.integrations.length > 0 ? g : null;
    },
    60_000,
    "integrations to publish"
  );

  log(`integrations (${withTools.integrations.length}):`);
  for (const intg of withTools.integrations) {
    log(`  - ${intg.id} (${intg.name}): ${intg.tools.length} tools`);
  }

  const grafana = withTools.integrations.find((intg) => intg.id === "grafana");
  if (!grafana) {
    fail("no 'grafana' integration published");
    await cleanup();
    process.exit(1);
  }
  if (grafana.tools.length === 0) {
    fail("grafana integration published an empty tool catalog");
    await cleanup();
    process.exit(1);
  }
  log(`grafana tool count: ${grafana.tools.length}`);

  const tool = grafana.tools.find((t) => t.name === TOOL);
  if (!tool) {
    fail(`tool '${TOOL}' not in the grafana catalog`);
    await cleanup();
    process.exit(1);
  }

  const result = await server.callTool("grafana", TOOL, {});
  const text = (result.content ?? [])
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("");
  if (result.isError) {
    fail(`tool '${TOOL}' returned an error: ${text.slice(0, 300)}`);
    await cleanup();
    process.exit(1);
  }
  if (text.trim().length === 0) {
    fail(`tool '${TOOL}' returned no content`);
    await cleanup();
    process.exit(1);
  }
  log(`read result (${text.length} chars): ${text.slice(0, 200)}`);
  log("RESULT: pass");
} catch (err) {
  fail(err?.message ?? String(err));
} finally {
  await cleanup();
}
