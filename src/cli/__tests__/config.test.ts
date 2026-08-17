import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseConfig, BastionConfigFileSchema } from "../config.js";

vi.mock("node:fs", () => ({
  readFileSync: vi.fn(),
}));

import { readFileSync } from "node:fs";

const mockReadFileSync = vi.mocked(readFileSync);

function baseEnv(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    JOURNAL_BASTION_TOKEN: "gw_test123",
    ...overrides,
  };
}

beforeEach(() => {
  mockReadFileSync.mockReset();
});

describe("parseConfig", () => {
  // --- Operational env vars ---

  it("requires JOURNAL_BASTION_TOKEN", () => {
    expect(() => parseConfig({}, [])).toThrow();
  });

  // --- Pre-rename env var names (gateway -> bastion compatibility) ---

  it("falls back to JOURNAL_GATEWAY_TOKEN when the bastion name is unset", () => {
    const config = parseConfig(
      { JOURNAL_GATEWAY_TOKEN: "gw_legacy", JOURNAL_BASTION_CONFIG: "{}" },
      []
    );
    expect(config.token).toBe("gw_legacy");
  });

  it("prefers the bastion env var over the legacy gateway one", () => {
    const config = parseConfig(
      {
        JOURNAL_BASTION_TOKEN: "gw_new",
        JOURNAL_GATEWAY_TOKEN: "gw_legacy",
        JOURNAL_BASTION_CONFIG: "{}",
      },
      []
    );
    expect(config.token).toBe("gw_new");
  });

  it("falls back to JOURNAL_GATEWAY_URL and JOURNAL_GATEWAY_CONFIG", () => {
    const config = parseConfig(
      {
        JOURNAL_GATEWAY_TOKEN: "gw_legacy",
        JOURNAL_GATEWAY_URL: "ws://legacy.example:3000",
        JOURNAL_GATEWAY_CONFIG: "{}",
      },
      []
    );
    expect(config.url).toBe("ws://legacy.example:3000");
    expect(config.mcpServers).toEqual([]);
  });

  it("uses default URL when not specified", () => {
    const config = parseConfig(baseEnv({ JOURNAL_BASTION_CONFIG: "{}" }), []);
    expect(config.url).toBe("wss://bastion.journal.one");
  });

  it("defaults to a URL with no path, because the service upgrades at the root", () => {
    const config = parseConfig(baseEnv({ JOURNAL_BASTION_CONFIG: "{}" }), []);
    expect(new URL(config.url).pathname).toBe("/");
  });

  it("uses default log level when not specified", () => {
    const config = parseConfig(baseEnv({ JOURNAL_BASTION_CONFIG: "{}" }), []);
    expect(config.logLevel).toBe("info");
  });

  it("respects custom URL and log level", () => {
    const config = parseConfig(
      baseEnv({
        JOURNAL_BASTION_URL: "wss://custom.example.com",
        LOG_LEVEL: "debug",
        JOURNAL_BASTION_CONFIG: "{}",
      }),
      []
    );
    expect(config.url).toBe("wss://custom.example.com");
    expect(config.logLevel).toBe("debug");
  });

  it("keeps automatic integrations disabled for npm users by default", () => {
    const config = parseConfig(
      baseEnv({
        DATADOG_API_KEY: "api-secret",
        DATADOG_APP_KEY: "app-secret",
      }),
      []
    );

    expect(config.mcpServers).toEqual([]);
    expect(config.automaticIntegrations).toBeUndefined();
  });

  it("resolves Datadog automatically when explicitly enabled", () => {
    const config = parseConfig(
      baseEnv({
        JOURNAL_BASTION_AUTO_INTEGRATIONS: "true",
        DD_API_KEY: "api-secret",
        DD_APP_KEY: "app-secret",
        DD_SITE: "datadoghq.com",
      }),
      []
    );

    expect(config.mcpServers).toEqual([
      expect.objectContaining({ id: "datadog", transport: "streamable-http" }),
    ]);
    expect(config.mcpEnvVars.get("datadog")).toEqual({
      DD_API_KEY: "api-secret",
      DD_APPLICATION_KEY: "app-secret",
    });
    expect(config.automaticIntegrations).toEqual({
      enabled: ["datadog"],
      disabled: [],
    });
  });

  it("treats explicit empty config as a full replacement for automatic integrations", () => {
    const config = parseConfig(
      baseEnv({
        JOURNAL_BASTION_AUTO_INTEGRATIONS: "true",
        JOURNAL_BASTION_CONFIG: "{}",
        DATADOG_API_KEY: "api-secret",
        DATADOG_APP_KEY: "app-secret",
      }),
      []
    );

    expect(config.mcpServers).toEqual([]);
    expect(config.automaticIntegrations).toBeUndefined();
  });

  // A self-hosted hub can feed BastionServer.handleConnection from a route
  // under any prefix, so an explicit path must survive untouched. This is the
  // guard against "fix the /v1 default" turning into "strip every path".
  it("passes an explicit path through verbatim", () => {
    const config = parseConfig(
      baseEnv({
        JOURNAL_BASTION_URL: "wss://hub.internal.example.com/bastion",
        JOURNAL_BASTION_CONFIG: "{}",
      }),
      []
    );
    expect(config.url).toBe("wss://hub.internal.example.com/bastion");
  });

  it("rejects non-WebSocket URL schemes", () => {
    expect(() =>
      parseConfig(
        baseEnv({
          JOURNAL_BASTION_URL: "ftp://example.com",
          JOURNAL_BASTION_CONFIG: "{}",
        }),
        []
      )
    ).toThrow("URL must use ws://, wss://, http://, or https:// scheme");
  });

  // --- Config file loading ---

  it("loads config from --config file path", () => {
    const configJson = JSON.stringify({
      mcpServers: [{ id: "pg", command: "npx", args: ["-y", "pg-server"] }],
      skillsDir: "/opt/skills",
    });
    mockReadFileSync.mockReturnValue(configJson);

    const config = parseConfig(baseEnv(), ["node", "main.js", "--config", "/tmp/gw.json"]);
    expect(mockReadFileSync).toHaveBeenCalledWith("/tmp/gw.json", "utf-8");
    expect(config.mcpServers).toHaveLength(1);
    expect(config.mcpServers[0].id).toBe("pg");
    expect(config.skillsDir).toBe("/opt/skills");
  });

  it("loads config from JOURNAL_BASTION_CONFIG file path", () => {
    const configJson = JSON.stringify({ skillsDir: "/opt/skills" });
    mockReadFileSync.mockReturnValue(configJson);

    const config = parseConfig(
      baseEnv({ JOURNAL_BASTION_CONFIG: "/etc/bastion.json" }),
      []
    );
    expect(mockReadFileSync).toHaveBeenCalledWith("/etc/bastion.json", "utf-8");
    expect(config.skillsDir).toBe("/opt/skills");
  });

  it("parses inline JSON from JOURNAL_BASTION_CONFIG", () => {
    const inline = JSON.stringify({
      mcpServers: [{ id: "test", command: "echo" }],
    });
    const config = parseConfig(baseEnv({ JOURNAL_BASTION_CONFIG: inline }), []);
    expect(config.mcpServers).toHaveLength(1);
    expect(config.mcpServers[0].id).toBe("test");
    // readFileSync should NOT be called for inline JSON
    expect(mockReadFileSync).not.toHaveBeenCalled();
  });

  it("--config takes precedence over JOURNAL_BASTION_CONFIG env var", () => {
    const fileConfig = JSON.stringify({ skillsDir: "/from-file" });
    mockReadFileSync.mockReturnValue(fileConfig);

    const config = parseConfig(
      baseEnv({ JOURNAL_BASTION_CONFIG: '{"skillsDir": "/from-env"}' }),
      ["node", "main.js", "--config", "/tmp/gw.json"]
    );
    expect(config.skillsDir).toBe("/from-file");
  });

  // --- Schema validation ---

  it("rejects server missing id", () => {
    const inline = JSON.stringify({
      mcpServers: [{ command: "echo" }],
    });
    expect(() =>
      parseConfig(baseEnv({ JOURNAL_BASTION_CONFIG: inline }), [])
    ).toThrow();
  });

  it("rejects stdio server missing command", () => {
    const inline = JSON.stringify({
      mcpServers: [{ id: "test", transport: "stdio" }],
    });
    expect(() =>
      parseConfig(baseEnv({ JOURNAL_BASTION_CONFIG: inline }), [])
    ).toThrow();
  });

  it("applies defaults for optional fields", () => {
    const inline = JSON.stringify({
      mcpServers: [{ id: "minimal", command: "echo" }],
    });
    const config = parseConfig(baseEnv({ JOURNAL_BASTION_CONFIG: inline }), []);
    const server = config.mcpServers[0];
    expect(server.name).toBe("minimal"); // defaults to id
    expect(server.description).toBe("");
    expect(server.transport).toBe("stdio");
    if (server.transport === "stdio") {
      expect(server.args).toEqual([]);
      expect(server.envVars).toEqual({});
    }
  });

  it("accepts empty {} as valid config", () => {
    const config = parseConfig(baseEnv({ JOURNAL_BASTION_CONFIG: "{}" }), []);
    expect(config.mcpServers).toEqual([]);
    expect(config.skillsDir).toBeNull();
  });

  // --- Env var resolution ---

  it("resolves envVars mapping from real environment", () => {
    const inline = JSON.stringify({
      mcpServers: [
        { id: "db", command: "npx", envVars: { DATABASE_URL: "DATABASE_URL" } },
      ],
    });
    const config = parseConfig(
      baseEnv({
        JOURNAL_BASTION_CONFIG: inline,
        DATABASE_URL: "postgresql://localhost:5432/test",
      }),
      []
    );
    const dbEnv = config.mcpEnvVars.get("db");
    expect(dbEnv).toEqual({ DATABASE_URL: "postgresql://localhost:5432/test" });
  });

  it("throws when a required env var is missing", () => {
    const inline = JSON.stringify({
      mcpServers: [
        { id: "db", command: "npx", envVars: { DATABASE_URL: "DATABASE_URL" } },
      ],
    });
    expect(() =>
      parseConfig(baseEnv({ JOURNAL_BASTION_CONFIG: inline }), [])
    ).toThrow('MCP server "db" requires environment variable DATABASE_URL');
  });

  // --- Edge cases ---

  it("throws when config file does not exist", () => {
    mockReadFileSync.mockImplementation(() => {
      throw new Error("ENOENT");
    });
    expect(() =>
      parseConfig(baseEnv(), ["node", "main.js", "--config", "/nonexistent.json"])
    ).toThrow("Cannot read config file: /nonexistent.json");
  });

  it("throws when config file contains invalid JSON", () => {
    mockReadFileSync.mockReturnValue("not json {{{");
    expect(() =>
      parseConfig(baseEnv(), ["node", "main.js", "--config", "/bad.json"])
    ).toThrow("Config file is not valid JSON: /bad.json");
  });

  it("throws when JOURNAL_BASTION_CONFIG env is invalid JSON", () => {
    expect(() =>
      parseConfig(baseEnv({ JOURNAL_BASTION_CONFIG: "{bad json" }), [])
    ).toThrow("JOURNAL_BASTION_CONFIG is not valid JSON");
  });

  it("records a warning when no servers or skills are configured", () => {
    const config = parseConfig(baseEnv({ JOURNAL_BASTION_CONFIG: "{}" }), []);
    expect(config.warnings).toEqual([
      "No mcpServers or skillsDir configured; the bastion will connect without tools or skills.",
    ]);
  });

  it("records no warnings when servers or skills are configured", () => {
    const inline = JSON.stringify({ skillsDir: "/opt/skills" });
    const config = parseConfig(baseEnv({ JOURNAL_BASTION_CONFIG: inline }), []);
    expect(config.warnings).toEqual([]);
  });

  // --- Backward compatibility ---

  it("injects transport: stdio when command present but no transport field", () => {
    const inline = JSON.stringify({
      mcpServers: [{ id: "legacy", command: "npx", args: ["server"] }],
    });
    const config = parseConfig(baseEnv({ JOURNAL_BASTION_CONFIG: inline }), []);
    expect(config.mcpServers[0].transport).toBe("stdio");
  });

  it("does not overwrite explicit transport field", () => {
    const inline = JSON.stringify({
      mcpServers: [
        { id: "remote", transport: "sse", url: "https://mcp.example.com/sse" },
      ],
    });
    const config = parseConfig(baseEnv({ JOURNAL_BASTION_CONFIG: inline }), []);
    expect(config.mcpServers[0].transport).toBe("sse");
  });

  // --- SSE transport ---

  it("parses SSE config with url", () => {
    const inline = JSON.stringify({
      mcpServers: [
        { id: "remote", transport: "sse", url: "https://mcp.example.com/sse" },
      ],
    });
    const config = parseConfig(baseEnv({ JOURNAL_BASTION_CONFIG: inline }), []);
    const server = config.mcpServers[0];
    expect(server.transport).toBe("sse");
    if (server.transport === "sse") {
      expect(server.url).toBe("https://mcp.example.com/sse");
    }
  });

  it("rejects SSE config missing url", () => {
    const inline = JSON.stringify({
      mcpServers: [{ id: "bad", transport: "sse" }],
    });
    expect(() =>
      parseConfig(baseEnv({ JOURNAL_BASTION_CONFIG: inline }), [])
    ).toThrow();
  });

  it("resolves SSE headers from env vars", () => {
    const inline = JSON.stringify({
      mcpServers: [
        {
          id: "remote",
          transport: "sse",
          url: "https://mcp.example.com/sse",
          headers: { Authorization: "API_KEY" },
        },
      ],
    });
    const config = parseConfig(
      baseEnv({
        JOURNAL_BASTION_CONFIG: inline,
        API_KEY: "Bearer sk-123",
      }),
      []
    );
    const env = config.mcpEnvVars.get("remote");
    expect(env).toEqual({ Authorization: "Bearer sk-123" });
  });

  it("throws when SSE header env var is missing", () => {
    const inline = JSON.stringify({
      mcpServers: [
        {
          id: "remote",
          transport: "sse",
          url: "https://mcp.example.com/sse",
          headers: { Authorization: "MISSING_KEY" },
        },
      ],
    });
    expect(() =>
      parseConfig(baseEnv({ JOURNAL_BASTION_CONFIG: inline }), [])
    ).toThrow(
      'MCP server "remote" requires environment variable MISSING_KEY for header "Authorization"'
    );
  });

  // --- Streamable HTTP transport ---

  it("parses streamable-http config with url", () => {
    const inline = JSON.stringify({
      mcpServers: [
        { id: "api", transport: "streamable-http", url: "https://mcp.example.com/mcp" },
      ],
    });
    const config = parseConfig(baseEnv({ JOURNAL_BASTION_CONFIG: inline }), []);
    const server = config.mcpServers[0];
    expect(server.transport).toBe("streamable-http");
    if (server.transport === "streamable-http") {
      expect(server.url).toBe("https://mcp.example.com/mcp");
    }
  });

  it("rejects streamable-http config missing url", () => {
    const inline = JSON.stringify({
      mcpServers: [{ id: "bad", transport: "streamable-http" }],
    });
    expect(() =>
      parseConfig(baseEnv({ JOURNAL_BASTION_CONFIG: inline }), [])
    ).toThrow();
  });

  it("resolves streamable-http headers from env vars", () => {
    const inline = JSON.stringify({
      mcpServers: [
        {
          id: "api",
          transport: "streamable-http",
          url: "https://mcp.example.com/mcp",
          headers: { "X-Api-Key": "SECRET_KEY" },
        },
      ],
    });
    const config = parseConfig(
      baseEnv({
        JOURNAL_BASTION_CONFIG: inline,
        SECRET_KEY: "my-secret",
      }),
      []
    );
    const env = config.mcpEnvVars.get("api");
    expect(env).toEqual({ "X-Api-Key": "my-secret" });
  });

  // --- Mixed transports ---

  it("supports mixed transports in the same config", () => {
    const inline = JSON.stringify({
      mcpServers: [
        { id: "local", command: "npx", args: ["-y", "pg-server"] },
        { id: "remote-sse", transport: "sse", url: "https://mcp.example.com/sse" },
        { id: "remote-http", transport: "streamable-http", url: "https://mcp.example.com/mcp" },
      ],
    });
    const config = parseConfig(baseEnv({ JOURNAL_BASTION_CONFIG: inline }), []);
    expect(config.mcpServers).toHaveLength(3);
    expect(config.mcpServers[0].transport).toBe("stdio");
    expect(config.mcpServers[1].transport).toBe("sse");
    expect(config.mcpServers[2].transport).toBe("streamable-http");
  });
});

describe("BastionConfigFileSchema", () => {
  it("validates a full config", () => {
    const result = BastionConfigFileSchema.parse({
      mcpServers: [
        {
          id: "pg",
          command: "npx",
          args: ["-y", "pg-server"],
          name: "PostgreSQL",
          description: "Query databases",
          envVars: { DATABASE_URL: "DATABASE_URL" },
        },
      ],
      skillsDir: "/opt/skills",
    });
    expect(result.mcpServers).toHaveLength(1);
    expect(result.skillsDir).toBe("/opt/skills");
  });

  it("applies defaults for empty object", () => {
    const result = BastionConfigFileSchema.parse({});
    expect(result.mcpServers).toEqual([]);
    expect(result.skillsDir).toBeNull();
  });
});
