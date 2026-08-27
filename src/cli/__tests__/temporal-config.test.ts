import { describe, expect, it } from "vitest";
import {
  hasTemporalIntent,
  parseTemporalConfig,
} from "../../integrations/temporal/config.js";

describe("Temporal configuration", () => {
  const certData =
    "-----BEGIN CERTIFICATE-----\nfixture-certificate\n-----END CERTIFICATE-----";
  const keyData =
    "-----BEGIN PRIVATE KEY-----\nfixture-private-key\n-----END PRIVATE KEY-----";
  const complete = {
    TEMPORAL_API_KEY: "top-secret",
    TEMPORAL_NAMESPACE: "journal-test.a1b2c",
    TEMPORAL_ADDRESS: "journal-test.a1b2c.tmprl.cloud:7233",
  };
  const completeMtls = {
    TEMPORAL_TLS_CERT_DATA: certData,
    TEMPORAL_TLS_KEY_DATA: keyData,
    TEMPORAL_NAMESPACE: "journal-test.a1b2c",
    TEMPORAL_ADDRESS: "journal-test.a1b2c.tmprl.cloud:7233",
  };

  it("detects intent and returns the fixed Cloud target", () => {
    expect(hasTemporalIntent({})).toBe(false);
    expect(hasTemporalIntent({ TEMPORAL_API_KEY: "" })).toBe(true);
    expect(parseTemporalConfig(complete)).toEqual({
      authMode: "api-key",
      apiKey: "top-secret",
      namespace: "journal-test.a1b2c",
      address: "journal-test.a1b2c.tmprl.cloud:7233",
    });
    expect(parseTemporalConfig(completeMtls)).toEqual({
      authMode: "mtls",
      tlsCertData: certData,
      tlsKeyData: keyData,
      namespace: "journal-test.a1b2c",
      address: "journal-test.a1b2c.tmprl.cloud:7233",
    });
  });

  it("detects mTLS intent", () => {
    expect(hasTemporalIntent({ TEMPORAL_TLS_CERT_DATA: "" })).toBe(true);
  });

  it.each([
    {},
    { TEMPORAL_API_KEY: "top-secret" },
    { ...complete, TEMPORAL_NAMESPACE: "journal-test" },
    { ...complete, TEMPORAL_ADDRESS: "https://journal-test.a1b2c.tmprl.cloud:7233" },
    { ...complete, TEMPORAL_ADDRESS: "journal-test.a1b2c.tmprl.cloud:443" },
    {
      ...completeMtls,
      TEMPORAL_TLS_KEY_DATA: undefined,
    },
    {
      ...completeMtls,
      TEMPORAL_API_KEY: "ambiguous-secret",
    },
  ])("rejects incomplete or movable targets %#", (env) => {
    expect(() => parseTemporalConfig(env)).toThrow();
  });

  it("never includes the API key in validation errors", () => {
    try {
      parseTemporalConfig({
        TEMPORAL_API_KEY: "do-not-leak",
        TEMPORAL_NAMESPACE: "journal-test.a1b2c",
        TEMPORAL_ADDRESS: "wrong.a1b2c.tmprl.cloud:7233",
      });
    } catch (error) {
      expect(String(error)).not.toContain("do-not-leak");
    }
  });

  it("never includes mTLS contents in validation errors", () => {
    try {
      parseTemporalConfig({
        TEMPORAL_TLS_CERT_DATA: certData,
        TEMPORAL_NAMESPACE: "journal-test.a1b2c",
        TEMPORAL_ADDRESS: "journal-test.a1b2c.tmprl.cloud:7233",
      });
    } catch (error) {
      expect(String(error)).not.toContain(certData);
    }
  });

  it.each([
    { ...completeMtls, TEMPORAL_TLS_CERT_DATA: "not-a-certificate" },
    { ...completeMtls, TEMPORAL_TLS_KEY_DATA: "not-a-private-key" },
  ])("rejects malformed PEM without disclosing it %#", (env) => {
    expect(() => parseTemporalConfig(env)).toThrow("PEM-encoded");
    try {
      parseTemporalConfig(env);
    } catch (error) {
      expect(String(error)).not.toContain("not-a-");
    }
  });
});
