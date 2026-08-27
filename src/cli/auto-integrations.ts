import type { BastionConfigFile } from "./config.js";
import { fileURLToPath } from "node:url";
import {
  hasTemporalIntent,
  parseTemporalConfig,
} from "../integrations/temporal/config.js";

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

const POSTHOG_ENV_NAMES = [
  "POSTHOG_PERSONAL_API_KEY",
  "POSTHOG_PROJECT_ID",
  "POSTHOG_FEATURES",
  "POSTHOG_TOOLS",
  "POSTHOG_MCP_URL",
] as const;

const MONGODB_ENV_NAMES = ["MDB_MCP_CONNECTION_STRING"] as const;

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
const DEFAULT_POSTHOG_MCP_URL = "https://mcp.posthog.com/mcp";
const INTERNAL_POSTHOG_AUTHORIZATION =
  "JOURNAL_BASTION_INTERNAL_POSTHOG_AUTHORIZATION";

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

function hasIntent(
  env: Record<string, string | undefined>,
  names: readonly string[]
): boolean {
  return names.some((name) =>
    Object.prototype.hasOwnProperty.call(env, name)
  );
}

function aliasedValue(
  env: Record<string, string | undefined>,
  names: string[],
  integrationName: string
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
        `Conflicting ${integrationName} environment aliases: ${configured
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
      aliasedValue(env, ["DATADOG_SITE", "DD_SITE"], "Datadog") ??
      DEFAULT_DATADOG_SITE
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

function resolvePosthogUrl(
  env: Record<string, string | undefined>,
  allowInsecureUrls: boolean
): string {
  const endpoint = value(env, "POSTHOG_MCP_URL") ?? DEFAULT_POSTHOG_MCP_URL;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error("POSTHOG_MCP_URL must be a valid URL");
  }

  if (url.username || url.password) {
    throw new Error("POSTHOG_MCP_URL must not contain credentials");
  }
  if (url.protocol !== "https:" && !allowInsecureUrls) {
    throw new Error("POSTHOG_MCP_URL must use https");
  }
  if (!(url.protocol === "https:" || url.protocol === "http:")) {
    throw new Error("POSTHOG_MCP_URL must use http or https");
  }

  url.searchParams.set("mode", "cli");
  url.searchParams.set("readonly", "true");

  const features = value(env, "POSTHOG_FEATURES");
  if (features) {
    url.searchParams.set(
      "features",
      normalizeCommaList(features, "POSTHOG_FEATURES")
    );
  }

  const tools = value(env, "POSTHOG_TOOLS");
  if (tools) {
    url.searchParams.set("tools", normalizeCommaList(tools, "POSTHOG_TOOLS"));
  }

  return url.toString();
}

function resolveDatadogIntegration(
  env: Record<string, string | undefined>,
  allowInsecureUrls: boolean
): {
  server: BastionConfigFile["mcpServers"][number];
  derivedEnv: Record<string, string>;
} | null {
  if (!hasIntent(env, DATADOG_ENV_NAMES)) return null;

  const accessToken = value(env, "DATADOG_ACCESS_TOKEN");
  const apiKey = aliasedValue(
    env,
    ["DATADOG_API_KEY", "DD_API_KEY"],
    "Datadog"
  );
  const appKey = aliasedValue(
    env,
    ["DATADOG_APP_KEY", "DD_APP_KEY", "DD_APPLICATION_KEY"],
    "Datadog"
  );
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
    server: {
      id: "datadog",
      name: "Datadog",
      description:
        "Read-only investigation of Datadog logs, metrics, traces, monitors, incidents, dashboards, and services",
      transport: "streamable-http",
      url: resolveDatadogUrl(env, allowInsecureUrls),
      headers,
    },
    derivedEnv,
  };
}

function resolvePosthogIntegration(
  env: Record<string, string | undefined>,
  allowInsecureUrls: boolean
): {
  server: BastionConfigFile["mcpServers"][number];
  derivedEnv: Record<string, string>;
} | null {
  if (!hasIntent(env, POSTHOG_ENV_NAMES)) return null;

  const personalApiKey = value(env, "POSTHOG_PERSONAL_API_KEY");
  const projectId = value(env, "POSTHOG_PROJECT_ID");
  const missing: string[] = [];
  if (!personalApiKey) missing.push("POSTHOG_PERSONAL_API_KEY");
  if (!projectId) missing.push("POSTHOG_PROJECT_ID");
  if (missing.length > 0) {
    throw new Error(`Incomplete PostHog integration: missing ${missing.join(", ")}`);
  }
  const resolvedPersonalApiKey = personalApiKey as string;
  if (resolvedPersonalApiKey.startsWith("phc_")) {
    throw new Error(
      "POSTHOG_PERSONAL_API_KEY must be a personal API key, not a phc_ project ingestion key"
    );
  }

  return {
    server: {
      id: "posthog",
      name: "PostHog",
      description:
        "Read-only product analytics, feature flags, experiments, errors, logs, replays, and project context",
      transport: "streamable-http",
      url: resolvePosthogUrl(env, allowInsecureUrls),
      headers: {
        Authorization: INTERNAL_POSTHOG_AUTHORIZATION,
        "x-posthog-project-id": "POSTHOG_PROJECT_ID",
      },
    },
    derivedEnv: {
      [INTERNAL_POSTHOG_AUTHORIZATION]: `Bearer ${resolvedPersonalApiKey}`,
    },
  };
}

function resolveMongodbIntegration(
  env: Record<string, string | undefined>
): {
  server: BastionConfigFile["mcpServers"][number];
  derivedEnv: Record<string, string>;
} | null {
  if (!hasIntent(env, MONGODB_ENV_NAMES)) return null;

  const connectionString = value(env, "MDB_MCP_CONNECTION_STRING");
  if (!connectionString) {
    throw new Error(
      "Incomplete MongoDB integration: missing MDB_MCP_CONNECTION_STRING"
    );
  }

  let connectionUrl: URL;
  try {
    connectionUrl = new URL(connectionString);
  } catch {
    throw new Error("MDB_MCP_CONNECTION_STRING must be a valid MongoDB URL");
  }
  if (
    connectionUrl.protocol !== "mongodb:" &&
    connectionUrl.protocol !== "mongodb+srv:"
  ) {
    throw new Error(
      "MDB_MCP_CONNECTION_STRING must use mongodb:// or mongodb+srv://"
    );
  }

  return {
    server: {
      id: "mongodb",
      name: "MongoDB",
      description:
        "Read-only queries and metadata for the configured MongoDB deployment",
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
    },
    derivedEnv: {},
  };
}

function resolveTemporalIntegration(
  env: Record<string, string | undefined>
): {
  server: BastionConfigFile["mcpServers"][number];
  derivedEnv: Record<string, string>;
} | null {
  if (!hasTemporalIntent(env)) return null;

  const config = parseTemporalConfig(env);
  const authenticationEnvVars: Record<string, string> =
    config.authMode === "api-key"
      ? { TEMPORAL_API_KEY: "TEMPORAL_API_KEY" }
      : {
          TEMPORAL_TLS_CERT_DATA: "TEMPORAL_TLS_CERT_DATA",
          TEMPORAL_TLS_KEY_DATA: "TEMPORAL_TLS_KEY_DATA",
        };
  return {
    server: {
      id: "temporal",
      name: "Temporal Cloud",
      description:
        "Read-only Temporal Cloud workflow, worker, schedule, capacity, Namespace, and authentication diagnostics for one configured Namespace",
      transport: "stdio",
      command: "journal-temporal-mcp",
      args: [],
      envVars: {
        ...authenticationEnvVars,
        TEMPORAL_ADDRESS: "TEMPORAL_ADDRESS",
        TEMPORAL_NAMESPACE: "TEMPORAL_NAMESPACE",
      },
    },
    derivedEnv: {},
  };
}

function bundledSkillsDir(): string {
  return fileURLToPath(new URL("../../skills/temporal-ops/", import.meta.url));
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
  const allowInsecureUrls = options.allowInsecureUrls ?? false;
  const resolved = [
    ["datadog", resolveDatadogIntegration(env, allowInsecureUrls)],
    ["posthog", resolvePosthogIntegration(env, allowInsecureUrls)],
    ["mongodb", resolveMongodbIntegration(env)],
    ["temporal", resolveTemporalIntegration(env)],
  ] as const;

  const enabled = resolved.flatMap(([id, integration]) =>
    integration ? [{ id, integration }] : []
  );
  const disabled = resolved
    .filter(([, integration]) => integration === null)
    .map(([id]) => id);

  return {
    configFile: {
      mcpServers: enabled.map(({ integration }) => integration.server),
      skillsDir: enabled.some(({ id }) => id === "temporal")
        ? bundledSkillsDir()
        : null,
    },
    derivedEnv: Object.assign(
      {},
      ...enabled.map(({ integration }) => integration.derivedEnv)
    ),
    enabledIntegrationIds: enabled.map(({ id }) => id),
    disabledIntegrationIds: disabled,
  };
}
