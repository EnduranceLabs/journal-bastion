import { describe, expect, it } from "vitest";
import {
  hasTemporalIntent,
  parseTemporalConfig,
} from "../../integrations/temporal/config.js";

describe("Temporal configuration", () => {
  const complete = {
    TEMPORAL_API_KEY: "top-secret",
    TEMPORAL_NAMESPACE: "journal-test.a1b2c",
    TEMPORAL_ADDRESS: "journal-test.a1b2c.tmprl.cloud:7233",
  };

  it("detects intent and returns the fixed Cloud target", () => {
    expect(hasTemporalIntent({})).toBe(false);
    expect(hasTemporalIntent({ TEMPORAL_API_KEY: "" })).toBe(true);
    expect(parseTemporalConfig(complete)).toEqual({
      apiKey: "top-secret",
      namespace: "journal-test.a1b2c",
      address: "journal-test.a1b2c.tmprl.cloud:7233",
    });
  });

  it.each([
    {},
    { TEMPORAL_API_KEY: "top-secret" },
    { ...complete, TEMPORAL_NAMESPACE: "journal-test" },
    { ...complete, TEMPORAL_ADDRESS: "https://journal-test.a1b2c.tmprl.cloud:7233" },
    { ...complete, TEMPORAL_ADDRESS: "journal-test.a1b2c.tmprl.cloud:443" },
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
});
