import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runReadonlyTemporalOperation } from "../../integrations/temporal/runner.js";

const config = {
  apiKey: "runner-secret",
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
