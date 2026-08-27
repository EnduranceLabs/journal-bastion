import { describe, expect, it } from "vitest";
import { buildReadonlyInvocation } from "../../integrations/temporal/args.js";
import {
  READONLY_OPERATIONS,
  READONLY_OPERATION_IDS,
} from "../../integrations/temporal/operations.js";

const config = {
  authMode: "api-key" as const,
  apiKey: "secret",
  namespace: "journal-test.a1b2c",
  address: "journal-test.a1b2c.tmprl.cloud:7233",
};
const mtlsConfig = {
  authMode: "mtls" as const,
  tlsCertData:
    "-----BEGIN CERTIFICATE-----\nfixture-certificate\n-----END CERTIFICATE-----",
  tlsKeyData:
    "-----BEGIN PRIVATE KEY-----\nfixture-private-key\n-----END PRIVATE KEY-----",
  namespace: "journal-test.a1b2c",
  address: "journal-test.a1b2c.tmprl.cloud:7233",
};

describe("Temporal read-only operation policy", () => {
  it("contains inspection commands only", () => {
    expect(READONLY_OPERATION_IDS.length).toBeGreaterThan(10);
    const commandWords = Object.values(READONLY_OPERATIONS).flatMap(
      (definition) => definition.command
    );
    for (const forbidden of [
      "cancel",
      "create",
      "delete",
      "disable",
      "enable",
      "execute",
      "invite",
      "reset",
      "set",
      "signal",
      "start",
      "terminate",
      "update",
    ]) {
      expect(commandWords).not.toContain(forbidden);
    }
  });

  it("keeps mTLS credentials out of data-plane arguments", () => {
    const invocation = buildReadonlyInvocation("cluster.health", [], mtlsConfig);
    expect(invocation.args).not.toContain("--api-key");
    expect(invocation.args).not.toContain("--tls-cert-path");
    expect(invocation.args).not.toContain("--tls-key-path");
    expect(invocation.args).not.toContain("--tls-cert-data");
    expect(invocation.args).not.toContain("--tls-key-data");
    expect(invocation.args).not.toContain(mtlsConfig.tlsCertData);
    expect(invocation.args).not.toContain(mtlsConfig.tlsKeyData);
  });

  it("rejects Cloud control-plane operations in mTLS mode", () => {
    expect(() =>
      buildReadonlyInvocation("namespace.get", [], mtlsConfig)
    ).toThrow("requires Temporal Cloud API-key authentication");
  });

  it("injects the fixed data-plane target and no API key argument", () => {
    const invocation = buildReadonlyInvocation(
      "workflow.list",
      ["--limit", "1"],
      config
    );
    expect(invocation).toEqual({
      executable: "temporal",
      args: expect.arrayContaining([
        "workflow",
        "list",
        "--address",
        config.address,
        "--namespace",
        config.namespace,
      ]),
    });
    expect(invocation.args).not.toContain("--api-key");
    expect(invocation.args).not.toContain(config.apiKey);
  });

  it("injects the fixed Namespace for Namespace-scoped Cloud reads", () => {
    expect(
      buildReadonlyInvocation("namespace.get", [], config).args
    ).toEqual(
      expect.arrayContaining(["namespace", "get", "--namespace", config.namespace])
    );
  });

  it.each([
    ["--address", "other.example:7233"],
    ["--namespace", "other.account"],
    ["--api-key", "another-secret"],
    ["--config-file", "/tmp/config"],
    ["-n", "other.account"],
    ["--limit=1"],
    ["; touch /tmp/pwned"],
  ])("rejects unallowlisted argument sequence %#", (...args) => {
    expect(() =>
      buildReadonlyInvocation("workflow.list", args, config)
    ).toThrow();
  });
});
