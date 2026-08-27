import { access, chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runReadonlyTemporalOperation } from "../../integrations/temporal/runner.js";

const config = {
  authMode: "api-key" as const,
  apiKey: "runner-secret",
  namespace: "journal-test.a1b2c",
  address: "journal-test.a1b2c.tmprl.cloud:7233",
};
const mtlsConfig = {
  authMode: "mtls" as const,
  tlsCertData:
    "-----BEGIN CERTIFICATE-----\nrunner-certificate-secret\n-----END CERTIFICATE-----",
  tlsKeyData:
    "-----BEGIN PRIVATE KEY-----\nrunner-private-key-secret\n-----END PRIVATE KEY-----",
  namespace: "journal-test.a1b2c",
  address: "journal-test.a1b2c.tmprl.cloud:7233",
};

async function fixture(script: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "temporal-runner-"));
  const path = join(dir, "fixture");
  await writeFile(path, `#!/bin/sh\n${script}\n`, "utf8");
  await chmod(path, 0o700);
  return path;
}

describe("Temporal runner", () => {
  it("passes fixed credentials through environment and redacts output", async () => {
    const executable = await fixture(
      'printf "%s\\n" "$TEMPORAL_API_KEY"; printf "%s\\n" "$TEMPORAL_CLOUD_API_KEY" >&2'
    );
    const result = await runReadonlyTemporalOperation(
      "workflow.list",
      ["--limit", "1"],
      config,
      { binaries: { temporal: executable } }
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("[REDACTED]");
    expect(result.stderr).toContain("[REDACTED]");
    expect(JSON.stringify(result)).not.toContain(config.apiKey);
  });

  it("materializes mTLS env data securely, redacts it, and removes the files", async () => {
    const executable = await fixture(
      'cert=""; key=""; while [ "$#" -gt 0 ]; do case "$1" in --tls-cert-path) cert="$2"; shift 2 ;; --tls-key-path) key="$2"; shift 2 ;; *) shift ;; esac; done; printf "%s\\n%s\\n" "$cert" "$key"; cat "$cert"; cat "$key" >&2; test -z "$TEMPORAL_API_KEY"; test -z "$TEMPORAL_CLOUD_API_KEY"'
    );
    const result = await runReadonlyTemporalOperation(
      "workflow.list",
      ["--limit", "1"],
      mtlsConfig,
      { binaries: { temporal: executable } }
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("[REDACTED]");
    expect(result.stderr).toContain("[REDACTED]");
    expect(JSON.stringify(result)).not.toContain(mtlsConfig.tlsCertData);
    expect(JSON.stringify(result)).not.toContain(mtlsConfig.tlsKeyData);
    const [certPath, keyPath] = result.stdout.split("\n");
    await expect(access(certPath)).rejects.toThrow();
    await expect(access(keyPath)).rejects.toThrow();
  });

  it("rejects mTLS control-plane operations before spawning", async () => {
    await expect(
      runReadonlyTemporalOperation("namespace.get", [], mtlsConfig, {
        binaries: { tcld: "/does/not/exist" },
      })
    ).rejects.toThrow("requires Temporal Cloud API-key authentication");
  });

  it("bounds runtime", async () => {
    const executable = await fixture("sleep 5");
    const result = await runReadonlyTemporalOperation(
      "cluster.health",
      [],
      config,
      { binaries: { temporal: executable }, timeoutMs: 25 }
    );
    expect(result.timedOut).toBe(true);
  });

  it("bounds captured output", async () => {
    const executable = await fixture("printf '1234567890'");
    const result = await runReadonlyTemporalOperation(
      "cluster.health",
      [],
      config,
      { binaries: { temporal: executable }, outputLimitBytes: 5 }
    );
    expect(result.stdout).toBe("12345");
    expect(result.truncated).toBe(true);
  });
});
