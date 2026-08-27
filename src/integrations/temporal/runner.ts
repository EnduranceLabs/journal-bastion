import { spawn } from "node:child_process";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TemporalConfig } from "./config.js";
import {
  READONLY_OPERATIONS,
  type ReadonlyTemporalOperation,
} from "./operations.js";
import { buildReadonlyInvocation } from "./args.js";

const DEFAULT_TIMEOUT_MS = 45_000;
const DEFAULT_OUTPUT_LIMIT = 1_048_576;

export interface TemporalRunResult {
  operation: ReadonlyTemporalOperation;
  namespace: string;
  exitCode: number | null;
  durationMs: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  truncated: boolean;
}

export interface TemporalRunnerOptions {
  binaries?: Partial<Record<"temporal" | "tcld", string>>;
  timeoutMs?: number;
  outputLimitBytes?: number;
}

function redact(value: string, config: TemporalConfig): string {
  const secrets =
    config.authMode === "api-key"
      ? [config.apiKey]
      : [config.tlsCertData, config.tlsKeyData];
  return secrets.reduce(
    (redacted, secret) =>
      secret.length > 0 ? redacted.split(secret).join("[REDACTED]") : redacted,
    value
  );
}

async function materializeMtlsCredentials(config: Extract<
  TemporalConfig,
  { authMode: "mtls" }
>): Promise<{
  directory: string;
  tlsCertPath: string;
  tlsKeyPath: string;
}> {
  const directory = await mkdtemp(join(tmpdir(), "journal-temporal-mtls-"));
  const tlsCertPath = join(directory, "client.pem");
  const tlsKeyPath = join(directory, "client.key");

  try {
    await chmod(directory, 0o700);
    await Promise.all([
      writeFile(tlsCertPath, config.tlsCertData, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      }),
      writeFile(tlsKeyPath, config.tlsKeyData, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      }),
    ]);
    return { directory, tlsCertPath, tlsKeyPath };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

export async function runReadonlyTemporalOperation(
  operation: ReadonlyTemporalOperation,
  suppliedArgs: readonly string[],
  config: TemporalConfig,
  options: TemporalRunnerOptions = {}
): Promise<TemporalRunResult> {
  if (
    config.authMode === "mtls" &&
    READONLY_OPERATIONS[operation].executable === "tcld"
  ) {
    buildReadonlyInvocation(operation, suppliedArgs, config);
  }

  const credentialFiles =
    config.authMode === "mtls"
      ? await materializeMtlsCredentials(config)
      : undefined;

  try {
    const invocation = buildReadonlyInvocation(
      operation,
      suppliedArgs,
      config,
      credentialFiles
    );
    const executable =
      options.binaries?.[invocation.executable] ??
      `/usr/local/bin/${invocation.executable}`;
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const outputLimit = options.outputLimitBytes ?? DEFAULT_OUTPUT_LIMIT;
    const startedAt = Date.now();

    return await new Promise<TemporalRunResult>((resolve) => {
      const child = spawn(executable, invocation.args, {
        shell: false,
        detached: process.platform !== "win32",
        cwd: "/tmp",
        env: {
          HOME: "/tmp",
          LANG: "C.UTF-8",
          NO_COLOR: "1",
          PATH: "/usr/local/bin:/usr/bin:/bin",
          ...(config.authMode === "api-key"
            ? {
                TEMPORAL_API_KEY: config.apiKey,
                TEMPORAL_CLOUD_API_KEY: config.apiKey,
              }
            : {}),
        },
        stdio: ["ignore", "pipe", "pipe"],
      });

      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let truncated = false;
      let timedOut = false;
      let settled = false;

      const append = (
        chunks: Buffer[],
        currentBytes: number,
        chunk: Buffer
      ): number => {
        if (currentBytes >= outputLimit) {
          truncated = true;
          return currentBytes;
        }
        const remaining = outputLimit - currentBytes;
        if (chunk.length > remaining) truncated = true;
        const accepted = chunk.subarray(0, remaining);
        chunks.push(Buffer.from(accepted));
        return currentBytes + accepted.length;
      };

      child.stdout?.on("data", (chunk: Buffer) => {
        stdoutBytes = append(stdoutChunks, stdoutBytes, chunk);
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        stderrBytes = append(stderrChunks, stderrBytes, chunk);
      });

      const stopChild = (): void => {
        if (!child.pid) return;
        try {
          if (process.platform === "win32") child.kill("SIGTERM");
          else process.kill(-child.pid, "SIGTERM");
        } catch {
          child.kill("SIGTERM");
        }
      };

      const timer = setTimeout(() => {
        timedOut = true;
        stopChild();
      }, timeoutMs);

      const finish = (exitCode: number | null, spawnError?: Error): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (spawnError) {
          stderrBytes = append(
            stderrChunks,
            stderrBytes,
            Buffer.from(spawnError.message)
          );
        }
        resolve({
          operation,
          namespace: config.namespace,
          exitCode,
          durationMs: Date.now() - startedAt,
          stdout: redact(Buffer.concat(stdoutChunks).toString("utf8"), config),
          stderr: redact(Buffer.concat(stderrChunks).toString("utf8"), config),
          timedOut,
          truncated,
        });
      };

      child.on("error", (error) => finish(null, error));
      child.on("close", (code) => finish(code));
    });
  } finally {
    if (credentialFiles) {
      await rm(credentialFiles.directory, { recursive: true, force: true });
    }
  }
}
