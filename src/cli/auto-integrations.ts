import type { BastionConfigFile } from "./config.js";

const DATADOG_ENV_NAMES = [
  "DATADOG_ACCESS_TOKEN",
  "DATADOG_API_KEY",
  "DATADOG_APP_KEY",
  "DATADOG_SITE",
  "DATADOG_MCP_TOOLSETS",
  "DATADOG_MCP_OMIT_TOOLS",
  "DATADOG_MCP_URL",
  "DD_API_KEY",
  "DD_APP_KEY",
  "DD_APPLICATION_KEY",
  "DD_SITE",
] as const;

const DATADOG_SITE_ENDPOINTS: Record<string, string> = {
  "app.datadoghq.com": "https://mcp.datadoghq.com/v1/mcp",
  "datadoghq.com": "https://mcp.datadoghq.com/v1/mcp",
  us1: "https://mcp.datadoghq.com/v1/mcp",
  "us3.datadoghq.com": "https://mcp.us3.datadoghq.com/v1/mcp",
  us3: "https://mcp.us3.datadoghq.com/v1/mcp",
  "us5.datadoghq.com": "https://mcp.us5.datadoghq.com/v1/mcp",
  us5: "https://mcp.us5.datadoghq.com/v1/mcp",
  "app.datadoghq.eu": "https://mcp.datadoghq.eu/v1/mcp",
  "datadoghq.eu": "https://mcp.datadoghq.eu/v1/mcp",
  eu: "https://mcp.datadoghq.eu/v1/mcp",
  eu1: "https://mcp.datadoghq.eu/v1/mcp",
  "ap1.datadoghq.com": "https://mcp.ap1.datadoghq.com/v1/mcp",
  ap1: "https://mcp.ap1.datadoghq.com/v1/mcp",
  "ap2.datadoghq.com": "https://mcp.ap2.datadoghq.com/v1/mcp",
  ap2: "https://mcp.ap2.datadoghq.com/v1/mcp",
  "uk1.datadoghq.com": "https://mcp.uk1.datadoghq.com/v1/mcp",
  uk1: "https://mcp.uk1.datadoghq.com/v1/mcp",
};

const DEFAULT_DATADOG_SITE = "datadoghq.com";
const DEFAULT_DATADOG_TOOLSETS = "core";
const INTERNAL_DATADOG_AUTHORIZATION =
  "JOURNAL_BASTION_INTERNAL_DATADOG_AUTHORIZATION";
const INTERNAL_DATADOG_API_KEY = "JOURNAL_BASTION_INTERNAL_DATADOG_API_KEY";
const INTERNAL_DATADOG_APP_KEY = "JOURNAL_BASTION_INTERNAL_DATADOG_APP_KEY";

export interface AutomaticIntegrationsResult {
  configFile: BastionConfigFile;
  derivedEnv: Record<string, string>;
  enabledIntegrationIds: string[];
  disabledIntegrationIds: string[];
}

function value(
  env: Record<string, string | undefined>,
  name: string
): string | undefined {
  const raw = env[name];
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function hasDatadogIntent(env: Record<string, string | undefined>): boolean {
  return DATADOG_ENV_NAMES.some((name) =>
    Object.prototype.hasOwnProperty.call(env, name)
  );
}

function aliasedValue(
  env: Record<string, string | undefined>,
  names: string[]
): string | undefined {
  const configured = names
    .map((name) => ({ name, value: value(env, name) }))
    .filter((entry): entry is { name: string; value: string } =>
      entry.value !== undefined
    );

  if (configured.length > 1) {
    const first = configured[0].value;
    if (configured.some((entry) => entry.value !== first)) {
      throw new Error(
        `Conflicting Datadog environment aliases: ${configured
          .map((entry) => entry.name)
          .join(", ")}`
      );
    }
  }

  return configured[0]?.value;
}

function normalizeCommaList(raw: string, name: string): string {
  const values = raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (values.length === 0) {
    throw new Error(`${name} must contain at least one value`);
  }

  for (const entry of values) {
    if (!/^[A-Za-z0-9_-]+$/.test(entry)) {
      throw new Error(`${name} contains an invalid value: ${entry}`);
    }
  }

  return values.join(",");
}

function resolveDatadogUrl(
  env: Record<string, string | undefined>,
  allowInsecureUrls: boolean
): string {
  const override = value(env, "DATADOG_MCP_URL");
  let endpoint: string;

  if (override) {
    let parsed: URL;
    try {
      parsed = new URL(override);
    } catch {
      throw new Error("DATADOG_MCP_URL must be a valid URL");
    }
    if (parsed.username || parsed.password) {
      throw new Error("DATADOG_MCP_URL must not contain credentials");
    }
    if (parsed.protocol !== "https:" && !allowInsecureUrls) {
      throw new Error("DATADOG_MCP_URL must use https");
    }
    if (!(parsed.protocol === "https:" || parsed.protocol === "http:")) {
      throw new Error("DATADOG_MCP_URL must use http or https");
    }
    endpoint = parsed.toString();
  } else {
    const site = (
      aliasedValue(env, ["DATADOG_SITE", "DD_SITE"]) ?? DEFAULT_DATADOG_SITE
    ).toLowerCase();
    const mapped = DATADOG_SITE_ENDPOINTS[site];
    if (!mapped) {
      const supportedSites = [
        "datadoghq.com (US1)",
        "us3.datadoghq.com",
        "us5.datadoghq.com",
        "datadoghq.eu",
        "ap1.datadoghq.com",
        "ap2.datadoghq.com",
        "uk1.datadoghq.com",
      ].join(", ");
      throw new Error(
        `Unsupported DATADOG_SITE ${site}. Supported sites: ${supportedSites}`
      );
    }
    endpoint = mapped;
  }

  const url = new URL(endpoint);
  const toolsets = normalizeCommaList(
    value(env, "DATADOG_MCP_TOOLSETS") ?? DEFAULT_DATADOG_TOOLSETS,
    "DATADOG_MCP_TOOLSETS"
  );
  url.searchParams.set("toolsets", toolsets);

  const omitTools = value(env, "DATADOG_MCP_OMIT_TOOLS");
  if (omitTools) {
    url.searchParams.set(
      "omit_tools",
      normalizeCommaList(omitTools, "DATADOG_MCP_OMIT_TOOLS")
    );
  }

  return url.toString();
}

export function automaticIntegrationsEnabled(
  env: Record<string, string | undefined>
): boolean {
  const raw = value(env, "JOURNAL_BASTION_AUTO_INTEGRATIONS");
  if (raw === undefined) return false;
  const normalized = raw.toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  throw new Error("JOURNAL_BASTION_AUTO_INTEGRATIONS must be true or false");
}

export function resolveAutomaticIntegrations(
  env: Record<string, string | undefined>,
  options: { allowInsecureUrls?: boolean } = {}
): AutomaticIntegrationsResult {
  if (!hasDatadogIntent(env)) {
    return {
      configFile: { mcpServers: [], skillsDir: null },
      derivedEnv: {},
      enabledIntegrationIds: [],
      disabledIntegrationIds: ["datadog"],
    };
  }

  const accessToken = value(env, "DATADOG_ACCESS_TOKEN");
  const apiKey = aliasedValue(env, ["DATADOG_API_KEY", "DD_API_KEY"]);
  const appKey = aliasedValue(env, [
    "DATADOG_APP_KEY",
    "DD_APP_KEY",
    "DD_APPLICATION_KEY",
  ]);
  const hasAccessToken = accessToken !== undefined;
  const hasAnyKeyPairValue = apiKey !== undefined || appKey !== undefined;

  if (hasAccessToken && hasAnyKeyPairValue) {
    throw new Error(
      "Datadog authentication is ambiguous: set DATADOG_ACCESS_TOKEN or DATADOG_API_KEY with DATADOG_APP_KEY, not both"
    );
  }

  if (!hasAccessToken && !apiKey && !appKey) {
    throw new Error(
      "Datadog integration requires DATADOG_ACCESS_TOKEN or both DATADOG_API_KEY and DATADOG_APP_KEY"
    );
  }

  const missingKeyPairVariables: string[] = [];
  if (!hasAccessToken) {
    if (!apiKey) missingKeyPairVariables.push("DATADOG_API_KEY");
    if (!appKey) missingKeyPairVariables.push("DATADOG_APP_KEY");
  }
  if (missingKeyPairVariables.length > 0) {
    throw new Error(
      `Incomplete Datadog integration: missing ${missingKeyPairVariables.join(", ")}`
    );
  }

  const derivedEnv: Record<string, string> = {};
  const headers: Record<string, string> = {};
  if (accessToken) {
    derivedEnv[INTERNAL_DATADOG_AUTHORIZATION] = `Bearer ${accessToken}`;
    headers.Authorization = INTERNAL_DATADOG_AUTHORIZATION;
  } else {
    derivedEnv[INTERNAL_DATADOG_API_KEY] = apiKey as string;
    derivedEnv[INTERNAL_DATADOG_APP_KEY] = appKey as string;
    headers.DD_API_KEY = INTERNAL_DATADOG_API_KEY;
    headers.DD_APPLICATION_KEY = INTERNAL_DATADOG_APP_KEY;
  }

  return {
    configFile: {
      mcpServers: [
        {
          id: "datadog",
          name: "Datadog",
          description:
            "Read-only investigation of Datadog logs, metrics, traces, monitors, incidents, dashboards, and services",
          transport: "streamable-http",
          url: resolveDatadogUrl(
            env,
            options.allowInsecureUrls ?? false
          ),
          headers,
        },
      ],
      skillsDir: null,
    },
    derivedEnv,
    enabledIntegrationIds: ["datadog"],
    disabledIntegrationIds: [],
  };
}
