import { describe, expect, it } from "vitest";
import {
  automaticIntegrationsEnabled,
  resolveAutomaticIntegrations,
} from "../auto-integrations.js";

describe("automaticIntegrationsEnabled", () => {
  it("defaults off and accepts explicit booleans", () => {
    expect(automaticIntegrationsEnabled({})).toBe(false);
    expect(
      automaticIntegrationsEnabled({
        JOURNAL_BASTION_AUTO_INTEGRATIONS: "true",
      })
    ).toBe(true);
    expect(
      automaticIntegrationsEnabled({
        JOURNAL_BASTION_AUTO_INTEGRATIONS: "FALSE",
      })
    ).toBe(false);
  });

  it("rejects ambiguous values", () => {
    expect(() =>
      automaticIntegrationsEnabled({
        JOURNAL_BASTION_AUTO_INTEGRATIONS: "yes",
      })
    ).toThrow("must be true or false");
  });
});

describe("resolveAutomaticIntegrations", () => {
  it("returns an empty catalog when automatic integrations are absent", () => {
    expect(resolveAutomaticIntegrations({})).toEqual({
      configFile: { mcpServers: [], skillsDir: null },
      derivedEnv: {},
      enabledIntegrationIds: [],
      disabledIntegrationIds: ["datadog", "posthog", "mongodb", "temporal"],
    });
  });

  it("builds access-token authentication without exposing the token in config", () => {
    const result = resolveAutomaticIntegrations({
      DATADOG_ACCESS_TOKEN: "secret-access-token",
    });

    expect(result.enabledIntegrationIds).toEqual(["datadog"]);
    expect(result.configFile.mcpServers).toEqual([
      expect.objectContaining({
        id: "datadog",
        transport: "streamable-http",
        url: "https://mcp.datadoghq.com/v1/mcp?toolsets=core",
        headers: {
          Authorization: "JOURNAL_BASTION_INTERNAL_DATADOG_AUTHORIZATION",
        },
      }),
    ]);
    expect(result.derivedEnv).toEqual({
      JOURNAL_BASTION_INTERNAL_DATADOG_AUTHORIZATION:
        "Bearer secret-access-token",
    });
    expect(JSON.stringify(result.configFile)).not.toContain(
      "secret-access-token"
    );
  });

  it("builds API/application-key authentication from customer-facing names", () => {
    const result = resolveAutomaticIntegrations({
      DATADOG_API_KEY: "api-secret",
      DATADOG_APP_KEY: "app-secret",
    });

    expect(result.configFile.mcpServers[0]).toEqual(
      expect.objectContaining({
        headers: {
          DD_API_KEY: "JOURNAL_BASTION_INTERNAL_DATADOG_API_KEY",
          DD_APPLICATION_KEY: "JOURNAL_BASTION_INTERNAL_DATADOG_APP_KEY",
        },
      })
    );
    expect(result.derivedEnv).toEqual({
      JOURNAL_BASTION_INTERNAL_DATADOG_API_KEY: "api-secret",
      JOURNAL_BASTION_INTERNAL_DATADOG_APP_KEY: "app-secret",
    });
  });

  it("accepts Datadog's DD_* environment aliases", () => {
    const result = resolveAutomaticIntegrations({
      DD_API_KEY: "api-secret",
      DD_APP_KEY: "app-secret",
      DD_SITE: "us3.datadoghq.com",
    });

    expect(result.configFile.mcpServers[0]).toEqual(
      expect.objectContaining({
        url: "https://mcp.us3.datadoghq.com/v1/mcp?toolsets=core",
      })
    );
  });

  it.each([
    [{ DATADOG_API_KEY: "api" }, "DATADOG_APP_KEY"],
    [{ DATADOG_APP_KEY: "app" }, "DATADOG_API_KEY"],
    [{ DATADOG_SITE: "datadoghq.com" }, "requires DATADOG_ACCESS_TOKEN"],
    [{ DD_SITE: "datadoghq.com" }, "requires DATADOG_ACCESS_TOKEN"],
  ])("rejects partial Datadog configuration %#", (env, message) => {
    expect(() => resolveAutomaticIntegrations(env)).toThrow(message);
  });

  it("rejects both authentication modes", () => {
    expect(() =>
      resolveAutomaticIntegrations({
        DATADOG_ACCESS_TOKEN: "access",
        DATADOG_API_KEY: "api",
        DATADOG_APP_KEY: "app",
      })
    ).toThrow("authentication is ambiguous");
  });

  it("rejects conflicting aliases without showing their values", () => {
    expect(() =>
      resolveAutomaticIntegrations({
        DATADOG_API_KEY: "canonical-secret",
        DD_API_KEY: "alias-secret",
        DATADOG_APP_KEY: "app-secret",
      })
    ).toThrow("Conflicting Datadog environment aliases");
  });

  it.each([
    ["datadoghq.com", "https://mcp.datadoghq.com/v1/mcp?toolsets=core"],
    ["us3.datadoghq.com", "https://mcp.us3.datadoghq.com/v1/mcp?toolsets=core"],
    ["us5.datadoghq.com", "https://mcp.us5.datadoghq.com/v1/mcp?toolsets=core"],
    ["datadoghq.eu", "https://mcp.datadoghq.eu/v1/mcp?toolsets=core"],
    ["ap1.datadoghq.com", "https://mcp.ap1.datadoghq.com/v1/mcp?toolsets=core"],
    ["ap2.datadoghq.com", "https://mcp.ap2.datadoghq.com/v1/mcp?toolsets=core"],
    ["uk1.datadoghq.com", "https://mcp.uk1.datadoghq.com/v1/mcp?toolsets=core"],
  ])("maps Datadog site %s", (site, expectedUrl) => {
    const result = resolveAutomaticIntegrations({
      DATADOG_ACCESS_TOKEN: "access",
      DATADOG_SITE: site,
    });
    expect(result.configFile.mcpServers[0]).toEqual(
      expect.objectContaining({ url: expectedUrl })
    );
  });

  it("rejects unsupported sites", () => {
    expect(() =>
      resolveAutomaticIntegrations({
        DATADOG_ACCESS_TOKEN: "access",
        DATADOG_SITE: "ddog-gov.com",
      })
    ).toThrow("Unsupported DATADOG_SITE");
  });

  it("applies toolset and omit-tool filters with URL encoding", () => {
    const result = resolveAutomaticIntegrations({
      DATADOG_ACCESS_TOKEN: "access",
      DATADOG_MCP_TOOLSETS: "core, software-delivery",
      DATADOG_MCP_OMIT_TOOLS:
        "create_datadog_notebook, edit_datadog_notebook",
    });
    const server = result.configFile.mcpServers[0];
    expect(new URL(server.url).searchParams.get("toolsets")).toBe(
      "core,software-delivery"
    );
    expect(new URL(server.url).searchParams.get("omit_tools")).toBe(
      "create_datadog_notebook,edit_datadog_notebook"
    );
  });

  it("requires secure URL overrides outside tests", () => {
    expect(() =>
      resolveAutomaticIntegrations({
        DATADOG_ACCESS_TOKEN: "access",
        DATADOG_MCP_URL: "http://localhost:4000/mcp",
      })
    ).toThrow("must use https");

    expect(
      resolveAutomaticIntegrations(
        {
          DATADOG_ACCESS_TOKEN: "access",
          DATADOG_MCP_URL: "http://localhost:4000/mcp",
        },
        { allowInsecureUrls: true }
      ).configFile.mcpServers[0]
    ).toEqual(expect.objectContaining({ url: expect.stringContaining("http:") }));
  });

  it("rejects credentials embedded in a URL override", () => {
    expect(() =>
      resolveAutomaticIntegrations({
        DATADOG_ACCESS_TOKEN: "access",
        DATADOG_MCP_URL: "https://user:secret@mcp.example.com/mcp",
      })
    ).toThrow("must not contain credentials");
  });

  it("builds a project-pinned, read-only PostHog integration", () => {
    const result = resolveAutomaticIntegrations({
      POSTHOG_PERSONAL_API_KEY: "phx_personal-secret",
      POSTHOG_PROJECT_ID: "12345",
    });

    expect(result.enabledIntegrationIds).toEqual(["posthog"]);
    expect(result.disabledIntegrationIds).toEqual([
      "datadog",
      "mongodb",
      "temporal",
    ]);
    expect(result.configFile.mcpServers).toEqual([
      expect.objectContaining({
        id: "posthog",
        transport: "streamable-http",
        url: "https://mcp.posthog.com/mcp?mode=cli&readonly=true",
        headers: {
          Authorization: "JOURNAL_BASTION_INTERNAL_POSTHOG_AUTHORIZATION",
          "x-posthog-project-id": "POSTHOG_PROJECT_ID",
        },
      }),
    ]);
    expect(result.derivedEnv).toEqual({
      JOURNAL_BASTION_INTERNAL_POSTHOG_AUTHORIZATION:
        "Bearer phx_personal-secret",
    });
    expect(JSON.stringify(result.configFile)).not.toContain(
      "phx_personal-secret"
    );
  });

  it.each([
    [
      { POSTHOG_PERSONAL_API_KEY: "phx_personal-secret" },
      "POSTHOG_PROJECT_ID",
    ],
    [{ POSTHOG_PROJECT_ID: "12345" }, "POSTHOG_PERSONAL_API_KEY"],
    [{ POSTHOG_FEATURES: "insights" }, "POSTHOG_PERSONAL_API_KEY"],
  ])("rejects partial PostHog configuration %#", (env, message) => {
    expect(() => resolveAutomaticIntegrations(env)).toThrow(message);
  });

  it("rejects a PostHog project ingestion key", () => {
    expect(() =>
      resolveAutomaticIntegrations({
        POSTHOG_PERSONAL_API_KEY: "phc_ingestion-secret",
        POSTHOG_PROJECT_ID: "12345",
      })
    ).toThrow("not a phc_ project ingestion key");
  });

  it("applies PostHog feature and tool filters while enforcing safe query flags", () => {
    const result = resolveAutomaticIntegrations({
      POSTHOG_PERSONAL_API_KEY: "phx_personal-secret",
      POSTHOG_PROJECT_ID: "12345",
      POSTHOG_FEATURES: "insights, error_tracking",
      POSTHOG_TOOLS: "dashboard-get, execute-sql",
      POSTHOG_MCP_URL:
        "https://posthog.example.com/custom?mode=tools&readonly=false",
    });
    const server = result.configFile.mcpServers[0];
    const url = new URL(server.url);

    expect(url.searchParams.get("mode")).toBe("cli");
    expect(url.searchParams.get("readonly")).toBe("true");
    expect(url.searchParams.get("features")).toBe("insights,error_tracking");
    expect(url.searchParams.get("tools")).toBe(
      "dashboard-get,execute-sql"
    );
  });

  it("requires a credential-free HTTPS PostHog endpoint outside tests", () => {
    const base = {
      POSTHOG_PERSONAL_API_KEY: "phx_personal-secret",
      POSTHOG_PROJECT_ID: "12345",
    };

    expect(() =>
      resolveAutomaticIntegrations({
        ...base,
        POSTHOG_MCP_URL: "http://localhost:4000/mcp",
      })
    ).toThrow("must use https");
    expect(() =>
      resolveAutomaticIntegrations({
        ...base,
        POSTHOG_MCP_URL: "https://user:secret@posthog.example.com/mcp",
      })
    ).toThrow("must not contain credentials");
    expect(
      resolveAutomaticIntegrations(
        { ...base, POSTHOG_MCP_URL: "http://localhost:4000/mcp" },
        { allowInsecureUrls: true }
      ).configFile.mcpServers[0]
    ).toEqual(expect.objectContaining({ url: expect.stringContaining("http:") }));
  });

  it("builds a scope-pinned MongoDB stdio integration", () => {
    const connectionString =
      "mongodb://readonly:secret@mongo.internal:27017/spendflo";
    const result = resolveAutomaticIntegrations({
      MDB_MCP_CONNECTION_STRING: connectionString,
    });

    expect(result.enabledIntegrationIds).toEqual(["mongodb"]);
    expect(result.disabledIntegrationIds).toEqual([
      "datadog",
      "posthog",
      "temporal",
    ]);
    expect(result.configFile.mcpServers).toEqual([
      expect.objectContaining({
        id: "mongodb",
        transport: "stdio",
        command: "mongodb-mcp-server",
        args: [
          "--readOnly",
          "--telemetry",
          "disabled",
          "--loggers",
          "stderr",
          "--disabledTools",
          "atlas,connect,disconnect,export",
        ],
        envVars: {
          MDB_MCP_CONNECTION_STRING: "MDB_MCP_CONNECTION_STRING",
        },
      }),
    ]);
    expect(result.derivedEnv).toEqual({});
    expect(JSON.stringify(result.configFile)).not.toContain(connectionString);
  });

  it.each([
    [{ MDB_MCP_CONNECTION_STRING: "" }, "missing MDB_MCP_CONNECTION_STRING"],
    [
      { MDB_MCP_CONNECTION_STRING: "https://mongo.internal/spendflo" },
      "must use mongodb:// or mongodb+srv://",
    ],
    [
      { MDB_MCP_CONNECTION_STRING: "not a URL" },
      "must be a valid MongoDB URL",
    ],
  ])("rejects invalid MongoDB configuration %#", (env, message) => {
    expect(() => resolveAutomaticIntegrations(env)).toThrow(message);
  });

  it("builds a fixed-target Temporal integration and bundled skill", () => {
    const result = resolveAutomaticIntegrations({
      TEMPORAL_API_KEY: "temporal-secret",
      TEMPORAL_NAMESPACE: "journal-test.a1b2c",
      TEMPORAL_ADDRESS: "journal-test.a1b2c.tmprl.cloud:7233",
    });

    expect(result.enabledIntegrationIds).toEqual(["temporal"]);
    expect(result.configFile.skillsDir).toMatch(/skills\/temporal-ops\/?$/);
    expect(result.configFile.mcpServers).toEqual([
      expect.objectContaining({
        id: "temporal",
        transport: "stdio",
        command: "journal-temporal-mcp",
        args: [],
        envVars: {
          TEMPORAL_API_KEY: "TEMPORAL_API_KEY",
          TEMPORAL_ADDRESS: "TEMPORAL_ADDRESS",
          TEMPORAL_NAMESPACE: "TEMPORAL_NAMESPACE",
        },
      }),
    ]);
    expect(JSON.stringify(result.configFile)).not.toContain("temporal-secret");
  });

  it.each([
    [{ TEMPORAL_API_KEY: "secret" }, "TEMPORAL_ADDRESS, TEMPORAL_NAMESPACE"],
    [
      {
        TEMPORAL_API_KEY: "secret",
        TEMPORAL_NAMESPACE: "journal-test.a1b2c",
        TEMPORAL_ADDRESS: "other.a1b2c.tmprl.cloud:7233",
      },
      "must exactly match",
    ],
  ])("rejects invalid Temporal configuration %#", (env, message) => {
    expect(() => resolveAutomaticIntegrations(env)).toThrow(message);
  });

  it("combines every automatic integration without putting secrets in config", () => {
    const secrets = [
      "dd-api-secret",
      "dd-app-secret",
      "phx_secret",
      "mongo-secret",
      "temporal-secret",
    ];
    const result = resolveAutomaticIntegrations({
      DATADOG_API_KEY: secrets[0],
      DATADOG_APP_KEY: secrets[1],
      POSTHOG_PERSONAL_API_KEY: secrets[2],
      POSTHOG_PROJECT_ID: "12345",
      MDB_MCP_CONNECTION_STRING: `mongodb://readonly:${secrets[3]}@mongo:27017/db`,
      TEMPORAL_API_KEY: secrets[4],
      TEMPORAL_NAMESPACE: "journal-test.a1b2c",
      TEMPORAL_ADDRESS: "journal-test.a1b2c.tmprl.cloud:7233",
    });

    expect(result.enabledIntegrationIds).toEqual([
      "datadog",
      "posthog",
      "mongodb",
      "temporal",
    ]);
    expect(result.disabledIntegrationIds).toEqual([]);
    expect(result.configFile.mcpServers.map((server) => server.id)).toEqual([
      "datadog",
      "posthog",
      "mongodb",
      "temporal",
    ]);
    for (const secret of secrets) {
      expect(JSON.stringify(result.configFile)).not.toContain(secret);
    }
  });
});
