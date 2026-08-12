import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { BastionServer } from "@journal/journal-bastion/hub";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASTION_BIN = path.resolve(__dirname, "../../../dist/cli/main.js");

function waitForBastion(
  server: BastionServer,
  timeoutMs = 10_000
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Bastion did not connect in time")),
      timeoutMs
    );
    server.onBastionConnected = () => {
      clearTimeout(timer);
      resolve();
    };
  });
}

function startBastion(
  url: string,
  token: string,
  env?: Record<string, string>
): ChildProcess {
  return spawn("node", [BASTION_BIN], {
    env: {
      ...process.env,
      JOURNAL_BASTION_TOKEN: token,
      JOURNAL_BASTION_URL: url,
      JOURNAL_BASTION_CONFIG: "{}",
      LOG_LEVEL: "error",
      ...env,
    },
    stdio: "pipe",
  });
}

describe("Integration: TS client <-> real bastion", () => {
  let server: BastionServer;
  let bastion: ChildProcess;

  beforeEach(async () => {
    server = new BastionServer({
      validateToken: async (token) =>
        token === "gw_test" ? { organizationId: "org_1" } : null,
      pingIntervalMs: 0,
    });
    await server.start();

    const connected = waitForBastion(server);
    bastion = startBastion(server.url, "gw_test");
    await connected;
  });

  afterEach(async () => {
    bastion.kill("SIGTERM");
    await server.stop();
  });

  it("bastion connects with zero tools (no MCP servers)", () => {
    expect(server.connectedBastions).toHaveLength(1);
    expect(server.connectedBastions[0].integrations).toHaveLength(0);
  });

  it("connected bastion includes version fields (null when no MCP/skills configured)", () => {
    const gw = server.connectedBastions[0];
    // With no MCP servers or skills, both should be null
    expect(gw.mcpVersion).toBeNull();
    expect(gw.skillsVersion).toBeNull();
  });

  it("rejects bastion with invalid token", async () => {
    const bad = startBastion(server.url, "gw_wrong");

    const code = await new Promise<number>((resolve) => {
      bad.on("exit", (c) => resolve(c ?? 1));
    });
    expect(code).not.toBe(0);
    // Original bastion should still be connected
    expect(server.connectedBastions).toHaveLength(1);
  });

  it("service can pull versions from bastion", async () => {
    const bastionId = server.connectedBastions[0].id;
    const versions = await server.getVersions(bastionId);
    expect(versions).toHaveProperty("mcpVersion");
    expect(versions).toHaveProperty("skillsVersion");
    // No MCP servers configured, so mcpVersion should be null
    expect(versions.mcpVersion).toBeNull();
    expect(versions.skillsVersion).toBeNull();
  });

  it("detects bastion disconnect", async () => {
    let disconnected = false;
    server.onBastionDisconnected = () => {
      disconnected = true;
    };

    bastion.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 500));
    expect(disconnected).toBe(true);
    expect(server.connectedBastions).toHaveLength(0);
  });
});
