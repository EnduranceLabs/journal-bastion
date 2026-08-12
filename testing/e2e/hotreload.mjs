// Config hot-reload E2E: start the bastion with an empty config, then write a
// Postgres MCP server into the config file on disk and assert the bastion picks
// it up at runtime and republishes tools to the service — no restart.
//
//   node hotreload.mjs
//
// Requires the Dockerized Postgres from docker-compose.yml to be up.

import { spawn } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BastionServer } from "../../src/hub/dist/server.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "../..");
const BASTION_BIN = path.join(REPO, "bastion", "dist", "main.js");
const TOKEN = "gw_e2e";

const log = (...a) => console.log("[hotreload]", ...a);
let ok = true;

async function waitFor(check, ms, label) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const v = check();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`timeout waiting for ${label}`);
}

function deadline(ms, label) {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`timeout waiting for ${label}`)), ms)
  );
}

const tmp = mkdtempSync(path.join(tmpdir(), "jg-hotreload-"));
const configPath = path.join(tmp, "bastion.json");
writeFileSync(configPath, JSON.stringify({ mcpServers: [] }));

const POSTGRES_SERVER = {
  id: "postgres",
  name: "PostgreSQL",
  command: "npx",
  args: ["-y", "@toolbox-sdk/server", "--prebuilt", "postgres", "--stdio"],
  envVars: {
    POSTGRES_HOST: "POSTGRES_HOST",
    POSTGRES_PORT: "POSTGRES_PORT",
    POSTGRES_DATABASE: "POSTGRES_DATABASE",
    POSTGRES_USER: "POSTGRES_USER",
    POSTGRES_PASSWORD: "POSTGRES_PASSWORD",
  },
};

const server = new BastionServer({
  port: 8080,
  pingIntervalMs: 0,
  validateToken: async (t) => (t === TOKEN ? { organizationId: "org_e2e" } : null),
});

let proc;
try {
  await server.start();
  let updates = 0;
  server.onBastionUpdated = () => {
    updates++;
  };

  const connected = new Promise((r) => (server.onBastionConnected = r));
  proc = spawn(
    "node",
    [BASTION_BIN, "--config", configPath],
    {
      env: {
        ...process.env,
        JOURNAL_BASTION_TOKEN: TOKEN,
        JOURNAL_BASTION_URL: server.url,
        POSTGRES_HOST: "127.0.0.1",
        POSTGRES_PORT: "5433",
        POSTGRES_DATABASE: "analytics",
        POSTGRES_USER: "journal_bastion_ro",
        POSTGRES_PASSWORD: "ro_pw",
        LOG_LEVEL: "warn",
      },
      stdio: "inherit",
    }
  );

  const gw = await Promise.race([connected, deadline(30_000, "bastion connect")]);
  log(`connected id=${gw.id}, initial integrations=${gw.integrations.length} (expect 0)`);
  if (gw.integrations.length !== 0) { ok = false; log("FAIL: expected 0 integrations at start"); }

  log("writing postgres server into config file on disk...");
  writeFileSync(configPath, JSON.stringify({ mcpServers: [POSTGRES_SERVER] }, null, 2));

  const updated = await waitFor(
    () => {
      const g = server.connectedBastions.find((c) => c.id === gw.id);
      return g && g.integrations.some((i) => i.id === "postgres") ? g : null;
    },
    60_000,
    "postgres integration to appear after hot-reload"
  );
  const pg = updated.integrations.find((i) => i.id === "postgres");
  log(`hot-reload picked up postgres: ${pg.tools.length} tools, onBastionUpdated fired ${updates}x`);
  if (!pg.tools.some((t) => t.name === "execute_sql")) { ok = false; log("FAIL: execute_sql not present after reload"); }

  // Prove the newly added server is actually callable
  const res = await server.callTool("postgres", "execute_sql", { sql: "SELECT 1 AS one" });
  log("post-reload execute_sql result:", JSON.stringify(res.content), "isError:", res.isError === true);
  if (res.isError) { ok = false; log("FAIL: execute_sql errored after reload"); }
} catch (e) {
  ok = false;
  log("FAIL:", e?.stack || String(e));
} finally {
  try { proc?.kill("SIGTERM"); } catch {}
  await server.stop();
  log(ok ? "RESULT: PASS" : "RESULT: FAIL");
  process.exit(ok ? 0 : 1);
}
