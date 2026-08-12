import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Own config so this package does not inherit the repo-root `include`,
    // which is scoped to src/ and would match nothing here.
    include: ["*.test.ts"],
    testTimeout: 30_000,
  },
});
