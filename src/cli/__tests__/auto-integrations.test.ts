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
  it("returns an empty catalog when Datadog is absent", () => {
    expect(resolveAutomaticIntegrations({})).toEqual({
      configFile: { mcpServers: [], skillsDir: null },
      derivedEnv: {},
      enabledIntegrationIds: [],
      disabledIntegrationIds: ["datadog"],
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
});
