import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Unit tests only. The integration suite under testing/integration needs a
    // built dist/ and is run separately via `pnpm test:integration`.
    include: ["src/**/*.test.ts"],
  },
});
