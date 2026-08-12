#!/usr/bin/env node

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { ZodError } from "zod";
import {
  parseConfig,
  readBastionEnv,
  resolveConfigFilePath,
} from "./config.js";
import { EnvFile } from "./env-file.js";
import { Runtime } from "./runtime.js";
import { BastionConnection, AuthenticationError } from "./connection.js";
import { Logger } from "./common/logger.js";
import { Telemetry } from "./telemetry.js";
import { AuditLogger } from "./audit.js";
import { VERSION } from "./version.js";

const HELP = `journal-bastion ${VERSION}

Connect MCP servers and skills in your network to Journal (https://journal.one).

Usage:
  journal-bastion [--config <path>] [--env-file <path>]

Options:
  --config <path>     Bastion config file (JSON). Overrides JOURNAL_BASTION_CONFIG.
  --env-file <path>   .env file to load. Overrides JOURNAL_BASTION_ENV_FILE.
  -h, --help          Show this help and exit.
  -v, --version       Print the version and exit.

Environment:
  JOURNAL_BASTION_TOKEN     Auth token from Journal (required, starts with gw_).
  JOURNAL_BASTION_URL       Journal endpoint (default wss://bastion.journal.one).
  JOURNAL_BASTION_CONFIG    Config file path, or inline JSON.
  JOURNAL_BASTION_ENV_FILE  .env file path (auto-detects ./.env if unset).
  LOG_LEVEL                 debug | info | warn | error (default info).

Example:
  JOURNAL_BASTION_TOKEN=gw_xxx journal-bastion --config bastion.json

Docs: https://github.com/EnduranceLabs/journal-bastion#readme`;

function resolveEnvFilePath(
  env: Record<string, string | undefined>,
  argv: string[]
): string | null {
  // --env-file CLI arg
  const idx = argv.indexOf("--env-file");
  if (idx !== -1 && idx + 1 < argv.length) {
    return argv[idx + 1];
  }

  // JOURNAL_BASTION_ENV_FILE env var
  const envFilePath = readBastionEnv(env, "ENV_FILE");
  if (envFilePath) return envFilePath;

  // Auto-detect .env in cwd
  const defaultPath = resolve(".env");
  if (existsSync(defaultPath)) return defaultPath;

  return null;
}

function formatConfigError(err: unknown): string {
  if (err instanceof ZodError) {
    const issues = err.issues
      .map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    return `Invalid configuration:\n${issues}`;
  }
  return err instanceof Error ? err.message : String(err);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(HELP);
    process.exit(0);
  }
  if (argv.includes("--version") || argv.includes("-v")) {
    console.log(VERSION);
    process.exit(0);
  }

  // Resolve .env file and load it before parsing config
  const envFilePath = resolveEnvFilePath(process.env, process.argv);

  let mergedEnv: Record<string, string | undefined> = { ...process.env };
  if (envFilePath) {
    const envFile = new EnvFile(envFilePath);
    const envVars = envFile.load();
    // .env values fill in gaps; process.env takes precedence
    mergedEnv = { ...envVars, ...process.env };
  }

  let config;
  try {
    config = parseConfig(mergedEnv, process.argv);
  } catch (err) {
    console.error(formatConfigError(err));
    console.error("\nRun `journal-bastion --help` for usage.");
    process.exit(1);
  }
  const logger = new Logger(config.logLevel);
  for (const warning of config.warnings) {
    logger.warn(warning);
  }

  const telemetry = new Telemetry();
  await telemetry.start({
    endpoint: mergedEnv.OTEL_EXPORTER_OTLP_ENDPOINT,
    serviceName: mergedEnv.OTEL_SERVICE_NAME ?? "journal-bastion",
    disabled: (mergedEnv.TELEMETRY_DISABLED ?? "").toLowerCase() === "true",
  });

  const audit = new AuditLogger({
    filePath: mergedEnv.AUDIT_LOG_FILE ?? null,
    enabled: true,
    maxBytes: mergedEnv.AUDIT_MAX_BYTES ? Number(mergedEnv.AUDIT_MAX_BYTES) : null,
    maxFiles: mergedEnv.AUDIT_MAX_FILES ? Number(mergedEnv.AUDIT_MAX_FILES) : null,
  });

  const configFilePath = resolveConfigFilePath(mergedEnv, process.argv);

  logger.info("Starting Journal Bastion", {
    url: config.url,
    mcpServers: config.mcpServers.map((s) => s.id),
    ...(config.skillsDir ? { skillsDir: config.skillsDir } : {}),
    ...(configFilePath ? { configFile: configFilePath } : {}),
    ...(envFilePath ? { envFile: envFilePath } : {}),
  });

  const runtime = new Runtime(config, configFilePath, envFilePath, {
    telemetry,
    audit,
  });
  await runtime.start();

  const connection = new BastionConnection(config, runtime, telemetry, audit);

  // Register signal handlers before connect() so shutdown works during
  // startup retries (connect blocks until first auth success).
  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}, shutting down`);
    await connection.close();
    await runtime.stop();
    await telemetry.shutdown();
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  try {
    await connection.connect();
    logger.info("Journal Bastion is running");
  } catch (err) {
    if (err instanceof AuthenticationError) {
      logger.error("Service rejected the bastion token, exiting", {
        error: err.message,
      });
      await runtime.stop();
      await telemetry.shutdown();
      process.exit(1);
    }
    // close() was called before first successful connection
    // (e.g. SIGTERM during startup). Shutdown handler already ran.
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
