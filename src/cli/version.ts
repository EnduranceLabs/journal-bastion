import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Read the package version off disk.
 *
 * Walks up from this module looking for the package manifest rather than
 * hardcoding a depth, because the depth differs between running from source
 * (`src/cli/`) and running from the build (`dist/cli/`) — and silently returned
 * "0.0.0" the last time the tree was reorganised. The version is customer-facing
 * via `--version` and is sent on the wire as `bastionVersion`, so a wrong value
 * is not cosmetic. `version.test.ts` pins it to package.json.
 */
function loadVersion(): string {
  let dir = __dirname;

  for (let i = 0; i < 5; i++) {
    try {
      const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf-8"));
      if (typeof pkg.version === "string") {
        return pkg.version;
      }
    } catch {
      // not this directory; keep walking up
    }

    const parent = dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }

  return "0.0.0";
}

export const VERSION = loadVersion();
