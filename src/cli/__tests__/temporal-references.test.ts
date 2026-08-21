import { describe, expect, it } from "vitest";
import {
  readTemporalReference,
  TEMPORAL_REFERENCE_PATHS,
} from "../../integrations/temporal/references.js";

describe("Temporal reference policy", () => {
  it("reads every curated reference", async () => {
    for (const path of TEMPORAL_REFERENCE_PATHS) {
      const result = await readTemporalReference(path);
      expect(result.path).toBe(path);
      expect(result.content.length).toBeGreaterThan(50);
    }
  });

  it.each(["", "../authentication.md", "/etc/passwd", "nested/file.md"])(
    "rejects non-manifest path %s",
    async (path) => {
      await expect(readTemporalReference(path)).rejects.toThrow();
    }
  );
});
