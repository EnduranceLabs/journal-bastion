import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { VERSION } from "../version.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");

describe("VERSION", () => {
  it("matches the version in package.json", () => {
    const pkg = JSON.parse(
      readFileSync(join(repoRoot, "package.json"), "utf-8")
    );

    expect(VERSION).toBe(pkg.version);
  });

  it("is not the not-found fallback", () => {
    // Collapsing the three packages into one moved main.js from dist/ to
    // dist/cli/, which broke the manifest lookup and made `--version` report
    // 0.0.0. The value is customer-facing and goes on the wire as
    // bastionVersion, so it gets its own assertion.
    expect(VERSION).not.toBe("0.0.0");
  });
});
